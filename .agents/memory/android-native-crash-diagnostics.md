---
name: Android native crash diagnostics
description: Distinguishing device-only Hermes crashes from JS and comparing development and release binaries.
---

**Rule:** For abrupt Android exits with no Metro exception, use an on-device bug report. Read only the app's tombstones; symbolicate against the unstripped `prefab/modules/libhermes/libs/android.arm64-v8a/libhermes.so` inside the matching `hermes-android` Maven AAR, verifying its ELF Build ID first. The smaller `jni/` library can be stripped. Development APKs can use the `debugOptimized` Hermes variant while release builds use a different binary; do not assume a development-client crash reproduces in the release build.

**Why:** Repeated cover-request aborts looked suspicious, but the device report showed native Hermes garbage-collector SIGSEGVs that never appeared in Metro. Temporarily disabling automatic push registration did not stop them. Symbolication located the fault in Hades marking, but that location alone cannot distinguish an engine defect from heap corruption by another native dependency.

**How to apply:** When a physical device repeatedly returns to the Android home screen, collect the bug report shortly after a crash (with the user's informed choice, since reports contain sensitive device data). Filter tombstones by the app process and recent timestamps, then compare development and release-mode Android builds before changing JS engines, upgrading SDKs, or attributing the crash to a specific native library. Never treat a request aborted during screen changes as the crash cause without corroboration.