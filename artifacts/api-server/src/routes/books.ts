import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db, booksTable, quotesTable, commentsTable } from "@workspace/db";
import {
  ListBooksQueryParams,
  CreateBookBody,
  GetBookParams,
} from "@workspace/api-zod";
import type { Book, BookDetail, Comment, Quote } from "@workspace/api-zod";
import {
  formatBook,
  getBookCountsMap,
  toBook,
  getQuoteCountsMap,
  toQuote,
  getHighlightedQuoteIds,
  formatComment,
} from "../lib/queries";
import { normalizeTitle, normalizeAuthor } from "../lib/text";
import { getViewer, visibilityPredicate } from "../lib/social";
import { authenticate } from "../middlewares/authenticate.js";

const COVER_COLORS = [
  "#8B5E3C", "#1E3A5F", "#4A1942", "#2D4A3E", "#5C3A21",
  "#3A2F4A", "#1F3A4A", "#4A3A1F", "#42323A", "#2A3A2A",
];

function randomCover(): string {
  return COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)]!;
}

const router: IRouter = Router();

router.get("/books", async (req, res): Promise<void> => {
  const qp = ListBooksQueryParams.safeParse(req.query);
  const q = qp.success ? qp.data.q : undefined;

  const rows = q
    ? await db
        .select()
        .from(booksTable)
        .where(
          or(
            ilike(booksTable.title, `%${q}%`),
            ilike(booksTable.author, `%${q}%`),
          ),
        )
        .orderBy(asc(booksTable.id))
    : await db.select().from(booksTable).orderBy(asc(booksTable.id));

  const countsMap = await getBookCountsMap(rows.map((b) => b.id));
  const result: Book[] = rows.map((b) => toBook(b, countsMap.get(b.id)!));
  res.json(result);
});

router.post("/books", async (req, res): Promise<void> => {
  const body = CreateBookBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { title, author, description, isbn } = body.data;
  const [book] = await db
    .insert(booksTable)
    .values({
      title,
      author,
      normTitle: normalizeTitle(title),
      normAuthor: normalizeAuthor(author),
      description: description ?? "",
      coverColor: randomCover(),
      isbn: isbn ?? null,
    })
    .returning();

  const result = await formatBook(book!);
  res.status(201).json(result);
});

router.get("/books/:bookId", authenticate, async (req, res): Promise<void> => {
  const params = GetBookParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = req.userId;
  const viewer = await getViewer(userId);

  const [book] = await db
    .select()
    .from(booksTable)
    .where(eq(booksTable.id, params.data.bookId));
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const counts = (await getBookCountsMap([book.id], viewer)).get(book.id)!;

  const quotes = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.canonicalBookId, book.id));
  const quoteIds = quotes.map((q) => q.id);
  const qCounts = await getQuoteCountsMap(quoteIds, viewer);
  const highlighted = userId
    ? await getHighlightedQuoteIds(userId, quoteIds)
    : new Set<number>();

  const topQuotes: Quote[] = quotes
    .map((q) => toQuote(q, qCounts.get(q.id)!, highlighted.has(q.id)))
    // Only surface quotes with viewer-visible activity — never leak the text of
    // passages whose only comments/highlights are private/friends-only.
    .filter((q) => q.highlightCount > 0 || q.commentCount > 0)
    .sort(
      (a, b) =>
        b.highlightCount - a.highlightCount ||
        b.commentCount - a.commentCount,
    )
    .slice(0, 10);

  let bestComments: Comment[] = [];
  if (quoteIds.length > 0) {
    const rows = await db
      .select()
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
      .orderBy(desc(commentsTable.likeCount))
      .limit(10);
    const quoteTextById = new Map(quotes.map((q) => [q.id, q.text]));
    bestComments = await Promise.all(
      rows.map((c) => formatComment(c, userId, quoteTextById.get(c.quoteId))),
    );
  }

  const detail: BookDetail = {
    ...toBook(book, counts),
    topQuotes,
    bestComments,
  };
  res.json(detail);
});

export default router;
