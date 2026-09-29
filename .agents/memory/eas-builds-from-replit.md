---
name: EAS builds from Replit
description: How to produce and connect an Expo dev-client build for the `mobile` artifact from the Replit environment.
---

# EAS builds from Replit (mobile artifact)

- The reader needs native modules (readium config plugin), so Expo Go can't run it — the user must make an **EAS dev-client build** (`eas.json` has a `development` profile with `developmentClient: true`) and install the APK on a physical Android device.
- For a cloud build from a Git reference, the Expo project must be linked to its GitHub repository in Expo's project GitHub settings, with the monorepo base directory set to `artifacts/mobile`. Use the Expo connection's build tool rather than EAS CLI. **Why:** a GitHub remote in Replit alone does not establish this Expo-side link, and local Android builds lack a full SDK. **How to apply:** let the user authorize the Expo GitHub App in their own account; never handle their credentials or rewrite the EAS project ID just to bypass access errors.
- GitHub-triggered Expo builders can default to a newer pnpm than the workspace uses. **Why:** pnpm 11 rejected an approved `esbuild` lifecycle script in this pnpm 10 workspace, even after the lockfile passed. **How to apply:** pin the matching pnpm version in the EAS preview profile and keep the root lockfile consistent with every workspace package manifest present in the Git source snapshot.
- Connecting the dev client to Metro: the `dev` script sets `EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN`, so the dev client connects over the internet to `https://$REPLIT_EXPO_DEV_DOMAIN` (no USB / same-Wi-Fi needed). The domain is per-repl and ephemeral — read it from the env var, don't hardcode. The `artifacts/mobile: expo` workflow must be running when the phone connects.
