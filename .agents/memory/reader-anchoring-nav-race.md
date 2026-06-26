---
name: Reader anchoring vs navigation race
description: Why community-highlight anchoring and reading-position saves in the EPUB reader must be carefully guarded around controlled navigation.
---

# Reader anchoring vs navigation race

The reader (`artifacts/mobile/app/read/[libraryId].tsx`) paints community highlights
by running `rendition.search()` per quote ("anchoring"). It also performs controlled
navigation: restore-to-`initialLocation` and TOC jumps via `rendition.display()`.

## Anchoring race

**Problem:** `search()` and `display()` race in epub.js — anchoring that fires while a
`display()` is in flight can hijack the rendition position or silently fail to anchor.

**The rule:** gate anchoring on `navPhaseRef` ('idle' | 'navigating').
- `startAnchoring()` returns early if `navPhaseRef.current === 'navigating'`.
- Set `navPhaseRef='navigating'` before a controlled `display()`; reset to `'idle'`
  in the `navigationDone` WebView message handler, then call `startAnchoring()` to resume.
- Both safety timeouts (restore + TOC) must also call `startAnchoring()` on force-release
  so deferred anchoring isn't stranded if `navigationDone` never arrives.
- Any callback that resumes anchoring needs `startAnchoring` in its dependency array.

## Location-save race (nav-artifact CFI corruption)

**Problem:** `onLocationChange` (relocated) events fired during navigation arrive in the
RN bridge queue slightly AFTER `navigationDone` resets `navPhaseRef = 'idle'`. The existing
`navPhase === 'navigating'` guard no longer fires for these late events, so a
navigation-artifact CFI (e.g. a chapter-start CFI from a TOC jump) gets persisted as the
user's reading position. On the next open, that CFI is used as the restore target → wrong page.

**Fix:** `blockSaveUntilRef` — a `useRef<number>` holding a future timestamp.
- Set `blockSaveUntilRef.current = Date.now() + 1000` in `navigationDone` handler.
- Also set it in both safety timeouts when force-releasing navPhase.
- In `handleLocationChange`: skip save if `Date.now() < blockSaveUntilRef.current`.
- 1 second absorbs all realistic late-arriving relocated events after nav settles.

**Also:** NEVER write `resultCfi` from the `navigationDone` message into `currentLocationRef`.
That CFI is a navigation intermediate, not a stable user reading position.

## TOC convergence (no-fragment path)

The no-fragment TOC path drives a convergence loop calling `rendition.display(startCfi)`
repeatedly until `currentLocation` is "near the start of the section". The CFI comparison
(`ePub.CFI.prototype.compare(resultCfi, startCfi) <= 0`) can fail in scrolled-doc mode
even when the correct section is on screen — the result CFI is slightly past startCfi.

**Fix:** add `hrefMatch(resultHref, section.href)` as an OR-fallback to the convergence
condition. Filenames are compared (`a.split('/').pop() === b.split('/').pop()`) to survive
path-prefix differences between TOC href and `currentLocation().start.href`.

**Why this matters:** without href-match fallback, the loop never converges, fires 5 retries
with repeated `display()` calls, and the 6s safety timeout eventually releases navPhase —
generating multiple intermediate CFIs during the retry window, any of which can slip through
the save guard on the next relocated event.
