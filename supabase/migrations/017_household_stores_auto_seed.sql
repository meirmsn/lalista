-- Migration 017: auto-seed household_stores on household creation.
--
-- Closes the gap left by migration 016: the cross-join backfill (016 § 5)
-- seeded household_stores for households that existed AT MIGRATION TIME.
-- Households created AFTER 016 ran (via `create_household_with_owner` RPC
-- from migration 008, or any future path) started with an EMPTY My Stores
-- — every `list_entries` insert then trips the BEFORE INSERT trigger
-- (016 § 8, `list_entries_store_membership_check`) with
-- `store % is not in household %'s My Stores`.
--
-- Fix: AFTER INSERT trigger on `households` that mirrors the migration-time
-- backfill — seeds every is_global=true store into the new household's My
-- Stores. Self-healing for any provisioning path (the RPC, future server-
-- side admin tools, manual inserts). Architecturally symmetric with 016's
-- backfill block; no RPC coupling.
--
-- v0 invariant: every household has every is_global=true store in its My
-- Stores at creation time. Users can subsequently remove individual stores
-- (remove_household_store RPC). New globals added after this trigger fires
-- (e.g., admin-promotion of a popular custom) do NOT automatically
-- propagate to existing households — that's a deferred concern (see
-- TODOS.md → admin-promote-custom-store-to-global).

create or replace function seed_household_stores_on_new_household()
returns trigger language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Mirrors the migration-016 cross-join backfill, scoped to the single
  -- newly-inserted household row. ON CONFLICT DO NOTHING in case a future
  -- code path pre-seeds rows before the trigger fires (defense-in-depth;
  -- the PK is (household_id, store_id) so collisions are well-defined).
  insert into household_stores (household_id, store_id, added_by)
  select new.id, s.id, null
  from stores s
  where s.is_global = true
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists households_auto_seed_my_stores on households;
create trigger households_auto_seed_my_stores
  after insert on households
  for each row execute function seed_household_stores_on_new_household();
-- LOAD-BEARING(do-not-remove): AFTER INSERT (not BEFORE) — the insert into
-- household_stores requires the household row to be visible in `households`
-- for the FK to resolve, and AFTER INSERT runs in the same transaction so
-- the seed is atomic with the household creation (a household either exists
-- with its My Stores seeded, or doesn't exist at all). SECURITY DEFINER so
-- the seed bypasses the (deliberate) absence of an INSERT policy on
-- household_stores — same principle-of-least-privilege as add_household_store
-- (CLAUDE.md gotcha § Principle of least privilege for RLS-bypass writes).

-- Refresh PostgREST's schema cache for completeness. No new RPCs here, but
-- the schema fingerprint changed and reload is cheap.
notify pgrst, 'reload schema';

-- ROLLBACK:
-- drop trigger if exists households_auto_seed_my_stores on households;
-- drop function if exists seed_household_stores_on_new_household();
-- notify pgrst, 'reload schema';
