import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  db,
  booksTable,
  commentLikesTable,
  commentsTable,
  highlightLikesTable,
  quotesTable,
  userHighlightsTable,
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
 * Feed items are totally ordered by (createdAt, typeRank, id) descending so
 * pagination can resume exactly after the last item even when timestamps
 * collide. The opaque cursor encodes all three components; timestamps are
 * compared at millisecond precision (JS Date resolution) via date_trunc.
 */
const TYPE_RANK = { highlight: 0, comment: 1 } as const;

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

// Activity feed: recent highlights and comments from users the viewer follows,
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
  const followingIds = await getFollowingIds(userId);
  if (followingIds.length === 0) {
    const empty: FeedPage = { items: [], nextCursor: null };
    res.json(empty);
    return;
  }
  const viewer = await getViewer(userId);

  const highlightFilters: SQL[] = [
    inArray(userHighlightsTable.userId, followingIds),
    visibilityPredicate(
      userHighlightsTable.visibility,
      userHighlightsTable.userId,
      viewer,
    ),
  ];
  if (cursor) {
    highlightFilters.push(
      cursorPredicate(
        userHighlightsTable.createdAt,
        userHighlightsTable.id,
        TYPE_RANK.highlight,
        cursor,
      ),
    );
  }

  const highlightRows = await db
    .select({
      id: userHighlightsTable.id,
      userId: userHighlightsTable.userId,
      username: usersTable.username,
      avatarColor: usersTable.avatarColor,
      quoteId: quotesTable.id,
      quoteText: quotesTable.text,
      bookId: booksTable.id,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      coverColor: booksTable.coverColor,
      createdAt: userHighlightsTable.createdAt,
    })
    .from(userHighlightsTable)
    .innerJoin(usersTable, eq(userHighlightsTable.userId, usersTable.id))
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .innerJoin(booksTable, eq(quotesTable.canonicalBookId, booksTable.id))
    .where(and(...highlightFilters))
    .orderBy(desc(userHighlightsTable.createdAt), desc(userHighlightsTable.id))
    .limit(limit + 1);

  const commentFilters: SQL[] = [
    inArray(commentsTable.userId, followingIds),
    visibilityPredicate(commentsTable.visibility, commentsTable.userId, viewer),
  ];
  if (cursor) {
    commentFilters.push(
      cursorPredicate(
        commentsTable.createdAt,
        commentsTable.id,
        TYPE_RANK.comment,
        cursor,
      ),
    );
  }

  const commentRows = await db
    .select({
      id: commentsTable.id,
      userId: commentsTable.userId,
      username: usersTable.username,
      avatarColor: usersTable.avatarColor,
      quoteId: quotesTable.id,
      quoteText: quotesTable.text,
      commentText: commentsTable.text,
      containsSpoilers: commentsTable.containsSpoilers,
      bookId: booksTable.id,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      coverColor: booksTable.coverColor,
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

  type MergedRow =
    | ((typeof highlightRows)[number] & { type: "highlight" })
    | ((typeof commentRows)[number] & { type: "comment" });

  const merged: MergedRow[] = [
    ...highlightRows.map((r) => ({ ...r, type: "highlight" as const })),
    ...commentRows.map((r) => ({ ...r, type: "comment" as const })),
  ].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      TYPE_RANK[b.type] - TYPE_RANK[a.type] ||
      b.id - a.id,
  );

  const page = merged.slice(0, limit);
  const hasMore = merged.length > limit;

  // Copyright guardrail: full quote text only for books the viewer owns.
  const ownedBookIds = await getOwnedBookIds(userId, [
    ...new Set(page.map((r) => r.bookId)),
  ]);

  // Like state for the page. Highlight like counts are computed via GROUP BY
  // (no denormalized counter); comment counts come from commentsTable.likeCount.
  const highlightIds = page
    .filter((r) => r.type === "highlight")
    .map((r) => r.id);
  const commentIds = page.filter((r) => r.type === "comment").map((r) => r.id);

  const highlightLikeCounts = new Map<number, number>();
  const likedHighlightIds = new Set<number>();
  if (highlightIds.length > 0) {
    const countRows = await db
      .select({
        highlightId: highlightLikesTable.highlightId,
        count: sql<number>`count(*)::int`,
      })
      .from(highlightLikesTable)
      .where(inArray(highlightLikesTable.highlightId, highlightIds))
      .groupBy(highlightLikesTable.highlightId);
    for (const row of countRows) {
      highlightLikeCounts.set(row.highlightId, row.count);
    }
    const myLikes = await db
      .select({ highlightId: highlightLikesTable.highlightId })
      .from(highlightLikesTable)
      .where(
        and(
          inArray(highlightLikesTable.highlightId, highlightIds),
          eq(highlightLikesTable.userId, userId),
        ),
      );
    for (const row of myLikes) likedHighlightIds.add(row.highlightId);
  }

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
      type: r.type,
      id: r.id,
      userId: r.userId,
      username: r.username,
      avatarColor: r.avatarColor,
      bookId: r.bookId,
      bookTitle: r.bookTitle,
      bookAuthor: r.bookAuthor,
      coverColor: r.coverColor,
      quoteId: r.quoteId,
      quoteText: preview.text,
      quoteTextTruncated: preview.truncated,
      ...(r.type === "comment" ? { commentText: r.commentText } : {}),
      likeCount:
        r.type === "highlight"
          ? (highlightLikeCounts.get(r.id) ?? 0)
          : r.likeCount,
      likedByMe:
        r.type === "highlight"
          ? likedHighlightIds.has(r.id)
          : likedCommentIds.has(r.id),
      containsSpoilers: r.type === "comment" ? r.containsSpoilers : false,
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
            r: TYPE_RANK[last.type],
            i: last.id,
          })
        : null,
  };
  res.json(result);
});

export default router;
