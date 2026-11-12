---
name: Android push needs user-side FCM setup
description: Why push can't be verified from Replit and what the user must do before device delivery works.
---

# Android push / FCM prerequisites

- Expo push on a standalone/dev-client Android build requires BOTH: Firebase client configuration compiled into the app AND an FCM V1 service account key configured on the matching Expo project.
- **Why:** Standalone builds need their own Firebase configuration; Expo Go behavior does not prove standalone push works. Tokens registered by other devices do not prove the affected Android device registered successfully.
- **How to apply:** Check Firebase client configuration before diagnosing downstream delivery. Use Expo's dashboard under Project settings → Credentials → Android application identifier → Service credentials → FCM V1 service account key; do not run or suggest EAS CLI. The private service-account JSON belongs directly in Expo's credential upload, never chat or source control. Firebase's `google-services.json` is a distinct public-facing client configuration file, not that private key. Client configuration changes require a new native build. Verify token registration and physical-device delivery separately.
