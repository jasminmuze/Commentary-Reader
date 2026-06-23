import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  booksTable,
  quotesTable,
  userHighlightsTable,
  usersTable,
} from "@workspace/db";
import {
  GetBookQuotesParams,
  CreateQuoteParams,
  CreateQuoteBody,
  ToggleHighlightParams,
  ToggleHighlightBody,
} from "@workspace/api-zod";
import type { Quote, HighlightResult } from "@workspace/api-zod";
import {
  findOrCreateQuote,
  getQuoteCountsMap,
  getHighlightedQuoteIds,
  toQuote,
} from "../lib/queries";
import { getViewer } from "../lib/social";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

// Community quotes for a book — drives the reader's highlight overlay.
router.get("/books/:bookId/quotes", authenticate, async (req, res): Promise<void> => {
  const params = GetBookQuotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = req.userId;
  const viewer = await getViewer(userId);

  const quotes = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.canonicalBookId, params.data.bookId))
    .orderBy(asc(quotesTable.id));
  const quoteIds = quotes.map((q) => q.id);
  const counts = await getQuoteCountsMap(quoteIds, viewer);
  const highlighted = await getHighlightedQuoteIds(userId, quoteIds);

  // Only return quotes with viewer-visible activity so the reader never paints
  // (and thus never leaks the text of) private/friends-only passages.
  const result: Quote[] = quotes
    .map((q) => toQuote(q, counts.get(q.id)!, highlighted.has(q.id)))
    .filter((q) => q.highlightCount > 0 || q.commentCount > 0);
  res.json(result);
});

// Find-or-create a quote in a book (anchored by normalized text).
router.post("/books/:bookId/quotes", authenticate, async (req, res): Promise<void> => {
  const params = CreateQuoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CreateQuoteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [book] = await db
    .select()
    .from(booksTable)
    .where(eq(booksTable.id, params.data.bookId));
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const quote = await findOrCreateQuote(params.data.bookId, body.data.text);
  const counts = (await getQuoteCountsMap([quote.id])).get(quote.id)!;
  res.json(toQuote(quote, counts, false));
});

// Toggle the current user's highlight on a quote.
router.post("/quotes/:quoteId/highlight", authenticate, async (req, res): Promise<void> => {
  const params = ToggleHighlightParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ToggleHighlightBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { quoteId } = params.data;
  const userId = req.userId;
  const { userLibraryId, cfiRange, visibility } = body.data;

  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.id, quoteId));
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }

  const existing = await db
    .select()
    .from(userHighlightsTable)
    .where(
      and(
        eq(userHighlightsTable.userId, userId),
        eq(userHighlightsTable.quoteId, quoteId),
      ),
    );

  let highlighted: boolean;
  if (existing.length > 0) {
    await db
      .delete(userHighlightsTable)
      .where(
        and(
          eq(userHighlightsTable.userId, userId),
          eq(userHighlightsTable.quoteId, quoteId),
        ),
      );
    highlighted = false;
  } else {
    let resolvedVisibility = visibility;
    if (!resolvedVisibility) {
      const [author] = await db
        .select({ defaultVisibility: usersTable.defaultVisibility })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      resolvedVisibility = author?.defaultVisibility ?? "public";
    }
    await db
      .insert(userHighlightsTable)
      .values({
        userId,
        quoteId,
        userLibraryId: userLibraryId ?? null,
        cfiRange: cfiRange ?? null,
        visibility: resolvedVisibility,
      })
      .onConflictDoNothing();
    highlighted = true;
  }

  const viewer = await getViewer(userId);
  const counts = (await getQuoteCountsMap([quoteId], viewer)).get(quoteId)!;
  const result: HighlightResult = {
    highlighted,
    highlightCount: counts.highlightCount,
  };
  res.json(result);
});

export default router;
