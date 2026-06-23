---
name: Visibility privacy invariant
description: Rules every endpoint surfacing quote text, comments, or activity counts must follow so private/friends-only rows never leak.
---

# Visibility privacy invariant

Comments and userHighlights carry a `visibility` of `public | friends | private`.
Filtering is centralized in `artifacts/api-server/src/lib/social.ts`:
- `getViewer(userId)` resolves the viewer's mutual-friend set (directional follow: mutual = following ∩ followers).
- `visibilityPredicate(visibilityCol, ownerCol, viewer)` = public OR own OR (friends AND owner is a mutual). With no viewer it closes to public-only.

**The rule:** ANY endpoint that returns quote TEXT, comments, or activity counts
MUST gate the underlying comment/highlight rows through `visibilityPredicate`,
AND drop quotes whose only activity is invisible to the viewer.

**Why:** counting raw quote rows, or returning a quote with `highlightCount===0 && commentCount===0`,
leaks the *existence* (and often the text) of a passage that someone highlighted/commented privately.
A prior architect review FAILED on exactly these leaks.

**How to apply:**
- Counts (`getBookCountsMap`/`getQuoteCountsMap` in `queries.ts`): never `count()` raw quote rows for `quoteCount`. Use `selectDistinct` over comments/highlights `innerJoin` quotes + `visibilityPredicate`, union the quote IDs per book, take set size. `commentCount`/`highlightCount` gate by the same predicate.
- Lists returning quotes (`GET /books/:id/quotes`, book detail `topQuotes`): after mapping, `.filter(q => q.highlightCount > 0 || q.commentCount > 0)` before sort/slice.
- Per-comment interactions (`/comments/:id/like`, `/save`): first SELECT the comment under `visibilityPredicate`; 404 if not visible (prevents IDOR interaction leak).
- Re-reads of stored references (e.g. `saved-comments` via saved IDs): re-apply `visibilityPredicate` — a comment saved while public may have since turned private.
- Mobile: the comment-compose visibility choice must propagate to BOTH the comment create AND the auto-highlight toggle (don't fall back to the user default).
