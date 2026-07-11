---
name: Auth model decision
description: Why this app uses its own HMAC bearer tokens + bcrypt passwords instead of Clerk/Replit Auth
---

# Auth model: self-issued HMAC bearer tokens, not Clerk

The API issues HMAC-signed bearer tokens (SESSION_SECRET, 30-day TTL) on password signup/login; bcryptjs hashes live in `users.password_hash` (nullable — seeded demo accounts can never log in).

**Why:** Clerk was `not_configured`, a bearer-token layer was already wired end-to-end (server middleware, mobile token getter, EPUB download headers), and a native Android dev build was in device QA — introducing Clerk Expo would have forced a native rebuild mid-QA.

**How to apply:** Extend the existing scheme (e.g. refresh, rate limiting) rather than swapping providers. If migrating to Clerk later, expect to replace the token getter in the mobile app, the `authenticate` middleware, and the login/signup screen together. Login does a dummy bcrypt compare on unknown usernames to blunt timing-based enumeration — keep that if refactoring.
