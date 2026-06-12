import { createHash } from "crypto";

/**
 * Canonical text normalization shared by quotes and book matching.
 * NFKC -> lowercase -> curly quotes/dashes to ASCII -> strip soft hyphens ->
 * collapse whitespace -> trim. This is the single source of truth for how a
 * highlighted/commented selection is reduced to a stable identity across editions.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    // single quotes / apostrophes / primes
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    // double quotes / primes
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    // hyphens / dashes / minus
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    // soft hyphen
    .replace(/\u00AD/g, "")
    // ellipsis
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** sha256 hex of the normalized text (used as the quote's stable key per book). */
export function hashText(normText: string): string {
  return createHash("sha256").update(normText).digest("hex");
}

export function normalizeTitle(input: string): string {
  return normalizeText(input);
}

export function normalizeAuthor(input: string): string {
  // Strip a leading "lastname, firstname" comma form to a single normalized string.
  return normalizeText(input.replace(/,/g, " "));
}

/**
 * A distinctive leading slice of the RAW quote text used to locate the quote
 * inside an EPUB via the reader's full-text search. We search a leading substring
 * (not the full quote) because punctuation/hyphenation drifts across editions.
 */
export function leadingSubstring(text: string, wordCount = 8): string {
  return text.trim().split(/\s+/).slice(0, wordCount).join(" ");
}
