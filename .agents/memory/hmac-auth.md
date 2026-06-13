---
name: HMAC auth pattern
description: How Bookmarks implements HMAC token-based auth — token shape, middleware, OpenAPI, mobile registration.
---

## Rule
Every protected route uses `authenticate` middleware (`artifacts/api-server/src/middlewares/authenticate.ts`).
The middleware verifies a `Authorization: Bearer <token>` header and sets `req.userId`.
No client-supplied `userId` is allowed anywhere — neither in query params, request body, nor path params for owner-sensitive routes.

**Why:** Code review rejected repeated IDOR findings where userId was client-supplied, letting any user impersonate another.

**How to apply:**
- New route that touches user-owned data → add `authenticate` as second argument to `router.get/post/patch/put`.
- Use `req.userId` (number, always set after middleware) instead of reading from body/query.
- OpenAPI spec: do NOT add userId to requestBody or query params for any write operation. Remove it from read operations too (server reads from token).

## Token shape
`createToken(userId)` in `artifacts/api-server/src/lib/auth.ts`:
- payload = `${userId}.${timestamp}` → HMAC-SHA256 with SESSION_SECRET → base64url
- format: `base64url(payload).base64url(sig)`
- `verifyToken(token)` returns `userId` (number) or throws on invalid/expired (7-day TTL)

## Mobile registration
`setAuthTokenGetter(() => AsyncStorage.getItem(TOKEN_KEY))` is called once at module load in `UserContext.tsx`.
This wires every `customFetch` call to automatically include `Authorization: Bearer <token>`.
Token is stored in AsyncStorage on user creation (POST /api/users) and on returning login (GET /api/users/:id).
Server always returns a fresh token in the `User.token` field.

## OpenAPI
`User` schema has `required: [... token]` and `token: { type: string }`.
No `userId` in: `CommentInput`, `HighlightInput`, `CreateLibraryInput`, `ManualMatchInput`, `UpdateReadingLocationInput`, `LikeCommentBody`, `SaveCommentBody`, or any query params on `GET /books/:id`, `GET /books/:id/quotes`, `GET /quotes/:id/comments`, `GET /library/:id`.
