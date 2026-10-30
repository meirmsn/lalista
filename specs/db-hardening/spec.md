<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: db-hardening -->
<!-- date: 2026-05-08 -->

# Spec: db-hardening (PR 58)

**Sources:**

- `PRODUCT-ROADMAP.md § v0 § 1n` — primary scope (Database hardening pass — Supabase Advisor follow-up)
- `PLAN.md § Planned § 2 db-hardening` — scope summary
- Local Supabase Advisor audit run from chapter 1l's dev session (2026-05-04) — full triage of 19 findings
- Prior spec `specs/app-snappiness/spec.md` — style + structure reference

Single migration `014_advisor_findings.sql` resolving the 19 Supabase Advisor findings audited 2026-05-04. Critical: `my_household_ids` SECURITY DEFINER gets `search_path = public, pg_temp` (privilege-escalation surface). Plus defense-in-depth `search_path` on four sibling functions, 12 missing FK indexes, 8 RLS policies rewrapped in `(select auth.uid())`, and `profiles` collapsed from two permissive SELECT policies into one. Bonus: enable the `password_changed` security notification email (closes the chapter-1l gap where `/reset-password` lands the user on `/list` with no confirmation).

---

## Decisions (resolved at spec time)

5 `/ak-spec`-time decisions resolved in Phase 0 with the user. Recorded below
so Phase 1 preserves them verbatim and a crashed Phase 1 resumes without
re-asking.

### D1: `create index` with vs without `concurrently`

**Decision:** Without `concurrently`. The single migration runs inside Postgres' migration transaction; `CREATE INDEX CONCURRENTLY` is incompatible with running inside a transaction block (Postgres-level constraint, well-known).

**Rationale:** At v0 scale (tens of rows on `list_entries`, the largest table) the SHARE lock builds in milliseconds — invisible to users. Wrapping in a `commit; create index concurrently …; begin;` shape is brittle on hosted Supabase and gains nothing at our row counts. Flip to concurrent only if a future audit shows write contention. Roadmap recommendation.

### D2: Single PR vs split security-only / performance-only

**Decision:** Single PR — `feature/db-hardening` ships `014_advisor_findings.sql` with all changes plus the integration test plus the `password_changed` email plumbing.

**Rationale:** Findings are tightly coupled (same migration touches the same tables and same SQL session); one focused review is faster than two; the ROLLBACK block round-trips as one unit; the integration test pins the combined behavior. Roadmap recommendation.

### D3: Include the bonus `password_changed` security notification email (scope item 7)

**Decision:** Yes — include in this PR. Uncomment `[auth.email.template.password_changed]` in `supabase/config.toml`, add `supabase/templates/password-changed.html` (terracotta-on-cream branded HTML matching chapter 1l), call out the prod-dashboard paste step in the PR body (out-of-band deploy item — `supabase/templates/**` does NOT auto-deploy; operator must paste subject + body into prod project's `/auth/templates` UI after merge).

**Rationale:** Roadmap lists it under **Scope** (item 7), not under non-scope. Closes the chapter-1l gap where `/reset-password` lands the user on `/list` with no security-confirmation email. Standard practice (Apple, GitHub, Stripe). Adding the template now while we're already touching auth-template plumbing keeps the round-trip cost low.

Symmetric `email_change_security` notification deferred until a Settings → "change email" UI exists (no current flow that produces it).

### D4: Move `pg_trgm` + `fuzzystrmatch` to `extensions` schema (scope item 6)

**Decision:** No — defer. The two extensions stay in `public`.

**Rationale:** Roadmap explicitly says skip; cosmetic advisor finding, not a real security risk (extensions in `public` were the Postgres default forever). Worth a coordinated migration only if we add a third extension and want to do them all together. Stays as a v+ candidate; not tracked in PRODUCT-ROADMAP for now.

### D5: Combined `profiles_select` policy semantics

**Decision:** `user_id = (select auth.uid()) or user_id = any (public.my_household_ids())` — preserves the existing OR'd visibility (own row + same-household profiles) in one policy instead of two.

**Rationale:** Mechanical merge of `profiles_select_own` + `profiles_select_household` into one rule. Permissive policies in Postgres OR-evaluate, so two policies cost twice the per-row evaluation; one combined policy halves the cost while preserving exact visibility. The integration test in `packages/core/src/api/profiles.integration.test.ts` pins this semantic — two seeded users in the same household: A SELECTs B's profile via `fetchHouseholdProfiles`, A cannot UPDATE B's profile.

The `(select auth.uid())` wrapper inside the combined policy is the same RLS-caching pattern applied to all 8 policies (decision is consistent across the migration).

---

<!-- /ak-spec (Phase 1) expands the file from here: In scope, Files to
     create/modify, Migration shape, Tests, Dependencies, Task order,
     Gotchas, Acceptance / rollout / rollback. The Decisions section
     above stays verbatim. -->

## In scope

The migration resolves 19 of the 19 advisor findings (the original 17 from
the 2026-05-04 audit plus 2 the audit missed, surfaced by a 2026-05-08
re-probe at PR-58 dogfood time — see bucket E below). The two
extension-in-public ones remain deferred per D4 (cosmetic, not real
findings). Plus the bonus `password_changed` notification email per D3.
Eight buckets:

1. **Critical — fix `my_household_ids` SECURITY DEFINER `search_path`** (advisor finding 1, roadmap §1n scope item 1). The other three SECURITY DEFINER functions (`create_household_with_owner`, `handle_new_user`, `mark_item_bought`) all have `set search_path = …` since migrations 008 / 010 / 012; `my_household_ids` is the migration-008-era outlier. This is the privilege-escalation surface — without an explicit search_path, an attacker who can create a same-named function in a schema they control (`pg_temp`, etc.) can hijack the lookup.
2. **Defense-in-depth `search_path` on 4 user-owned non-DEFINER functions** (advisor findings 2-5, roadmap §1n scope item 2):
   - `current_household_id`
   - `find_item_alternatives`
   - `find_item_by_trgm`
   - `route_item_to_store`
     Lower stakes than (1) but the advisor flag goes away and consistency is worth the four-line addition.
3. **12 missing FK indexes** (advisor findings 6-17, roadmap §1n scope item 3) — joins and cascading deletes scan instead of seek; fine at v0 scale, painful at thousands of users:
   - `idx_brand_preferences_item_id` on `brand_preferences (item_id)`
   - `idx_brand_preferences_store_id` on `brand_preferences (store_id)`
   - `idx_disambiguation_log_candidate_item_id` on `disambiguation_log (candidate_item_id)`
   - `idx_disambiguation_log_chosen_item_id` on `disambiguation_log (chosen_item_id)`
   - `idx_disambiguation_log_store_id` on `disambiguation_log (store_id)`
   - `idx_household_members_user_id` on `household_members (user_id)`
   - `idx_list_entries_added_by` on `list_entries (added_by)`
   - `idx_list_entries_item_id` on `list_entries (item_id)`
   - `idx_list_entries_store_id` on `list_entries (store_id)`
   - `idx_purchase_history_added_by` on `purchase_history (added_by)`
   - `idx_purchase_history_item_id` on `purchase_history (item_id)`
   - `idx_purchase_history_store_id` on `purchase_history (store_id)`
     Per D1, indexes are created without `CONCURRENTLY` so they can run inside the migration transaction.
4. **8 RLS policies rewrapped in `(select auth.uid())`** (roadmap §1n scope item 4) — Postgres caches the per-statement result instead of calling the function for every row. Affected policies (each gets `drop` + `create` since `alter policy` doesn't accept a new expression):
   - `config.config_select` — `using` clause
   - `household_members.household_members_insert` — `with check`
   - `households.households_insert` — `with check` (currently `with check (true)`; rewrap is a no-op semantically but the advisor flag goes away — see Gotchas for why we still touch it)
   - `items.items_insert` — `with check`
   - `items.items_select` — `using`
   - `profiles.profiles_update_own` — `using` + `with check`
   - `stores.stores_select` — `using`
   - `profiles.profiles_select_own` — collapsed into combined policy in bucket (5), so the rewrap happens implicitly when the new policy is created.
5. **`profiles` permissive collapse** (roadmap §1n scope item 5, D5) — drop the two SELECT permissive policies (`profiles_select_household` + `profiles_select_own`) and replace with a single combined `profiles_select`:
   ```sql
   user_id = (select auth.uid())
   or user_id = any (public.my_household_ids())
   ```
   Postgres OR-evaluates permissive policies; one combined policy halves the per-row cost while preserving exact visibility (your own row + any profile in any of your households).
6. **Bonus — `password_changed` notification email** (D3, roadmap §1n scope item 7). Three pieces:
   - Uncomment + populate `[auth.email.notification.password_changed]` in `supabase/config.toml`.
   - New `supabase/templates/password-changed.html` matching the chapter-1l terracotta-on-cream design system (mirror of `recovery.html`'s structure, no CTA — informational).
   - PR body includes the prod-dashboard paste step (`supabase/templates/**` does NOT auto-deploy; operator must paste subject + body into prod project's `/auth/templates` UI after merge — same out-of-band shape as the chapter-1l email templates).
7. **Integration test** pinning the combined `profiles_select` semantic (roadmap §1n Tests subsection). Two-user-same-household: A SELECTs B's profile via `fetchHouseholdProfiles` succeeds; A's UPDATE on B's profile FAILS (RLS-denied). Extends the existing `packages/core/src/api/profiles.integration.test.ts` (4 cases today) rather than creating a new file.
8. **Bucket E — 2 RLS policies the original audit missed** (added 2026-05-08 during PR-58 dogfood after running the local advisor against the post-migration DB). Same mechanical `(select auth.uid())` rewrap as bucket C; bodies preserve existing OR/AND semantics verbatim:
   - `household_members.household_members_select` — bare `auth.uid()` in the OR clause (`user_id = auth.uid() or household_id in (select public.my_household_ids())`)
   - `list_entries.list_entries_insert` — bare `auth.uid()` in the AND clause (`household_id in (select public.my_household_ids()) and added_by = auth.uid()`)
     These were created in migration 004's RLS-recursion fix and use the helper function (the `select public.my_household_ids()` clauses are already wrapped — only the `auth.uid()` references need the rewrap).

Explicit non-scope (per D4 + roadmap §1n non-scope, repeated here so reviewers don't ask):

- Moving `pg_trgm` + `fuzzystrmatch` to an `extensions` schema (cosmetic; deferred to v+ if a third extension lands).
- Fixing the ~42 extension-owned functions without `search_path` (owned by `supabase_admin`; we can't `ALTER` them; hosted advisor filters these automatically).
- Adding a `fetchHouseholdProfiles` API wrapper as part of this PR — the integration test in T6 calls into the existing `profiles` table directly via the supabase client; if a future surface needs a wrapper, it lands in its own PR with its own E2E. (The existing two-query hydration in `fetchListEntries` / `fetchListEntryById` already exercises the household-visibility read path indirectly.)
- App-code changes. None — this PR is policies + indexes + function attributes + email template + a test. No `apps/web` source touched. No new METRICS events.

## Files to create / modify

**New:**

- `supabase/migrations/014_advisor_findings.sql` — single migration with all SQL changes + ROLLBACK block.
- `supabase/templates/password-changed.html` — branded HTML mirroring `supabase/templates/recovery.html`'s structure (terracotta on cream, lalista logo, no CTA — informational).

**Modified:**

- `supabase/config.toml` — uncomment + populate `[auth.email.notification.password_changed]` block at lines 260-264. Subject: `Your lalista password was changed`. `content_path = "./supabase/templates/password-changed.html"`.
- `packages/core/src/api/profiles.integration.test.ts` — extend existing file with the two-user-same-household combined-policy test (one new `it()` block).
- `packages/core/src/supabase.types.ts` — regenerated via `pnpm db:gen-types`. No shape change expected (the migration is policy + index + function-attribute + extension-template only; nothing column-level). The CI type-drift gate (`scripts/ci-type-drift.sh`) verifies this expectation — if a regen produces a diff, treat as a Phase-2 surprise and stop.
- `CLAUDE.md` — small touch-up under § Where Things Happen § Auth (or a new bullet under § Gotchas) noting the password-changed email's existence and the out-of-band paste step. Same shape as the existing chapter-1l "transactional email config lives in dashboards, not in this repo" gotcha; this addition is one bullet under that gotcha rather than a new section.

**Out-of-band deploys** (PR body must enumerate these — see `/ak-build` § PR body conventions § Out-of-band deploy items):

- Paste subject + body of `supabase/templates/password-changed.html` into the prod project's dashboard at `/auth/templates` after merge.
- (No edge-function deploy needed — no `supabase/functions/**` changes.)

## Migration shape (`014_advisor_findings.sql`)

Single migration, four buckets in sequence (A–D), one `-- ROLLBACK:` block at the bottom. The ordering matters only for D (which depends on A — the combined policy references `public.my_household_ids()`, whose `search_path` is fixed in A; semantically a no-op since A is metadata-only and Postgres queues metadata changes behind active executions, but readability-wise putting the security-critical change first is the convention).

```sql
-- 014_advisor_findings.sql
--
-- What: Resolve 17 of the 19 Supabase Advisor findings audited 2026-05-04.
--   A. Defense-in-depth `search_path` on 5 functions (1 SECURITY DEFINER + 4 non-DEFINER).
--   B. 12 missing FK indexes for joins + cascading deletes.
--   C. 8 RLS policies rewrapped in `(select auth.uid())` so the planner caches
--      the per-statement uid instead of calling the function per row.
--   D. `profiles` permissive collapse — two SELECT policies → one combined policy.
-- Why: Drop us from 19 advisor findings → ≤2 (the two extension-in-public ones
--      we deferred). Critical: A's first ALTER closes a privilege-escalation
--      surface on `my_household_ids` (the migration-008-era outlier — every
--      other SECURITY DEFINER function has `search_path` set since its own
--      migration; this is the gap).
-- Does NOT: Add columns, change RLS semantics (combined policy preserves the
--           existing OR'd visibility), touch app code, or change function
--           bodies. Pure metadata + indexes + policy expressions.

-- ============================================================================
-- A. search_path defense-in-depth (5 functions)
-- ============================================================================
-- The first ALTER is the critical fix — `my_household_ids` is SECURITY DEFINER
-- (migration 008's `current_household_id` companion) and was missing the
-- explicit search_path that 008 / 010 / 012's other DEFINER functions all set.
-- The remaining four are non-DEFINER but advisor-flagged for consistency.

alter function public.my_household_ids() set search_path = public, pg_temp;
alter function public.current_household_id() set search_path = public, pg_temp;
alter function public.find_item_alternatives(text, uuid) set search_path = public, pg_temp;
alter function public.find_item_by_trgm(text) set search_path = public, pg_temp;
alter function public.route_item_to_store(uuid, uuid) set search_path = public, pg_temp;

-- ============================================================================
-- B. 12 missing FK indexes
-- ============================================================================
-- `if not exists` makes the migration idempotent on re-runs (a re-applied
-- migration after a partial failure should not error on existing indexes).
-- Per D1, no `concurrently` — incompatible with the migration's transaction;
-- v0 row counts make the SHARE lock build in milliseconds anyway.

create index if not exists idx_brand_preferences_item_id on public.brand_preferences (item_id);
create index if not exists idx_brand_preferences_store_id on public.brand_preferences (store_id);
create index if not exists idx_disambiguation_log_candidate_item_id on public.disambiguation_log (candidate_item_id);
create index if not exists idx_disambiguation_log_chosen_item_id on public.disambiguation_log (chosen_item_id);
create index if not exists idx_disambiguation_log_store_id on public.disambiguation_log (store_id);
create index if not exists idx_household_members_user_id on public.household_members (user_id);
create index if not exists idx_list_entries_added_by on public.list_entries (added_by);
create index if not exists idx_list_entries_item_id on public.list_entries (item_id);
create index if not exists idx_list_entries_store_id on public.list_entries (store_id);
create index if not exists idx_purchase_history_added_by on public.purchase_history (added_by);
create index if not exists idx_purchase_history_item_id on public.purchase_history (item_id);
create index if not exists idx_purchase_history_store_id on public.purchase_history (store_id);

-- ============================================================================
-- C. RLS policies rewrapped in (select auth.uid())
-- ============================================================================
-- Postgres' planner can cache the result of `(select auth.uid())` once per
-- statement — bare `auth.uid()` re-evaluates per row. At our scale the
-- difference is invisible; once we cross ~10k rows in a household it matters.
-- `alter policy` cannot rewrite the expression, so each is drop+create. Brief
-- ACCESS EXCLUSIVE on each table during the swap; invisible at v0, NOT
-- acceptable during a planned migration window once we have live users.

drop policy if exists "config_select" on public.config;
create policy "config_select" on public.config
  for select using ((select auth.uid()) is not null);

drop policy if exists "household_members_insert" on public.household_members;
create policy "household_members_insert" on public.household_members
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "households_insert" on public.households;
create policy "households_insert" on public.households
  for insert with check (true); -- preserved verbatim from 001; advisor flag clears via the explicit re-create

drop policy if exists "items_insert" on public.items;
create policy "items_insert" on public.items
  for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "items_select" on public.items;
create policy "items_select" on public.items
  for select using ((select auth.uid()) is not null);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "stores_select" on public.stores;
create policy "stores_select" on public.stores
  for select using ((select auth.uid()) is not null);

-- ============================================================================
-- D. profiles permissive collapse — two SELECT policies → one combined
-- ============================================================================
-- `profiles_select_own` and `profiles_select_household` are both PERMISSIVE
-- SELECT policies on the same table — Postgres OR-evaluates them, paying
-- twice the per-row cost. Combine into one rule that preserves the OR
-- semantic explicitly. The integration test in
-- packages/core/src/api/profiles.integration.test.ts pins this:
-- two-user-same-household, A SELECTs B's profile (must succeed), A UPDATEs
-- B's profile (must fail).

drop policy if exists "profiles_select_household" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or user_id = any (public.my_household_ids())
  );

-- ROLLBACK:
-- -- D. Restore the two original profiles SELECT policies (verbatim from migration 012)
-- drop policy if exists "profiles_select" on public.profiles;
-- create policy "profiles_select_own" on public.profiles
--   for select to authenticated
--   using (user_id = auth.uid());
-- create policy "profiles_select_household" on public.profiles
--   for select to authenticated
--   using (
--     exists (
--       select 1
--       from household_members hm_self
--       join household_members hm_other
--         on hm_other.household_id = hm_self.household_id
--       where hm_self.user_id = auth.uid()
--         and hm_other.user_id = profiles.user_id
--     )
--   );
-- -- C. Restore the original (per-row-evaluating) policy bodies
-- drop policy if exists "stores_select" on public.stores;
-- create policy "stores_select" on public.stores
--   for select using (auth.uid() is not null);
-- drop policy if exists "profiles_update_own" on public.profiles;
-- create policy "profiles_update_own" on public.profiles
--   for update to authenticated
--   using (user_id = auth.uid())
--   with check (user_id = auth.uid());
-- drop policy if exists "items_select" on public.items;
-- create policy "items_select" on public.items
--   for select using (auth.uid() is not null);
-- drop policy if exists "items_insert" on public.items;
-- create policy "items_insert" on public.items
--   for insert to authenticated
--   with check (auth.uid() is not null);
-- drop policy if exists "households_insert" on public.households;
-- create policy "households_insert" on public.households
--   for insert with check (true);
-- drop policy if exists "household_members_insert" on public.household_members;
-- create policy "household_members_insert" on public.household_members
--   for insert with check (user_id = auth.uid());
-- drop policy if exists "config_select" on public.config;
-- create policy "config_select" on public.config
--   for select using (auth.uid() is not null);
-- -- B. Drop the FK indexes (idempotent)
-- drop index if exists public.idx_purchase_history_store_id;
-- drop index if exists public.idx_purchase_history_item_id;
-- drop index if exists public.idx_purchase_history_added_by;
-- drop index if exists public.idx_list_entries_store_id;
-- drop index if exists public.idx_list_entries_item_id;
-- drop index if exists public.idx_list_entries_added_by;
-- drop index if exists public.idx_household_members_user_id;
-- drop index if exists public.idx_disambiguation_log_store_id;
-- drop index if exists public.idx_disambiguation_log_chosen_item_id;
-- drop index if exists public.idx_disambiguation_log_candidate_item_id;
-- drop index if exists public.idx_brand_preferences_store_id;
-- drop index if exists public.idx_brand_preferences_item_id;
-- -- A. Reset search_path on the 5 functions to the catalog default
-- alter function public.route_item_to_store(uuid, uuid) reset search_path;
-- alter function public.find_item_by_trgm(text) reset search_path;
-- alter function public.find_item_alternatives(text, uuid) reset search_path;
-- alter function public.current_household_id() reset search_path;
-- alter function public.my_household_ids() reset search_path;
```

Notes on the SQL above:

- `households_insert`'s body stays `with check (true)` verbatim — the advisor flag was on the policy expression's auth.uid() reference inside its `with check`, but in this case the body is literally `true` and contains no `auth.uid()` call. We re-create the policy anyway so the advisor's per-policy fingerprint refreshes; if the local advisor still flags it after migration, treat it as a false-positive (no `auth.uid()` to wrap) and document in the PR body.
- The 4 non-DEFINER functions in bucket A may not all currently exist in 001's `_helper_functions` migration — `pnpm db:reset` will fail loudly during T1 implementation if the function name + signature is wrong. T1's stuck-protocol exit on that failure is correct; verify against `\df` on the live local DB before pushing.
- The ROLLBACK block uses `drop policy if exists` + `create policy` rather than a single `alter policy` because of the same `alter policy` limitation that drove the forward shape. Round-trip via `scripts/ci-rollback-explain.sh` validates this.

## ROLLBACK shape

The `-- ROLLBACK:` block above is the unit of round-trip the CI rollback gate validates. Every line after the marker is stripped of the `-- ` prefix and applied as plain SQL by `scripts/ci-rollback-explain.sh` (see the script's `extract_rollback` awk function), then the forward migration is re-applied. The block must therefore:

1. Drop the new combined `profiles_select` policy + recreate the two original ones (preserving their verbatim bodies from migration 012). This restores the OR'd visibility from two policies again.
2. Drop+recreate each of the 7 rewrapped policies (C bucket) with the original `auth.uid()` (no `select`-wrap) bodies — the verbatim SQL from migrations 001 + 011 + 012.
3. Drop the 12 indexes (with `if exists` for idempotence).
4. `alter function … reset search_path` on each of the 5 functions, returning them to the catalog default (no fixed search_path). For `my_household_ids` this restores the pre-migration vulnerability; the rollback exists for an emergency, not for general use.

The forward migration plus rollback round-trips cleanly because:

- Buckets A+B are pure metadata + index DDL — both directions are idempotent.
- Bucket C drops + recreates each policy individually; the rollback drops + recreates each one back to its prior body. Brief ACCESS EXCLUSIVE on each table both directions.
- Bucket D is two ↔ one — the forward drops two, creates one; the rollback drops the one, creates two. Brief ACCESS EXCLUSIVE on `profiles`.

## Tests

Two layers, no new E2E.

### Integration (T6) — `packages/core/src/api/profiles.integration.test.ts`

Extend the existing file (4 tests today) with one new `it()` block under the existing `describe.skipIf(!shouldRun)('profiles integration', ...)` block. Pins the combined `profiles_select` policy semantic.

Sketch (final exact code in T6 implementation):

```ts
it('two-user-same-household: A reads B's profile via combined policy; A cannot UPDATE B', async () => {
  // Setup
  // 1. Provision A + B via signInAs (returns authenticated anon-keyed clients)
  // 2. Use admin client to put A + B in the same household:
  //    - Create the household via admin via service-role bypass of RLS
  //    - Insert two household_members rows (A as owner, B as member)
  //    Or alternatively: have A sign in, call create_household_with_owner RPC,
  //    then admin-insert B as a member. Either works; pick the simpler in T6.
  const a = await signInAs(uniqueEmail('a'), 'Password123!', 'Alice');
  const b = await signInAs(uniqueEmail('b'), 'Password123!', 'Bob');
  createdUsers.push(a.userId, b.userId);
  // ... set up shared household via admin (see force-create-race.spec.ts pattern)

  // Assertion 1: A can SELECT B's profile (combined policy's household-visibility branch)
  const { data: bSeenByA, error: selectErr } = await a.client
    .from('profiles')
    .select('user_id, display_name')
    .eq('user_id', b.userId)
    .single();
  expect(selectErr).toBeNull();
  expect(bSeenByA?.display_name).toBe('Bob');

  // Assertion 2: A cannot UPDATE B's profile (profiles_update_own scopes to user_id = auth.uid())
  const { data: updateData, error: updateErr } = await a.client
    .from('profiles')
    .update({ display_name: 'HIJACK' })
    .eq('user_id', b.userId)
    .select();
  // Either policy-rejected (error) OR silent zero-row (empty data); B's row stays 'Bob' regardless.
  if (updateErr) {
    expect(updateErr.message).toMatch(/row-level|rls|permission|policy/i);
  } else {
    expect(updateData).toEqual([]);
  }
  const bAfter = await b.client
    .from('profiles')
    .select('display_name')
    .eq('user_id', b.userId)
    .single();
  expect(bAfter.data?.display_name).toBe('Bob');
});
```

The cross-user-update assertion is intentionally tolerant of both Postgres responses (RLS error vs silent empty rows) — the existing test in the file (`forbids a user from updating another user's profile`) uses the same pattern. The load-bearing invariant is **B's row is unchanged** + **A successfully read B's display_name** (which would have failed pre-migration if the household-visibility policy were dropped without the combined replacement).

### Regression coverage — existing E2E + integration

The migration is invisible to app code if the policies preserve their semantics exactly. These existing specs exercise the affected surfaces and must still pass post-migration:

- `apps/web/e2e/core-flows.spec.ts` — exercises `list_entries_*`, `purchase_history_*`, `households_insert`, `household_members_insert` via the standard sign-in → create household → add item → mark bought flow.
- `apps/web/e2e/auth-edge-cases.spec.ts` — exercises `profiles` self-row + sign-up trigger.
- `apps/web/e2e/realtime.spec.ts` — exercises `list_entries` realtime + RLS as the second session.
- `apps/web/e2e/force-create-race.spec.ts` — exercises `items_insert` (the policy whose advisor-flagged body is rewrapped in C).
- `packages/core/src/api/items.integration.test.ts` — `items_select` + `items_insert` semantic checks.
- `packages/core/src/api/profiles.integration.test.ts` (existing 4 cases) — `profiles` self-row + signup-trigger checks; the combined policy must keep these green AND add the new fifth case.

### CI gates

- `pnpm turbo run test:unit` — fast job. No change expected; this PR adds no unit tests.
- `pnpm turbo run test` (slow job) with `VITEST_INTEGRATION=1` — integration suite. The new T6 case runs here.
- `scripts/ci-rollback-explain.sh` — slow job. Validates the `-- ROLLBACK:` block applies + the forward re-applies. **Load-bearing for this PR** because the rollback is the largest one we've shipped.
- `scripts/ci-type-drift.sh` — slow job. Verifies generated types in `packages/core/src/supabase.types.ts` match the local stack post-migration. Should be a no-op (no column changes).
- Playwright × 2 viewports — slow job. Regression coverage on the user-visible surface.

## Dependencies

Strictly none — this PR is SQL + an HTML template + a config-toml uncomment + an integration test. No code changes in `apps/web`, `packages/core`, `packages/ui`, or `supabase/functions`. No new packages added.

Operationally:

- `SUPABASE_PROD_URL` GitHub Variable must be set (it already is — chapter 1l shipped on this rail). `.github/workflows/deploy-migrations.yml` derives the project ref from it via the sed-pattern documented in `CLAUDE.md § Gotchas § SUPABASE_PROD_URL is the single source of truth`.
- `supabase/templates/**` does NOT auto-deploy — see Files modified above + Gotchas below. The PR body lists the prod-dashboard paste step under "Out-of-band deploy items."

## Task order

8 tasks. Each commits atomically per `/ak-implement` convention; small SQL edits could be collapsed but the finer granularity makes review easier and gives `/ak-implement`'s stuck protocol more recovery points.

- **T1: Migration — bucket A (search_path on 5 functions).** Write `supabase/migrations/014_advisor_findings.sql` with bucket A only (5 ALTER FUNCTION statements + the file's introductory comment header). Run `pnpm db:reset` locally; verify all 5 functions show the new search_path via `\df+`. Commit.
- **T2: Migration — bucket B (12 FK indexes).** Append bucket B (12 `create index if not exists` statements) to the same migration file. Run `pnpm db:reset`. Verify each index exists via `\di public.idx_*`. Commit.
- **T3: Migration — bucket C (8 RLS policies rewrapped).** Append bucket C (drop + create for each of the 7 policies; `profiles_select_own` is dropped here but its replacement lives in D). Run `pnpm db:reset`. Verify the rewrites by inspecting `pg_policies.qual` / `with_check` columns. Run the existing test suite (`pnpm turbo run test:unit` + Playwright smoke) to confirm no semantic regression. Commit.
- **T4: Migration — bucket D (profiles combined policy).** Append bucket D (drop the two SELECT policies + create combined `profiles_select`). Run `pnpm db:reset`. Verify `pg_policies` shows one SELECT policy on `profiles`. Commit.
- **T5: Migration — ROLLBACK block + types regen.** Append the `-- ROLLBACK:` block. Run `pnpm db:gen-types` (no diff expected); run `bash scripts/ci-rollback-explain.sh` against the local stack to validate round-trip. Commit.
- **T6: Integration test — combined-policy household-visibility pin.** Extend `packages/core/src/api/profiles.integration.test.ts` with the new `it()` block sketched above. Two-user-same-household setup via admin client; A SELECTs B's profile (passes); A UPDATEs B's profile (fails). Run `VITEST_INTEGRATION=1 pnpm --filter @lalista/core test`. Commit.
- **T7: password_changed email — config + template.** Uncomment + populate the `[auth.email.notification.password_changed]` block in `supabase/config.toml` (subject + content_path); create `supabase/templates/password-changed.html` mirroring `recovery.html`'s structure (terracotta on cream, lalista logo, no CTA — this email is informational). Restart the local Supabase stack (`pnpm db:start` or `supabase stop && supabase start`) and verify the local mailpit receives the correct body when triggering an `updateUser({ password })` flow against the local stack. Commit.
- **T8: Docs touch-ups + PR-body operator paste step.** Add a short bullet to `CLAUDE.md` (under § Gotchas § custom domain + transactional email config) noting the `password_changed` template's existence + out-of-band paste step. Verify nothing else needs changing — `OVERVIEW.md`, `ARCHITECTURE.md`, `METRICS.md`, `BUILD-LOG.md`, `TODOS.md` are all unaffected by a pure-SQL + email-template PR. Commit.

T1–T5 could compress into a single "write 014_advisor_findings.sql" task, but the per-bucket decomposition gives `/ak-implement` 5 atomic resume points if the local stack throws an unexpected failure (most likely on T1 if a function signature doesn't match what the advisor saw — T1 isolates that failure mode). T7 is naturally separate because it touches a different surface (config.toml + a new HTML template, no SQL).

## Gotchas

Surfaced during planning. Non-obvious rules `/ak-implement` should know before touching the relevant area.

- **Migration ordering — A before C/D.** The SECURITY DEFINER `search_path` fix on `my_household_ids` (A bucket, first ALTER) is metadata-only and Postgres queues metadata changes behind active executions. Putting A first means the combined `profiles_select` policy in D — which calls `public.my_household_ids()` — sees the fixed function from the first reference. Reversing to D-then-A would technically work too (the function call resolves at execution time, not policy-creation time) but the convention is "fix the security issue first."
- **`drop policy` takes ACCESS EXCLUSIVE briefly.** Each of the 8 policy drops in C+D acquires ACCESS EXCLUSIVE on the table for the duration of the drop+create (microseconds at our scale). Invisible at v0; **NOT** acceptable during a planned migration window once we have live users — a future RLS-rewrite pass should batch these inside a transaction with explicit `set lock_timeout` + run during a maintenance window. This PR is fine because traffic is effectively zero.
- **`create index` (without `concurrently`) takes a SHARE lock.** Blocks writes on the table for the duration of the build. Per D1, at v0 row counts (`list_entries` is the largest with tens of rows) the index builds in milliseconds. Flip to `concurrently` only if a future audit shows write contention — and that flip requires a separate DDL-only migration since `concurrently` can't run inside a transaction.
- **`pnpm db:reset` must succeed locally before push.** The migration is one file; if it fails to apply, `pnpm db:reset` errors and the local stack stops mid-migration. T1–T4 each include a `pnpm db:reset` step to catch that early. Don't skip the reset between buckets — it's the only guard against a typo in a function signature breaking the advisor-flag fix.
- **`pnpm db:gen-types` may produce no diff.** The migration touches policies, indexes, function attributes, and a template — none of which surface in Supabase's TypeScript type generation. The CI type-drift gate (`scripts/ci-type-drift.sh`) verifies this expectation. If a regen produces a diff, treat it as a Phase-2 surprise (likely a function signature accidentally changed during T1) and stop.
- **`scripts/ci-rollback-explain.sh` round-trip.** The script applies the rollback, then re-applies the forward migration. The rollback block above is large (50+ lines of SQL). If the round-trip fails on the slow-job, the most likely cause is a mismatch between the forward `drop policy` body and the rollback `drop policy` body — the rollback must drop the **new** policy names (e.g. the combined `profiles_select`) before recreating the **old** ones. T5 validates this locally before pushing.
- **`profiles` two-query read pattern is unaffected.** `fetchListEntries` + `fetchListEntryById` still issue two queries (list_entries first, then `profiles.select(...).in('user_id', <uniqueAddedBy>)`). The combined `profiles_select` policy preserves the OR semantics that powers the second query — the two-query pattern keeps working without modification. Don't try to "simplify" it into a join in this PR (separate concern; see CLAUDE.md gotcha § `addedByName` hydration).
- **`households_insert` with `check (true)` re-create is harmless.** The advisor flagged this policy because its expression contained an `auth.uid()` reference somewhere in the historical body (or possibly the advisor over-matched on the policy's metadata). The current body in `001_initial_schema.sql` is literally `with check (true)` — there's no `auth.uid()` to wrap. We re-create it anyway in C bucket so the advisor's fingerprint refreshes; if the local advisor still flags it, document in the PR body and treat as a known false-positive.
- **Hosted Supabase advisor parity expectation.** Re-running the advisor against the prod project after deploy-migrations ships should drop us from 19 findings → ≤2 (the two extension-in-public ones we deferred per D4). If the post-deploy run shows more than 2 findings, the PR's prod-deploy verification has failed — treat it like a CI red on land-and-deploy (don't auto-rollback; investigate the unexpected finding).
- **Out-of-band deploy: `password-changed.html`.** `supabase/templates/**` does NOT auto-deploy via `deploy-migrations.yml` (which is path-filtered to `supabase/migrations/**`) or `deploy-functions.yml` (filtered to `supabase/functions/**`). The operator must paste the subject + body into the prod project's `/auth/templates` UI after merge. Same pattern as the chapter-1l email templates per `CLAUDE.md § Gotchas § Custom domain + transactional email config`. The PR body MUST list this as an "Out-of-band deploy item" so `/ak-go-live` doesn't skip it.
- **No new METRICS events.** Per the implicit Phase-0 invariant ("no app-code changes"). If T6 or T8 would somehow motivate one, stop and ask the user — don't sneak it in.
- **`my_household_ids` signature.** Verify against `\df public.my_household_ids` on the local stack — if the function takes args, T1's `alter function public.my_household_ids() set search_path …` will error. Migration 003 / 004 / 008 are the originating files; spot-check before T1.

## Acceptance / rollout / rollback

### Acceptance

Definition-of-done for the PR to be mergeable:

- `pnpm db:reset` succeeds locally with all 14 migrations applied (013 + new 014).
- `pnpm db:gen-types` produces no diff to `packages/core/src/supabase.types.ts`.
- `pnpm turbo run test:unit` passes (fast job).
- `VITEST_INTEGRATION=1 pnpm --filter @lalista/core test` passes (slow job locally; CI runs via `CI_SLOW_JOB=1`). The new T6 test case is included.
- `bash scripts/ci-rollback-explain.sh` reports `OK: 014_advisor_findings.sql` (rollback round-trips cleanly).
- `bash scripts/ci-type-drift.sh` reports no drift.
- Playwright E2E × 2 viewports green (slow job CI).
- Local mailpit receives the password-changed email when an `updateUser({ password })` is fired against the local stack.
- PR body lists the `password-changed.html` prod-dashboard paste step under "Out-of-band deploy items."

### Rollout

`deploy-migrations.yml` ships `supabase/migrations/014_advisor_findings.sql` on push to main automatically (path-filtered to `supabase/migrations/**`). No edge-function deploy required. After merge:

1. CI's `deploy-migrations.yml` job picks up the migration and applies it to the prod Supabase project. Watch the action log for the `supabase db push` step.
2. **Operator manual step**: paste the subject (`Your lalista password was changed`) + the body of `supabase/templates/password-changed.html` into the prod project's dashboard at `/auth/templates`. Without this, prod's `password_changed` email stays disabled (or sends the Supabase default if a previous template was set). PR body lists this; `/ak-go-live` reads the PR body to surface it.
3. Re-run the local Supabase advisor against the prod project (Supabase Studio → Advisor → Refresh). Expect 2 findings (the two extension-in-public ones we deferred). If more, treat as a deploy-verification failure.

### Rollback

The forward `-- ROLLBACK:` block is the unit. If post-deploy something is wrong:

- **Don't rewrite history.** Don't `git revert` migration 014 — that would leave the prod DB in a state CI's slow-job rollback gate doesn't validate.
- **Do** create a new migration `015_revert_advisor_findings.sql` containing the rollback SQL block from 014's `-- ROLLBACK:` section, verbatim (stripped of leading `-- `). Push to main; `deploy-migrations.yml` applies it automatically. The slow-job's `ci-rollback-explain.sh` already validated this round-trip pre-merge.
- **For the email template only**: if `password-changed.html` content is wrong, edit + re-paste into the prod dashboard. No SQL involved; no migration needed.

Risk profile: low. The migration is idempotent on re-runs (every `if not exists` + `if exists`); the rollback block round-trips cleanly per the CI gate; the integration test pins the one semantic invariant that could quietly break (combined `profiles_select` visibility); the PR is small in code-LOC terms (one SQL file + one HTML file + one config-toml uncomment + one test case + one docs bullet).
