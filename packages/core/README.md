# @lalista/core

> Framework-neutral business logic — Supabase client, API wrappers, types, schemas. Up to [OVERVIEW.md](../../OVERVIEW.md) for the product context, [ARCHITECTURE.md](../../ARCHITECTURE.md) for where this fits in the system.

## What's here

Every Supabase-touching call in lalista flows through `packages/core`. The package is framework-neutral by design — no Next.js, no React, no Sentry. The web app passes the `@supabase/supabase-js` client in via `createClient(config)`; everything else is pure TypeScript.

This separation lets `apps/web` stay focused on rendering, makes integration tests against a real Supabase stack possible without a Next.js harness, and keeps the door open for other surfaces (mobile, CLI tools) to consume the same wrappers.

## Module map

| File / dir            | Purpose                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase.ts`         | Client factory + `assertNotProdUrlInTestEnv` URL guard (structural defense — see CLAUDE.md)                                                                                                                                                                                          |
| `supabase.types.ts`   | Generated Postgres types (regenerate via `pnpm db:gen-types` after schema changes)                                                                                                                                                                                                   |
| `errors.ts`           | Typed error classes (`AddItemValidationError`, friendly auth-error mappers)                                                                                                                                                                                                          |
| `index.ts`            | Public barrel export — every consumer imports from `@lalista/core`                                                                                                                                                                                                                   |
| `api/auth.ts`         | `signIn`, `signUp`, `signOut`, `getCurrentUser`, friendly error mapping; `signUpWithPassword` accepts an `inviteToken` 5th arg (D4)                                                                                                                                                  |
| `api/households.ts`   | Provision via `create_household_with_owner` RPC, fetch household + membership; `fetchMyHousehold` + `renameHousehold` + `leaveHousehold` (migration 015)                                                                                                                             |
| `api/items.ts`        | List/search items in the household catalog (pg_trgm-backed); `fetchListEntries` returns `{entries, currentHouseholdId}` (D6 — RemovedFromHouseholdError on null)                                                                                                                     |
| `api/profiles.ts`     | `fetchMyProfile`, `updateMyProfile` (display name editing)                                                                                                                                                                                                                           |
| `api/realtime.ts`     | `subscribeToList(client, householdId, callback, onError?, onSubscribed?) → unsubscribe` — wraps Realtime channel filtered by household. `onSubscribed` fires on every successful (re)subscription; consumers use it to clear wake-recovery suppress state (sync-banner-pwa-recovery) |
| `api/stores.ts`       | Fetch stores list + per-household My Stores wrappers (`fetchMyStores`, `fetchStoreCatalogSuggestions`, `addHouseholdStore`, `removeHouseholdStore`) — migration 016                                                                                                                  |
| `api/storeErrors.ts`  | Typed `StoreError` union + `StoreRpcError` class + `mapStoreError` / `throwMappedStoreError` shared by every my-stores wrapper                                                                                                                                                       |
| `api/addItem.ts`      | `invokeAddItem` — calls `add-item` edge function, validates response with Zod schema, throws typed `AddItemValidationError` on shape drift                                                                                                                                           |
| `api/inviteErrors.ts` | Typed `InviteError` union + `InviteRpcError` class + `mapInviteError` / `throwMappedInviteError` shared by every household-collaborators wrapper                                                                                                                                     |
| `api/invitations.ts`  | `createInvite` / `fetchPendingInvites` / `revokeInvite` / `acceptInvite` (migration 015 RPCs); URL building per D5 (`NEXT_PUBLIC_SITE_URL ?? window.location.origin`)                                                                                                                |
| `api/members.ts`      | `fetchMembers` (two-query display-name hydration) + `removeMember` RPC                                                                                                                                                                                                               |
| `api/audit.ts`        | `fetchHouseholdAudit(limit?)` — household_audit_events with two-query display-name hydration for actor + target (D13/C1)                                                                                                                                                             |
| `migrations/`         | Migration-paired tests — `015_for_update.test.ts` (T8 pure-file FOR UPDATE assertion) + `015_household_collaborators.integration.test.ts` (T1, T2a, T2b, 4, 5, 7) + `016_is_global_false.test.ts` + `016_household_stores.integration.test.ts`                                       |
| `schemas/`            | Zod schemas (single source of truth for `AddItemResponse` shape via `z.infer`)                                                                                                                                                                                                       |
| `models/`             | Re-exports `z.infer<...>` types (so `apps/web` imports types from `models/`, not `schemas/`)                                                                                                                                                                                         |

## Conventions

- **Never read env vars directly**: all configuration enters through `createClient(config)`'s arguments. The web app provides `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from its own env surface. See `CLAUDE.md § Env Var Naming`.
- **Wrappers over raw queries**: `apps/web` should never call `supabase.from('table').select(...)` directly. Add a wrapper here, document it in `CLAUDE.md § Where Things Happen`, write a unit test, optionally add an integration test (`*.integration.test.ts`).
- **`mark_item_bought` is the ONLY path to mark bought**: RLS blocks direct inserts to `purchase_history`. Use `markItemBought(client, entryId)` — never `purchase_history.insert` directly. (CLAUDE.md gotcha — load-bearing.)
- **Realtime errors via `onError`, recovery via `onSubscribed`**: `subscribeToList`'s optional `onError` fires on `'CHANNEL_ERROR'` / `'TIMED_OUT'`; optional `onSubscribed` fires on every successful (re)subscription (load-bearing for `<ListClient>`'s wake-recovery early-clear of the suppress-window + pending-error ref). Synchronous WebSocket-constructor throws are still caller's responsibility. See `CLAUDE.md § Gotchas` → `subscribeToList` wake-recovery bullet for the full state machine (always-rebuild + suppress + pending-error tracking + deferred banner-check).
- **Two-query pattern for `addedByName` hydration**: `fetchListEntries` does NOT use a PostgREST join through `auth.users` (it doesn't resolve). Two queries — list_entries first, then `profiles.in('user_id', uniqueAddedBy)`. Don't "simplify" without re-evaluating the FK story.
- **Schema → types**: types in `models/` come from `z.infer<typeof Schema>` in `schemas/`. The Zod schema is the source of truth at the runtime boundary; the type is derived. Don't hand-author the type.
- **Tests colocate**: `auth.test.ts` next to `auth.ts`. Integration tests use `*.integration.test.ts` naming and are gated by `VITEST_INTEGRATION=1` (CI slow-job sets this).
- **E2E coverage trail**: every API wrapper either has a dedicated E2E spec or cites one in its JSDoc that transitively covers it. The `/ak-test-review` gate flags missing pairs. See `CLAUDE.md § Testing` for the E2E-per-surface invariant.

## See also

- [OVERVIEW.md](../../OVERVIEW.md) — product context
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — system view
- [`apps/web/README.md`](../../apps/web/README.md) — primary consumer
- [`packages/ui/README.md`](../ui/README.md) — sibling package (design system)
- [`supabase/functions/README.md`](../../supabase/functions/README.md) — the edge function this package wraps
- `CLAUDE.md § Where Things Happen` — path index
- `CLAUDE.md § Gotchas` — wrapper-specific load-bearing rules
