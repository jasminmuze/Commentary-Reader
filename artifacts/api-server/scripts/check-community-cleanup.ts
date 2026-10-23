import assert from "node:assert/strict";
import {
  db, pool, usersTable, commentsTable, userHighlightsTable,
  readingRoomsTable, roomMembersTable, commentLikesTable,
} from "../../../lib/db/src/index.ts";
import { buildCleanupPlan } from "../src/lib/communityCleanupPlan.ts";

// All fixture writes are inside a transaction that ALWAYS rolls back.
// This does not enable or invoke the destructive HTTP endpoint.
const rollback = new Error("ROLLBACK_CLEANUP_FIXTURES");
try {
  await db.transaction(async (tx) => {
    const users = await tx.select({ id: usersTable.id, username: usersTable.username }).from(usersTable);
    let bookwormId = users.find((user) => user.username === "bookworm")?.id;
    if (!bookwormId) {
      const [user] = await tx.insert(usersTable).values({
        id: -910001, username: "bookworm", avatarColor: "#000000",
      }).returning({ id: usersTable.id });
      bookwormId = user!.id;
    }
    if (!users.some((user) => user.username === "violet")) {
      await tx.insert(usersTable).values({
        id: -910002, username: "violet", avatarColor: "#000000",
      });
    }
    const targetId = -910003;
    const parentId = -910004;
    const privateCommentId = -910005;
    const replyId = -910006;
    const roomId = -910007;
    const publicHighlightId = -910008;
    const privateHighlightId = -910009;
    await tx.insert(usersTable).values({
      id: targetId, username: "__cleanup_rollback_fixture__", avatarColor: "#000000",
    });
    await tx.insert(readingRoomsTable).values({
      id: roomId, canonicalBookId: -1, name: "Rollback fixture", ownerId: targetId,
    });
    await tx.insert(roomMembersTable).values([
      { id: -910010, roomId, userId: bookwormId, role: "member" },
      { id: -910011, roomId, userId: targetId, role: "owner" },
    ]);
    await tx.insert(commentsTable).values([
      { id: parentId, quoteId: -1, userId: targetId, text: "Delete fixture", visibility: "public", roomId },
      { id: privateCommentId, quoteId: -1, userId: targetId, text: "Keep private fixture", visibility: "private", roomId },
      { id: replyId, quoteId: -1, userId: bookwormId, text: "Keep reply fixture", visibility: "public", parentId, roomId },
    ]);
    await tx.insert(userHighlightsTable).values([
      { id: publicHighlightId, quoteId: -1, userId: targetId, visibility: "public", roomId },
      { id: privateHighlightId, quoteId: -2, userId: targetId, visibility: "private", roomId },
    ]);
    await tx.insert(commentLikesTable).values([
      { id: -910012, commentId: parentId, userId: bookwormId },
      { id: -910013, commentId: replyId, userId: targetId },
    ]);

    const plan = await buildCleanupPlan(tx);
    assert(plan.commentIdsToDelete.includes(parentId));
    assert(!plan.commentIdsToDelete.includes(privateCommentId));
    assert(!plan.commentIdsToDelete.includes(replyId));
    assert(plan.replyIdsToDetach.includes(replyId));
    assert(plan.highlightIdsToDelete.includes(publicHighlightId));
    assert(!plan.highlightIdsToDelete.includes(privateHighlightId));
    assert(plan.roomIdsToArchive.includes(roomId));
    assert(!plan.roomIdsToDelete.includes(roomId));
    assert(!plan.roomMemberIdsToDelete.includes(-910010));
    assert(plan.roomMemberIdsToDelete.includes(-910011));
    assert(plan.commentLikeIdsToDelete.includes(-910012));
    assert(plan.commentLikeIdsToDelete.includes(-910013));
    assert(plan.affectedCommentIdsWithSurvivingLikes.includes(replyId));
    assert.equal(plan.snapshotHash, (await buildCleanupPlan(tx)).snapshotHash);
    console.log("PASS: protected replies, private content, room access, related likes, and stable preview hash.");
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  console.log("PASS: fixture transaction rolled back; no records committed.");
} finally {
  await pool.end();
}
