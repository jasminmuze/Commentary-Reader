# iOS 빌드 가이드 (EAS)

Shelfmates iOS 빌드는 EAS(Expo Application Services) 클라우드에서 진행합니다.
Replit Shell에서 실행하며, **Apple Developer Program 계정($99/년)** 이 필요합니다.

## 사전 준비 (1회)

```bash
cd artifacts/mobile
npx eas-cli login          # Expo 계정 로그인 (owner: jasminmuze)
```

## 개발용(dev-client) 빌드 — 실기기 iPhone

```bash
cd artifacts/mobile
npx eas-cli build --profile development --platform ios
```

- 처음 실행하면 Apple 계정 로그인과 기기 등록(ad-hoc provisioning)을 안내합니다.
  - `eas device:create` 로 나온 링크를 iPhone에서 열어 기기를 등록하세요.
  - 기기 등록 후에는 빌드를 다시 실행해야 새 기기가 프로필에 포함됩니다.
- 빌드가 끝나면 설치 링크(QR)를 iPhone Safari에서 열어 설치합니다.
- 설치 후 앱을 열고 개발 서버(`artifacts/mobile: expo` 워크플로우가 실행 중이어야 함)에
  연결하면 됩니다 — Metro 주소는 `https://$REPLIT_EXPO_DEV_DOMAIN` 입니다.

## 시뮬레이터 빌드 (Mac이 있는 경우)

```bash
npx eas-cli build --profile development-simulator --platform ios
```

## TestFlight / App Store

```bash
npx eas-cli build --profile production --platform ios
npx eas-cli submit --platform ios     # App Store Connect 업로드
```

- App Store Connect에서 앱 레코드(bundle id `com.shelfmates.app`)가 필요합니다.
  `eas submit`이 자동 생성을 안내합니다.
- 버전 번호는 EAS가 원격 관리합니다(`appVersionSource: remote`, production은 autoIncrement).

## 푸시 알림 (APNs)

iOS 푸시는 Expo Push API를 그대로 사용하지만 APNs 키가 필요합니다:

1. `eas build` 최초 실행 시 "Push Notifications" 설정 여부를 물으면 **Yes** —
   EAS가 Apple 계정에서 APNs 키를 자동 생성/등록합니다.
2. 이미 빌드한 뒤라면 `npx eas-cli credentials` → iOS → Push Notifications에서 설정.
3. 서버 쪽은 변경 불필요 — Expo Push API가 FCM/APNs를 모두 처리합니다
   (`artifacts/api-server/src/lib/push.ts`).
4. 앱은 실기기 + dev/EAS 빌드에서만 토큰을 등록합니다(시뮬레이터/Expo Go 미지원).

## 참고

- iOS 리더(Readium Swift)는 config plugin(`plugins/withReadium.js`)이 Podfile에
  자동 주입합니다. 별도 설정이 필요 없습니다.
- 로컬 `ios/` 디렉터리는 생성물이며 커밋하지 않습니다(EAS가 빌드 시 prebuild 수행).
