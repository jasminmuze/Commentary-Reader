import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  db, pool, accountRequestLockPool, booksTable, usersTable, quotesTable,
  readingRoomsTable, roomMembersTable, commentsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { roomCommentScope } from "./roomComments";
import { activityFeedCommentPredicate, visibilityPredicate, type Viewer } from "./social";

test("ordinary book comments reach shared rooms without exposing private or other-room posts", async () => {
  const rollback = new Error("rollback-only room-comment fixtures");
  try {
    await db.transaction(async (tx) => {
      const tag = randomUUID();
      const [author, reader, outsider] = await tx.insert(usersTable).values(
        ["author", "reader", "outsider"].map((name) => ({
          username: `${tag}-${name}`, avatarColor: "#000000",
        })),
      ).returning();
      const [book, otherBook] = await tx.insert(booksTable).values(
        ["book", "other"].map((name) => ({
          title: name, author: tag, normTitle: name, normAuthor: tag, coverColor: "#000000",
        })),
      ).returning();
      const [quote, otherQuote] = await tx.insert(quotesTable).values(
        [book, otherBook].map((b) => ({
          canonicalBookId: b.id, text: tag, normText: tag, normTextHash: tag,
        })),
      ).returning();
      const [room, otherRoom] = await tx.insert(readingRoomsTable).values(
        ["room", "other-room"].map((name) => ({
          canonicalBookId: book.id, name, ownerId: author.id, isPublic: false,
        })),
      ).returning();
      await tx.insert(roomMembersTable).values([
        { roomId: room.id, userId: author.id },
        { roomId: room.id, userId: reader.id },
        { roomId: otherRoom.id, userId: author.id },
      ]);
      const rows = await tx.insert(commentsTable).values([
        { text: "ordinary-public", visibility: "public" as const },
        { text: "ordinary-friends", visibility: "friends" as const },
        { text: "ordinary-private", visibility: "private" as const },
        { text: "explicit-room", visibility: "room" as const, roomId: room.id },
        { text: "explicit-friends", visibility: "friends" as const, roomId: room.id },
        { text: "explicit-private", visibility: "private" as const, roomId: room.id },
        { text: "different-room", visibility: "room" as const, roomId: otherRoom.id },
        { text: "different-book", visibility: "friends" as const, quoteId: otherQuote.id },
        { text: "nonmember", visibility: "friends" as const, userId: outsider.id },
      ].map((c) => ({ quoteId: quote.id, userId: author.id, ...c }))).returning();
      const ids = rows.map((c) => c.id);
      const names = async (scope: ReturnType<typeof roomCommentScope>) =>
        (await tx.select({ text: commentsTable.text }).from(commentsTable)
          .where(and(inArray(commentsTable.id, ids), scope)))
          .map((c) => c.text).sort();
      const expected = ["explicit-friends", "explicit-room", "ordinary-friends", "ordinary-public"];
      assert.deepEqual(await names(roomCommentScope([room.id])), expected);
      assert.deepEqual(await names(roomCommentScope([])), []);
      const viewer: Viewer = { userId: reader.id, mutualIds: [], roomIds: [room.id], blockedIds: [] };
      const visible = (v: Viewer, includeRooms = true) => visibilityPredicate(
        commentsTable.visibility, commentsTable.userId, v, commentsTable.roomId, includeRooms,
      );
      assert.deepEqual(await names(visible(viewer)), expected);
      // The All activity feed includes room participants even when the viewer
      // follows nobody, alongside the existing followed-user community stream.
      assert.deepEqual(await names(activityFeedCommentPredicate([], viewer)), expected);
      // Community-only surfaces retain their original public/friends policy.
      assert.deepEqual(await names(visible(viewer, false)), ["ordinary-public"]);
      assert.deepEqual(await names(visible({ ...viewer, roomIds: [] })), ["ordinary-public"]);
      assert.deepEqual(await names(visible({ ...viewer, blockedIds: [author.id] })), []);
      assert.deepEqual(await names(activityFeedCommentPredicate([], { ...viewer, blockedIds: [author.id] })), []);
      assert.deepEqual(await names(activityFeedCommentPredicate([], { ...viewer, roomIds: [] })), []);
      // Multiple matching rooms do not duplicate a comment.
      assert.equal((await names(roomCommentScope([room.id, otherRoom.id]))).length, 5);
      await tx.delete(roomMembersTable).where(and(
        eq(roomMembersTable.roomId, room.id), eq(roomMembersTable.userId, author.id),
      ));
      assert.deepEqual(await names(roomCommentScope([room.id])), ["explicit-friends", "explicit-room"]);
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  } finally {
    await Promise.all([pool.end(), accountRequestLockPool.end()]);
  }
});
