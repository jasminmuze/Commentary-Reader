---
name: Swift checks on Linux
description: Limits and runtime requirements of the workspace's Nix Swift interpreter.
---

The workspace may contain Nix Swift wrappers without exposing `swift` on PATH.
Its interpreter needs the Swift concurrency runtime preloaded for async checks;
that runtime also needs the matching libdispatch directory in LD_LIBRARY_PATH.

**Why:** Plain synchronous Swift can run while async code fails with unresolved
task symbols; preloading concurrency alone then fails to find libdispatch.

**How to apply:** Locate the current Swift wrapper, libswift_Concurrency.so, and
libdispatch.so under /nix/store. Supply SWIFT, LD_PRELOAD, and LD_LIBRARY_PATH
for isolated Linux checks. Do not bake store hashes into project scripts.
Passing those checks does not replace a UIKit/Readium build on macOS.
