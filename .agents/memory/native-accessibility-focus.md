---
name: Native accessibility focus
description: Platform constraints for moving accessibility focus in the Expo app
---

Only call `findNodeHandle` and `AccessibilityInfo.setAccessibilityFocus` on iOS and Android; React Native Web throws when `findNodeHandle` is called.

**Why:** The Expo artifact also renders as a web preview, so native-only focus movement can crash an otherwise valid signup screen there.

**How to apply:** Guard programmatic native accessibility focus with a platform check while keeping announcements and accessible labels available on web.
