---
name: Android push needs user-side FCM setup
description: Why push can't be verified from Replit and what the user must do before device delivery works.
---

# Android push / FCM prerequisites

- Expo push on a standalone/dev-client Android build requires BOTH: `google-services.json` compiled into the build AND an FCM V1 service account key uploaded to the EAS project (`npx eas-cli credentials`). Without google-services.json, `getExpoPushTokenAsync` fails on-device — tokens never even register (empty `push_tokens` table is the symptom, not a server bug).
- **Why:** Expo Go bundles Expo's own FCM creds, but standalone builds must use the app owner's Firebase project. None of this is checkable from Replit: `eas-cli` is not logged in (user's personal Expo account) and Firebase console access is user-only.
- **How to apply:** Don't debug the server pipeline when `push_tokens` is empty on Android — check FCM setup first. `artifacts/mobile/app.config.js` conditionally wires `googleServicesFile` only when the file exists, so the user just drops `google-services.json` into `artifacts/mobile/` and rebuilds; committing that file is fine (it ships in the APK anyway).
