import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql, gt, ne } from "drizzle-orm";
import { db, booksTable, userLibraryTable, userObjectUploadsTable, usersTable } from "@workspace/db";
import {
  CreateLibraryEntryBody,
  GetLibraryEntryParams,
  MatchLibraryEntryParams,
  MatchLibraryEntryBody,
  UpdateReadingLocationParams,
  UpdateReadingLocationBody,
  GetUserLibraryParams,
} from "@workspace/api-zod";
import type {
  Book,
  LibraryEntry,
  LibraryUploadResult,
  MatchResult,
} from "@workspace/api-zod";
import { isGeneratedEpubObjectPath, ObjectStorageService } from "../lib/objectStorage";
import { extractEpubMetadata, extractEpubCover } from "../lib/epubMetadata";
import { formatBook } from "../lib/queries";
import { normalizeTitle, normalizeAuthor } from "../lib/text";
import { authenticate } from "../middlewares/authenticate.js";

const router: IRouter = Router();

function normIsbn(s: string): string {
  return s.replace(/[^0-9xX]/g, "").toLowerCase();
}

// Best-effort: if the canonical book has no cover yet, extract one from the
// uploaded EPUB and store it. First cover wins (`WHERE cover_url IS NULL`
// guards against concurrent uploads); existing covers are never overwritten.
// Never throws — a cover failure must not break the upload/match flow.
async function maybeSetBookCover(
  bookId: number,
  buffer: Uint8Array,
  log: { warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    const [book] = await db
      .select({ coverUrl: booksTable.coverUrl })
      .from(booksTable)
      .where(eq(booksTable.id, bookId));
    if (!book || book.coverUrl) return;

    const cover = extractEpubCover(buffer);
    if (!cover) return;

    const svc = new ObjectStorageService();
    const coverUrl = await svc.uploadBookCover(cover.data, cover.mimeType);
    await db
      .update(booksTable)
      .set({ coverUrl })
      .where(and(eq(booksTable.id, bookId), isNull(booksTable.coverUrl)));
  } catch (err) {
    log.warn({ err, bookId }, "Failed to extract/store EPUB cover");
  }
}

async function formatLibraryEntry(
  entry: typeof userLibraryTable.$inferSelect,
): Promise<LibraryEntry> {
  let book: Book | null = null;
  if (entry.canonicalBookId != null) {
    const [b] = await db
      .select()
      .from(booksTable)
      .where(eq(booksTable.id, entry.canonicalBookId));
    if (b) book = await formatBook(b);
  }
  return {
    id: entry.id,
    userId: entry.userId,
    canonicalBookId: entry.canonicalBookId ?? null,
    epubObjectPath: entry.epubObjectPath,
    epubUrl: `/api${entry.epubObjectPath}`,
    originalTitle: entry.originalTitle ?? null,
    originalAuthor: entry.originalAuthor ?? null,
    originalIsbn: entry.originalIsbn ?? null,
    lastReadingLocation: entry.lastReadingLocation ?? null,
    readingProgress: entry.readingProgress ?? null,
    createdAt: entry.createdAt,
    book,
  };
}

// Register an uploaded EPUB: normalize path, set private owner-only ACL,
// download, extract metadata, then auto-match against canonical books.
router.post("/library", authenticate, async (req, res): Promise<void> => {
  const body = CreateLibraryEntryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const userId = req.userId;
  const { uploadURL } = body.data;

  const svc = new ObjectStorageService();
  let normalizedPath: string;
  let buffer: Uint8Array;
  normalizedPath = svc.normalizeObjectEntityPath(uploadURL);
  if (!isGeneratedEpubObjectPath(normalizedPath)) {
    res.status(400).json({ error: "Invalid EPUB upload URL" });
    return;
  }

  const [sharedEntry] = await db
    .select({ id: userLibraryTable.id })
    .from(userLibraryTable)
    .where(
      and(
        eq(userLibraryTable.epubObjectPath, normalizedPath),
        ne(userLibraryTable.userId, userId),
      ),
    )
    .limit(1);
  if (sharedEntry) {
    res.status(409).json({ error: "This EPUB object is already registered to another account" });
    return;
  }

  const [claimedUpload] = await db
    .update(userObjectUploadsTable)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(userObjectUploadsTable.userId, userId),
        eq(userObjectUploadsTable.kind, "epub"),
        eq(userObjectUploadsTable.objectPath, normalizedPath),
        gt(userObjectUploadsTable.expiresAt, new Date()),
        isNull(userObjectUploadsTable.consumedAt),
      ),
    )
    .returning({ id: userObjectUploadsTable.id });
  if (!claimedUpload) {
    res.status(403).json({ error: "EPUB must come from an unused upload URL issued to this account" });
    return;
  }

  try {
    const aclPath = await svc.trySetObjectEntityAclPolicy(uploadURL, {
      owner: String(userId),
      visibility: "private",
    });
    if (aclPath !== normalizedPath) {
      throw new Error("Upload URL path changed during finalization");
    }
    const file = await svc.getObjectEntityFile(normalizedPath);
    const [buf] = await file.download();
    buffer = buf;
  } catch (err) {
    await db
      .update(userObjectUploadsTable)
      .set({ consumedAt: null })
      .where(eq(userObjectUploadsTable.id, claimedUpload.id));
    req.log.error({ err }, "Failed to finalize uploaded EPUB");
    res.status(400).json({ error: "Could not read uploaded file" });
    return;
  }

  const meta = extractEpubMetadata(buffer);

  // Auto-match: ISBN first, then normalized title (+author).
  let matchedBook: Book | null = null;
  let candidates: Book[] = [];
  const allBooks = await db.select().from(booksTable);

  const isbn = meta.isbn ? normIsbn(meta.isbn) : null;
  if (isbn) {
    const hits = allBooks.filter((b) => b.isbn && normIsbn(b.isbn) === isbn);
    if (hits.length === 1) matchedBook = await formatBook(hits[0]!);
    else if (hits.length > 1)
      candidates = await Promise.all(hits.map((b) => formatBook(b)));
  }

  if (!matchedBook && candidates.length === 0) {
    const nt = meta.title ? normalizeTitle(meta.title) : null;
    const na = meta.author ? normalizeAuthor(meta.author) : null;
    if (nt) {
      const exact = allBooks.filter(
        (b) => b.normTitle === nt && (na ? b.normAuthor === na : true),
      );
      if (exact.length === 1) matchedBook = await formatBook(exact[0]!);
      else if (exact.length > 1)
        candidates = await Promise.all(exact.map((b) => formatBook(b)));
      else {
        const titleOnly = allBooks.filter((b) => b.normTitle === nt);
        candidates = await Promise.all(titleOnly.map((b) => formatBook(b)));
      }
    }
  }

  const status: MatchResult["status"] = matchedBook
    ? "matched"
    : candidates.length > 0
      ? "candidates"
      : "none";

  const entry = await db.transaction(async (tx) => {
    const [activeAccount] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, userId),
          eq(usersTable.deletionPending, false),
        ),
      )
      .for("share");
    if (!activeAccount) return undefined;
    const [registered] = await tx
      .insert(userLibraryTable)
      .values({
        userId,
        canonicalBookId: matchedBook ? matchedBook.id : null,
        epubObjectPath: normalizedPath,
        originalTitle: meta.title ?? null,
        originalAuthor: meta.author ?? null,
        originalIsbn: meta.isbn ?? null,
      })
      .returning();
    return registered;
  });
  if (!entry) {
    res.status(409).json({ error: "Account deletion is in progress" });
    return;
  }

  // If the matched canonical book has no cover yet, extract one from this
  // upload (before formatting so the response already carries coverUrl).
  if (matchedBook) {
    await maybeSetBookCover(matchedBook.id, buffer, req.log);
    const [fresh] = await db
      .select()
      .from(booksTable)
      .where(eq(booksTable.id, matchedBook.id));
    if (fresh) matchedBook = await formatBook(fresh);
  }

  const result: LibraryUploadResult = {
    entry: await formatLibraryEntry(entry),
    match: { status, book: matchedBook, candidates },
  };
  res.status(201).json(result);
});

router.get("/library/:libraryId", authenticate, async (req, res): Promise<void> => {
  const params = GetLibraryEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db
    .select()
    .from(userLibraryTable)
    .where(eq(userLibraryTable.id, params.data.libraryId));
  if (!entry) {
    res.status(404).json({ error: "Library entry not found" });
    return;
  }
  if (entry.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(await formatLibraryEntry(entry));
});

router.patch("/library/:libraryId", authenticate, async (req, res): Promise<void> => {
  const params = MatchLibraryEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = MatchLibraryEntryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(userLibraryTable)
    .where(eq(userLibraryTable.id, params.data.libraryId));
  if (!existing) {
    res.status(404).json({ error: "Library entry not found" });
    return;
  }
  if (existing.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [book] = await db
    .select()
    .from(booksTable)
    .where(eq(booksTable.id, body.data.canonicalBookId));
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const [entry] = await db
    .update(userLibraryTable)
    .set({ canonicalBookId: body.data.canonicalBookId })
    .where(eq(userLibraryTable.id, params.data.libraryId))
    .returning();
  if (!entry) {
    res.status(404).json({ error: "Library entry not found" });
    return;
  }

  // Manual match: if the book still has no cover, try extracting one from
  // this entry's EPUB (best-effort — re-downloads the file).
  if (!book.coverUrl) {
    try {
      const svc = new ObjectStorageService();
      const file = await svc.getObjectEntityFile(entry.epubObjectPath);
      const [buf] = await file.download();
      await maybeSetBookCover(book.id, buf, req.log);
    } catch (err) {
      req.log.warn({ err, bookId: book.id }, "Cover extraction on match failed");
    }
  }

  res.json(await formatLibraryEntry(entry));
});

// Persist the reader's last reading location (EPUB CFI) for resume-on-reopen.
router.put("/library/:libraryId/location", authenticate, async (req, res): Promise<void> => {
  const params = UpdateReadingLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateReadingLocationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(userLibraryTable)
    .where(eq(userLibraryTable.id, params.data.libraryId));
  if (!existing) {
    res.status(404).json({ error: "Library entry not found" });
    return;
  }
  if (existing.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const progressValue = body.data.readingProgress ?? null;
  const [entry] = await db
    .update(userLibraryTable)
    .set({
      lastReadingLocation: body.data.location,
      lastOpenedAt: new Date(),
      ...(progressValue !== null && {
        readingProgress: Math.min(100, Math.max(0, progressValue)),
      }),
    })
    .where(eq(userLibraryTable.id, params.data.libraryId))
    .returning();
  if (!entry) {
    res.status(404).json({ error: "Library entry not found" });
    return;
  }
  res.json(await formatLibraryEntry(entry));
});

router.get("/users/:userId/library", authenticate, async (req, res): Promise<void> => {
  const params = GetUserLibraryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (req.userId !== params.data.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Most recently opened first; never-opened entries fall back to newest upload.
  const entries = await db
    .select()
    .from(userLibraryTable)
    .where(eq(userLibraryTable.userId, params.data.userId))
    .orderBy(
      sql`${userLibraryTable.lastOpenedAt} DESC NULLS LAST`,
      desc(userLibraryTable.id),
    );
  const result = await Promise.all(entries.map((e) => formatLibraryEntry(e)));
  res.json(result);
});

export default router;
