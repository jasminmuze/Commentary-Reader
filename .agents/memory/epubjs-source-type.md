---
name: epubjs source type detection
description: @epubjs-react-native/core getSourceType only matches URLs by substring — .epub or .opf must appear in the URL string
---

`@epubjs-react-native/core@1.4.7` `getSourceType(source)` logic:

```js
if (source.includes('base64,') || source.length > 1000) return SourceType.BASE64;
if (source.includes('.epub')) return SourceType.EPUB;
if (source.includes('.opf'))  return SourceType.OPF;
return undefined;  // → throws "Invalid source type: <url>"
```

**Why:** The library does NOT check for `http://` / `https://` as a remote source type — it only looks for file extension substrings. A UUID-keyed object URL like `/api/objects/uploads/<uuid>?userId=18` has no extension → crash.

**How to apply:**
- In `objectStorage.ts` `getObjectEntityUploadURL`, generate keys as `uploads/${uuid}.epub` (not bare UUID). This ensures all new upload URLs contain `.epub` in the path.
- In `read/[libraryId].tsx`, add a backward-compat guard for existing entries:
  ```ts
  const raw = apiUrl(entry.epubUrl);
  const src = raw.includes('.epub') ? raw
    : `${raw}${raw.includes('?') ? '&' : '?'}x=.epub`;
  ```
  The server ignores the unknown `x` query param; `getSourceType` sees `.epub` and returns `SourceType.EPUB`.
- `getSourceName` uses the same detection and returns `undefined` (→ "Invalid source name") for the same missing-extension case — the same fix resolves both.
