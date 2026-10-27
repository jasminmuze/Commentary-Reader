import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, booksTable, quotesTable, commentsTable } from "@workspace/db";
import {
  ListBooksQueryParams,
  CreateBookBody,
  GetBookParams,
  SearchGoogleBooksQueryParams,
  SearchBookCatalogQueryParams,
  ResolveCatalogBookBody,
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
import {
  findMatchingCanonicalBook,
  normalizeIsbn,
} from "../lib/googleBooksCatalog";
import { getViewer, visibilityPredicate } from "../lib/social";
import {
  BOOK_TOP_QUOTES_LIMIT,
  getOwnedBookIds,
  truncateQuoteText,
} from "../lib/contentLimits";
import { authenticate } from "../middlewares/authenticate.js";
import { bookCatalog, catalogCoverPath, isTrustedCatalogCoverUrl } from "../lib/bookCatalog";

const COVER_COLORS = [
  "#8B5E3C", "#1E3A5F", "#4A1942", "#2D4A3E", "#5C3A21",
  "#3A2F4A", "#1F3A4A", "#4A3A1F", "#42323A", "#2A3A2A",
];

function randomCover(): string {
  return COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)]!;
}

const router: IRouter = Router();

router.get("/catalog-covers", (req, res): void => {
  const url = req.query.url;
  if (typeof url !== "string" || url.length > 2048 || !isTrustedCatalogCoverUrl(url)) {
    res.status(400).json({ error: "Unsupported catalog thumbnail." });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.redirect(302, url);
});

router.get("/books/catalog", authenticate, async (req, res): Promise<void> => {
  const parsed = SearchBookCatalogQueryParams.safeParse(req.query);
  if (!parsed.success || typeof req.query.q !== "string" ||
      parsed.data.q.trim().length < 2 || !Number.isInteger(parsed.data.page)) {
    res.status(400).json({ error: "Enter a title, author, or ISBN of 2 to 160 characters and a valid page." });
    return;
  }
  try {
    res.json(await bookCatalog.search(parsed.data.q, parsed.data.page ?? 1));
  } catch (err) {
    req.log.warn({ err }, "Book catalog search failed");
    res.status(503).json({ error: "Book search is unavailable. Please try again or use the community search." });
  }
});

router.get("/books/google-books", authenticate, async (req, res): Promise<void> => {
  const parsed = SearchGoogleBooksQueryParams.safeParse(req.query);
  if (!parsed.success || typeof req.query.q !== "string") {
    res.status(400).json({ error: "Enter a title, author, or ISBN." });
    return;
  }

  const term = parsed.data.q.trim();
  if (term.length < 2) {
    res.status(400).json({ error: "Search term must contain at least 2 characters" });
    return;
  }
  try {
    // Keep older installed app builds working while moving away from the
    // Google-only endpoint whose anonymous request quota can be zero.
    res.json((await bookCatalog.search(term.slice(0, 160))).items);
  } catch (err) {
    req.log.warn({ err }, "Google Books search request failed");
    res.status(502).json({ error: "Google Books search is temporarily unavailable" });
  }
});

router.post(["/books/google-books", "/books/catalog"], authenticate, async (req, res): Promise<void> => {
  const parsed = ResolveCatalogBookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { title, author, isbn, coverUrl, description } = parsed.data;
  if (coverUrl && !isTrustedCatalogCoverUrl(coverUrl)) {
    res.status(400).json({ error: "Cover must be an HTTPS thumbnail from a supported catalog." });
    return;
  }
  // Keep Book.coverUrl compatible with existing APK/TestFlight builds.
  // This public relative URL redirects to the provider; no image is copied.
  const storedCoverUrl = coverUrl ? catalogCoverPath(coverUrl) : null;
  const normTitle = normalizeTitle(title);
  const normAuthor = normalizeAuthor(author);
  const normIsbn = isbn ? normalizeIsbn(isbn) : "";
  const lockKeys = [
    `title-author:${normTitle}:${normAuthor}`,
    ...(normIsbn ? [`isbn:${normIsbn}`] : []),
  ].sort();

  const result = await db.transaction(async (tx) => {
    for (const lockKey of lockKeys) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    }

    const matchConditions = [
      and(
        eq(booksTable.normTitle, normTitle),
        eq(booksTable.normAuthor, normAuthor),
      ),
    ];
    if (normIsbn) {
      matchConditions.push(
        sql`regexp_replace(lower(${booksTable.isbn}), '[^0-9x]', '', 'g') = ${normIsbn}`,
      );
    }
    const candidates = await tx
      .select()
      .from(booksTable)
      .where(or(...matchConditions));
    const existing = findMatchingCanonicalBook(candidates, {
      title,
      author,
      isbn,
      normTitle,
      normAuthor,
    });

    if (existing) {
      if ((!existing.coverUrl && storedCoverUrl) || (!existing.description && description)) {
        const [updated] = await tx.update(booksTable).set({
          ...(!existing.coverUrl && storedCoverUrl ? { coverUrl: storedCoverUrl } : {}),
          ...(!existing.description && description ? { description } : {}),
        }).where(eq(booksTable.id, existing.id)).returning();
        return { book: updated!, created: false };
      }
      return { book: existing, created: false };
    }

    const [created] = await tx
      .insert(booksTable)
      .values({
        title: title.trim(),
        author: author.trim(),
        normTitle,
        normAuthor,
        description: description ?? "",
        coverUrl: storedCoverUrl,
        coverColor: randomCover(),
        isbn: isbn?.trim() || null,
      })
      .returning();
    return { book: created!, created: true };
  });

  const formatted = await formatBook(result.book);
  res.status(result.created ? 201 : 200).json(formatted);
});

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

router.post("/books", authenticate, async (req, res): Promise<void> => {
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

  // Copyright guardrail: viewers who don't own this book only see quote-text
  // previews (owners — book in their library — see full text).
  const ownsBook = (await getOwnedBookIds(userId, [book.id])).has(book.id);

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
    .slice(0, BOOK_TOP_QUOTES_LIMIT)
    .map((q) =>
      ownsBook ? q : { ...q, text: truncateQuoteText(q.text).text },
    );

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
            commentsTable.roomId,
          ),
        ),
      )
      .orderBy(desc(commentsTable.likeCount))
      .limit(10);
    const quoteTextById = new Map(
      quotes.map((q) => [
        q.id,
        ownsBook ? q.text : truncateQuoteText(q.text).text,
      ]),
    );
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
