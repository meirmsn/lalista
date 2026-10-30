-- 014_advisor_findings.sql
--
-- What: Resolve 19 of the 19 Supabase Advisor findings (the original 17 from
--       2026-05-04 plus 2 `auth_rls_initplan` policies the original audit
--       missed, surfaced by a re-probe at PR 58 dogfood time).
--   A. Defense-in-depth `search_path` on 5 functions (1 SECURITY DEFINER + 4 non-DEFINER).
--   B. 12 missing FK indexes for joins + cascading deletes.
--   C. 7 RLS policies rewrapped in `(select auth.uid())` so the planner caches
--      the per-statement uid instead of calling the function per row.
--   D. `profiles` permissive collapse — two SELECT policies → one combined policy
--      (also rewrapped in `(select auth.uid())`).
--   E. 2 RLS policies the original 2026-05-04 audit missed: `household_members_select`
--      and `list_entries_insert` both still call `auth.uid()` directly. Same mechanical
--      `(select auth.uid())` rewrap as bucket C.
-- Why: Drop us from 19 advisor findings → 2 (the two extension-in-public ones
--      we deferred per spec D4). Critical: A's first ALTER closes a privilege-escalation
--      surface on `my_household_ids` (the migration-008-era outlier — every
--      other SECURITY DEFINER function has `search_path` set since its own
--      migration; this is the gap).
-- Does NOT: Add columns, change RLS semantics (combined policy preserves the
--           existing OR'd visibility, bucket E preserves the existing OR/AND
--           semantics), touch app code, or change function bodies. Pure
--           metadata + indexes + policy expressions.

-- ============================================================================
-- A. search_path defense-in-depth (5 functions)
-- ============================================================================
-- The first ALTER is the critical fix — `my_household_ids` is SECURITY DEFINER
-- (migration 004's RLS-recursion fix) and was missing the explicit search_path
-- that 008 / 010 / 012's other DEFINER functions all set. The remaining four
-- are non-DEFINER but advisor-flagged for consistency.

alter function public.my_household_ids() set search_path = public, pg_temp;
alter function public.current_household_id() set search_path = public, pg_temp;
alter function public.find_item_alternatives(text, int) set search_path = public, pg_temp;
alter function public.find_item_by_trgm(text, numeric) set search_path = public, pg_temp;
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
  for insert to authenticated
  with check ((select auth.uid()) is not null); -- preserved from migration 005's tightening (auth-required); rewrapped in (select …) per the C-bucket pattern

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
    or user_id in (
      select hm.user_id
      from household_members hm
      where hm.household_id in (select public.my_household_ids())
    )
  );

-- ============================================================================
-- E. RLS policies the original audit missed (2026-05-08 re-probe gap)
-- ============================================================================
-- The 2026-05-04 advisor audit named 8 policies for the bucket-C rewrap.
-- A re-probe at PR 58 dogfood time surfaced two more `auth_rls_initplan`
-- hits the original audit missed: `household_members.household_members_select`
-- (bare `auth.uid()` in the OR) and `list_entries.list_entries_insert`
-- (bare `auth.uid()` in the AND). Same mechanical `(select auth.uid())`
-- rewrap. Both bodies preserve the existing semantics verbatim — the
-- only change is the wrapper.

drop policy if exists "household_members_select" on public.household_members;
create policy "household_members_select" on public.household_members
  for select using (
    user_id = (select auth.uid())
    or household_id in (select public.my_household_ids())
  );

drop policy if exists "list_entries_insert" on public.list_entries;
create policy "list_entries_insert" on public.list_entries
  for insert with check (
    household_id in (select public.my_household_ids())
    and added_by = (select auth.uid())
  );

-- ROLLBACK:
-- -- E. Restore the original (per-row-evaluating) bodies of the 2 audit-gap policies (verbatim from migration 004)
-- drop policy if exists "list_entries_insert" on public.list_entries;
-- create policy "list_entries_insert" on public.list_entries
--   for insert with check (
--     household_id in (select public.my_household_ids())
--     and added_by = auth.uid()
--   );
-- drop policy if exists "household_members_select" on public.household_members;
-- create policy "household_members_select" on public.household_members
--   for select using (
--     user_id = auth.uid()
--     or household_id in (select public.my_household_ids())
--   );
-- -- D. Restore the two original profiles SELECT policies (verbatim from migration 012).
-- --    `drop if exists` on each restored policy too — the CI rollback-explain script
-- --    iterates migrations and round-trips each one; by the time 014's ROLLBACK runs,
-- --    012's round-trip has already re-created profiles_select_own +
-- --    profiles_select_household (012 forward creates them, 014 forward dropped them
-- --    on initial db:reset, then 012's per-iteration round-trip recreated them
-- --    without 014's forward being re-applied yet). Without these `if exists` drops,
-- --    the bare CREATE here errors with "policy ... already exists".
-- drop policy if exists "profiles_select" on public.profiles;
-- drop policy if exists "profiles_select_own" on public.profiles;
-- drop policy if exists "profiles_select_household" on public.profiles;
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
--   for insert with check (auth.uid() is not null); -- restores migration 005's tightening
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
-- alter function public.find_item_by_trgm(text, numeric) reset search_path;
-- alter function public.find_item_alternatives(text, int) reset search_path;
-- alter function public.current_household_id() reset search_path;
-- alter function public.my_household_ids() reset search_path;
