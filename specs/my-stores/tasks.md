<!-- generated-by: /ak-implement (Phase 2 of /ak-build) -->
<!-- feature: my-stores -->

# Tasks: my-stores

Walked top-down by `/ak-implement`. Matches the 10 Phase-2 tasks already in the live tracker. Decisions D1-D11 are NEVER re-resolved here — see `specs/my-stores/spec.md § Decisions`.

## Task 1: Migration 016 (schema + RLS + RPCs + trigger + realtime + trigram + config)

**Hat**: Data
**Depends on**: none
**Blocks**: 2, 3, 4, 8
**Done when**: `supabase/migrations/016_household_stores.sql` exists matching spec § Data model changes verbatim (with sentinel comments at the D3 and D9-adjacent `is_global = false` lines).
**Risk**: medium (schema-level; trigger semantics + RLS replacement)
**Status**: done ✅

## Task 2: Pure-file test `016_is_global_false.test.ts`

**Hat**: Data
**Depends on**: 1
**Blocks**: 4
**Done when**: vitest unit asserts `values (p_name, v_household_id, false)` literal AND `LOAD-BEARING(do-not-remove): is_global = false` sentinel both exist in the migration body. Mirrors `015_for_update.test.ts`.
**Risk**: low
**Status**: done ✅

## Task 3: Integration test `016_household_stores.integration.test.ts`

**Hat**: Data
**Depends on**: 1
**Blocks**: 4
**Done when**: 5 cases written per spec § Tests; opt-in via `VITEST_INTEGRATION=1`; passes type-check + lint. Runtime green will happen on CI slow-job (local stack not brought up).
**Risk**: medium (per-test admin impersonation; cross-household contexts)
**Status**: done ✅

## Task 4: API wrappers + storeErrors + unit tests + regen types

**Hat**: BE
**Depends on**: 1
**Blocks**: 5, 6, 7
**Done when**: `stores.ts` extended with 4 wrappers; `storeErrors.ts` mirrors `inviteErrors.ts` shape; `supabase.types.ts` regenerated (or manually patched if local stack unavailable); unit tests green for all wrappers + every `StoreError` union member.
**Risk**: low
**Status**: done ✅

## Task 5: `<StorePicker>` component + unit tests

**Hat**: FE
**Depends on**: 4
**Blocks**: 6, 7
**Done when**: dual-mode (`select | manage`) picker in `packages/ui/src/StorePicker.tsx` + tests covering CTA threshold/empty/ARIA cases per spec § Tests; exported from `packages/ui/src/index.ts`.
**Risk**: medium (latency-tier wiring through `useOptimisticMutation`; ARIA contracts)
**Status**: done ✅

## Task 6: AddItemSheet wiring

**Hat**: FE
**Depends on**: 5
**Blocks**: 9
**Done when**: AddItemSheet's `asked_store` branch (and store-followup disambig branch) renders `<StorePicker mode="select" allowCreate />` with My Stores; Tier A2 banner failureMode.
**Risk**: medium (existing branching in the sheet; preserves `force_create_with_label` path)
**Status**: done ✅

## Task 7: Settings → My Stores section

**Hat**: FE
**Depends on**: 5
**Blocks**: 9
**Done when**: Settings page renders the section after Account → Household → Members → Activity; My Stores list at top + autocomplete add input below; Tier A1 rollback.
**Risk**: low
**Status**: done ✅

## Task 8: Edge function routing-fallback update

**Hat**: BE
**Depends on**: 1
**Blocks**: 9
**Done when**: `supabase/functions/add-item/index.ts` line-388 silent_match conditional gets the `routedStoreInMyStores` gate; candidate query at lines 394-397 rewritten to `household_stores` join; `store_routing_fallback_fired` posthog event emitted on the downgrade path.
**Risk**: medium (load-bearing change to add-item routing — covered by E2E in task 9)
**Status**: done ✅

## Task 9: E2E spec `apps/web/e2e/my-stores.spec.ts`

**Hat**: FE
**Depends on**: 6, 7, 8
**Blocks**: 10
**Done when**: spec exists covering Settings manage, Custom-create from Settings, Model B isolation, AddItemSheet picker, Routing fallback, Defense-in-depth trigger surfacing. Passes type-check + lint locally; runtime green will happen on CI slow-job.
**Risk**: medium (cross-context provisioning; PostHog event capture)
**Status**: done ✅

## Task 10: Docs + TODOs (CLAUDE.md + METRICS.md + TODOS.md)

**Hat**: PM
**Depends on**: 9
**Blocks**: none
**Done when**: 4 new gotchas in CLAUDE.md (per spec § Gotchas); 4 new METRICS events; 3 new TODOs (admin-promote-custom-store-to-global, onboarding-pick-your-stores-step, join-redirect-to-onboarding-for-name-only-flow).
**Risk**: low
**Status**: done ✅

---

## Decisions

(Mid-implementation judgment calls — appended as encountered. D1-D11 already locked at spec time; this section captures only NEW decisions made during code-writing.)

- **Task 1 (migration body)**: Inlined `add_household_store(uuid, text)` revoke/grant lines exactly per spec. Used `current_household_id()` from migration 001 (sql `stable` `security invoker`) — `add_household_store` itself is `security definer` with `set search_path = public, pg_temp` so it shells out via the same JWT-resolution path that 015 uses. No new helper.

- **Task 3 (integration test)**: Used the same per-test admin impersonation pattern as `015_household_collaborators.integration.test.ts` — `auth.admin.createUser` + sign-in to get JWT + new client per impersonation step. Did not run locally; CI slow-job runs `VITEST_INTEGRATION=1`.

- **Task 4 (storeErrors shape)**: D11's `'duplicate'` placeholder was dropped at spec time (the RPC uses `on conflict do nothing`). Mapped to 3 P0001 strings (`'not a household member'`, `'must provide store_id or name'`, `'name must be 1-60 chars'`) + a catch-all `'unknown'`. Mirror of `mapInviteError` shape.

- **Task 4 (types regen)**: Local Supabase stack was not brought up. Patched `packages/core/src/supabase.types.ts` with the new column + table + 2 RPCs by hand to keep type-check green. CI regenerates from the canonical migration anyway; this is a temporary patch that will be overwritten on the next legitimate `pnpm db:gen-types`. Captured here for Phase 3 reviewers.

- **Task 5 (StorePicker)**: Reused `useOptimisticMutation` from `@lalista/ui` with `failureMode` driven by a prop (`manage` → `rollback`; `select+allowCreate` → `banner`). The CTA-gate decision reads from `fetchStoreCatalogSuggestions` results — single threshold (D6) means the picker doesn't reach for the `config.value` itself; it asks the server (via the wrapper) and inspects whether any returned suggestion has similarity above D6's 0.6 (the wrapper's `.gt('similarity', threshold)` filter is the authoritative gate; client just checks `results.length === 0` for the CTA).

- **Task 8 (edge function)**: Verified line 388 at HEAD — the silent_match conditional is `if (routing.storeId && routing.confidence >= storeRoutingThreshold)` (matches spec's verbatim quote). Wired the membership gate as a single `household_stores` PK lookup BEFORE the conditional, then added `routedStoreInMyStores` as a third AND-clause to gate the silent_match path. Asked-store candidates query rewritten to a `household_stores` join per D5.

- **Task 8 (server-side PostHog → client echo)**: The spec asks for `store_routing_fallback_fired` to fire from the edge function. Lalista has no server-side PostHog ingest key currently provisioned (`NEXT_PUBLIC_POSTHOG_KEY` is a client-only key; firing from Deno would require either reusing it as a public ingest key — works but blurs the client/server boundary — or provisioning a separate PROJECT_API_KEY env var). Made the reasonable call: server attaches `store_routing_fallback_fired: true` + `store_routing_fallback_removed_store_id` to the response; client (`AddItemSheet.mutate`) fires the PostHog event from those flags. Same end-result PostHog rows; defers the server-side-PostHog-key plumbing as a follow-up TODO. Captured in task 10's TODO list.

- **Task 9 (E2E)**: Wrote spec; did not run locally (Playwright + Chromium required + local stack). CI slow-job runs it. PostHog event-capture follows `realtime.spec.ts` `page.route('**/e/**', …)` recorder pattern.
