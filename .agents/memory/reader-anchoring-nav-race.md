---
name: Reader anchoring vs navigation race
description: Why community-highlight anchoring in the EPUB reader must pause during controlled navigation and resume after it settles.
---

# Reader anchoring vs navigation race

The reader (`artifacts/mobile/app/read/[libraryId].tsx`) paints community highlights
by running `rendition.search()` per quote ("anchoring"). It also performs controlled
navigation: restore-to-`initialLocation` and TOC jumps via `rendition.display()`.

**Problem:** `search()` and `display()` race in epub.js — anchoring that fires while a
`display()` is in flight can hijack the rendition position or silently fail to anchor.

**The rule:** gate anchoring on a `navPhaseRef` ('idle' | 'navigating').
- `startAnchoring()` returns early if `navPhaseRef.current === 'navigating'`.
- Set `navPhaseRef='navigating'` before a controlled `display()`; reset to `'idle'`
  in the `navigationDone` WebView message handler, then call `startAnchoring()` to resume.
- The restore safety timeout (force-release after ~6s) must ALSO call `startAnchoring()`
  so deferred anchoring isn't stranded if `navigationDone` never arrives.
- Any callback that resumes anchoring needs `startAnchoring` in its dependency array.

**Why:** without resuming after nav settles, highlights deferred during restore/TOC
never paint; without the guard, they paint mid-navigation and corrupt the reading position.
