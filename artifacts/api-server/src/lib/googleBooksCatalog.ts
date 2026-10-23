export interface GoogleBookCatalogItem {
  title: string;
  author: string;
  isbn: string | null;
}

export interface GoogleBookIdentity {
  title: string;
  author: string;
  isbn?: string | null;
}

export interface CanonicalBookIdentity {
  normTitle: string;
  normAuthor: string;
  isbn: string | null;
}

export function normalizeIsbn(value: string): string {
  return value.replace(/[^0-9x]/gi, "").toLowerCase();
}

export function findMatchingCanonicalBook<T extends CanonicalBookIdentity>(
  books: T[],
  selected: GoogleBookIdentity & { normTitle: string; normAuthor: string },
): T | undefined {
  const selectedIsbn = selected.isbn ? normalizeIsbn(selected.isbn) : "";
  if (selectedIsbn) {
    const isbnMatch = books.find(
      (book) => book.isbn && normalizeIsbn(book.isbn) === selectedIsbn,
    );
    if (isbnMatch) return isbnMatch;
  }
  return books.find(
    (book) =>
      book.normTitle === selected.normTitle &&
      book.normAuthor === selected.normAuthor,
  );
}

export function buildGoogleBooksUrl(term: string): URL {
  const normalized = normalizeIsbn(term);
  const isIsbn = normalized.length === 10 || normalized.length === 13;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", isIsbn ? `isbn:${normalized}` : term);
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("printType", "books");
  return url;
}

export function mapGoogleBooksPayload(payload: unknown): GoogleBookCatalogItem[] {
  if (!payload || typeof payload !== "object" || !("items" in payload) || !Array.isArray(payload.items)) {
    return [];
  }

  return payload.items.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || !("volumeInfo" in item)) return [];
    const info = item.volumeInfo;
    if (!info || typeof info !== "object") return [];
    const title = "title" in info && typeof info.title === "string" ? info.title.trim() : "";
    if (!title) return [];
    const authors = "authors" in info && Array.isArray(info.authors)
      ? info.authors.filter((author): author is string => typeof author === "string" && !!author.trim())
      : [];
    const identifiers = "industryIdentifiers" in info && Array.isArray(info.industryIdentifiers)
      ? info.industryIdentifiers
      : [];
    const preferredIsbn = identifiers.find(
      (identifier) =>
        !!identifier &&
        typeof identifier === "object" &&
        "type" in identifier &&
        identifier.type === "ISBN_13" &&
        "identifier" in identifier &&
        typeof identifier.identifier === "string",
    );
    const fallbackIsbn = identifiers.find(
      (identifier) =>
        !!identifier &&
        typeof identifier === "object" &&
        "type" in identifier &&
        identifier.type === "ISBN_10" &&
        "identifier" in identifier &&
        typeof identifier.identifier === "string",
    );
    const selectedIsbn = preferredIsbn ?? fallbackIsbn;
    const isbn =
      selectedIsbn && "identifier" in selectedIsbn && typeof selectedIsbn.identifier === "string"
        ? selectedIsbn.identifier
        : null;

    return [{
      title,
      author: authors.join(", ") || "Unknown",
      isbn,
    }];
  });
}

export async function fetchGoogleBooksResults(
  term: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleBookCatalogItem[]> {
  const response = await fetcher(buildGoogleBooksUrl(term), {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Google Books returned ${response.status}`);
  }
  return mapGoogleBooksPayload(await response.json());
}
