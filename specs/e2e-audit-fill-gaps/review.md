# Pre-ship review: e2e-audit-fill-gaps (PR 5)

**Run date:** 2026-04-26
**Branch:** feature/e2e-audit-fill-gaps
**Commits at start:** 10 ahead of main (3 spec + 7 implementation)
**Commits at end:** 13 ahead of main (10 + 3 fix commits from pre-ship)

## Gate results

| #   | Gate               | Result             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Docs check         | pass               | `CLAUDE.md § Testing` "E2E-per-surface invariant" paragraph well-formed, references three of the new specs as patterns (auth-edge-cases, force-create-race, realtime). `TODOS.md` cleanly closes the `e2e-audit-fill-gaps` pre-ship entry and adds 3 carry-forward entries (`email-not-confirmed-bounce-e2e`, `auth-rate-limit-e2e`, `password-reset-e2e`), each with What / Why / How / Depends on / Cross-ref shape consistent with template. |
| 2   | Metrics check      | pass               | No `posthog.capture(...)` calls in any new spec. No `METRICS.md` modification. Spec D9 explicitly states no new METRICS events; verified.                                                                                                                                                                                                                                                                                                       |
| 3   | Responsive + theme | n/a                | Testing-infrastructure PR. No new UI surfaces. The 4-combo evidence matrix (mobile/desktop × light/dark) has nothing new to capture. The 9 active tests run automatically at both `mobile` + `desktop` viewport projects per existing `playwright.config.ts` glob.                                                                                                                                                                              |
| 4   | `/simplify`        | findings (1) fixed | `adminClient()` factory + local-stack `test.skip()` predicate duplicated across 6 specs (5 new + `add-new.spec.ts`). Spec § Gotchas anticipated this with a 5-spec threshold; threshold met. Extracted `apps/web/e2e/helpers/admin-client.ts` exposing `adminClient()` + `isLocalSupabase()` + `localSupabaseSkipReason()`. Refactored the 5 new specs (per spec § Out of scope, did not touch `add-new.spec.ts`). 75 net lines removed.        |
| 5   | `/ak-test-review`  | pass               | All 9 active tests have strong UI + DB-level cross-check assertions (admin-client confirms what the UI claims). 3 skipped tests use explicit `test.skip(true, '<reason>')` form per spec D3 — grep-able and visible in `playwright --list`. No weak assertions, no untested auth boundaries, no race conditions in the concurrent specs. Selectors use `getByRole`/`getByLabel` (resilient to copy churn) rather than CSS classes.              |
| 6   | `/review`          | findings (1) fixed | `PLAN.md § Files to modify` listed `Flip row #1 from Planned → Active (mirror ci-slow-job precedent)`; the implementer skipped this. Applied the flip per the convention header on PLAN.md ("A Planned row transitions to Active when /ak-spec runs: drop #, add Branch + Spec columns") and renumbered remaining Planned rows. No SQL changes, no LLM trust-boundary changes, no conditional side effects, no app code touched.                |
| 7   | `/cso`             | findings (1) fixed | Service-role JWT flow analysed: env var reads centralized in helper, never logged or committed. The local-stack `test.skip()` predicate was the only barrier between admin credentials + a hosted URL. Added defense-in-depth refusal inside `adminClient()` itself: throws if `!isLocalSupabase()`. Pairs with the existing `assertNotProdUrlInTestEnv` guard in `packages/core/src/supabase.ts` — same intent, different scope.               |
| 8   | `/design-review`   | n/a                | Testing-infrastructure PR; no new UI to inspect. Daemon-driven design-review would have nothing app-side to look at even if the gstack browse daemon were running.                                                                                                                                                                                                                                                                              |
| 9   | `/qa`              | blocked            | gstack browse daemon has a known bun-polyfill runtime error (devshop v0 entry "Browse binary + Playwright browser availability in project devcontainers"). Preflight fix recipe: see /devshop/kit/ROADMAP.md § v0 § Browse binary + Playwright browser availability in project devcontainers. (Note: even with the daemon working, this PR has no new feature to QA-test — it's pure testing infrastructure.)                                   |
| 10  | `/benchmark`       | n/a                | No new pages added, no bundle-size delta. Diff is `apps/web/e2e/**` + docs only. No app code in the front-end build path.                                                                                                                                                                                                                                                                                                                       |
| 11  | Convention check   | pass               | `*.spec.ts` naming ✓; helpers/admin-client.ts ✓; per-task atomic commits with Conventional Commits prefixes (`test(e2e):`, `docs(claude):`, `chore(todos):`, `refactor(e2e):`, `chore(plan):`, `fix(e2e):`); `process.env` reads only inside the e2e-only helper; the 3 skipped tests use predicate form `test.skip(true, '<reason>')` (no `.skip()` without predicate); all commits pass gitleaks + typecheck + lint hooks.                    |

## Findings + fixes

- **Finding (Gate 4 / `/simplify`)** — `adminClient()` factory duplicated 6× (16-line block per spec). Spec § Gotchas anticipated this. Fixed by extracting `apps/web/e2e/helpers/admin-client.ts` and refactoring the 5 PR-5 specs to import from it. `add-new.spec.ts` left untouched per spec § Out of scope. Commit `1c3e9c4 refactor(e2e): extract helpers/admin-client.ts (5 specs share boilerplate)`.

- **Finding (Gate 6 / `/review`)** — `PLAN.md` row not flipped from Planned → Active despite spec § Files to modify listing this as a deliverable. Fixed by adding the Active table row with Branch + Spec columns and renumbering remaining Planned rows. Commit `504cce4 chore(plan): flip e2e-audit-fill-gaps Planned → Active`.

- **Finding (Gate 7 / `/cso`)** — `adminClient()` had only the predicate (`test.skip(!isLocalSupabase())`) gating service-role JWT use against hosted Supabase. If a future spec author copy-pasted the boilerplate without the predicate, the factory would happily dial hosted with admin credentials. Fixed by adding a refusal inside the factory: throws if `!isLocalSupabase()`. Pairs with `assertNotProdUrlInTestEnv` in `packages/core/src/supabase.ts`. Commit `cf58e60 fix(e2e): admin-client refuses non-local-stack URLs (defense-in-depth)`.

## Blocked gates

- **Gate 9 (`/qa`)** — gstack `browse` daemon (used by `/qa`, `/qa-only`, `/design-review`, `/benchmark`, `/canary`) has a known bun-polyfill runtime error preventing it from launching in this devcontainer. Preflight fix recipe: see `/devshop/kit/ROADMAP.md § v0 § Browse binary + Playwright browser availability in project devcontainers`. (Practical note: this PR has no new feature for `/qa` to test even if the daemon were working — it's pure testing infrastructure. The `blocked` mark is correct per the gate-vocabulary distinction: tooling-broken ≠ nothing-to-look-at.)

## Test-checkpoint history

| Timestamp (UTC) | Trigger                                | Result         |
| --------------- | -------------------------------------- | -------------- |
| 04:16 baseline  | Pre-ship start                         | 152/152 passed |
| 04:21           | After Gate 4 refactor (helper extract) | 152/152 passed |
| 04:24           | After Gate 6 fix (PLAN flip)           | 152/152 passed |
| 04:29           | After Gate 7 fix (admin-client guard)  | 152/152 passed |
| 04:34 final     | Post-fix sweep                         | 152/152 passed |

`pnpm exec playwright test --list` was re-run after each refactor and consistently parsed all 44 tests across 14 spec files (the new 5 + the existing 9, mapped to 2 viewport projects + 1 qa-walk project).

## Diff scope (acceptance criterion verification)

```
 CLAUDE.md                              |  11 +
 PLAN.md                                |  11 +-
 TODOS.md                               |  99 ++++--
 apps/web/e2e/auth-edge-cases.spec.ts   | 211 ++++++++++++
 apps/web/e2e/force-create-race.spec.ts | 174 ++++++++++
 apps/web/e2e/helpers/admin-client.ts   |  72 +++++
 apps/web/e2e/item-detail.spec.ts       | 176 ++++++++++
 apps/web/e2e/realtime.spec.ts          | 203 ++++++++++++
 apps/web/e2e/settings.spec.ts          |  94 ++++++
 specs/e2e-audit-fill-gaps/spec.md      | 575 +++++++++++++++++++++++++++++++++
 specs/e2e-audit-fill-gaps/tasks.md     |  23 ++
 11 files changed, 1615 insertions(+), 34 deletions(-)
```

Spec § Acceptance criteria § "git diff --stat main..HEAD showing only `apps/web/e2e/**`, `CLAUDE.md`, `TODOS.md`, `PLAN.md`, `specs/e2e-audit-fill-gaps/**` paths" — verified ✓ (no schema, migration, edge function, seed, or METRICS.md change).

## Summary

- 11 gates run.
- **passed**: 5 (Docs, Metrics, `/ak-test-review`, Convention check) + 1 (`/simplify` post-fix) + 1 (`/review` post-fix) + 1 (`/cso` post-fix) = 7 gates pass on final state.
  - Counted as passed: 7 (Gates 1, 2, 4, 5, 6, 7, 11).
- **n/a**: 3 (Responsive+theme, `/design-review`, `/benchmark` — no new UI / pages / bundle changes for these to inspect).
- **blocked**: 1 (`/qa` — gstack browse daemon broken).
- **findings_pending**: 0 (3 findings surfaced + fixed in pre-ship).

PR is ready for ship.
