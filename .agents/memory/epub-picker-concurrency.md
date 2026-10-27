---
name: EPUB picker concurrency
description: Prevent overlapping native document picker calls in the mobile EPUB upload flow.
---

iOS `DocumentPicker.getDocumentAsync` rejects a second launch while another picker request is still active. A disabled button driven only by React state can still allow a rapid duplicate tap, and an async consent step can leave the upload action available while the picker is opening. Guard picker launches with a synchronous `useRef` lock across the consent and picker flow, and keep the trigger disabled until the picker resolves. Always release the lock in `finally`.

**Why:** a reader saw the native error “Different document picking in progress. Await other document picking first” during EPUB upload.

**How to apply:** any new code path that opens the document picker should use the same lock and keep it until the active picker promise settles.
