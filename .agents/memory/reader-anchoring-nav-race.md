---
name: Reader anchoring vs navigation race
description: Guards needed around controlled EPUB navigation to prevent anchoring races and location-save corruption.
---

# Reader anchoring vs navigation race

The reader (`artifacts/mobile/app/read/[libraryId].tsx`) paints community highlights
via `rendition.search()` ("anchoring") and performs controlled navigation via
`rendition.display()` (restore-to-savedCFI and TOC jumps).

## Anchoring race

`search()` and `display()` race in epub.js — anchoring fired while a `display()` is
in-flight can hijack the rendition position or silently fail.

**Rule:** gate anchoring on `navPhaseRef` ('idle' | 'navigating').
- `startAnchoring()` returns early when `navPhaseRef.current === 'navigating'`.
- Set `navPhaseRef='navigating'` before any `display()`; reset to `'idle'` in the
  `navigationDone` WebView handler, then immediately call `startAnchoring()`.
- Both safety timeouts (restore 6 s + TOC 6 s) must also reset navPhase AND call
  `startAnchoring()` so deferred anchoring isn't stranded if `navigationDone` never arrives.
- Any callback that resumes anchoring needs `startAnchoring` in its dep array.

## Location-save race (nav-artifact CFI overwriting reading position)

`onLocationChange` (relocated) events fired during navigation arrive in the RN bridge
queue slightly AFTER `navigationDone` resets `navPhaseRef = 'idle'`. These late events
pass the existing `navPhase !== 'navigating'` guard and persist a navigation-artifact
CFI as the user's reading position — causing "wrong page on next open".

**Fix: `blockSaveUntilRef`** — a `useRef<number>` holding a future timestamp.
- Set `blockSaveUntilRef.current = Date.now() + 1000` in the `navigationDone` handler.
- Also set it in both safety timeouts when force-releasing navPhase.
- In `handleLocationChange`: skip save if `Date.now() < blockSaveUntilRef.current`.
- 1 second absorbs all realistic late-arriving relocated events.

**Also:** never write `resultCfi` from `navigationDone` into `currentLocationRef`.
That CFI is a nav intermediate, not a stable user reading position.

## TOC convergence loop (no-fragment path) — DO NOT add hrefMatch

The no-fragment TOC path loops calling `rendition.display(startCfi)` and checks
`isNearStart(resultCfi)` (CFI ≤ startCfi in the same spine item) to detect success.

**DO NOT** add an `hrefMatch(resultHref, section.href)` OR-condition as a shortcut.
Even when the href matches on attempt 1, the rendition may have landed mid-chapter
(e.g. `/4/162`) because scrolled-doc mode re-uses the previous scroll offset.
The loop exists precisely to force additional `display(startCfi)` calls until
`currentLocation` converges to the actual chapter start. Short-circuiting on href
stops this convergence and leaves the reader mid-chapter despite showing the TOC target.
