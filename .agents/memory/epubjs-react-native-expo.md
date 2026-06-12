---
name: epubjs-react-native on Expo SDK 54
description: Which @epubjs-react-native packages to avoid and how to wire the file system on Expo Go.
---

Rendering original EPUB formatting uses `@epubjs-react-native/core` + `react-native-webview` inside a WebView. Two companion packages must NOT be installed:

- `@epubjs-react-native/file-system` — pulls native `@dr.pogodin/react-native-fs`, which is not available in Expo Go.
- `@epubjs-react-native/expo-file-system` — imports from the `expo-file-system` ROOT; Expo SDK 54 moved those APIs to `expo-file-system/legacy`, so it crashes at runtime.

**Fix:** write a local ~80-line `useFileSystem` hook (`hooks/useFileSystem.ts`) that imports from `expo-file-system/legacy` and pass it to the Reader's `fileSystem` prop.

**Why:** Expo Go can't load arbitrary native modules, and SDK 54's file-system API relocation breaks the published expo adapter.

**How to apply:** the WebView reader only works on a real device / Expo Go, NOT the web preview — platform-guard it OFF web with a fallback (call all hooks before the `Platform.OS === "web"` early return to respect rules of hooks). `useReader()` exposes `search(term)` (results via the `onSearch` callback — exactly one `onSearch` per `search()` call, so a sequential search→annotate→next loop is safe), `addAnnotation('highlight', cfiRange, data, styles)`, `goToLocation`, `injectJavascript`.
