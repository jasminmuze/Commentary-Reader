---
name: Native Readium reader (iOS)
description: How the iOS reader mirrors the Android bridge contract, and iOS-specific gotchas (events, pods, gitignore).
---

# Native Readium reader (iOS)

The iOS reader is a local CocoaPod (`native/readium-host/ios`, pod `NativeReadiumHost`) hosting Readium Swift toolkit 3.1.0's `EPUBNavigatorViewController` inside an RN legacy view, mirroring the Android bridge contract byte-for-byte (same module/view names, methods, event names, payloads). Keep both platforms in lockstep when changing the JS bridge contract in the readium route.

**Gotchas learned:**
- **Events**: Android uses `DeviceEventEmitter`; iOS must subscribe via `NativeEventEmitter(NativeModules.NativeReadiumHost)` or RCTEventEmitter silently drops events (listener count 0). The native side buffers early events until `startObserving` to survive the mount race.
- **Pods**: Readium 3.1.0 comes from the `https://github.com/readium/podspecs` source. Expo links pods statically, so all Readium pods (plus Minizip/SwiftSoup/DifferenceKit) need `:modular_headers => true`. The Podfile helpers `readium_pods` / `readium_post_install` are *defined* by the config plugin (`plugins/withReadium.js`) — the plugin's idempotency checks must match bare call lines, not the `def` lines.
- **gitignore trap**: the mobile `.gitignore` ignores `ios/` anywhere, which silently excluded `native/readium-host/ios/`; explicit `!` negations were needed (same pattern as android). Check `git check-ignore` when adding native dirs.
- **API deltas vs Android**: decoration tint is `UIColor` (convert the JS ARGB int); TOC is `await publication.tableOfContents()` (Result); selection menu items are `EditingAction`s resolved on the responder chain (the hosting UIView implements the selectors). The iOS reader now emits `chapterPull` from an observe-only pan tracker, but its gesture behavior still requires device validation.
- Linux can check Swift syntax and isolated gesture logic, but cannot compile UIKit/Readium or verify UIKit gesture delivery. On-device verification requires a fresh native iOS build.

**Scroll-mode chapter navigation:** Only disable Readium's horizontal chapter transitions on a platform that also has a vertical pull-to-chapter path; the iOS observer is not yet device-verified. **Why:** Removing sideways turns without a functioning pull gesture would strand readers at chapter boundaries. **How to apply:** Before shipping an iOS build with horizontal turns disabled, verify on-device that both next and previous chapters are reachable by pulling beyond the scroll edge, including after settings changes and selection; fall back to horizontal turns if the pull path fails.

**Short resources need a recognizable vertical pan:** Readium Swift disables bouncing, including always-vertical bounce. Observe-only edge gestures must accommodate chapters shorter than the viewport without changing paged-mode behavior.
**Why:** Pure gesture-logic tests can pass even though UIKit never begins the scroll pan on a short resource.
**How to apply:** Verify short resources on an actual iPhone, and restore the original bounce settings when leaving scroll mode or removing an observer.
