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
- **API deltas vs Android**: decoration tint is `UIColor` (convert the JS ARGB int); TOC is `await publication.tableOfContents()` (Result); selection menu items are `EditingAction`s resolved on the responder chain (the hosting UIView implements the selectors); no per-platform `chapterPull` event on iOS (JS tolerates its absence).
- Cannot compile/verify Swift in this environment — validated via `expo prebuild -p ios` (Podfile output) and TS typecheck only; on-device verification requires the user's EAS iOS build (Apple credentials).

**Scroll-mode chapter navigation:** Do not enable Readium's `disablePageTurnsWhileScrolling` on iOS until a working vertical chapter-pull transition exists there. **Why:** Android has an independent vertical overscroll-to-chapter gesture, but iOS currently does not; removing sideways page turns on iOS would strand a reader at a chapter boundary. **How to apply:** Implement and verify an iOS pull transition first, then set Readium's public configuration flag on iOS. On Android, the flag can be enabled because its vertical pull gesture already exists.
