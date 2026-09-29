import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  db,
  booksTable,
  commentLikesTable,
  commentsTable,
  quotesTable,
  roomMembersTable,
  usersTable,
} from "@workspace/db";
import { GetFeedQueryParams } from "@workspace/api-zod";
import type { FeedItem, FeedPage } from "@workspace/api-zod";
import {
  getFollowingIds,
  getViewer,
  visibilityPredicate,
} from "../lib/social";
import { getOwnedBookIds, truncateQuoteText } from "../lib/contentLimits";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

/**
 * Cursors retain the old type rank for compatibility with already-issued
 * cursors, even though this feed now includes comments only.
 */
const COMMENT_RANK = 1;

interface FeedCursor {
  t: string; // createdAt ISO (ms precision)
  r: number; // type rank
  i: number; // row id
}

function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): FeedCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    if (
      typeof c.t !== "string" ||
      Number.isNaN(new Date(c.t).getTime()) ||
      typeof c.r !== "number" ||
      !Number.isInteger(c.r) ||
      typeof c.i !== "number" ||
      !Number.isInteger(c.i)
    ) {
      return null;
    }
    return { t: c.t, r: c.r, i: c.i };
  } catch {
    return null;
  }
}

/** Row-comparison predicate: rows strictly after `cursor` in feed order. */
function cursorPredicate(
  createdAtCol: AnyPgColumn,
  idCol: AnyPgColumn,
  typeRank: number,
  cursor: FeedCursor,
): SQL {
  return sql`(date_trunc('milliseconds', ${createdAtCol}), ${typeRank}, ${idCol}) < (${cursor.t}::timestamptz, ${cursor.r}, ${cursor.i})`;
}

// Activity feed: recent comments from users the viewer follows,
// visibility-filtered (public always; friends-only when mutual), newest first.
router.get("/feed", authenticate, async (req, res): Promise<void> => {
  const qp = GetFeedQueryParams.safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ error: qp.error.message });
    return;
  }
  const limit = qp.data.limit;
  let cursor: FeedCursor | null = null;
  if (qp.data.cursor !== undefined) {
    cursor = decodeCursor(qp.data.cursor);
    if (!cursor) {
      res.status(400).json({ error: "Invalid cursor" });
      return;
    }
  }

  const userId = req.userId;
  const roomId = qp.data.roomId;

  // Room-scoped feed: show all comments in the room (not just followed users),
  // restricted to members. Room rows are visible to every member regardless
  // of the row's visibility setting, matching the room feed screen.
  if (roomId !== undefined) {
    const [membership] = await db
      .select({ id: roomMembersTable.id })
      .from(roomMembersTable)
      .where(
        and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, userId)),
      );
    if (!membership) {
      res.status(403).json({ error: "Members only" });
      return;
    }
  }

  const followingIds = roomId === undefined ? await getFollowingIds(userId) : [];
  if (roomId === undefined && followingIds.length === 0) {
    const empty: FeedPage = { items: [], nextCursor: null };
    res.json(empty);
    return;
  }
  const viewer = await getViewer(userId);

  const commentFilters: SQL[] =
    roomId !== undefined
      ? [eq(commentsTable.roomId, roomId)]
      : [
          inArray(commentsTable.userId, followingIds),
          visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer, commentsTable.roomId),
        ];
  if (cursor) {
    commentFilters.push(
      cursorPredicate(
        commentsTable.createdAt,
        commentsTable.id,
        COMMENT_RANK,
        cursor,
      ),
    );
  }

  const commentRows = await db
    .select({
      id: commentsTable.id,
      userId: commentsTable.userId,
      username: usersTable.username,
      nickname: usersTable.nickname,
      avatarUrl: usersTable.avatarUrl,
      avatarColor: usersTable.avatarColor,
      quoteId: quotesTable.id,
      quoteText: quotesTable.text,
      commentText: commentsTable.text,
      containsSpoilers: commentsTable.containsSpoilers,
      bookId: booksTable.id,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      coverColor: booksTable.coverColor,
      coverUrl: booksTable.coverUrl,
      likeCount: commentsTable.likeCount,
      createdAt: commentsTable.createdAt,
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .innerJoin(booksTable, eq(quotesTable.canonicalBookId, booksTable.id))
    .where(and(...commentFilters))
    .orderBy(desc(commentsTable.createdAt), desc(commentsTable.id))
    .limit(limit + 1);

  const page = commentRows.slice(0, limit);
  const hasMore = commentRows.length > limit;

  // Copyright guardrail: full quote text only for books the viewer owns.
  const ownedBookIds = await getOwnedBookIds(userId, [
    ...new Set(page.map((r) => r.bookId)),
  ]);

  // Like state for the comments on this page.
  const commentIds = page.map((r) => r.id);

  const likedCommentIds = new Set<number>();
  if (commentIds.length > 0) {
    const myLikes = await db
      .select({ commentId: commentLikesTable.commentId })
      .from(commentLikesTable)
      .where(
        and(
          inArray(commentLikesTable.commentId, commentIds),
          eq(commentLikesTable.userId, userId),
        ),
      );
    for (const row of myLikes) likedCommentIds.add(row.commentId);
  }

  const items: FeedItem[] = page.map((r) => {
    const owned = ownedBookIds.has(r.bookId);
    const preview = owned
      ? { text: r.quoteText, truncated: false }
      : truncateQuoteText(r.quoteText);
    return {
      type: "comment",
      id: r.id,
      userId: r.userId,
      username: r.username,
      nickname: r.nickname ?? null,
      avatarUrl: r.avatarUrl ?? null,
      avatarColor: r.avatarColor,
      bookId: r.bookId,
      bookTitle: r.bookTitle,
      bookAuthor: r.bookAuthor,
      coverColor: r.coverColor,
      coverUrl: r.coverUrl ?? null,
      quoteId: r.quoteId,
      quoteText: preview.text,
      quoteTextTruncated: preview.truncated,
      commentText: r.commentText,
      likeCount: r.likeCount,
      likedByMe: likedCommentIds.has(r.id),
      containsSpoilers: r.containsSpoilers,
      createdAt: r.createdAt,
    };
  });

  const last = page[page.length - 1];
  const result: FeedPage = {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            t: last.createdAt.toISOString(),
            r: COMMENT_RANK,
            i: last.id,
          })
        : null,
  };
  res.json(result);
});

export default router;
