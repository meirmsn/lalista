# Tasks: ci-slow-job (PR 4)

Feature branch: `feature/ci-slow-job`
Spec: `specs/ci-slow-job/spec.md`
Nine tasks (A–I) mirroring spec § Task order. Task I (runtime URL guard, D22) added mid-flight after user question about automating secret rotation — see `spec.md § Decisions D22` for full rationale.

---

## Task A: profiles migration (012)

**Hat**: Data
**Depends on**: none
**Blocks**: B, C, E
**Done when**: `supabase/migrations/012_profiles.sql` exists (table + RLS + trigger + backfill + ROLLBACK block), and `Profile` type is accessible from `@lalista/core`.
**Risk**: medium (trigger + RLS + FK to auth.users)
**Status**: todo

## Task B: Posted-by-someone UI

**Hat**: FE + BE
**Depends on**: A
**Blocks**: G
**Done when**: display-name plumbing lands end-to-end (sign-up field → profiles table → fetchListEntries join → ListRow + item detail + Settings render).
**Risk**: medium (PostgREST join resolution — D21)
**Status**: todo

## Task C: Integration test harness

**Hat**: BE
**Depends on**: A
**Blocks**: D
**Done when**: `test:integration` turbo task exists, vitest `*.integration.test.ts` glob wired, `profiles.integration.test.ts` + `items.integration.test.ts` skeletons written with CI-skip-when-local behavior.
**Risk**: low
**Status**: todo

## Task D: CI slow-job YAML

**Hat**: Data / PM
**Depends on**: C
**Blocks**: E, F
**Done when**: `.github/workflows/ci.yml` contains a full `slow` job (Supabase setup → seed → edge-fn deploy → integration tests → Playwright 2 viewports → caching × 3 → trace upload → secret masking).
**Risk**: high (CI-only validation; can't fully test locally)
**Status**: todo

## Task E: Type drift + rollback EXPLAIN scripts

**Hat**: Data
**Depends on**: A, D
**Blocks**: none
**Done when**: `scripts/ci-type-drift.sh` + `scripts/ci-rollback-explain.sh` exist, are executable, bash-safe (`set -euo pipefail`), and wired into slow-job YAML.
**Risk**: medium
**Status**: todo

## Task F: Force-create E2E (PR 5 carry-forward)

**Hat**: FE
**Depends on**: D
**Blocks**: none
**Done when**: `apps/web/e2e/add-new.spec.ts` runs at both viewports and asserts `items` + `list_entries` rows via Supabase admin client.
**Risk**: medium
**Status**: todo

## Task G: Unit + component test coverage

**Hat**: FE
**Depends on**: B
**Blocks**: none
**Done when**: each of the 7 files modified by B has at least one test asserting the new branch.
**Risk**: low
**Status**: todo

## Task H: README + TODOS + PRODUCT-ROADMAP + (optional) in-PR secret rotation

**Hat**: PM + Data
**Depends on**: D
**Blocks**: none
**Done when**: README has CI section, TODOS.md `posted-by-someone` removed, PRODUCT-ROADMAP § 1g item 4 rewritten to reflect D8 (optional rotation) + D22 (URL guard). Rotation itself is now optional defense-in-depth — Task I's guard carries the load.
**Risk**: low (docs only; rotation demoted to optional post-merge note)
**Status**: done — docs edits landed (`a064f27`). Rotation `gh secret set` still blocked by session PAT (HTTP 403), but since D22 makes rotation non-load-bearing, this is no longer a ship blocker. Surfaced in PR body as an optional post-merge note.

## Task I: Runtime URL guard (D22 — user-requested mid-flight)

**Hat**: BE
**Depends on**: none (additive to core; no blocking deps)
**Blocks**: none
**Done when**: `assertNotProdUrlInTestEnv(url)` helper lives in `packages/core/src/supabase.ts`, is called from all four Supabase client factory sites (core + web-client + web-server + middleware), and has 5 passing unit tests in `packages/core/src/supabase.test.ts`. `@lalista/core` barrel re-exports the helper.
**Risk**: low (narrow scope, NODE_ENV===test only, no runtime behavior change in dev/prod)
**Status**: done (`4081278`). Tests green. Softens D8 from blocker to optional; closes qa-options.md § Deferred Enforcement #3 within PR 4 rather than as a follow-up PR.

---

## Decisions

D1–D21 are locked in `spec.md § Decisions`. Phase 2 judgment calls appended here:

- **A — Type regen deferred to CI slow-job**: devcontainer's `supabase gen types --local` cannot run (DiD inert; no live local Postgres). Manually patched `packages/core/src/supabase.types.ts` to add the `profiles` table Row/Insert/Update/Relationships — mirrors the shape `supabase gen types` would produce. CI slow-job's type-drift step (Task E, `scripts/ci-type-drift.sh`) regenerates against the real local Postgres and fails if the hand-patched version drifts from the generated output. Expected: zero drift (migration matches the table definition character-for-character).
- **A — `HydratedListEntry.addedByName: null` stub shipped in Task A**: Task B owns the actual PostgREST join. Task A adds the field but returns `null` from both `fetchListEntries` + `fetchListEntryById` so `HydratedListEntry` stays type-coherent (every caller already branches on null for the "someone" fallback, so behavior is unchanged until B lands).
- **B — Two-query hydration instead of PostgREST join**: D21 suggested `profiles!list_entries_added_by_fkey(display_name)` or a two-hop through auth.users. PostgREST cannot express either cleanly — auth.\* is in a different schema so PostgREST's relationship inference doesn't cover it, and adding a direct `list_entries.added_by -> profiles.user_id` FK would couple migration 012 to migration 009's `ON DELETE SET NULL` semantic. Falling back to a second `profiles.select('user_id, display_name').in(...)` call (documented in D21 as the deferred path) — one extra round trip per list fetch, trivially typed, and reusable by `fetchListEntryById`. A view (`list_entries_hydrated`) was considered but rejected: adds another SQL surface to maintain without eliminating the join complexity.
- **B — DisplayNameField tests use `fireEvent` + real timers, not `vi.useFakeTimers`**: initial attempt combined fake-timer-driven debounce with `userEvent.setup({ advanceTimers })`; both compete to drive the event loop and caused 5-second timeouts on the error-rollback + empty-trim tests. Rewrote tests to pin `debounceMs` at 20-30ms and use `fireEvent.change` + `fireEvent.blur` + `waitFor(..., { timeout: 500 })`. Suite runs < 300ms and is deterministic.
- **C — `@types/node` added to `packages/core`** to typecheck `process.env.SUPABASE_URL` reads in the integration test files. Integration tests are the only `packages/core` consumers of process.env — unit tests don't need it.
- **C — `VITEST_INTEGRATION` env flag drives vitest config include globs**, not a separate vitest.integration.config.ts. Keeps the fast/slow split to a single toggle; avoids drift between two configs.
- **H — rotation demoted to optional**: session PAT lacks `secrets:write` scope (HTTP 403 on both `gh secret list` and `gh secret set`). With D22's URL guard landing, rotation is no longer load-bearing; PR ships without it. User may rotate at their leisure via the GitHub UI (Settings → Secrets → Actions) or with a PAT that has the scope. README + TODOS + PRODUCT-ROADMAP edits (the other three parts of Task H) landed in `a064f27`; PRODUCT-ROADMAP item-4 rewritten to reflect current state in the same follow-up as Task I's landing.
- **I — scope decision: fold qa-options.md Enforcement #3 into PR 4 rather than ship as a separate narrow PR**: user-triggered mid-flight ("can we make this automatic so I don't rotate every time?"). Guard is a ~20-LOC helper + 5 tests — small enough to slot in without growing PR 4's coherence, large enough to answer the user's question structurally. Net effect: the "rotate every time" concern goes away permanently (guard catches any accidental prod dial from test env regardless of what's in CI secrets).
- **I — guard scope: `NODE_ENV === 'test'` only**: considered blocking dev + test + anything-not-production, but that would regress the current dev workflow (user's `.env.local` points at prod for QA walks per qa-options.md § Current state). Scoping to test env preserves dev ergonomics while closing the actual risk (fast-job unit tests silently dialing prod). Production runtime skips the guard on purpose (must talk to prod). Development skips on purpose (QA-walk pattern relies on it).
- **I — hard-coded project ref `nzfdfjctpotjyuxdfcpw`** in `packages/core/src/supabase.ts`: not a secret (URL + anon key are public); used as a safety landmark. If a staging Supabase project is ever added, the allow-list-in-test approach can replace the block-prod-ref approach; today single-project v0 doesn't warrant the abstraction.
