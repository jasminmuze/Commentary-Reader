import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, booksTable, userLibraryTable } from "@workspace/db";
import {
  CreateLibraryEntryBody,
  GetLibraryEntryParams,
  MatchLibraryEntryParams,
  MatchLibraryEntryBody,
  GetUserLibraryParams,
} from "@workspace/api-zod";
import type {
  Book,
  LibraryEntry,
  LibraryUploadResult,
  MatchResult,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractEpubMetadata } from "../lib/epubMetadata";
import { formatBook } from "../lib/queries";
import { normalizeTitle, normalizeAuthor } from "../lib/text";

const router: IRouter = Router();

function normIsbn(s: string): string {
  return s.replace(/[^0-9xX]/g, "").toLowerCase();
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
    createdAt: entry.createdAt,
    book,
  };
}

// Register an uploaded EPUB: normalize path, set public ACL, download, extract
// metadata, then auto-match against canonical books.
router.post("/library", async (req, res): Promise<void> => {
  const body = CreateLibraryEntryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { userId, uploadURL } = body.data;

  const svc = new ObjectStorageService();
  let normalizedPath: string;
  let buffer: Uint8Array;
  try {
    normalizedPath = await svc.trySetObjectEntityAclPolicy(uploadURL, {
      owner: String(userId),
      visibility: "public",
    });
    const file = await svc.getObjectEntityFile(normalizedPath);
    const [buf] = await file.download();
    buffer = buf;
  } catch (err) {
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

  const [entry] = await db
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

  const result: LibraryUploadResult = {
    entry: await formatLibraryEntry(entry!),
    match: { status, book: matchedBook, candidates },
  };
  res.status(201).json(result);
});

router.get("/library/:libraryId", async (req, res): Promise<void> => {
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
  res.json(await formatLibraryEntry(entry));
});

router.patch("/library/:libraryId", async (req, res): Promise<void> => {
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
  res.json(await formatLibraryEntry(entry));
});

router.get("/users/:userId/library", async (req, res): Promise<void> => {
  const params = GetUserLibraryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const entries = await db
    .select()
    .from(userLibraryTable)
    .where(eq(userLibraryTable.userId, params.data.userId))
    .orderBy(desc(userLibraryTable.id));
  const result = await Promise.all(entries.map((e) => formatLibraryEntry(e)));
  res.json(result);
});

export default router;
