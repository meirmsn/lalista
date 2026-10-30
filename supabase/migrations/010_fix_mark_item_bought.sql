-- Fix mark_item_bought so it can actually run.
--
-- The original (migration 002) used `security invoker`, but the schema lacks:
--   - an UPDATE policy on `list_entries` (so `select ... for update` inside
--     the RPC returns 0 rows for the calling user → "Entry not found")
--   - an INSERT policy on `purchase_history` (so the RPC's INSERT raises
--     42501 even if the SELECT did succeed)
-- Net effect: the RPC was non-functional for every authenticated user since
-- migration 002. Existing unit tests mocked `supabase.rpc(...)` and never
-- exercised the real round-trip; the PR-3 qa-walk caught this when verb 4
-- ("tap buy → see row disappear") couldn't make the row disappear.
--
-- Two fixes were on the table:
--   (a) add the missing UPDATE/INSERT policies, keep `security invoker`
--   (b) switch the RPC to `security definer` with an explicit
--       household-membership check inside
-- This migration takes (b). (a) would relax RLS on `purchase_history` so
-- direct client INSERTs become possible — contradicting the CLAUDE.md gotcha
-- that mark_item_bought is the ONLY write path. With an explicit auth check
-- inside, definer is safe; migration 002's "Do NOT change to DEFINER" warning
-- assumed no in-function check, which we now provide.

create or replace function mark_item_bought(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entry list_entries%rowtype;
  caller_uid uuid := auth.uid();
begin
  -- Reject anonymous calls before doing any work.
  if caller_uid is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  -- security definer bypasses RLS, so this SELECT FOR UPDATE always finds
  -- the row if it exists. We re-impose the household-membership check
  -- below to replace the RLS filter.
  select * into entry
  from list_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Entry not found' using errcode = 'P0001';
  end if;

  -- Explicit access check — replaces the per-row RLS filter that
  -- security invoker used to provide.
  if not exists (
    select 1
    from household_members
    where household_id = entry.household_id
      and user_id = caller_uid
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  insert into purchase_history (
    household_id, item_id, store_id, brand, bought_at, added_by
  )
  values (
    entry.household_id, entry.item_id, entry.store_id,
    entry.brand, now(), entry.added_by
  );

  delete from list_entries where id = p_entry_id;
end;
$$;

grant execute on function mark_item_bought(uuid) to authenticated;

-- No unconditional rollback block: restoring the migration-002 body
-- leaves Buy non-functional because the old RPC was `security invoker`
-- and depended on client-side `list_entries_update` + `purchase_history_insert`
-- policies that never shipped. A safe rollback requires adding those
-- policies first:
--   create policy "list_entries_update" on list_entries
--     for update using (household_id in (select public.my_household_ids()));
--   create policy "purchase_history_insert" on purchase_history
--     for insert with check (household_id in (select public.my_household_ids()));
-- then restore the migration-002 RPC body verbatim. Intentionally no
-- `-- ROLLBACK:` marker so ci-rollback-explain.sh skips this file.
