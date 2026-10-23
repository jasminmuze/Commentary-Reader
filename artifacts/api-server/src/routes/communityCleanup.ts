import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  communityCleanupRunsTable,
  commentLikesTable,
  commentSavesTable,
  commentsTable,
  db,
  friendRequestsTable,
  friendshipsTable,
  highlightLikesTable,
  notificationsTable,
  readingRoomsTable,
  roomInvitesTable,
  roomMembersTable,
  userHighlightsTable,
  usersTable,
} from "@workspace/db";
import { acquireAccountRequestLocks } from "../lib/accountRequestLocks.js";
import {
  authenticate,
  authenticateWithoutAccountLocks,
} from "../middlewares/authenticate.js";

const router: IRouter = Router();
const SCOPE_KEY = "prelaunch-community-cleanup-v1";
const KEEP_USERNAMES = ["bookworm", "violet"] as const;
const REQUIRED_CONFIRMATION = "DELETE COMMUNITY RECORDS";

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

function adminUserId(): number | null {
  const value = Number(process.env.COMMUNITY_CLEANUP_ADMIN_USER_ID);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function applyEnabled(): boolean {
  return process.env.COMMUNITY_CLEANUP_APPLY_ENABLED === "true";
}

function isCleanupAdmin(userId: number): boolean {
  const configuredAdminId = adminUserId();
  return configuredAdminId !== null && configuredAdminId === userId;
}

async function buildCleanupPlan(): Promise<CleanupPlan> {
  const users = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable);
  const keptUsers = users.filter((user) =>
    (KEEP_USERNAMES as readonly string[]).includes(user.username),
  );
  if (keptUsers.length !== KEEP_USERNAMES.length) {
    throw new Error("One or more protected accounts are missing");
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

function requireAdmin(req: Parameters<typeof authenticate>[0], res: Parameters<typeof authenticate>[1]): boolean {
  if (!isCleanupAdmin(req.userId)) {
    res.status(404).json({ error: "Not found" });
    return false;
  }
  return true;
}

router.get("/admin/community-cleanup", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(CLEANUP_PAGE);
});

router.get("/admin/community-cleanup/preview", authenticate, async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const [existingRun] = await db
      .select({ appliedAt: communityCleanupRunsTable.appliedAt })
      .from(communityCleanupRunsTable)
      .where(eq(communityCleanupRunsTable.scopeKey, SCOPE_KEY))
      .limit(1);
    const plan = await buildCleanupPlan();
    res.json({
      state: existingRun ? "already_applied" : "ready",
      keepUsernames: KEEP_USERNAMES,
      targetAccountCount: plan.targetAccountCount,
      counts: plan.counts,
      snapshotHash: plan.snapshotHash,
      applyEnabled: applyEnabled(),
      appliedAt: existingRun?.appliedAt ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Community cleanup preview failed");
    res.status(500).json({ error: "Could not build a safe cleanup preview" });
  }
});

router.post(
  "/admin/community-cleanup/apply",
  authenticateWithoutAccountLocks,
  async (req, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    if (!applyEnabled()) {
      res.status(403).json({ error: "Cleanup apply is disabled" });
      return;
    }
    if (
      req.body?.confirmation !== REQUIRED_CONFIRMATION ||
      typeof req.body?.snapshotHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(req.body.snapshotHash)
    ) {
      res.status(400).json({ error: "A current preview and exact confirmation are required" });
      return;
    }

    let releaseLock: (() => Promise<void>) | undefined;
    try {
      // The cleanup route deliberately skipped the normal shared lock in
      // authenticateWithoutAccountLocks. This exclusive global lock fences
      // every authenticated writer while the snapshot is rechecked and applied.
      releaseLock = await acquireAccountRequestLocks(req.userId, "exclusive");
      const plan = await buildCleanupPlan();
      if (plan.snapshotHash !== req.body.snapshotHash) {
        res.status(409).json({
          error: "Community data changed since preview. Refresh the preview before continuing.",
        });
        return;
      }

      await db.transaction(async (tx) => {
        const [alreadyApplied] = await tx
          .select({ scopeKey: communityCleanupRunsTable.scopeKey })
          .from(communityCleanupRunsTable)
          .where(eq(communityCleanupRunsTable.scopeKey, SCOPE_KEY))
          .limit(1);
        if (alreadyApplied) {
          throw new Error("This one-time cleanup has already been applied");
        }

        await tx.insert(communityCleanupRunsTable).values({
          scopeKey: SCOPE_KEY,
          requestedByUserId: req.userId,
          previewHash: plan.snapshotHash,
          affectedCounts: plan.counts,
        });

        if (plan.replyIdsToDetach.length) {
          await tx
            .update(commentsTable)
            .set({ parentId: null })
            .where(inArray(commentsTable.id, plan.replyIdsToDetach));
        }

        if (plan.commentLikeIdsToDelete.length) {
          await tx
            .delete(commentLikesTable)
            .where(inArray(commentLikesTable.id, plan.commentLikeIdsToDelete));
        }
        if (plan.commentSaveIdsToDelete.length) {
          await tx
            .delete(commentSavesTable)
            .where(inArray(commentSavesTable.id, plan.commentSaveIdsToDelete));
        }
        for (const commentId of plan.affectedCommentIdsWithSurvivingLikes) {
          await tx
            .update(commentsTable)
            .set({
              likeCount: sql`(SELECT COUNT(*)::int FROM comment_likes WHERE comment_id = ${commentId})`,
            })
            .where(eq(commentsTable.id, commentId));
        }
        if (plan.highlightLikeIdsToDelete.length) {
          await tx
            .delete(highlightLikesTable)
            .where(inArray(highlightLikesTable.id, plan.highlightLikeIdsToDelete));
        }
        if (plan.notificationIdsToDelete.length) {
          await tx
            .delete(notificationsTable)
            .where(inArray(notificationsTable.id, plan.notificationIdsToDelete));
        }
        if (plan.commentIdsToDelete.length) {
          await tx
            .delete(commentsTable)
            .where(inArray(commentsTable.id, plan.commentIdsToDelete));
        }
        if (plan.highlightIdsToDelete.length) {
          await tx
            .delete(userHighlightsTable)
            .where(inArray(userHighlightsTable.id, plan.highlightIdsToDelete));
        }
        if (plan.friendshipIdsToDelete.length) {
          await tx
            .delete(friendshipsTable)
            .where(inArray(friendshipsTable.id, plan.friendshipIdsToDelete));
        }
        if (plan.friendRequestIdsToDelete.length) {
          await tx
            .delete(friendRequestsTable)
            .where(inArray(friendRequestsTable.id, plan.friendRequestIdsToDelete));
        }
        if (plan.roomInviteIdsToDelete.length) {
          await tx
            .delete(roomInvitesTable)
            .where(inArray(roomInvitesTable.id, plan.roomInviteIdsToDelete));
        }
        if (plan.roomMemberIdsToDelete.length) {
          await tx
            .delete(roomMembersTable)
            .where(inArray(roomMembersTable.id, plan.roomMemberIdsToDelete));
        }
        if (plan.roomIdsToArchive.length) {
          await tx
            .update(readingRoomsTable)
            .set({ ownerId: null, isPublic: false })
            .where(inArray(readingRoomsTable.id, plan.roomIdsToArchive));
          await tx
            .update(roomMembersTable)
            .set({ role: "member" })
            .where(inArray(roomMembersTable.roomId, plan.roomIdsToArchive));
        }
        if (plan.roomIdsToDelete.length) {
          await tx
            .delete(readingRoomsTable)
            .where(inArray(readingRoomsTable.id, plan.roomIdsToDelete));
        }
      });

      res.json({ ok: true, state: "applied", counts: plan.counts });
    } catch (err) {
      req.log.error({ err, userId: req.userId }, "Community cleanup apply failed");
      const message = err instanceof Error ? err.message : "";
      if (message.includes("already been applied")) {
        res.status(409).json({ error: "This one-time cleanup has already been applied" });
        return;
      }
      res.status(500).json({ error: "Cleanup failed; no partial changes were committed" });
    } finally {
      if (releaseLock) {
        try {
          await releaseLock();
        } catch (err) {
          req.log.error({ err, userId: req.userId }, "Failed to release cleanup lock");
        }
      }
    }
  },
);

const CLEANUP_PAGE = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shelfmates community cleanup</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, sans-serif; color: #30251f; background: #f9f6f0; }
    body { margin: 0; padding: 24px 16px 48px; }
    main { max-width: 680px; margin: 0 auto; }
    section { background: #fff; border: 1px solid #e8ded3; border-radius: 16px; padding: 20px; margin: 16px 0; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    p { line-height: 1.55; }
    label { display: block; font-weight: 600; margin: 12px 0 6px; }
    input { box-sizing: border-box; width: 100%; border: 1px solid #cfc2b7; border-radius: 9px; padding: 12px; font: inherit; }
    button { border: 0; border-radius: 9px; padding: 12px 16px; margin-top: 14px; font: inherit; font-weight: 700; background: #b85c38; color: white; }
    button:disabled { opacity: .48; }
    button.danger { background: #8b2d22; }
    .muted { color: #62564e; font-size: 14px; }
    .notice { padding: 12px; border-radius: 9px; background: #f5eee6; white-space: pre-wrap; }
    .error { color: #9a2117; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; }
    dt { color: #62564e; } dd { margin: 0; font-weight: 700; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
<main>
  <h1>커뮤니티 기록 정리</h1>
  <p class="muted">관리자 계정으로만 미리보기를 볼 수 있습니다. 이 도구는 사용자 계정, 서재, EPUB, 프로필, 비공개 기록은 삭제하지 않습니다.</p>
  <section>
    <h2>관리자 로그인</h2>
    <form id="loginForm">
      <label for="identifier">사용자 이름</label>
      <input id="identifier" autocomplete="username" value="bookworm">
      <label for="password">비밀번호</label>
      <input id="password" type="password" autocomplete="current-password">
      <button id="login" type="submit">로그인</button>
    </form>
  </section>
  <section id="previewSection" hidden>
    <h2>정리 미리보기</h2>
    <p>보존 계정: <strong>bookworm</strong>, <strong>violet</strong>. 나머지 계정은 유지하고 공개 커뮤니티 기록만 정리합니다.</p>
    <p class="muted">보존 계정의 답글은 부모 댓글이 삭제되면 독립 댓글로 남깁니다. 보존 계정이 참여한 다른 사용자 소유 방은 제한 보관합니다.</p>
    <button id="refresh">최신 미리보기 불러오기</button>
    <div id="summary" class="notice" role="status" aria-live="polite">미리보기를 불러오세요.</div>
    <div id="countsWrap" hidden><dl id="counts"></dl></div>
  </section>
  <section id="applySection" hidden>
    <h2>실행 확인</h2>
    <p class="muted">실행은 별도 설정이 켜져 있을 때만 가능합니다. 현재 미리보기 해시와 정확한 확인 문구가 모두 필요하며, 한 번 성공하면 다시 실행할 수 없습니다.</p>
    <label for="confirmation">확인 문구: DELETE COMMUNITY RECORDS</label>
    <input id="confirmation" autocomplete="off">
    <button id="apply" class="danger" disabled>커뮤니티 기록 정리 실행</button>
  </section>
  <p id="message" class="notice" role="status" aria-live="polite" hidden></p>
</main>
<script>
let token = "";
let snapshotHash = "";
let currentPreview = null;
const $ = (id) => document.getElementById(id);
const message = (text, isError = false) => {
  $("message").textContent = text;
  $("message").className = isError ? "notice error" : "notice";
  $("message").hidden = !text;
};
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login").disabled = true;
  try {
    const data = await request("/api/users/login", {
      method: "POST",
      body: JSON.stringify({ identifier: $("identifier").value.trim(), password: $("password").value }),
    });
    token = data.token;
    $("password").value = "";
    $("previewSection").hidden = false;
    $("applySection").hidden = false;
    message("로그인되었습니다. 최신 미리보기를 불러오세요.");
  } catch (error) {
    message(error.message || "로그인하지 못했습니다.", true);
  } finally {
    $("login").disabled = false;
  }
});
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  try {
    currentPreview = await request("/api/admin/community-cleanup/preview");
    snapshotHash = currentPreview.snapshotHash;
    $("summary").textContent = currentPreview.state === "already_applied"
      ? "이미 실행된 1회성 정리입니다. 다시 실행할 수 없습니다."
      : "보존 계정: " + currentPreview.keepUsernames.join(", ") +
        "\\n정리 대상 계정 수: " + currentPreview.targetAccountCount +
        "\\n적용 잠금: " + (currentPreview.applyEnabled ? "해제됨 (다시 확인 후 실행 가능)" : "잠김 (미리보기 전용)") +
        "\\n최신 데이터를 기준으로 계산했습니다.";
    const labels = {
      accountsPreserved: "계정(모두 유지)",
      accountsTargetedForCommunityCleanup: "커뮤니티 기록 정리 대상 계정",
      commentsDeleted: "공개 댓글/답글 삭제",
      retainedRepliesDetached: "보존 계정 답글 분리 후 유지",
      publicHighlightsDeleted: "공개 하이라이트 삭제",
      commentLikesDeleted: "댓글 좋아요 삭제",
      commentSavesDeleted: "댓글 저장 삭제",
      highlightLikesDeleted: "하이라이트 좋아요 삭제",
      friendshipsDeleted: "친구 관계 삭제",
      friendRequestsDeleted: "친구 요청 삭제",
      notificationsDeleted: "관련 알림 삭제",
      roomInvitesDeleted: "방 초대 삭제",
      roomMembershipsDeleted: "방 멤버십 삭제",
      roomsArchived: "제한 보관할 방",
      roomsDeleted: "삭제할 방",
    };
    $("counts").replaceChildren();
    for (const [key, label] of Object.entries(labels)) {
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = label;
      value.textContent = String(currentPreview.counts[key] ?? 0);
      $("counts").append(term, value);
    }
    $("countsWrap").hidden = false;
    $("apply").disabled = currentPreview.state !== "ready" ||
      !currentPreview.applyEnabled ||
      $("confirmation").value !== "DELETE COMMUNITY RECORDS";
    message("미리보기가 갱신되었습니다. 여기서는 운영 데이터가 변경되지 않았습니다.");
  } catch (error) {
    message(error.message || "미리보기를 불러오지 못했습니다.", true);
  } finally {
    $("refresh").disabled = false;
  }
});
$("confirmation").addEventListener("input", () => {
  $("apply").disabled = !currentPreview ||
    currentPreview.state !== "ready" ||
    !currentPreview.applyEnabled ||
    $("confirmation").value !== "DELETE COMMUNITY RECORDS";
});
$("apply").addEventListener("click", async () => {
  if (!currentPreview || $("confirmation").value !== "DELETE COMMUNITY RECORDS") return;
  if (!window.confirm("미리보기의 공개 커뮤니티 기록을 정리할까요? 계정과 비공개 기록은 유지됩니다.")) return;
  $("apply").disabled = true;
  try {
    const result = await request("/api/admin/community-cleanup/apply", {
      method: "POST",
      body: JSON.stringify({ snapshotHash, confirmation: $("confirmation").value }),
    });
    currentPreview = { ...currentPreview, state: "already_applied" };
    $("summary").textContent = "정리가 완료되었습니다. 이 1회성 절차는 다시 실행할 수 없습니다.";
    $("counts").replaceChildren();
    for (const [key, value] of Object.entries(result.counts || {})) {
      const term = document.createElement("dt");
      const count = document.createElement("dd");
      term.textContent = key;
      count.textContent = String(value);
      $("counts").append(term, count);
    }
    $("confirmation").value = "";
    message("완료되었습니다. 계정은 삭제하지 않았습니다.");
  } catch (error) {
    message(error.message || "정리를 완료하지 못했습니다. 최신 미리보기를 다시 확인하세요.", true);
    $("apply").disabled = true;
  }
});
</script>
</body>
</html>`;

export default router;
