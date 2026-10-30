-- Migration 016: my-stores (per-household store membership + custom catalog rows)
--
-- Layers a per-household "My Stores" concept on top of the existing global
-- catalog at `stores`. Two columns added to stores (created_by_household_id +
-- is_global), one new membership table (household_stores), two SECURITY
-- DEFINER RPCs, one defense-in-depth BEFORE INSERT trigger on list_entries,
-- one runtime-tunable config row, one realtime publication addition.
--
-- v0 invariants (drop / revise in v1+ chapters):
--   - household_stores PK is (household_id, store_id) — single-row-per-pair.
--   - stores.is_global = false rows are visible ONLY to created_by_household_id;
--     no cross-household dedup happens at the catalog layer (operator-side
--     admin-promotion is the dedup path — TODO admin-promote-custom-store-to-global).

-- 1. Extend stores: support per-household custom rows.
alter table stores
  add column if not exists created_by_household_id uuid references households(id) on delete set null,
  add column if not exists is_global boolean not null default true;
-- D9: `default true` applies to existing rows on ADD COLUMN; no explicit
--     UPDATE … SET is_global = true needed. Verified-pattern.

-- 2. Drop the stores.name UNIQUE constraint.
alter table stores drop constraint if exists stores_name_key;
-- LOAD-BEARING(do-not-remove): under Model B (private custom stores), N households
-- can each independently create their own "Trader Joe's" row — that fragmentation
-- is invisible to users (RLS hides each household's customs from the others) and
-- is intentionally accepted in v0. Re-adding UNIQUE would make House B's add fail
-- when House A had already created the name, even though A's row is invisible
-- to B. Operator-side admin-promotion to global is the dedup path — see
-- TODOS.md → admin-promote-custom-store-to-global.

-- 3. Trigram index on stores.name for autocomplete + RPC fuzzy match (D8).
-- items has the same pattern at 001:53; stores didn't because the catalog
-- was only 3 rows. Per-household customs grow it.
create index if not exists stores_name_trgm_idx on stores using gin (name gin_trgm_ops);

-- 4. New: per-household membership table.
create table if not exists household_stores (
  household_id uuid not null references households(id) on delete cascade,
  store_id     uuid not null references stores(id),
  added_at     timestamptz not null default now(),
  added_by     uuid references auth.users(id) on delete set null,
  primary key (household_id, store_id)
);

create index if not exists household_stores_household_idx on household_stores (household_id);
-- FK indexes
create index if not exists household_stores_store_idx on household_stores (store_id);
create index if not exists household_stores_added_by_idx on household_stores (added_by);

alter table household_stores enable row level security;

-- household_stores: SELECT only; writes via SECURITY DEFINER RPC.
-- 015 wrap-in-subquery pattern for planner caching.
drop policy if exists "household_stores_select" on household_stores;
create policy "household_stores_select" on household_stores
  for select using (
    household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    )
  );
-- No client INSERT/UPDATE/DELETE policies — all writes via add_household_store
-- and remove_household_store RPCs below.

-- 5. Backfill: every existing household gets the 3 globals.
-- D2: cross-join over is_global=true catalog rows. on conflict do nothing
-- in case a v1+ migration adds early rows mid-backfill.
insert into household_stores (household_id, store_id, added_by)
select h.id, s.id, null
from households h
cross join stores s
where s.is_global = true
on conflict do nothing;

-- 6. Replace stores_select with Model B scoped policy (D2).
-- Globals visible to all authed users; customs visible only to creating household.
drop policy if exists "stores_select" on stores;
create policy "stores_select" on stores
  for select using (
    auth.uid() is not null
    and (
      is_global = true
      or created_by_household_id in (
        select household_id from household_members where user_id = (select auth.uid())
      )
    )
  );
-- No INSERT/UPDATE/DELETE policies on stores — all custom-create flows through
-- add_household_store (SECURITY DEFINER below). Same principle-of-least-privilege
-- pattern as 015 (CLAUDE.md gotcha § Principle of least privilege for RLS-bypass writes).

-- 7. RPCs (SECURITY DEFINER, narrow-purpose, migration-008 grant block parity).
-- add_household_store: add a store to caller's My Stores. Returns (store_id, was_created).
create or replace function add_household_store(
  p_store_id uuid default null,
  p_name text default null
) returns table(store_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household_id uuid;
  v_resolved_id uuid;
  v_match uuid;
  v_threshold numeric;
begin
  v_household_id := current_household_id();
  if v_household_id is null then
    raise exception 'not a household member' using errcode = 'P0001';
  end if;
  if p_store_id is null and p_name is null then
    raise exception 'must provide store_id or name' using errcode = 'P0001';
  end if;
  if p_name is not null then
    p_name := nullif(trim(p_name), '');
    if p_name is null or length(p_name) > 60 then
      raise exception 'name must be 1-60 chars' using errcode = 'P0001';
    end if;
  end if;

  -- Read the tunable fuzzy threshold (D6). Falls back to 0.6 if config row missing.
  select coalesce((select value::numeric from config where key = 'store_name_match_threshold'), 0.6)
    into v_threshold;

  if p_store_id is not null then
    -- LOAD-BEARING(do-not-remove): visibility gate on the p_store_id branch.
    -- Without this, a caller could pass a custom-store UUID belonging to a
    -- different household — the RPC would happily add it to caller's My
    -- Stores, defeating Model B (D2). The fuzzy-match branch already
    -- restricts to visible rows via the WHERE clause; this `select … where`
    -- mirrors that restriction for the direct-id branch.
    select id into v_resolved_id
      from stores
      where id = p_store_id
        and (is_global = true or created_by_household_id = v_household_id);
    if v_resolved_id is null then
      raise exception 'store not visible' using errcode = 'P0001';
    end if;
  else
    -- p_name given: fuzzy match against catalog rows VISIBLE to this caller.
    -- Under Model B, that's globals + this household's own customs. The
    -- redundant `or created_by_household_id = ...` clause makes the visibility
    -- scope explicit at the query layer — defense in depth.
    select id into v_match
      from stores
      where (is_global = true or created_by_household_id = v_household_id)
        and similarity(name, p_name) > v_threshold
      order by similarity(name, p_name) desc, name asc
      limit 1;
    v_resolved_id := v_match;
  end if;

  if v_resolved_id is not null then
    insert into household_stores (household_id, store_id, added_by)
      values (v_household_id, v_resolved_id, auth.uid())
      on conflict do nothing;
    return query select v_resolved_id, false;
    return;
  end if;

  -- No catalog match: mint a private custom store, then link membership.
  -- LOAD-BEARING(do-not-remove): is_global = false. Without this, custom
  -- stores default to is_global=true (column default), which would (a)
  -- include them in the cross-join backfill for FUTURE households,
  -- (b) widen their RLS visibility to ALL authed users (Model B violation),
  -- and (c) skew any future popular-stores ranking. Pure-file test in
  -- packages/core/src/migrations/016_is_global_false.test.ts greps for
  -- this exact line.
  insert into stores (name, created_by_household_id, is_global)
    values (p_name, v_household_id, false)
    returning id into v_resolved_id;
  insert into household_stores (household_id, store_id, added_by)
    values (v_household_id, v_resolved_id, auth.uid());

  return query select v_resolved_id, true;
end;
$$;
revoke all on function add_household_store(uuid, text) from public;
revoke execute on function add_household_store(uuid, text) from anon;
grant execute on function add_household_store(uuid, text) to authenticated, service_role;

-- remove_household_store: remove a store from caller's My Stores. Catalog untouched.
-- Idempotent: removing a non-membership row is a no-op (no error).
create or replace function remove_household_store(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household_id uuid;
begin
  v_household_id := current_household_id();
  if v_household_id is null then
    raise exception 'not a household member' using errcode = 'P0001';
  end if;
  delete from household_stores
    where household_id = v_household_id and store_id = p_store_id;
end;
$$;
revoke all on function remove_household_store(uuid) from public;
revoke execute on function remove_household_store(uuid) from anon;
grant execute on function remove_household_store(uuid) to authenticated, service_role;

-- 8. Defense-in-depth BEFORE INSERT trigger on list_entries (D4).
-- Without this, a stale-tab client could write a list_entries row for a store
-- the household just removed — RLS lets the insert through (membership check
-- is on household_id only); the FK to stores(id) is open. Same fix-the-invariant-
-- at-the-DB-layer pattern as 015's FOR UPDATE on accept_invite.
--
-- NOT applied to purchase_history (written via mark_item_bought() from already-
-- validated list_entries rows), brand_preferences, or disambiguation_log
-- (write-once-by-edge-function flows where this attack surface doesn't apply).
create or replace function check_list_entries_store_in_household_stores()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from household_stores
    where household_id = new.household_id and store_id = new.store_id
  ) then
    raise exception 'store % is not in household %''s My Stores', new.store_id, new.household_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists list_entries_store_membership_check on list_entries;
create trigger list_entries_store_membership_check
  before insert on list_entries
  for each row execute function check_list_entries_store_in_household_stores();

-- 9. Config row for the fuzzy threshold (D6). Runtime-tunable; no redeploy needed.
insert into config (key, value) values ('store_name_match_threshold', '0.6')
  on conflict (key) do nothing;

-- 10. Realtime publication: household_stores adds/removes propagate to other
-- members' active sessions. Mirrors how list_entries was added in 013 — the
-- DO-block guard keeps the migration idempotent across stack variants.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'household_stores'
  ) then
    alter publication supabase_realtime add table household_stores;
  end if;
end $$;

-- 11. Tell PostgREST to reload its schema cache so the new RPCs are callable
-- via the rest API immediately on deploy. (Migration 008/015 pattern.)
notify pgrst, 'reload schema';

-- ROLLBACK:
-- alter publication supabase_realtime drop table household_stores;
