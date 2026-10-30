-- What: Add list_entries to the supabase_realtime publication so cross-session
--       Realtime delivery works. Newer Supabase CLI versions don't auto-include
--       all tables via FOR ALL TABLES; older versions did. The DO-block guard
--       makes this idempotent on both stack variants.
-- Why: Trace evidence in PR 26 CI run #24966654227 confirmed list_entries was
--      not in the publication on this CI's local stack — the cross-session E2E
--      observed no row delivery despite a successful admin INSERT.
-- Does NOT: Touch any table data, RLS, or columns. Type generation produces no
--           diff for publication membership; ci-type-drift.sh is a no-op for
--           this migration.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'list_entries'
  ) then
    alter publication supabase_realtime add table list_entries;
  end if;
end $$;

-- ROLLBACK:
-- alter publication supabase_realtime drop table list_entries;
