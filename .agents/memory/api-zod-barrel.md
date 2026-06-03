---
name: API Zod barrel exports
description: How to avoid TS2308 collision between Zod schemas and TypeScript types in lib/api-zod/src/index.ts
---

# API Zod Barrel Export Collision Fix

## The rule
`lib/api-zod/src/index.ts` must NOT use `export * from "./generated/types"` wholesale. Instead, list each type file individually and skip the ones whose exported names collide with Zod schema names in `./generated/api`.

## Why
Orval generates two things for operations that have path params:
1. A Zod schema in `generated/api.ts`: e.g. `export const GetBookParams = zod.object({...})`
2. A TypeScript type in `generated/types/getBookParams.ts`: e.g. `export type GetBookParams = {...}`

When both are re-exported from the same barrel, TypeScript (and esbuild) see duplicate export names → TS2308 / "No matching export" error.

## How to apply
After running `pnpm --filter @workspace/api-spec run codegen`, look for which type files in `generated/types/` have the same base name as a `const` in `generated/api.ts`. Skip those files in `index.ts`.

Current skipped files (as of initial build):
- `./generated/types/getBookParams` (collides with `GetBookParams` Zod schema)
- `./generated/types/getPassageCommentsParams` (collides with `GetPassageCommentsParams` Zod schema)
