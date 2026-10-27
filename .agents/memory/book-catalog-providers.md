---
name: Book catalog provider constraints
description: External quota behavior and the limits of work-level catalog metadata.
---

Do not assume a Google Books 429 is a short-lived burst limit.

**Why:** On 2026-10-27, the full upstream response for anonymous requests explicitly reported a daily query quota of **0**. The generic client error concealed this. Slower typing or waiting briefly does not correct that configuration. Open Library returned real results and covers for the same query.

**How to apply:** Inspect the upstream error body when troubleshooting catalog failures. Treat the anonymous Google request path as unreliable unless its current quota is independently verified; changing Google back to the primary provider needs a working quota, not merely a successful local typecheck.

Open Library work-level search metadata does not guarantee that a cover, ISBN, publisher, language and publication date describe one exact edition.

**Why:** A work can aggregate multiple editions and translations. Broad book discovery benefits from this coverage, but EPUB matching must not present these records as guaranteed edition-level matches.

**How to apply:** Keep edition limitations visible in catalog details. If future matching needs translation/edition precision, resolve an actual edition rather than assuming every field from a work record belongs together.

Keep canonical book cover paths usable by older installed builds.

**Why:** Existing APK/TestFlight clients unconditionally prepend `/api` to canonical cover paths. Adding absolute URL support only to the newest client would leave older clients with broken images as soon as shared book metadata acquired remote covers.

**How to apply:** Keep API-relative cover URLs for shared canonical records, with trusted-source redirects for external thumbnails. Direct provider URLs are fine in the new catalog response, which older clients do not consume as canonical book covers.
