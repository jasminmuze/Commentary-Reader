import assert from "node:assert/strict";
import test from "node:test";
import {
  BookCatalogService,
  buildOpenLibraryUrl,
  catalogCoverPath,
  isTrustedCatalogCoverUrl,
  mapOpenLibraryCatalog,
} from "./bookCatalog.ts";

const olPayload = {
  numFound: 45,
  docs: [{
    key: "/works/OL29226517W",
    title: "Fourth Wing",
    author_name: ["Rebecca Yarros"],
    cover_i: 14407898,
    first_publish_year: 2023,
    isbn: ["1649374046", "9781649374042"],
    publisher: ["Red Tower Books"],
    number_of_pages_median: 528,
    language: ["eng"],
  }],
};
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("Open Library search supports exact ISBNs, titles and page numbers", () => {
  const url = buildOpenLibraryUrl("978-1-64937-404-2", 2);
  assert.equal(url.searchParams.get("isbn"), "9781649374042");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(buildOpenLibraryUrl("Fourth Wing", 1).searchParams.get("q"), "Fourth Wing");
});

test("Open Library records retain real covers, identifiers and pagination", () => {
  const result = mapOpenLibraryCatalog(olPayload, 1, "1649374046");
  assert.equal(result.items[0].isbn, "1649374046");
  assert.equal(result.items[0].coverUrl, "https://covers.openlibrary.org/b/id/14407898-L.jpg?default=false");
  assert.equal(result.items[0].infoUrl, "https://openlibrary.org/works/OL29226517W");
  assert.equal(result.items[0].pageCount, 528);
  assert.equal(result.hasMore, true);
  assert.equal(mapOpenLibraryCatalog(olPayload, 3).hasMore, false);
  assert.equal(result.source, "open_library");
  assert.throws(() => mapOpenLibraryCatalog({ error: "not search data" }, 1), /Invalid/);
});

test("records without covers stay visible and unsafe catalog IDs are rejected", () => {
  const result = mapOpenLibraryCatalog({
    numFound: 2,
    docs: [
      { key: "/works/OL1W", title: "No cover" },
      { key: "//evil.example", title: "Unsafe" },
    ],
  }, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].coverUrl, null);
  assert.equal(result.items[0].author, "Unknown author");
});

test("duplicate in-flight and repeated searches share a cached result", async () => {
  let requests = 0;
  const service = new BookCatalogService({
    requestIntervalMs: 0,
    fetcher: async () => {
      requests++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response(olPayload);
    },
  });
  const [a, b] = await Promise.all([service.search("Fourth Wing"), service.search("  fourth   wing  ")]);
  assert.deepEqual(a, b);
  await service.search("FOURTH WING");
  assert.equal(requests, 1);
  await service.search("Fourth Wing", 2);
  assert.equal(requests, 2);
});

test("a successful empty catalog result is not misreported as provider failure", async () => {
  let requests = 0;
  const service = new BookCatalogService({
    requestIntervalMs: 0,
    fetcher: async () => { requests++; return response({ numFound: 0, docs: [] }); },
  });
  assert.equal((await service.search("unlisted title")).items.length, 0);
  assert.equal(requests, 1);
});

test("Open Library failures use an explicitly attributed Google fallback", async () => {
  const service = new BookCatalogService({
    requestIntervalMs: 0,
    fetcher: async (url) => String(url).includes("openlibrary.org")
      ? response({ error: "unavailable" }, 503)
      : response({
        totalItems: 1,
        items: [{
          id: "volume",
          volumeInfo: {
            title: "Fallback book",
            authors: ["Author"],
            imageLinks: { thumbnail: "http://books.google.com/cover.jpg" },
          },
        }],
      }),
  });
  const result = await service.search("Fallback book");
  assert.equal(result.source, "google_books");
  assert.match(result.notice, /Open Library is unavailable/);
  assert.equal(result.items[0].coverUrl, "https://books.google.com/cover.jpg");
});

test("failures remain errors and a 429 is cooled down instead of repeatedly retried", async () => {
  const counts = { google: 0, ol: 0 };
  const service = new BookCatalogService({
    requestIntervalMs: 0,
    fetcher: async (url) => {
      if (String(url).includes("openlibrary.org")) {
        counts.ol++;
        return response({ error: "unavailable" }, 503);
      }
      counts.google++;
      return response({ error: { message: "Daily quota is zero" } }, 429);
    },
  });
  await assert.rejects(service.search("first title"), /Both book catalog providers/);
  await assert.rejects(service.search("second title"), /Both book catalog providers/);
  assert.deepEqual(counts, { google: 1, ol: 2 });
});

test("a connection reset is retried once without falling back or losing covers", async () => {
  let attempts = 0;
  const service = new BookCatalogService({
    requestIntervalMs: 0,
    fetcher: async () => {
      if (++attempts === 1) throw new TypeError("fetch failed: ECONNRESET");
      return response(olPayload);
    },
  });
  const result = await service.search("Fourth Wing");
  assert.equal(attempts, 2);
  assert.equal(result.source, "open_library");
  assert.ok(result.items[0].coverUrl);
});

test("only trusted HTTPS thumbnail hosts can be stored on community books", () => {
  assert.equal(isTrustedCatalogCoverUrl("https://covers.openlibrary.org/b/id/123-L.jpg"), true);
  assert.equal(isTrustedCatalogCoverUrl("https://books.google.com/books?id=123"), true);
  for (const url of [
    "javascript:alert(1)",
    "http://covers.openlibrary.org/cover.jpg",
    "https://evil.example/cover.jpg",
    "https://user:password@covers.openlibrary.org/cover.jpg",
    "https://covers.openlibrary.org.evil.example/cover.jpg",
  ]) assert.equal(isTrustedCatalogCoverUrl(url), false);
});

test("stored catalog covers use a relative image URL compatible with older app builds", () => {
  const external = "https://covers.openlibrary.org/b/id/14407898-L.jpg?default=false";
  const stored = catalogCoverPath(external);
  assert.ok(stored.startsWith("/catalog-covers?"));
  assert.equal(new URL(`https://shelfmates.invalid/api${stored}`).searchParams.get("url"), external);
  assert.throws(() => catalogCoverPath("https://evil.example/image.jpg"), /Unsupported/);
});
