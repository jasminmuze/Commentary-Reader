---
name: Orval query hooks require explicit queryKey
description: Generated useGetX hooks here demand a queryKey inside the query options object whenever you pass options at all.
---

The Orval react-query codegen in this repo (`lib/api-client-react`) generates `useGetX` hooks whose `query` options object **requires** an explicit `queryKey` as soon as you pass any `query` options (e.g. `enabled`, `select`). Calling `useGetX(arg, { query: { enabled } })` without a `queryKey` is a TYPE ERROR.

**Why:** the generated option type makes `queryKey` mandatory when the caller supplies the options object, so it can't fall back to the default key silently.

**How to apply:** every generated hook ships a `getGetXQueryKey(...args)` helper. When passing `query` options, always include it:
`useGetBook(id, { query: { queryKey: getGetBookQueryKey(id), enabled } })`. After any `pnpm --filter @workspace/api-spec run codegen`, re-check all `useGetX(..., { query: {...} })` call sites for missing `queryKey`. Use `getGetXQueryKey` for cache invalidation too (`queryClient.invalidateQueries({ queryKey: getGetXQueryKey(...) })`).
