---
name: Orval params naming convention
description: Which Zod schema name to use for path params vs query-only params in route handlers
---

# Orval Params Naming for Route Handlers

## The rule
- Operations with **path params** → Orval generates `<OperationName>Params` as a Zod schema in `api.ts` (e.g. `GetBookParams`, `GetPassageCommentsParams`)
- Operations with **query params only** → Orval generates `<OperationName>QueryParams` as a Zod schema in `api.ts` (e.g. `SearchUsersQueryParams`, `GetBookQueryParams`)
- The TypeScript interfaces in `types/` use the same names, but they are type-only and have no runtime value — esbuild will error if you try to use them as Zod schemas

## How to apply
In Express route handlers, always import from `@workspace/api-zod` and use:
- `GetBookParams.safeParse(req.params)` for path params
- `GetBookQueryParams.safeParse(req.query)` for query params
- `SearchUsersQueryParams.safeParse(req.query)` for query-only operations (NOT `SearchUsersParams`)

Never import a type-only name (one from `generated/types/*.ts` that isn't also exported from `generated/api.ts`) and call `.safeParse()` on it.
