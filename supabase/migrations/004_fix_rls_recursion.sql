-- Fix infinite recursion in household_members RLS policies.
--
-- The previous household_members_select policy checked membership by querying
-- household_members itself, which triggered the same policy → infinite recursion.
--
-- Solution: a SECURITY DEFINER helper function that reads household_members
-- without RLS checks. All policies use this function instead of raw subqueries.

-- Helper: returns the household IDs the calling user belongs to.
-- SECURITY DEFINER bypasses RLS on household_members so we avoid recursion.
create or replace function public.my_household_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select household_id from household_members where user_id = auth.uid()
$$;

-- household_members: drop recursive policy, replace with direct uid check
-- (a user can always see their own rows; seeing other members of their household
-- is handled through the security definer fn for other tables)
drop policy if exists "household_members_select" on household_members;

create policy "household_members_select" on household_members
  for select using (
    user_id = auth.uid()
    or household_id in (select public.my_household_ids())
  );

-- Rebuild all other policies to use the helper instead of inline subqueries.
-- This prevents any future recursion if the household_members policy changes.

-- households
drop policy if exists "households_select" on households;
create policy "households_select" on households
  for select using (id in (select public.my_household_ids()));

-- list_entries
drop policy if exists "list_entries_select" on list_entries;
create policy "list_entries_select" on list_entries
  for select using (household_id in (select public.my_household_ids()));

drop policy if exists "list_entries_insert" on list_entries;
create policy "list_entries_insert" on list_entries
  for insert with check (
    household_id in (select public.my_household_ids())
    and added_by = auth.uid()
  );

drop policy if exists "list_entries_delete" on list_entries;
create policy "list_entries_delete" on list_entries
  for delete using (household_id in (select public.my_household_ids()));

-- purchase_history
drop policy if exists "purchase_history_select" on purchase_history;
create policy "purchase_history_select" on purchase_history
  for select using (household_id in (select public.my_household_ids()));

-- brand_preferences
drop policy if exists "brand_preferences_select" on brand_preferences;
create policy "brand_preferences_select" on brand_preferences
  for select using (household_id in (select public.my_household_ids()));

drop policy if exists "brand_preferences_upsert" on brand_preferences;
create policy "brand_preferences_upsert" on brand_preferences
  for insert with check (household_id in (select public.my_household_ids()));

drop policy if exists "brand_preferences_update" on brand_preferences;
create policy "brand_preferences_update" on brand_preferences
  for update using (household_id in (select public.my_household_ids()));

-- disambiguation_log
drop policy if exists "disambiguation_log_select" on disambiguation_log;
create policy "disambiguation_log_select" on disambiguation_log
  for select using (household_id in (select public.my_household_ids()));

drop policy if exists "disambiguation_log_insert" on disambiguation_log;
create policy "disambiguation_log_insert" on disambiguation_log
  for insert with check (household_id in (select public.my_household_ids()));
