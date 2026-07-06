---
name: Native Readium reader (Android)
description: Architecture decisions and constraints for the native readium-kotlin reader in the mobile artifact, replacing the epub.js/WebView reader.
---

# Native Readium reader (Android)

## A full-screen Activity CANNOT host the community highlight/comment UX — use an embedded RN ViewManager
The original native host launches a separate full-screen `NativeReadiumActivity` via `startActivity`. That Activity covers the RN `MainActivity`, so **RN Modals (the existing `CommentSheet`, `TocPanel`, settings panels) render behind it and are invisible.**

**Why:** Requirement parity with the old epub.js reader needs "tap a community highlight → existing CommentSheet slides up over the page" and "select text → highlight/comment". Reusing the RN components requires the reader surface to live *inside* the RN view tree.

**How to apply:** For Step 2 (embedding + social layer), restructure the native host to a `SimpleViewManager`-hosted `NativeReadiumView` (a `FragmentContainerView` + `EpubNavigatorFragment` committed via the host `FragmentActivity`), rendered inside `app/readium/[libraryId].tsx`. Then all existing RN overlays work unchanged. Known gotcha: fragments inside RN views need the manual measure/layout workaround (override the container's `requestLayout` to post `measure`+`layout`). Note `app.json` has `newArchEnabled: true` (Fabric) — SimpleViewManager works via the interop layer but treat view hosting as delicate.

## Readium Kotlin 3.1.0 API surface for the social layer
- Decorations: `EpubNavigatorFragment` implements `DecorableNavigator`; `Decoration(id, locator, Decoration.Style.Highlight(tint=ARGB Int, isActive))`; `suspend applyDecorations(list, group="community")`. Encode popularity opacity in the tint alpha; compute ARGB on the JS side so Kotlin stays dumb.
- Tap: `navigator.addDecorationListener("community", DecorableNavigator.Listener)` → `onDecorationActivated(event)`; read `event.decoration.id`/extras to recover the quoteId → emit `highlightTapped`.
- Selection: `SelectableNavigator.currentSelection(): Selection?` + `clearSelection()`; add "Highlight/Comment" actions via `EpubNavigatorFragment.Configuration(selectionActionModeCallback=…)` → emit `textSelected {text, locatorJson}`.
- Search: `publication.search(query)` (SearchService in readium-shared; guard `searchService != null`) → `SearchIterator.next()` → `LocatorCollection`. Set case/diacritic-insensitive `SearchService.Options` to approximate server `normalizeText`.
- All are `@ExperimentalReadiumApi` in 3.1.0 (the 2.x `@ExperimentalDecorator` is gone).

## Anchoring invariant (preserve)
Community highlights/comments anchor by NORMALIZED QUOTE TEXT, not CFI/Locator positions. To place a decoration, search a distinctive LEADING SUBSTRING (~first 8 words) of the quote to survive edition drift, resolve to a Locator, then decorate. A substring match decorates only the matched span, not the full quote — accepted.

## Device-confirmed bugs from build #1 (fix in Step 2 rewrite)
- **TOC tap lands at END of chapter** (device-confirmed symptom). Current code passes the raw TOC `Link` to `navigator.go(link)`. HYPOTHESIS (not yet device-verified): resolve with `publication.locatorFromLink(link)`, and when the locator has no fragments, force `locations.progression = 0.0` before `go(locator)`; keep fragments when present. Must be validated on device in the embedded-rewrite build. The Activity's AlertDialog TOC is throwaway (replaced by the RN TOC panel), so don't burn a build fixing it there.
- **Native error surfaces must include the full cause chain.** Readium `Error.message` at the top level is generic ("An error occurred when trying to read asset"); walk `error.cause` recursively when reporting via events, or diagnosis is impossible without logcat.

## EPUB cache corruption (JS-side, fixed)
The reader route's download effect depended on the whole `useFileSystem()` return object (new identity every render) → effect churned, spawning CONCURRENT `downloadAsync` calls writing the SAME cache file → corrupted EPUB → "could not read the EPUB asset" on every reopen.
**How to apply:** depend on the individual stable `useCallback` helpers, never the hook's return object; download to a unique `.tmp` path, validate (size > 0 + ZIP magic `UEsD` via base64 head read), then atomically `moveAsync` onto the cache path. Cache filename was bumped (`_v2_`) to orphan poisoned files.

## Untestable-native build loop
The Replit agent cannot build/run Android (no emulator/APK). Only the user can EAS-build and device-test.
**How to apply:** Put the ENTIRE native surface in ONE EAS build, defensively coded; then iterate JS-only over Metro (dev-client reloads TS without rebuilds). Add a `NativeReadiumHost.log` DeviceEventEmitter event so native errors surface in Metro (agent has no logcat). Do the JS cutover (delete `app/read/[libraryId].tsx` + `@epubjs-react-native/core`, repoint `match/[libraryId].tsx`) only AFTER the user confirms the build works; keep it a one-commit switch. Verify `react-native-webview` isn't needed elsewhere before removing.
