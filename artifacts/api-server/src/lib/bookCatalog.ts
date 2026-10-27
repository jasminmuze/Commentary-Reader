export type CatalogSource = "open_library" | "google_books";

export interface CatalogBook {
  catalogId: string;
  infoUrl: string;
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

export interface CatalogSearchResult {
  items: CatalogBook[];
  page: number;
  hasMore: boolean;
  source: CatalogSource;
  notice: string | null;
}

const PAGE_SIZE = 20;
const CACHE_LIMIT = 250;
const CACHE_TTL = 15 * 60_000;

function text(value: unknown, limit = 300): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isbn(value: string): string {
  return value.replace(/[^0-9x]/gi, "").toUpperCase();
}

export function isTrustedCatalogCoverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "covers.openlibrary.org" ||
        url.hostname === "books.google.com" ||
        url.hostname === "books.googleusercontent.com" ||
        url.hostname.endsWith(".googleusercontent.com"));
  } catch {
    return false;
  }
}

/** Relative paths also load in older app builds that always prepend /api. */
export function catalogCoverPath(value: string): string {
  if (!isTrustedCatalogCoverUrl(value)) throw new Error("Unsupported catalog cover");
  return `/catalog-covers?url=${encodeURIComponent(value)}`;
}

function cover(value: unknown): string | null {
  const raw = text(value, 2048);
  if (!raw) return null;
  const https = raw.replace(/^http:/, "https:");
  return isTrustedCatalogCoverUrl(https) ? https : null;
}

export function buildOpenLibraryUrl(term: string, page: number): URL {
  const url = new URL("https://openlibrary.org/search.json");
  const normalized = isbn(term);
  if (/^(?:\d{13}|\d{9}[\dX])$/.test(normalized)) {
    url.searchParams.set("isbn", normalized);
  } else {
    url.searchParams.set("q", term);
  }
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("lang", "en");
  url.searchParams.set(
    "fields",
    "key,title,author_name,first_publish_year,isbn,cover_i,publisher,number_of_pages_median,language",
  );
  return url;
}

export function mapOpenLibraryCatalog(payload: unknown, page: number, term = ""): CatalogSearchResult {
  const data = record(payload);
  if (!data || !Array.isArray(data.docs)) throw new Error("Invalid Open Library response");
  const searchedIsbn = isbn(term);
  const items: CatalogBook[] = data.docs.flatMap((raw) => {
    const doc = record(raw);
    const title = text(doc?.title);
    const key = text(doc?.key);
    if (!doc || !title || !key || !/^\/works\/OL\d+W$/.test(key)) return [];
    const identifiers = strings(doc.isbn).map(isbn);
    const chosenIsbn = identifiers.find((value) => value === searchedIsbn) ??
      identifiers.find((value) => /^\d{13}$/.test(value)) ??
      identifiers.find((value) => /^\d{9}[\dX]$/.test(value)) ?? null;
    const coverId = typeof doc.cover_i === "number" && Number.isSafeInteger(doc.cover_i) && doc.cover_i > 0
      ? doc.cover_i : null;
    return [{
      catalogId: key,
      infoUrl: `https://openlibrary.org${key}`,
      title,
      author: strings(doc.author_name).join(", ").slice(0, 300) || "Unknown author",
      isbn: chosenIsbn,
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false` : null,
      publisher: text(strings(doc.publisher)[0]),
      publishedDate: typeof doc.first_publish_year === "number"
        ? String(doc.first_publish_year) : null,
      description: null,
      pageCount: typeof doc.number_of_pages_median === "number" && doc.number_of_pages_median > 0
        ? Math.floor(doc.number_of_pages_median) : null,
      language: strings(doc.language).includes("eng") ? "en" : text(strings(doc.language)[0], 32),
    }];
  });
  const total = typeof data.numFound === "number" ? data.numFound : data.num_found;
  return {
    items,
    page,
    hasMore: page < 50 && (typeof total === "number"
      ? page * PAGE_SIZE < total : data.docs.length === PAGE_SIZE),
    source: "open_library",
    notice: null,
  };
}

export function mapGoogleCatalog(payload: unknown, page: number): CatalogSearchResult {
  const data = record(payload);
  if (!data || (data.items !== undefined && !Array.isArray(data.items)) ||
      (data.items === undefined && typeof data.totalItems !== "number")) {
    throw new Error("Invalid Google Books response");
  }
  const rows = Array.isArray(data.items) ? data.items : [];
  const items: CatalogBook[] = rows.flatMap((raw) => {
    const row = record(raw);
    const info = record(row?.volumeInfo);
    const title = text(info?.title);
    const id = text(row?.id);
    if (!row || !info || !title || !id) return [];
    const ids = Array.isArray(info.industryIdentifiers)
      ? info.industryIdentifiers.map(record).filter((value) => value !== null) : [];
    const selectedIsbn = ids.find((value) => value.type === "ISBN_13") ??
      ids.find((value) => value.type === "ISBN_10");
    const images = record(info.imageLinks);
    return [{
      catalogId: `google:${id}`,
      infoUrl: `https://books.google.com/books?id=${encodeURIComponent(id)}`,
      title,
      author: strings(info.authors).join(", ").slice(0, 300) || "Unknown author",
      isbn: text(selectedIsbn?.identifier, 32),
      coverUrl: cover(images?.thumbnail) ?? cover(images?.smallThumbnail),
      publisher: text(info.publisher),
      publishedDate: text(info.publishedDate, 40),
      description: text(info.description, 10000)?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 4000) ?? null,
      pageCount: typeof info.pageCount === "number" && info.pageCount > 0
        ? Math.floor(info.pageCount) : null,
      language: text(info.language, 32),
    }];
  });
  return {
    items,
    page,
    hasMore: page < 50 && (typeof data.totalItems === "number"
      ? page * PAGE_SIZE < data.totalItems : rows.length === PAGE_SIZE),
    source: "google_books",
    notice: "Open Library is unavailable. Showing Google Books results.",
  };
}

export class CatalogProviderError extends Error {
  source: CatalogSource;
  status: number;

  constructor(source: CatalogSource, status: number, detail: string) {
    super(`${source} returned ${status}: ${detail}`);
    this.source = source;
    this.status = status;
  }
}

export class BookCatalogService {
  private fetcher: typeof fetch;
  private now: () => number;
  private interval: number;
  private nextOpenLibraryRequestAt = 0;
  private cache = new Map<string, { expiresAt: number; result: CatalogSearchResult }>();
  private inFlight = new Map<string, Promise<CatalogSearchResult>>();
  private cooldown = new Map<CatalogSource, number>();

  constructor(options: { fetcher?: typeof fetch; now?: () => number; requestIntervalMs?: number } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.interval = options.requestIntervalMs ?? 1000;
  }

  async search(term: string, page = 1): Promise<CatalogSearchResult> {
    const query = term.trim().replace(/\s+/g, " ");
    if (query.length < 2 || query.length > 160 || !Number.isInteger(page) || page < 1 || page > 50) {
      throw new Error("Invalid catalog search");
    }
    const key = `${query.toLowerCase()}:${page}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.result;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const request = this.searchProviders(query, page).then((result) => {
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, {
        expiresAt: this.now() + (result.items.length ? CACHE_TTL : 2 * 60_000),
        result,
      });
      return result;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private async request(source: CatalogSource, url: URL): Promise<unknown> {
    if ((this.cooldown.get(source) ?? 0) > this.now()) {
      throw new Error(`${source} is temporarily paused after a provider failure`);
    }
    if (source === "open_library" && this.interval > 0) {
      const wait = Math.max(0, this.nextOpenLibraryRequestAt - this.now());
      if (wait > 5000) throw new Error("Catalog search is busy. Please try again.");
      this.nextOpenLibraryRequestAt = this.now() + wait + this.interval;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Shelfmates/1.0", Accept: "application/json" },
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (response.ok) throw new Error(`${source} returned invalid catalog data`);
      payload = null;
    }
    if (!response.ok) {
      const error = record(record(payload)?.error);
      const detail = text(error?.message, 450) ?? response.statusText;
      if (response.status === 429) {
        this.cooldown.set(source, this.now() + (source === "google_books" ? 15 * 60_000 : 30_000));
      }
      throw new CatalogProviderError(source, response.status, detail);
    }
    return payload;
  }

  private async searchProviders(term: string, page: number): Promise<CatalogSearchResult> {
    let primaryError: unknown;
    // A connection reset or gateway failure gets one bounded retry, never a
    // quota failure. Search coalescing and request pacing still apply.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return mapOpenLibraryCatalog(
          await this.request("open_library", buildOpenLibraryUrl(term, page)),
          page,
          term,
        );
      } catch (error) {
        primaryError = error;
        const retryable = error instanceof TypeError ||
          (error instanceof CatalogProviderError && [502, 503, 504].includes(error.status));
        if (attempt === 0 && retryable) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        } else {
          break;
        }
      }
    }
    if ((this.cooldown.get("open_library") ?? 0) <= this.now()) {
      this.cooldown.set("open_library", this.now() + 15_000);
    }
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    const normalized = isbn(term);
    url.searchParams.set("q", /^(?:\d{13}|\d{9}[\dX])$/.test(normalized) ? `isbn:${normalized}` : term);
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    url.searchParams.set("startIndex", String((page - 1) * PAGE_SIZE));
    url.searchParams.set("printType", "books");
    try {
      return mapGoogleCatalog(await this.request("google_books", url), page);
    } catch (error) {
      throw new AggregateError([primaryError, error], "Both book catalog providers are unavailable");
    }
  }
}

export const bookCatalog = new BookCatalogService();
