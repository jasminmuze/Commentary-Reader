import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleBooksUrl,
  fetchGoogleBooksResults,
  findMatchingCanonicalBook,
  mapGoogleBooksPayload,
  normalizeIsbn,
} from "./googleBooksCatalog.ts";

test("ISBN terms use the exact Google Books ISBN query", () => {
  assert.equal(normalizeIsbn("978-0-306-40615-7"), "9780306406157");
  assert.equal(buildGoogleBooksUrl("978-0-306-40615-7").searchParams.get("q"), "isbn:9780306406157");
  assert.equal(buildGoogleBooksUrl("Ursula Le Guin").searchParams.get("q"), "Ursula Le Guin");
});

test("catalog mapping keeps edition identifiers and safely handles missing fields", () => {
  assert.deepEqual(
    mapGoogleBooksPayload({
      items: [
        {
          volumeInfo: {
            title: "  A Wizard of Earthsea ",
            authors: ["Ursula K. Le Guin"],
            publisher: "  Parnassus Press ",
            publishedDate: "1968",
            description: "<p>A classic &amp; beloved story.</p>",
            pageCount: 205,
            language: "en",
            imageLinks: { thumbnail: "http://books.google.com/cover.jpg" },
            industryIdentifiers: [
              { type: "ISBN_10", identifier: "0547773749" },
              { type: "ISBN_13", identifier: "9780547773742" },
            ],
          },
        },
        { volumeInfo: { title: "Untitled metadata", authors: [null, ""] } },
        { volumeInfo: { authors: ["No title"] } },
        null,
      ],
    }),
    [
      {
        title: "A Wizard of Earthsea",
        author: "Ursula K. Le Guin",
        isbn: "9780547773742",
        coverUrl: "https://books.google.com/cover.jpg",
        publisher: "Parnassus Press",
        publishedDate: "1968",
        description: "A classic & beloved story.",
        pageCount: 205,
        language: "en",
      },
      {
        title: "Untitled metadata",
        author: "Unknown",
        isbn: null,
        coverUrl: null,
        publisher: null,
        publishedDate: null,
        description: null,
        pageCount: null,
        language: null,
      },
    ],
  );
  assert.deepEqual(mapGoogleBooksPayload({ totalItems: 0 }), []);
  assert.deepEqual(mapGoogleBooksPayload({ items: [] }), []);
});

test("catalog mapping rejects unsafe cover URLs and invalid page counts", () => {
  assert.deepEqual(
    mapGoogleBooksPayload({
      items: [
        {
          volumeInfo: {
            title: "A partial record",
            imageLinks: { thumbnail: "javascript:alert(1)", smallThumbnail: "https://books.google.com/fallback.jpg" },
            pageCount: -2,
            description: "  ",
          },
        },
      ],
    }),
    [{
      title: "A partial record",
      author: "Unknown",
      isbn: null,
      coverUrl: "https://books.google.com/fallback.jpg",
      publisher: null,
      publishedDate: null,
      description: null,
      pageCount: null,
      language: null,
    }],
  );
});

test("provider failures are surfaced and empty provider results stay empty", async () => {
  const empty = await fetchGoogleBooksResults("a title", async () =>
    new Response(JSON.stringify({ totalItems: 0 }), { status: 200 }),
  );
  assert.deepEqual(empty, []);

  await assert.rejects(
    fetchGoogleBooksResults("a title", async () =>
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    ),
    /Google Books returned 503/,
  );
});

test("canonical selection reuses ISBN matches first, then normalized title and author", () => {
  const isbnMatch = {
    id: 1,
    isbn: "978-0-306-40615-7",
    normTitle: "another title",
    normAuthor: "another author",
  };
  const titleAuthorMatch = {
    id: 2,
    isbn: null,
    normTitle: "the left hand of darkness",
    normAuthor: "ursula k le guin",
  };

  assert.equal(
    findMatchingCanonicalBook([titleAuthorMatch, isbnMatch], {
      isbn: "9780306406157",
      title: "Different provider title",
      author: "Different provider author",
      normTitle: "different provider title",
      normAuthor: "different provider author",
    }),
    isbnMatch,
  );
  assert.equal(
    findMatchingCanonicalBook([titleAuthorMatch], {
      isbn: null,
      title: "The Left Hand of Darkness",
      author: "Ursula K. Le Guin",
      normTitle: "the left hand of darkness",
      normAuthor: "ursula k le guin",
    }),
    titleAuthorMatch,
  );
  assert.equal(
    findMatchingCanonicalBook([], {
      title: "A new book",
      author: "A new author",
      normTitle: "a new book",
      normAuthor: "a new author",
    }),
    undefined,
  );
});
