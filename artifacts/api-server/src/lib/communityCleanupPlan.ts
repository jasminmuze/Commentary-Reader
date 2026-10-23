import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db as defaultDb, usersTable, commentsTable, userHighlightsTable, commentLikesTable, commentSavesTable, highlightLikesTable, friendshipsTable, friendRequestsTable, notificationsTable, readingRoomsTable, roomMembersTable, roomInvitesTable } from "@workspace/db";

export const KEEP_USERNAMES = ["bookworm", "violet"] as const;

type CleanupCounts = Record<string, number>;

type CleanupPlan = {
  targetUserIds: number[];
  targetAccountCount: number;
  commentIdsToDelete: number[];
  replyIdsToDetach: number[];
  highlightIdsToDelete: number[];
  commentLikeIdsToDelete: number[];
  commentSaveIdsToDelete: number[];
  highlightLikeIdsToDelete: number[];
  friendshipIdsToDelete: number[];
  friendRequestIdsToDelete: number[];
  notificationIdsToDelete: number[];
  roomInviteIdsToDelete: number[];
  roomMemberIdsToDelete: number[];
  roomIdsToArchive: number[];
  roomIdsToDelete: number[];
  affectedCommentIdsWithSurvivingLikes: number[];
  counts: CleanupCounts;
  snapshotHash: string;
};

export class CleanupPreconditionError extends Error {}

export async function buildCleanupPlan(
  db: Pick<typeof defaultDb, "select"> = defaultDb,
): Promise<CleanupPlan> {
  const users = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable);
  const keptUsers = users.filter((user) =>
    (KEEP_USERNAMES as readonly string[]).includes(user.username),
  );
  if (keptUsers.length !== KEEP_USERNAMES.length) {
    throw new CleanupPreconditionError(
      "Both protected accounts (bookworm and violet) must exist. No cleanup is allowed.",
    );
  }

  const keepUserIds = keptUsers.map((user) => user.id);
  const targetUsers = users.filter((user) => !keepUserIds.includes(user.id));
  const targetUserIds = targetUsers.map((user) => user.id);
  const targetUserIdSet = new Set(targetUserIds);
  const keepUserIdSet = new Set(keepUserIds);

  const [comments, highlights, commentLikes, commentSaves, highlightLikes,
    friendships, friendRequests, notifications, rooms, roomMembers, roomInvites] =
    await Promise.all([
      db.select({
        id: commentsTable.id,
        userId: commentsTable.userId,
        visibility: commentsTable.visibility,
        parentId: commentsTable.parentId,
        roomId: commentsTable.roomId,
      }).from(commentsTable),
      db.select({
        id: userHighlightsTable.id,
        userId: userHighlightsTable.userId,
        visibility: userHighlightsTable.visibility,
        roomId: userHighlightsTable.roomId,
      }).from(userHighlightsTable),
      db.select({
        id: commentLikesTable.id,
        userId: commentLikesTable.userId,
        commentId: commentLikesTable.commentId,
      }).from(commentLikesTable),
      db.select({
        id: commentSavesTable.id,
        userId: commentSavesTable.userId,
        commentId: commentSavesTable.commentId,
      }).from(commentSavesTable),
      db.select({
        id: highlightLikesTable.id,
        userId: highlightLikesTable.userId,
        highlightId: highlightLikesTable.highlightId,
      }).from(highlightLikesTable),
      db.select({
        id: friendshipsTable.id,
        userId: friendshipsTable.userId,
        friendId: friendshipsTable.friendId,
      }).from(friendshipsTable),
      db.select({
        id: friendRequestsTable.id,
        requesterId: friendRequestsTable.requesterId,
        recipientId: friendRequestsTable.recipientId,
      }).from(friendRequestsTable),
      db.select({
        id: notificationsTable.id,
        userId: notificationsTable.userId,
        actorId: notificationsTable.actorId,
        commentId: notificationsTable.commentId,
        highlightId: notificationsTable.highlightId,
        roomId: notificationsTable.roomId,
      }).from(notificationsTable),
      targetUserIds.length
        ? db.select({
            id: readingRoomsTable.id,
            ownerId: readingRoomsTable.ownerId,
          }).from(readingRoomsTable)
            .where(inArray(readingRoomsTable.ownerId, targetUserIds))
        : Promise.resolve([]),
      db.select({
        id: roomMembersTable.id,
        roomId: roomMembersTable.roomId,
        userId: roomMembersTable.userId,
      }).from(roomMembersTable),
      db.select({
        id: roomInvitesTable.id,
        roomId: roomInvitesTable.roomId,
        inviterId: roomInvitesTable.inviterId,
        inviteeId: roomInvitesTable.inviteeId,
      }).from(roomInvitesTable),
    ]);

  const commentIdsToDelete = comments
    .filter((comment) =>
      targetUserIdSet.has(comment.userId) && comment.visibility !== "private",
    )
    .map((comment) => comment.id)
    .sort((a, b) => a - b);
  const commentDeleteSet = new Set(commentIdsToDelete);
  const replyIdsToDetach = comments
    .filter((comment) =>
      comment.parentId !== null &&
      commentDeleteSet.has(comment.parentId) &&
      !commentDeleteSet.has(comment.id),
    )
    .map((comment) => comment.id)
    .sort((a, b) => a - b);

  const highlightIdsToDelete = highlights
    .filter((highlight) =>
      targetUserIdSet.has(highlight.userId) &&
      highlight.visibility !== "private",
    )
    .map((highlight) => highlight.id)
    .sort((a, b) => a - b);
  const commentLikeIdsToDelete = commentLikes
    .filter((like) =>
      targetUserIdSet.has(like.userId) || commentDeleteSet.has(like.commentId),
    )
    .map((like) => like.id)
    .sort((a, b) => a - b);
  const commentLikeDeleteSet = new Set(commentLikeIdsToDelete);
  const commentSaveIdsToDelete = commentSaves
    .filter((save) =>
      targetUserIdSet.has(save.userId) || commentDeleteSet.has(save.commentId),
    )
    .map((save) => save.id)
    .sort((a, b) => a - b);
  const highlightDeleteSet = new Set(highlightIdsToDelete);
  const highlightLikeIdsToDelete = highlightLikes
    .filter((like) =>
      targetUserIdSet.has(like.userId) ||
      highlightDeleteSet.has(like.highlightId),
    )
    .map((like) => like.id)
    .sort((a, b) => a - b);
  const friendshipIdsToDelete = friendships
    .filter((row) =>
      targetUserIdSet.has(row.userId) || targetUserIdSet.has(row.friendId),
    )
    .map((row) => row.id)
    .sort((a, b) => a - b);
  const friendRequestIdsToDelete = friendRequests
    .filter((row) =>
      targetUserIdSet.has(row.requesterId) ||
      targetUserIdSet.has(row.recipientId),
    )
    .map((row) => row.id)
    .sort((a, b) => a - b);

  const targetRoomIds = rooms.map((room) => room.id).sort((a, b) => a - b);
  const targetRoomIdSet = new Set(targetRoomIds);
  const commentsToPreserve = comments.filter(
    (comment) => !commentDeleteSet.has(comment.id),
  );
  const highlightsToPreserve = highlights.filter(
    (highlight) => !highlightDeleteSet.has(highlight.id),
  );
  const roomIdsToArchive: number[] = [];
  const roomIdsToDelete: number[] = [];
  for (const roomId of targetRoomIds) {
    const hasKeptMembers = roomMembers.some(
      (member) => member.roomId === roomId && keepUserIdSet.has(member.userId),
    );
    const hasRetainedContent = commentsToPreserve.some(
      (comment) => comment.roomId === roomId,
    ) || highlightsToPreserve.some((highlight) => highlight.roomId === roomId);
    if (hasKeptMembers || hasRetainedContent) {
      roomIdsToArchive.push(roomId);
    } else {
      roomIdsToDelete.push(roomId);
    }
  }
  const roomIdsToArchiveSet = new Set(roomIdsToArchive);
  const roomIdsToDeleteSet = new Set(roomIdsToDelete);

  const roomMemberIdsToDelete = roomMembers
    .filter((member) =>
      targetUserIdSet.has(member.userId) || roomIdsToDeleteSet.has(member.roomId),
    )
    .map((member) => member.id)
    .sort((a, b) => a - b);
  const roomInviteIdsToDelete = roomInvites
    .filter((invite) =>
      targetUserIdSet.has(invite.inviterId) ||
      targetUserIdSet.has(invite.inviteeId) ||
      targetRoomIdSet.has(invite.roomId),
    )
    .map((invite) => invite.id)
    .sort((a, b) => a - b);
  const notificationIdsToDelete = notifications
    .filter((notification) =>
      targetUserIdSet.has(notification.userId) ||
      targetUserIdSet.has(notification.actorId) ||
      (notification.commentId !== null &&
        commentDeleteSet.has(notification.commentId)) ||
      (notification.highlightId !== null &&
        highlightDeleteSet.has(notification.highlightId)) ||
      (notification.roomId !== null &&
        targetRoomIdSet.has(notification.roomId)),
    )
    .map((notification) => notification.id)
    .sort((a, b) => a - b);

  const survivingLikedCommentIds = [...new Set(
    commentLikes
      .filter((like) =>
        commentLikeDeleteSet.has(like.id) &&
        !commentDeleteSet.has(like.commentId),
      )
      .map((like) => like.commentId),
  )].sort((a, b) => a - b);

  const counts: CleanupCounts = {
    accountsPreserved: users.length,
    accountsTargetedForCommunityCleanup: targetUsers.length,
    commentsDeleted: commentIdsToDelete.length,
    retainedRepliesDetached: replyIdsToDetach.length,
    publicHighlightsDeleted: highlightIdsToDelete.length,
    commentLikesDeleted: commentLikeIdsToDelete.length,
    commentSavesDeleted: commentSaveIdsToDelete.length,
    highlightLikesDeleted: highlightLikeIdsToDelete.length,
    friendshipsDeleted: friendshipIdsToDelete.length,
    friendRequestsDeleted: friendRequestIdsToDelete.length,
    notificationsDeleted: notificationIdsToDelete.length,
    roomInvitesDeleted: roomInviteIdsToDelete.length,
    roomMembershipsDeleted: roomMemberIdsToDelete.length,
    roomsArchived: roomIdsToArchive.length,
    roomsDeleted: roomIdsToDelete.length,
  };
  const hashPayload = {
    targetUserIds: [...targetUserIds].sort((a, b) => a - b),
    commentIdsToDelete,
    replyIdsToDetach,
    highlightIdsToDelete,
    commentLikeIdsToDelete,
    commentSaveIdsToDelete,
    highlightLikeIdsToDelete,
    friendshipIdsToDelete,
    friendRequestIdsToDelete,
    notificationIdsToDelete,
    roomInviteIdsToDelete,
    roomMemberIdsToDelete,
    roomIdsToArchive,
    roomIdsToDelete,
  };
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(hashPayload))
    .digest("hex");

  return {
    targetUserIds,
    targetAccountCount: targetUsers.length,
    commentIdsToDelete,
    replyIdsToDetach,
    highlightIdsToDelete,
    commentLikeIdsToDelete,
    commentSaveIdsToDelete,
    highlightLikeIdsToDelete,
    friendshipIdsToDelete,
    friendRequestIdsToDelete,
    notificationIdsToDelete,
    roomInviteIdsToDelete,
    roomMemberIdsToDelete,
    roomIdsToArchive,
    roomIdsToDelete,
    affectedCommentIdsWithSurvivingLikes: survivingLikedCommentIds,
    counts,
    snapshotHash,
  };
}

