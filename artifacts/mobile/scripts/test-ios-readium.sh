#!/usr/bin/env bash
set -Eeuo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MOBILE_DIR"

phase="iOS chapter-pull logic and Swift syntax checks"
trap 'status=$?; printf "::error::%s failed (exit %s).\\n" "$phase" "$status" >&2; exit "$status"' ERR

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: UIKit/Readium type-check requires macOS with Xcode and CocoaPods." >&2
  echo "Run scripts/test-ios-chapter-pull.py separately for the logic and syntax checks." >&2
  exit 2
fi

for command in pnpm pod xcodebuild; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: Required iOS build command '$command' was not found on PATH." >&2
    exit 2
  fi
done

echo "==> $phase"
python3 scripts/test-ios-chapter-pull.py

phase="Expo iOS prebuild"
echo "==> $phase"
pnpm exec expo prebuild --platform ios --clean --no-install

workspace="$(find ios -maxdepth 1 -type d -name '*.xcworkspace' -print -quit)"
if [[ -z "$workspace" ]]; then
  echo "ERROR: Expo prebuild did not generate an iOS workspace under $MOBILE_DIR/ios." >&2
  exit 1
fi

phase="CocoaPods dependency installation (including Readium Swift 3.1.x)"
echo "==> $phase"
(cd ios && pod install)

phase="unsigned iOS Simulator compile"
echo "==> $phase"
scheme="$(basename "$workspace" .xcworkspace)"
xcodebuild \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "${TMPDIR:-/tmp}/shelfmates-ios-derived-data" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

phase="iOS Readium verification"
echo "PASS: chapter-pull logic, complete Swift syntax, UIKit/Readium type-check, and unsigned iOS Simulator build."
trap - ERR
