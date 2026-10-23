export interface GoogleBookCatalogItem {
  title: string;
  author: string;
  isbn: string | null;
  coverUrl: string | null;
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  pageCount: number | null;
  language: string | null;
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

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeCoverUrl(value: unknown): string | null {
  const text = optionalText(value, 2048);
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.username || url.password) return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDescription(value: unknown): string | null {
  const text = optionalText(value, 10000);
  if (!text) return null;
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000) || null;
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
    const imageLinks = "imageLinks" in info && info.imageLinks && typeof info.imageLinks === "object"
      ? info.imageLinks
      : null;
    const coverUrl = imageLinks
      ? normalizeCoverUrl("thumbnail" in imageLinks ? imageLinks.thumbnail : null) ??
        normalizeCoverUrl("smallThumbnail" in imageLinks ? imageLinks.smallThumbnail : null)
      : null;
    const pageCount =
      "pageCount" in info &&
      typeof info.pageCount === "number" &&
      Number.isInteger(info.pageCount) &&
      info.pageCount > 0
        ? info.pageCount
        : null;

    return [{
      title,
      author: authors.join(", ") || "Unknown",
      isbn,
      coverUrl,
      publisher: optionalText("publisher" in info ? info.publisher : null, 300),
      publishedDate: optionalText("publishedDate" in info ? info.publishedDate : null, 40),
      description: normalizeDescription("description" in info ? info.description : null),
      pageCount,
      language: optionalText("language" in info ? info.language : null, 32),
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
