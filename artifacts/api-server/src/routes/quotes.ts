import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  booksTable,
  highlightLikesTable,
  quotesTable,
  userHighlightsTable,
  userLibraryTable,
  usersTable,
} from "@workspace/db";
import {
  GetBookQuotesParams,
  GetBookQuotesQueryParams,
  CreateQuoteParams,
  CreateQuoteBody,
  GetQuoteReaderContextParams,
  LikeHighlightParams,
  ToggleHighlightParams,
  ToggleHighlightBody,
} from "@workspace/api-zod";
import type { Quote, HighlightResult, QuoteReaderContext } from "@workspace/api-zod";
import {
  findOrCreateQuote,
  getQuoteCountsMap,
  getHighlightedQuoteIds,
  toQuote,
} from "../lib/queries";
import { leadingSubstring } from "../lib/text";
import { getViewer, visibilityPredicate } from "../lib/social";
import { createLikeNotification } from "../lib/notifications";
import { getOwnedBookIds, truncateQuoteText } from "../lib/contentLimits";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

// Community quotes for a book — drives the reader's highlight overlay.
router.get("/books/:bookId/quotes", authenticate, async (req, res): Promise<void> => {
  const params = GetBookQuotesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const queryParams = GetBookQuotesQueryParams.safeParse(req.query);
  const roomId = queryParams.success ? queryParams.data.roomId : undefined;
  const userId = req.userId;
  const viewer = await getViewer(userId);

  // Room scope: overlay shows only that room's activity, members only.
  if (roomId != null && !viewer.roomIds.includes(roomId)) {
    res.status(403).json({ error: "Not a member of this room" });
    return;
  }

  const quotes = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.canonicalBookId, params.data.bookId))
    .orderBy(asc(quotesTable.id));
  const quoteIds = quotes.map((q) => q.id);
  const counts = await getQuoteCountsMap(quoteIds, viewer, roomId);
  const highlighted = await getHighlightedQuoteIds(userId, quoteIds);

  // Copyright guardrail: full quote text only for owners of this book
  // (the overlay is only useful inside the owner's reader anyway).
  const ownsBook = (
    await getOwnedBookIds(userId, [params.data.bookId])
  ).has(params.data.bookId);

  // Only return quotes with viewer-visible activity so the reader never paints
  // (and thus never leaks the text of) private/friends-only passages.
  const result: Quote[] = quotes
    .map((q) => toQuote(q, counts.get(q.id)!, highlighted.has(q.id)))
    .filter((q) => q.highlightCount > 0 || q.commentCount > 0)
    .map((q) =>
      ownsBook ? q : { ...q, text: truncateQuoteText(q.text).text },
    );
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

// Where to read a quote: its canonical book plus the viewer's library entry
// for that book (most recently opened), or null if the book isn't in their library.
router.get("/quotes/:quoteId/reader-context", authenticate, async (req, res): Promise<void> => {
  const params = GetQuoteReaderContextParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [quote] = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.id, params.data.quoteId));
  if (!quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }

  // Same visibility rule as the book quotes list: never return the text of a
  // quote that has no viewer-visible activity (private/friends-only passages).
  const viewer = await getViewer(req.userId);
  const counts = (await getQuoteCountsMap([quote.id], viewer)).get(quote.id)!;
  if (counts.highlightCount === 0 && counts.commentCount === 0) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }

  const [entry] = await db
    .select({ id: userLibraryTable.id })
    .from(userLibraryTable)
    .where(
      and(
        eq(userLibraryTable.userId, req.userId),
        eq(userLibraryTable.canonicalBookId, quote.canonicalBookId),
      ),
    )
    .orderBy(
      sql`${userLibraryTable.lastOpenedAt} DESC NULLS LAST`,
      desc(userLibraryTable.id),
    )
    .limit(1);

  // Copyright guardrail: non-owners (no library entry) only get a preview —
  // the full text is only needed for the in-reader deeplink, which requires
  // owning the book anyway.
  const ownsBook = entry != null;
  const result: QuoteReaderContext = {
    quoteId: quote.id,
    canonicalBookId: quote.canonicalBookId,
    quoteText: ownsBook ? quote.text : truncateQuoteText(quote.text).text,
    searchText: leadingSubstring(quote.text),
    libraryId: entry?.id ?? null,
  };
  res.json(result);
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
  const { userLibraryId, cfiRange, visibility, roomId, authorProgress } =
    body.data;

  // Room-scoped highlight: author must be a member of the room.
  if (roomId != null) {
    const viewer = await getViewer(userId);
    if (!viewer.roomIds.includes(roomId)) {
      res.status(403).json({ error: "Not a member of this room" });
      return;
    }
  }

  // 'room' visibility (members only) is only meaningful with a room scope.
  if (visibility === "room" && roomId == null) {
    res.status(400).json({ error: "visibility 'room' requires roomId" });
    return;
  }

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
      if (roomId != null) {
        // Room-scoped default: members only.
        resolvedVisibility = "room";
      } else {
        const [author] = await db
          .select({ defaultVisibility: usersTable.defaultVisibility })
          .from(usersTable)
          .where(eq(usersTable.id, userId));
        resolvedVisibility = author?.defaultVisibility ?? "public";
      }
    }
    await db
      .insert(userHighlightsTable)
      .values({
        userId,
        quoteId,
        userLibraryId: userLibraryId ?? null,
        cfiRange: cfiRange ?? null,
        visibility: resolvedVisibility,
        roomId: roomId ?? null,
        authorProgress: authorProgress ?? null,
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

// POST /highlights/:highlightId/like — toggle a like on another user's highlight.
// Like counts are computed by GROUP BY (no denormalized counter), matching the
// no-denorm convention for highlights.
router.post("/highlights/:highlightId/like", authenticate, async (req, res): Promise<void> => {
  const params = LikeHighlightParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { highlightId } = params.data;
  const userId = req.userId;

  // Authz: you may only like a highlight you are allowed to see.
  const viewer = await getViewer(userId);
  const [highlight] = await db
    .select({
      id: userHighlightsTable.id,
      userId: userHighlightsTable.userId,
      quoteId: userHighlightsTable.quoteId,
    })
    .from(userHighlightsTable)
    .where(
      and(
        eq(userHighlightsTable.id, highlightId),
        visibilityPredicate(
          userHighlightsTable.visibility,
          userHighlightsTable.userId,
          viewer,
          userHighlightsTable.roomId,
          true,
        ),
      ),
    )
    .limit(1);
  if (!highlight) {
    res.status(404).json({ error: "Highlight not found" });
    return;
  }

  const deleted = await db
    .delete(highlightLikesTable)
    .where(
      and(
        eq(highlightLikesTable.highlightId, highlightId),
        eq(highlightLikesTable.userId, userId),
      ),
    )
    .returning();

  let liked = false;
  if (deleted.length === 0) {
    // Race-free like: the unique index makes concurrent double-taps a no-op.
    const inserted = await db
      .insert(highlightLikesTable)
      .values({ highlightId, userId })
      .onConflictDoNothing()
      .returning();
    liked = true;

    // Notify the highlight owner (best-effort; only on a newly created like).
    if (inserted.length > 0) {
      try {
        const [quote] = await db
          .select({ text: quotesTable.text })
          .from(quotesTable)
          .where(eq(quotesTable.id, highlight.quoteId));
        await createLikeNotification({
          recipientId: highlight.userId,
          actorId: userId,
          type: "highlight_like",
          highlightId,
          previewText: quote?.text ?? "",
        });
      } catch (err) {
        req.log.warn({ err }, "Failed to create highlight like notification");
      }
    }
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(highlightLikesTable)
    .where(eq(highlightLikesTable.highlightId, highlightId));

  res.json({ liked, likeCount: countRow?.count ?? 0 });
});

export default router;
