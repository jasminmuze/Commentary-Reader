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

## Follow the official test-app verbatim — hand-rolled "fixes" made things worse
User mandate after a broken device build: implement exactly what readium's official kotlin-toolkit test-app does, no creative additions.
**Why:** Hand-rolled deviations (forcing `publisherStyles=false` + textAlign/lineHeight, forcing TOC `locations.progression=0.0`) produced broken formatting and wrong TOC jumps on device. The official patterns are: TOC = `publication.locatorFromLink(link)` → `go(locator, animated=true)` (nothing else); preferences default EMPTY (publisher styles ON) with only user-changed settings applied; `lineHeight`/`pageMargins` only take effect with `publisherStyles=false`, so flip that switch only when the user picked a non-default value for them (mirrors the official editor's "activate" semantics).
**How to apply:** Before touching reader behavior, download the matching-version test-app sources (reader/, utils/) and copy their structure. Official reference patterns also adopted: navigator via fragmentFactory + `commitNow` + tag lookup; `DirectionalNavigationAdapter` for edge-tap page turns; center tap toggles system UI; immersive mode while reading.

## Android 15+ (Expo SDK 54 targets): legacy system-UI flags are no-ops
The official test-app's `SystemUiManagement.kt` uses deprecated `systemUiVisibility` flags, which are ignored on the Android 15+ targets Expo SDK 54 builds against. Use `WindowInsetsControllerCompat` (`hide/show(Type.systemBars())`, `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`) and pad overlays with `getInsetsIgnoringVisibility(systemBars)` via `ViewCompat.setOnApplyWindowInsetsListener`. Same behavior, platform-mandated API.
**Gotcha (caused a device bug):** a view attached AFTER the window's initial insets pass never receives an insets dispatch, so its listener silently never fires and the overlay renders under the status bar. Always call `ViewCompat.requestApplyInsets(view)` right after registering the listener, and re-dispatch whenever bar visibility changes (official pattern: `requestApplyInsets` in `updateSystemUiVisibility`).

## Fragment restore after process death crashes without a pre-restore factory
`EpubNavigatorFragment` has an internal constructor; if the hosting Activity/Fragment is restored (savedInstanceState != null) before the publication is opened, `super.onCreate` crashes instantiating the fragment. Official fix (EpubReaderFragment.onCreate): install `EpubNavigatorFragment.createDummyFactory()` BEFORE `super.onCreate`, then bail out (finish). Rotation recreation is already suppressed via the activity's `configChanges`, so this path only fires after process death.

- **Native error surfaces must include the full cause chain.** Readium `Error.message` at the top level is generic ("An error occurred when trying to read asset"); walk `error.cause` recursively when reporting via events, or diagnosis is impossible without logcat. A `NativeReadiumHost.debug` DeviceEventEmitter bridge surfaces native-side diagnostics in the Metro console (agent has no logcat).

## EPUB cache corruption (JS-side, fixed)
The reader route's download effect depended on the whole `useFileSystem()` return object (new identity every render) → effect churned, spawning CONCURRENT `downloadAsync` calls writing the SAME cache file → corrupted EPUB → "could not read the EPUB asset" on every reopen.
**How to apply:** depend on the individual stable `useCallback` helpers, never the hook's return object; download to a unique `.tmp` path, validate (size > 0 + ZIP magic `UEsD` via base64 head read), then atomically `moveAsync` onto the cache path. Cache filename was bumped (`_v2_`) to orphan poisoned files.

## Untestable-native build loop
The Replit agent cannot build/run Android (no emulator/APK). Only the user can EAS-build and device-test.
**How to apply:** Put the ENTIRE native surface in ONE EAS build, defensively coded; then iterate JS-only over Metro (dev-client reloads TS without rebuilds). Add a `NativeReadiumHost.log` DeviceEventEmitter event so native errors surface in Metro (agent has no logcat). Do the JS cutover (delete `app/read/[libraryId].tsx` + `@epubjs-react-native/core`, repoint `match/[libraryId].tsx`) only AFTER the user confirms the build works; keep it a one-commit switch. Verify `react-native-webview` isn't needed elsewhere before removing.
