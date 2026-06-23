import {
  db,
  booksTable,
  quotesTable,
  commentsTable,
  commentLikesTable,
  commentSavesTable,
  usersTable,
  userHighlightsTable,
} from "@workspace/db";
import { and, count, eq, inArray } from "drizzle-orm";
import type { Book, Comment, Quote } from "@workspace/api-zod";
import { normalizeText, hashText, leadingSubstring } from "./text";
import { visibilityPredicate, type Viewer } from "./social";

/**
 * Maps a community highlight count to a 0..1 intensity used to shade the
 * highlight in the reader. Tiered (not linear) so a couple of highlights still
 * reads as "lightly marked" and very popular passages saturate.
 */
export function intensityFromCount(c: number): number {
  if (c === 0) return 0;
  if (c <= 2) return 0.2;
  if (c <= 5) return 0.45;
  if (c <= 10) return 0.65;
  return 0.85;
}

export interface BookCounts {
  quoteCount: number;
  commentCount: number;
  highlightCount: number;
}

/**
 * Per-book quote/comment/highlight counts computed via GROUP BY (no
 * denormalization). All counts are visibility-gated to `viewer` (public-only
 * when omitted) so private/friends activity never leaks via counts. quoteCount
 * is the number of distinct quotes that have at least one viewer-visible comment
 * or highlight (not the raw quote-row count).
 */
export async function getBookCountsMap(
  bookIds: number[],
  viewer?: Viewer,
): Promise<Map<number, BookCounts>> {
  const map = new Map<number, BookCounts>();
  for (const id of bookIds)
    map.set(id, { quoteCount: 0, commentCount: 0, highlightCount: 0 });
  if (bookIds.length === 0) return map;

  // quoteCount = distinct quotes with >=1 viewer-visible comment OR highlight.
  // Counting raw quote rows would leak the existence of private/friends-only
  // passages, so we union the visible-activity quote IDs per book instead.
  const bookQuoteSets = new Map<number, Set<number>>();
  for (const id of bookIds) bookQuoteSets.set(id, new Set());
  const visibleCommentQuotes = await db
    .selectDistinct({
      bookId: quotesTable.canonicalBookId,
      quoteId: commentsTable.quoteId,
    })
    .from(commentsTable)
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(
      and(
        inArray(quotesTable.canonicalBookId, bookIds),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    );
  for (const r of visibleCommentQuotes)
    bookQuoteSets.get(r.bookId)?.add(r.quoteId);
  const visibleHighlightQuotes = await db
    .selectDistinct({
      bookId: quotesTable.canonicalBookId,
      quoteId: userHighlightsTable.quoteId,
    })
    .from(userHighlightsTable)
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .where(
      and(
        inArray(quotesTable.canonicalBookId, bookIds),
        visibilityPredicate(
          userHighlightsTable.visibility,
          userHighlightsTable.userId,
          viewer,
        ),
      ),
    );
  for (const r of visibleHighlightQuotes)
    bookQuoteSets.get(r.bookId)?.add(r.quoteId);
  for (const [id, set] of bookQuoteSets) {
    const m = map.get(id);
    if (m) m.quoteCount = set.size;
  }

  const cc = await db
    .select({ bookId: quotesTable.canonicalBookId, c: count() })
    .from(commentsTable)
    .innerJoin(quotesTable, eq(commentsTable.quoteId, quotesTable.id))
    .where(
      and(
        inArray(quotesTable.canonicalBookId, bookIds),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    )
    .groupBy(quotesTable.canonicalBookId);
  for (const r of cc) {
    const m = map.get(r.bookId);
    if (m) m.commentCount = Number(r.c);
  }

  const hc = await db
    .select({ bookId: quotesTable.canonicalBookId, c: count() })
    .from(userHighlightsTable)
    .innerJoin(quotesTable, eq(userHighlightsTable.quoteId, quotesTable.id))
    .where(
      and(
        inArray(quotesTable.canonicalBookId, bookIds),
        visibilityPredicate(
          userHighlightsTable.visibility,
          userHighlightsTable.userId,
          viewer,
        ),
      ),
    )
    .groupBy(quotesTable.canonicalBookId);
  for (const r of hc) {
    const m = map.get(r.bookId);
    if (m) m.highlightCount = Number(r.c);
  }

  return map;
}

export function toBook(
  book: typeof booksTable.$inferSelect,
  counts: BookCounts,
): Book {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    description: book.description,
    coverColor: book.coverColor,
    quoteCount: counts.quoteCount,
    commentCount: counts.commentCount,
    highlightCount: counts.highlightCount,
  };
}

export async function formatBook(
  book: typeof booksTable.$inferSelect,
): Promise<Book> {
  const counts = (await getBookCountsMap([book.id])).get(book.id)!;
  return toBook(book, counts);
}

export interface QuoteCounts {
  highlightCount: number;
  commentCount: number;
}

export async function getQuoteCountsMap(
  quoteIds: number[],
  viewer?: Viewer,
): Promise<Map<number, QuoteCounts>> {
  const map = new Map<number, QuoteCounts>();
  for (const id of quoteIds)
    map.set(id, { highlightCount: 0, commentCount: 0 });
  if (quoteIds.length === 0) return map;

  const hc = await db
    .select({ quoteId: userHighlightsTable.quoteId, c: count() })
    .from(userHighlightsTable)
    .where(
      and(
        inArray(userHighlightsTable.quoteId, quoteIds),
        visibilityPredicate(
          userHighlightsTable.visibility,
          userHighlightsTable.userId,
          viewer,
        ),
      ),
    )
    .groupBy(userHighlightsTable.quoteId);
  for (const r of hc) {
    const m = map.get(r.quoteId);
    if (m) m.highlightCount = Number(r.c);
  }

  const cc = await db
    .select({ quoteId: commentsTable.quoteId, c: count() })
    .from(commentsTable)
    .where(
      and(
        inArray(commentsTable.quoteId, quoteIds),
        visibilityPredicate(
          commentsTable.visibility,
          commentsTable.userId,
          viewer,
        ),
      ),
    )
    .groupBy(commentsTable.quoteId);
  for (const r of cc) {
    const m = map.get(r.quoteId);
    if (m) m.commentCount = Number(r.c);
  }

  return map;
}

export async function getHighlightedQuoteIds(
  userId: number,
  quoteIds: number[],
): Promise<Set<number>> {
  if (quoteIds.length === 0) return new Set();
  const rows = await db
    .select({ quoteId: userHighlightsTable.quoteId })
    .from(userHighlightsTable)
    .where(
      and(
        eq(userHighlightsTable.userId, userId),
        inArray(userHighlightsTable.quoteId, quoteIds),
      ),
    );
  return new Set(rows.map((r) => r.quoteId));
}

export function toQuote(
  quote: typeof quotesTable.$inferSelect,
  counts: QuoteCounts,
  highlightedByMe: boolean,
): Quote {
  return {
    id: quote.id,
    canonicalBookId: quote.canonicalBookId,
    text: quote.text,
    searchText: leadingSubstring(quote.text),
    highlightCount: counts.highlightCount,
    commentCount: counts.commentCount,
    highlightIntensity: intensityFromCount(counts.highlightCount),
    highlightedByMe,
  };
}

export async function formatComment(
  comment: typeof commentsTable.$inferSelect,
  userId?: number,
  quoteText?: string,
): Promise<Comment> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, comment.userId));
  const likedByMe = userId
    ? (
        await db
          .select()
          .from(commentLikesTable)
          .where(
            and(
              eq(commentLikesTable.commentId, comment.id),
              eq(commentLikesTable.userId, userId),
            ),
          )
      ).length > 0
    : false;
  const savedByMe = userId
    ? (
        await db
          .select()
          .from(commentSavesTable)
          .where(
            and(
              eq(commentSavesTable.commentId, comment.id),
              eq(commentSavesTable.userId, userId),
            ),
          )
      ).length > 0
    : false;

  return {
    id: comment.id,
    quoteId: comment.quoteId,
    userId: comment.userId,
    username: user?.username ?? "unknown",
    avatarColor: user?.avatarColor ?? "#7A8BAA",
    text: comment.text,
    visibility: comment.visibility,
    ...(quoteText !== undefined ? { quoteText } : {}),
    likeCount: comment.likeCount,
    likedByMe,
    savedByMe,
    createdAt: comment.createdAt,
  };
}

/**
 * Find-or-create a canonical quote by normalized-text hash. Race-free single
 * round trip via INSERT ... ON CONFLICT DO UPDATE ... RETURNING.
 */
export async function findOrCreateQuote(
  canonicalBookId: number,
  rawText: string,
): Promise<typeof quotesTable.$inferSelect> {
  const text = rawText.trim();
  const normText = normalizeText(text);
  const normTextHash = hashText(normText);
  const [quote] = await db
    .insert(quotesTable)
    .values({ canonicalBookId, text, normText, normTextHash })
    .onConflictDoUpdate({
      target: [quotesTable.canonicalBookId, quotesTable.normTextHash],
      set: { normTextHash },
    })
    .returning();
  return quote!;
}
