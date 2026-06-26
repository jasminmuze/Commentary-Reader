---
name: Reply threads + notifications
description: Architecture and pitfalls for 1-level reply threads and in-app notifications in Bookmarks.
---

## Architecture

- `comments.parentId` nullable FK (self-ref). 1-level max enforced in `POST /comments/:id/replies` by checking `isNull(parentId)` on the parent before inserting.
- `notifications` table: `userId` (recipient), `actorId`, `commentId` (the reply), `type` ('reply'|'mention'), `read`, `createdAt`.
- GET `/comments/:id/replies` — requires parent to pass `isNull(commentsTable.parentId)` + `visibilityPredicate` gate before returning replies.
- POST `/comments/:id/replies` — best-effort notification insert in try/catch so reply creation never fails due to notification errors.
- Notifications router is a **separate file** (`routes/notifications.ts`) mounted in `routes/index.ts` — not added to `users.ts`.

## Pitfalls

- After editing `lib/api-zod/src/index.ts` barrel, the new exported types (e.g. `NotificationItem`) are invisible to leaf packages until you run `pnpm run typecheck:libs`. Skipping this step causes TS2305 "has no exported member" in `api-server`.
- `NotificationItem.createdAt` is typed as `Date` (orval converts `format: date-time`). Return `n.createdAt` (the Drizzle Date) — do NOT call `.toISOString()` or TypeScript complains.
- `formatComment` now counts replies with `eq(commentsTable.parentId, comment.id)` — Drizzle handles nullable column correctly with a concrete integer RHS.
- GET `/quotes/:quoteId/comments` must filter `isNull(commentsTable.parentId)` or it returns replies mixed into the top-level list.

## Mobile

- `CommentCard` gains `onReply?: (comment: Comment) => void` and `isReply?: boolean` props; `replyCount` badge shown only on top-level cards (`!isReply && onReply`).
- `CommentSheet` uses `replyThread: Comment | null` state to switch between main list and inline reply thread view.
- `_layout.tsx` calls `useGetNotifications` (with `refetchInterval: 30_000`) inside a `useUnreadCount` hook used by both `ClassicTabLayout` (tabBarBadge) and the custom `BellIcon` component.

**Why:** Tab bar badge needs live data; polling every 30s is cheap and avoids WebSocket complexity for this demo.
