-- Ensure the households INSERT policy exists.
-- If migration 001 applied partially, this policy may be missing,
-- causing "new row violates row-level security policy" on household creation.

drop policy if exists "households_insert" on households;

create policy "households_insert" on households
  for insert with check (auth.uid() is not null);

-- Also ensure authenticated users have the necessary table grants
-- (Supabase auto-grants these for tables created via dashboard, but
--  SQL-migration-created tables may need them set explicitly)
grant select, insert, update, delete on table households          to authenticated;
grant select, insert, update, delete on table household_members   to authenticated;
grant select, insert, update, delete on table list_entries        to authenticated;
grant select, insert, update, delete on table purchase_history    to authenticated;
grant select, insert, update, delete on table brand_preferences   to authenticated;
grant select, insert, update, delete on table disambiguation_log  to authenticated;
grant select                          on table stores             to authenticated, anon;
grant select                          on table items              to authenticated, anon;
grant select                          on table config             to authenticated, anon;
