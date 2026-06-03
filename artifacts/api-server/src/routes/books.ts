import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, booksTable, passagesTable, commentsTable } from "@workspace/db";
import { GetBookParams, GetBookQueryParams, ListBooksResponse, GetBookResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function intensityFromCount(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 0.2;
  if (count <= 5) return 0.45;
  if (count <= 10) return 0.65;
  return 0.85;
}

router.get("/books", async (_req, res): Promise<void> => {
  const books = await db.select().from(booksTable).orderBy(booksTable.id);

  const booksWithCounts = await Promise.all(
    books.map(async (book) => {
      const passages = await db.select({ id: passagesTable.id }).from(passagesTable).where(eq(passagesTable.bookId, book.id));
      return {
        id: book.id,
        title: book.title,
        author: book.author,
        description: book.description,
        coverColor: book.coverColor,
        totalPassages: passages.length,
      };
    })
  );

  res.json(ListBooksResponse.parse(booksWithCounts));
});

router.get("/books/:bookId", async (req, res): Promise<void> => {
  const params = GetBookParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const queryParams = GetBookQueryParams.safeParse(req.query);
  const userId = queryParams.success ? queryParams.data.userId : undefined;

  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, params.data.bookId));
  if (!book) {
    res.status(404).json({ error: "Book not found" });
    return;
  }

  const passages = await db.select().from(passagesTable).where(eq(passagesTable.bookId, book.id)).orderBy(passagesTable.orderIndex);

  const passagesWithCounts = await Promise.all(
    passages.map(async (passage) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(commentsTable)
        .where(eq(commentsTable.passageId, passage.id));
      const count = row?.count ?? 0;
      return {
        id: passage.id,
        bookId: passage.bookId,
        orderIndex: passage.orderIndex,
        text: passage.text,
        commentCount: count,
        highlightIntensity: intensityFromCount(count),
      };
    })
  );

  res.json(GetBookResponse.parse({ ...book, passages: passagesWithCounts }));
});

export default router;
