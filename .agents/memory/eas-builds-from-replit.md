---
name: EAS builds from Replit
description: How to produce and connect an Expo dev-client build for the `mobile` artifact from the Replit environment.
---

# EAS builds from Replit (mobile artifact)

- The reader needs native modules (readium config plugin), so Expo Go can't run it — the user must make an **EAS dev-client build** (`eas.json` has a `development` profile with `developmentClient: true`) and install the APK on a physical Android device.
- Build in the cloud: `npx eas-cli build --profile development --platform android`. `eas build --local` is unreliable here (no full Android SDK). Login (`eas login`) is interactive and tied to the user's own Expo account — never handle their credentials; have the user run it.
- **projectId-ownership gotcha:** `app.json` → `extra.eas.projectId` may belong to a different Expo account than the user's. If `eas build` errors about project access/ownership, have the user run `npx eas-cli init` to relink the project to their account (it rewrites the projectId).
- Connecting the dev client to Metro: the `dev` script sets `EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN`, so the dev client connects over the internet to `https://$REPLIT_EXPO_DEV_DOMAIN` (no USB / same-Wi-Fi needed). The domain is per-repl and ephemeral — read it from the env var, don't hardcode. The `artifacts/mobile: expo` workflow must be running when the phone connects.
