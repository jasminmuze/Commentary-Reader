# Bookmarks

Bookmarks is a social ebook reader: users upload their own EPUB files, read them with the publisher's original formatting, and see community highlights and comments cross-linked across everyone's separate copies of the same book.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/mobile run dev` — run the Expo mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; use `push-force` for destructive changes)
- Required env: `DATABASE_URL` — Postgres connection string; object-storage env vars (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo SDK 54, React Native 0.81, React 19, expo-router
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Storage: Replit Object Storage (`expo_object_storage` blueprint) — owner-private EPUB uploads (ACL-gated)
- EPUB rendering: native Readium (Android, custom RN ViewManager under `artifacts/mobile/native/readium-host/`)

## Where things live

- DB schema (source of truth): `lib/db/src/schema/` — `books`, `quotes`, `userHighlights`, `userLibrary`, `comments`, `users`
- API contract (source of truth): `lib/api-spec/openapi.yaml`; generated Zod in `lib/api-zod`, generated react-query hooks in `lib/api-client-react`
- Server routes: `artifacts/api-server/src/routes/` (`books`, `quotes`, `comments`, `library`, `objects`); query helpers in `src/lib/queries.ts`; text normalization in `src/lib/text.ts`; EPUB metadata in `src/lib/epubMetadata.ts`; storage in `src/lib/objectStorage.ts` + `objectAcl.ts`
- Mobile screens: `artifacts/mobile/app/` — `(tabs)/index.tsx` (library + upload), `(tabs)/discover.tsx` (search), `book/[id].tsx` (detail), `readium/[libraryId].tsx` (native Readium reader), `match/[libraryId].tsx` (match confirm)
- Mobile API base + hooks: `artifacts/mobile/lib/api.ts`, `hooks/useFileSystem.ts`, `components/CommentSheet.tsx`

## Architecture decisions

- Community highlights/comments are anchored by NORMALIZED QUOTE TEXT, not file CFIs. Each quote stores `normText` + `normTextHash` (sha256) with a unique index on `(canonical_book_id, norm_text_hash)`. CFIs are per-file render positions only, never shared.
- Find-or-create quote is a single race-free `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` round trip. Comments also find-or-create a quote (users can comment on selections nobody highlighted).
- No `highlightCount` denormalization — counts are computed via GROUP BY on read.
- The reader matches a quote across editions by searching a distinctive LEADING SUBSTRING (~first 8 words), not the full quote, to survive punctuation/hyphenation drift between editions.
- The native Readium reader runs only in an Android dev/EAS build (NOT Expo Go or web preview). It is platform-guarded with a fallback screen elsewhere.
- Real auth: password-based signup/login (`bcryptjs` hashes in `users.password_hash`) issuing HMAC-signed bearer tokens (`SESSION_SECRET`, 30-day expiry, `src/lib/auth.ts`). All non-public routes use the `authenticate` middleware and derive identity from `req.userId` — client-supplied userIds are never trusted. `POST /users` returns 409 on username collision (no token giveaway); seeded/legacy accounts with null `password_hash` cannot log in. `GET /api/objects/*` enforces the object ACL against the authenticated user; the mobile app sends `Authorization: Bearer` on all API calls and EPUB downloads.
- Push notifications: Expo push tokens live in `push_tokens` (token unique, upsert reassigns to the latest registering user — no cross-account leakage on shared devices). Server fires best-effort pushes via the Expo Push API on reply/mention notification creation (`src/lib/push.ts`, fire-and-forget, prunes `DeviceNotRegistered` tokens). Mobile registers the token after login (`components/PushTokenRegistrar.tsx`), guarded to dev/EAS builds on real devices only (no web/Expo Go/simulator). `DELETE /api/users/{userId}/push-tokens` unregisters (for a future logout flow).
- Friend requests: `friend_requests` stores PENDING rows only (unique requester+recipient); accept/decline DELETE the row (decline is silent, re-request allowed). Accepting runs in a DB transaction that inserts BOTH follow directions (`onConflictDoNothing`) so the existing "mutual follow = friends" visibility rule keeps working unchanged; it also marks the recipient's `friend_request` notifications read and creates a `friend_accept` notification + push. Sending a request to someone whose request to you is pending auto-accepts. `notifications.comment_id` is nullable (null for `friend_*` types; API maps it to 0). Profile exposes `friendStatus` (none/requested/incoming/friends).
- Reading location is persisted per library entry: `userLibrary.lastReadingLocation` (Readium locator JSON). The reader passes it as the initial locator to resume, and debounce-saves location changes via `PUT /api/library/{libraryId}/location`.

## Product

- Upload your own EPUB; it is auto-matched to a shared canonical book by ISBN, then by normalized title+author (with candidate/manual fallback).
- Read with the publisher's original formatting.
- See community highlights painted over your own copy (amber, intensity scaled by popularity) and tap them to read/post comments.
- Discover screen searches canonical books; book detail shows the most-highlighted quotes and best comments.

## User preferences

- The user writes in Korean — respond in Korean. App UI copy is Korean.

## Gotchas

- After `pnpm --filter @workspace/api-spec run codegen`, generated `useGetX` hooks require an explicit `queryKey` whenever you pass `query` options — use the `getGetXQueryKey(...)` helper.
- Codegen + Metro race: while Orval is cleaning its output folder mid-codegen, Metro can bundle and cache an `Unable to resolve module ./generated/api` error that persists even after the files reappear. Restart the `artifacts/mobile: expo` workflow after running codegen to clear it.
- For EPUB download/caching use the local `hooks/useFileSystem.ts` (imports from `expo-file-system/legacy`; the root `expo-file-system` entrypoint changed APIs in SDK 54).
- `lib/api-zod/src/index.ts` is hand-maintained — never `export * from "./generated/types"` wholesale (name collisions); list individual files.
- `artifacts/mockup-sandbox` has pre-existing React 19 ref-type typecheck errors in `calendar.tsx`/`spinner.tsx`, unrelated to this app.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
