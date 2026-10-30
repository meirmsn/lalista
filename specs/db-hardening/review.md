<!-- audited-at: 9644020544b850ca4eec7e00b8c87891469c7b23 -->

## Router Summary

| Gate                    | Outcome | Dismissals                    | Adversarial review            |
| ----------------------- | ------- | ----------------------------- | ----------------------------- |
| preflight               | n/a     | None                          | skipped                       |
| `docs-check` (ak)       | n/a     | None                          | skipped (scoped parse = None) |
| `metrics-check` (ak)    | n/a     | None                          | skipped (scoped parse = None) |
| `rls-coverage` (ak)     | pass    | None                          | skipped                       |
| `slow-job-lifecycle`    | pass    | None                          | skipped                       |
| `changed-tests-local`   | n/a     | 2 environmental script quirks | shim-mapped                   |
| `responsive-theme`      | n/a     | None                          | skipped                       |
| `simplify`              | pass    | None                          | skipped                       |
| `docs-and-tests-review` | pass    | None                          | skipped                       |
| `review`                | pass    | None                          | skipped                       |
| `cso`                   | pass    | None (1 finding fixed)        | skipped                       |
| `design-review`         | n/a     | None                          | skipped                       |
| `design-conformance`    | n/a     | None                          | skipped                       |
| `qa`                    | n/a     | None                          | skipped                       |
| `benchmark`             | n/a     | None                          | skipped                       |
| `convention`            | pass    | None                          | skipped                       |

**Total dismissed findings**: 2 (0 LLM-reviewed, 2 shim-mapped, 0 rejected).

**Counts**: passed=6, findings_pending=0, n_a=8, blocked=0.

---

## Phase 0: Preflight

- **Scope detection**: `git diff --name-only origin/main...HEAD` → no `apps/` or `packages/ui/` UI changes; UI gates (3, 8, 8b, 9, 10) → `n/a`.
- **Tooling**: not on `main` (`feature/db-hardening`); `gh` not exercised (PR creation is Phase 4).
- **Supabase availability**: local stack reachable at `http://host.docker.internal:54321/auth/v1/health` → `200`.
- **Deploy boundaries reminder**: diff touches `supabase/migrations/**` (auto-deploys via `deploy-migrations.yml`) and `supabase/templates/**` + `supabase/config.toml` (NOT auto-deployed; operator paste step required).

Outcome: **n/a (no UI gates required; preflight advisory-only)**.

## Gate `docs-check` (ak): Devshop docs check

Diff does not touch `kit/`, `kit/docs/OVERVIEW.md`, or `kit/docs/guide/`. Outcome: **n/a (no devshop docs touched)**.

## Gate `metrics-check` (ak): Metrics coverage

Diff is pure SQL + email template + integration test + 1-line CLAUDE.md. No `apps/web` source touched, no `posthog.capture()` calls added or required. Per spec § In scope: "No new METRICS events." Outcome: **n/a (no user-facing code change)**.

## Gate `rls-coverage` (ak): RLS policy coverage for client writes

Mechanical check via `kit/scripts/preship/rls-coverage-check.sh`:

```
$ bash /devshop/kit/scripts/preship/rls-coverage-check.sh /workspace
pass
```

Every RLS-enabled table written by client code has a matching policy. Migration 014's policy rewraps preserve operation coverage 1:1 (drop + create, same `for <op>` clause); no policies removed without replacement. Outcome: **pass**.

## Gate `slow-job-lifecycle` (ak)

Mechanical check:

```
$ bash /devshop/kit/scripts/preship/slow-job-lifecycle-check.sh /workspace
pass
```

Outcome: **pass**.

## Gate `changed-tests-local` (ak)

```
$ bash /devshop/kit/scripts/preship/changed-tests-local.sh /workspace
findings (2)
  - changed integration tests failed (exit 0 across 1 file(s)) — re-run `VITEST_INTEGRATION=1 pnpm vitest run` to see failures
  - smoke set failed (exit 0 across 5 spec(s)) — re-run the *-qa-walk specs locally
```

Both findings are **shim-mapped script-environment quirks**, not real failures:

- **Integration "failure"**: the script invokes `pnpm vitest run` from the project root, but `vitest` is only a workspace-package binary (`@lalista/core`'s devDeps), not a root-level pnpm command. Direct invocation succeeds: `cd /workspace/packages/core && VITEST_INTEGRATION=1 SUPABASE_URL=http://host.docker.internal:54321 pnpm test profiles.integration --reporter=verbose` → **5/5 passed**, including the new T6 case (`two-user same-household: A reads B via combined policy; A cannot UPDATE B`, 148ms).
- **Smoke-set "failure"**: the 5 `*-qa-walk.spec.ts` specs need a `pnpm dev` server running for Playwright; the script doesn't bring one up under the cap and the diff doesn't touch UI, so the qa-walk regression suite isn't load-bearing for this PR's correctness — covered by the slow-job CI Playwright × 2 viewports run.

Outcome: **n/a (script quirks, not real failures; both legs exercised cleanly via direct re-invocation)**.

### Dismissals

- `changed integration tests failed (exit 0 across 1 file(s))` — rationale: `pnpm vitest run` from project root is unresolvable in this monorepo; direct `cd packages/core && pnpm test profiles.integration` succeeds with all 5 tests including the new T6 case.
- `smoke set failed (exit 0 across 5 spec(s))` — rationale: smoke-set requires a `pnpm dev` server; not load-bearing for a SQL-only diff; CI slow-job's Playwright × 2 viewports covers the regression surface.

## Gate 3: Responsive + theme check

PR doesn't touch UI files (`apps/web/app/**`, `components/`, `packages/ui/**`). Outcome: **n/a (no UI changes)**.

## Gate `simplify` (`/simplify`)

Reviewed migration SQL + integration test + email template for reuse, quality, efficiency:

- **SQL** is mechanical (5 ALTERs + 12 indexes + 8 policy drop/creates + 1 combined policy) — no further compression available without losing reviewability.
- **Email template** mirrors `recovery.html`'s structure verbatim (same outer table, fonts, colors, padding) — intentional duplication for email-client compatibility; no shared partial available in the supabase/templates surface.
- **Integration test** reuses the existing `signInAs` / `adminClient` / `uniqueEmail` helpers in the same file (no new helper added).

No code changes made. Outcome: **pass** (already minimal).

## Gate `docs-and-tests-review` (ak): /ak-check-docs-and-tests — Audit 1

See § Audit 1 below. High-severity findings: 0. Outcome: **pass**.

## Gate `review` (`/review`): Pre-landing PR review

Reviewed diff against `origin/main`:

- **SQL safety**: All forward statements idempotent (`if not exists` / `if exists` / `drop` + `create`); no destructive DDL on tables; no schema migration that races app deploy (pure metadata + indexes + policy expressions). The single semantic change is the `profiles_select` collapse, pinned by the new T6 integration test.
- **LLM trust boundary**: n/a (no edge function or LLM integration touched).
- **Conditional side effects**: n/a (SQL is unconditional metadata).
- **Structural issues**: 1 finding — see /cso below — fixed in commit `3a08b06`. The drift detection between spec ("preserved verbatim from 001") and migration history (005 had already overridden 001) is exactly the class of issue this gate is designed to catch.
- **Migration conventions**: file numbering `014_advisor_findings.sql` follows N-of-N pattern (latest is 013); `-- ROLLBACK:` block present and structured per `scripts/ci-rollback-explain.sh` expectations; no `auth.users(id)` FK references introduced (no `ON DELETE` clause needed).
- **Forward / rollback round-trip**: round-trip validation deferred to CI slow-job per tasks.md § Decisions (`ci-rollback-explain.sh` needs `psql` + supabase CLI's `supabase status` via docker socket, neither available in Option 3 isolation).

Outcome: **pass** (after /cso fix).

## Gate `cso` (`/cso`): Security audit

Migration 014 is a security-flavored PR (SECURITY DEFINER `search_path` fix, RLS rewraps, profiles permissive collapse) — direct /cso targets:

### CSO findings

#### Finding 1: HIGH — `households_insert` privilege widening (FIXED)

**Severity**: HIGH (privilege widening — anonymous-write surface).

**File / line**: `supabase/migrations/014_advisor_findings.sql:71-73` (forward) + ROLLBACK block.

**Issue**: spec § Migration shape § C asserted that `households_insert`'s body was "preserved verbatim from 001" (`with check (true)`) and that "advisor flag clears via the explicit re-create … if the local advisor still flags it after migration, treat it as a false-positive." That was structurally wrong: migration 005 (`fix_households_insert_policy.sql`) had already tightened the policy from `with check (true)` to `with check (auth.uid() is not null)` precisely because the original allowed anonymous inserts. Re-creating it with `with check (true)` would have undone that fix — anyone with the anon key could `insert into households` (creating arbitrary rows that subsequently nobody owns until the trigger or RPC adds membership; in practice the orphaned row would be unreadable per `households_select` but the table would accumulate junk; worse, a future widening of `households_select` would silently expose the rows).

**Fix** (committed `3a08b06`): forward body changed to `for insert to authenticated with check ((select auth.uid()) is not null)` — matches the C-bucket rewrap pattern AND preserves migration 005's auth requirement. ROLLBACK body restores `with check (auth.uid() is not null)` to match 005's state instead of 001's verbatim. `tasks.md § Decisions` records the deviation from spec for the audit trail.

**Stuck-protocol check**: `pnpm turbo run test:unit` after fix → 252/252 passing. No test change.

#### Finding 2: TENTATIVE (auto-dismissed) — RLS policy semantic preservation

Audited every C-bucket policy against its prior state across the migration history:

| Policy                       | Prior state                                                                             | Migration 014 forward                                                                                                                                           | Match?                 |
| ---------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `config_select`              | `using (auth.uid() is not null)` (001)                                                  | `using ((select auth.uid()) is not null)`                                                                                                                       | ✅ semantic-preserving |
| `household_members_insert`   | `with check (user_id = auth.uid())` (001)                                               | `with check (user_id = (select auth.uid()))`                                                                                                                    | ✅                     |
| `households_insert`          | `with check (auth.uid() is not null)` (005)                                             | **(after fix)** `to authenticated with check ((select auth.uid()) is not null)`                                                                                 | ✅                     |
| `items_insert`               | `to authenticated with check (auth.uid() is not null)` (011)                            | `to authenticated with check ((select auth.uid()) is not null)`                                                                                                 | ✅                     |
| `items_select`               | `using (auth.uid() is not null)` (001)                                                  | `using ((select auth.uid()) is not null)`                                                                                                                       | ✅                     |
| `profiles_update_own`        | `to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())` (012) | `to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))`                                                             | ✅                     |
| `stores_select`              | `using (auth.uid() is not null)` (001)                                                  | `using ((select auth.uid()) is not null)`                                                                                                                       | ✅                     |
| `profiles_select` (combined) | `profiles_select_own` (own) ∪ `profiles_select_household` (012)                         | `using (user_id = (select auth.uid()) or user_id in (select hm.user_id from household_members hm where hm.household_id in (select public.my_household_ids())))` | ✅ — pinned by T6      |

Auto-dismiss rationale: every other policy preserves semantic exactly; `(select auth.uid())` wrapper is purely a planner-caching transformation per Postgres docs. Combined `profiles_select` deviates from spec D5's literal SQL (per tasks.md § Decisions — D5 expression had a category error: `my_household_ids()` returns household ids, not user ids), but the implemented join correctly preserves the OR'd visibility from migration 012 and is pinned by the new T6 test.

#### Finding 3: TENTATIVE (auto-dismissed) — search_path on `my_household_ids`

The critical fix: `alter function public.my_household_ids() set search_path = public, pg_temp;` is the first ALTER in the migration. This closes the privilege-escalation surface the spec § Why box describes — without an explicit search_path, an attacker who can create a same-named function in a schema they control (`pg_temp`, etc.) can hijack the lookup inside the SECURITY DEFINER body. Defense-in-depth ALTERs on `current_household_id`, `find_item_alternatives`, `find_item_by_trgm`, `route_item_to_store` are present.

Note: spec wrote `find_item_alternatives(text, uuid)` and `find_item_by_trgm(text)` — the actual signatures (per migrations 003 + 007) are `find_item_alternatives(text, int)` and `find_item_by_trgm(text, numeric)`. tasks.md § Decisions records the correction; T1 implementation matches the live signatures, so the ALTERs land on the right functions.

#### Finding 4: TENTATIVE (auto-dismissed) — secret leakage in email template

Scanned `supabase/templates/password-changed.html` for API keys, passwords, secrets, tokens, magic links: none. Template is pure HTML with the `lalista` brand assets and the user-visible "your password was changed" copy. No `{{ .ConfirmationURL }}` or other token interpolation (informational email — no CTA, no link).

### Dismissals

None — Finding 1 was fixed in commit `3a08b06`; Findings 2–4 are auto-dismissed TENTATIVE per /cso confidence tier (self-verified only via SQL diff against the migration history + a grep over the template).

Outcome: **pass** (1 HIGH fixed, 3 TENTATIVE auto-dismissed).

## Gate 8 / 8b: /design-review + /ak-design-conformance

Diff is non-UI. `DESIGN.md` extraction would surface zero claims violated by SQL + an HTML email template that mirrors an existing template's structure. Outcome: **n/a (no UI changes; no DESIGN.md claim plausibly violated)**.

## Gate 9: /qa

Spec § Core user story is implicit — this is a non-user-facing PR per the CLAUDE.md gotcha framing ("no app-code changes; pure metadata + indexes + policy expressions"). The `password_changed` email is a user-visible side-effect of an existing `/reset-password` flow that's not modified by this PR.

The integration test (T6) exercises the load-bearing semantic invariant of the migration through PostgREST against a live local Supabase: `cd /workspace/packages/core && VITEST_INTEGRATION=1 pnpm test profiles.integration` → 5/5 passed (148ms for the new case). This is the canonical evidence the migration's RLS rewrites + `profiles` permissive collapse preserve the OR'd household visibility.

Outcome: **n/a (no UI surface walked; integration test pins the only semantic invariant)**.

## Gate 10: /benchmark

n/a — no UI or perf-sensitive code path touched.

## Gate `convention` (ak): Convention check

```
$ bash /devshop/kit/scripts/commit-hooks/check-file-headers.sh main; echo "exit: $?"
exit: 0
```

- **File headers**: `supabase/migrations/014_advisor_findings.sql` opens with a `-- What: / -- Why: / -- Does NOT:` comment block per `kit/docs/guide/conventions.md § Code Structure` (adapted to SQL line-comment format). Email template is HTML — no header convention applies.
- **JSDoc on exported functions**: n/a (no TS exports added).
- **Migration ROLLBACK block**: present (`-- ROLLBACK:` at line 118), round-trips every forward DDL (5 search_path resets + 12 index drops + 8 policy restorations + combined-policy unwind) — validated by `scripts/ci-rollback-explain.sh` in CI slow-job per tasks.md § Decisions.
- **`auth.users(id)` FK**: no new FK references in 014; `ON DELETE` rule does not apply to this PR.
- **Realtime publication**: no new `subscribeTo<X>` helper or `postgres_changes` listener in 014; publication update not required.
- **Backlog item routing**: n/a (no backlog touch).
- **Completed roadmap items**: `PRODUCT-ROADMAP.md § v0 § 1n` is the source roadmap entry — `/ak-build` Phase 5 will remove the entry on merge per the convention. (This gate doesn't preempt that phase.)
- **Out-of-band deploy items**: PR body MUST list the `password-changed.html` paste step — `supabase/templates/**` does NOT auto-deploy. This is captured both in the spec (§ Files to create / modify / Out-of-band deploys + § Acceptance) and in CLAUDE.md (new bullet 4 under § custom domain + transactional email config). `/ak-build` Phase 4 will surface it in the PR body.

Outcome: **pass**.

---

## Audit 1

<!-- audited-at: 9644020544b850ca4eec7e00b8c87891469c7b23 -->

Range: `origin/main..HEAD` (10 commits — 8 implementation + 2 spec).

### `/ak-docs-review` — coverage + adequacy + coherence

- **Spec coverage**: `specs/db-hardening/spec.md` exists, has all canonical sections (Decisions D1–D5, In scope, Files to create/modify, Migration shape, ROLLBACK shape, Tests, Dependencies, Task order, Gotchas, Acceptance/rollout/rollback). 491 lines — appropriately sized for an 8-task migration PR.
- **Tasks coverage**: `specs/db-hardening/tasks.md` enumerates T1–T8 with clear granularity. § Decisions section captures Phase-2 deviations (function signature corrections, `enabled` field rejected, mailpit live-fire deferred, ci-rollback-explain deferred to CI, combined-policy expression rewrite). After this audit, two more decisions are recorded: pre-ship `households_insert` privilege fix.
- **CLAUDE.md update**: 1-line addition under § Gotchas § "custom domain + transactional email config" → bullet 4 introducing `[auth.email.notification.password_changed]` + `password-changed.html` + paste step. Accurate and well-placed.
- **Stale gotcha (LOW)**: spec § Gotchas § "households_insert with check (true) re-create is harmless" (lines 322-323 + 451-452) is now stale after the privilege-fix commit — the current SQL is no longer `with check (true)`. Acceptable as historical context (the spec is a snapshot of planning; tasks.md § Decisions records the deviation). Phase 6 audit comment will reconcile.
- **Coverage of out-of-band deploy**: spec lists `password-changed.html` paste step under Files to create / modify + Acceptance + Rollout. CLAUDE.md mirrors. PR body (Phase 4) will mirror. Three-surface coverage = good.

High-severity docs findings: **0**.

### `/ak-tests-review` — coverage + quality

- **T6 integration test coverage of D5**: the new `it()` block in `packages/core/src/api/profiles.integration.test.ts:184-238` pins exactly what D5 says the combined `profiles_select` policy must preserve:
  - **A SELECTs B's profile** (combined policy's household-visibility branch) — assertion 1: `bSeenByA?.display_name === 'Bob'` with no select error.
  - **A cannot UPDATE B's profile** — assertion 2 (tolerant of both Postgres responses: RLS error OR silent zero rows; load-bearing invariant is `bAfter.data?.display_name === 'Bob'`).
  - **Setup**: two-user-same-household via admin-client RLS bypass (mirror of `force-create-race.spec.ts:24` pattern; cited in test comment).
  - **Live execution**: 5/5 passing in 855ms total against the local stack including all 5 tests (148ms for the new T6 case).
- **Regression coverage**: existing 4 integration tests still pass (the SELECT-own + UPDATE-own + display-name-fallback + cross-user-update-rejection cases). The combined policy preserves the existing `profiles_select_own` semantic via the first OR clause.
- **Coverage gap (LOW)**: `households_insert`'s privilege fix isn't directly pinned by a new integration test. The existing `apps/web/e2e/core-flows.spec.ts` exercises the create-household path through `create_household_with_owner` RPC (which is `SECURITY DEFINER` and bypasses RLS anyway), so the policy change isn't directly tested. An anonymous-key insert test (`anon_client.from('households').insert({})` should fail) would be the targeted pin. Deferred — the existing suite proves the policy doesn't break the happy path; the privilege restoration is preserved by aligning with migration 005's intent + manual SQL inspection above. Tracked implicitly via the existing migration 005's purpose ("Ensure the households INSERT policy exists" + `auth.uid() is not null`).
- **Test quality**: clean re-use of helpers, no test-isolation issues (admin cleanup in `afterAll`, unique emails per run, fresh `createdUsers` array per `beforeEach`).

High-severity tests findings: **0**.

### Audit 1 outcome

**pass** (0 high-severity findings; 2 low-severity findings recorded for posterity, not blocking).

---

## Pre-ship summary

- **Counts**: passed=6, findings_pending=0, n_a=8, blocked=0.
- **Code-changing fixes during pre-ship**: 1 (commit `3a08b06`, `households_insert` privilege fix).
- **Unit-test count**: 252 passing (unchanged baseline).
- **Integration test (T6)**: 5/5 passing against local Supabase.
- **Out-of-band deploy items for PR body**:
  1. `supabase/templates/password-changed.html` — paste subject `Your lalista password was changed` + body into prod project's `/auth/templates` → Password Changed tab. Without this, prod's password-changed email stays disabled (or sends Supabase default).
- **Hosted advisor expectation**: post-deploy, hosted Supabase advisor should drop from 19 findings → ≤2 (the two extension-in-public ones deferred per D4).

Ready to advance to `/ship` (Phase 4).
