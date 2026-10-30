-- mark_item_bought: atomic delete from list_entries + insert into purchase_history.
-- A crash between two sequential client writes would lose history.
-- Always call this RPC instead of separate client-side writes.
--
-- SECURITY: security invoker is intentional.
-- RLS on list_entries enforces household membership.
-- Do NOT change to DEFINER — that would bypass RLS and allow any authed user
-- to mark any entry as bought.

create or replace function mark_item_bought(p_entry_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  entry list_entries%rowtype;
begin
  -- Lock the row to prevent concurrent marks
  select * into entry
  from list_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Entry not found or access denied';
  end if;

  -- Record confirmed purchase
  insert into purchase_history (household_id, item_id, store_id, brand, bought_at, added_by)
  values (entry.household_id, entry.item_id, entry.store_id, entry.brand, now(), entry.added_by);

  -- Remove from active list
  delete from list_entries where id = p_entry_id;
end;
$$;

-- Grant execute to authenticated users (RLS enforces household check inside)
grant execute on function mark_item_bought(uuid) to authenticated;
