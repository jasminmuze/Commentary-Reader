import { and, eq, inArray } from "drizzle-orm";
import { db, userLibraryTable } from "@workspace/db";

/**
 * Copyright guardrails: quote text is user-selected passages from published
 * books. Viewers who do NOT own the book (no library entry) only ever see a
 * short preview, and any single response exposes at most a bounded number of
 * quotes per book. Owners (who have the book in their library) see full text.
 */

/** Max quote-text length shown to viewers who don't own the book. */
export const QUOTE_PREVIEW_MAX_CHARS = 300;

/** Max number of top quotes exposed on the book detail screen. */
export const BOOK_TOP_QUOTES_LIMIT = 10;

/** Truncate quote text to the non-owner preview length. */
export function truncateQuoteText(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= QUOTE_PREVIEW_MAX_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, QUOTE_PREVIEW_MAX_CHARS).trimEnd()}…`,
    truncated: true,
  };
}

/** Of `bookIds`, the canonical book IDs the user owns (has in their library). */
export async function getOwnedBookIds(
  userId: number,
  bookIds: number[],
): Promise<Set<number>> {
  if (bookIds.length === 0) return new Set();
  const rows = await db
    .select({ bookId: userLibraryTable.canonicalBookId })
    .from(userLibraryTable)
    .where(
      and(
        eq(userLibraryTable.userId, userId),
        inArray(userLibraryTable.canonicalBookId, bookIds),
      ),
    );
  return new Set(
    rows.map((r) => r.bookId).filter((id): id is number => id != null),
  );
}
