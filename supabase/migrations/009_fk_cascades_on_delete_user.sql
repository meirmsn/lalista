-- 009_fk_cascades_on_delete_user.sql
-- Rationale: added_by is audit data; preserving the row with unknown attribution
-- beats deleting history when a user leaves. Also prevents the "Database error
-- deleting user" UX in the Supabase dashboard.
-- Pairs with devshop conventions.md § Supabase Hardening Defaults § ON DELETE rule.

alter table list_entries
  alter column added_by drop not null;
alter table list_entries
  drop constraint list_entries_added_by_fkey;
alter table list_entries
  add constraint list_entries_added_by_fkey
    foreign key (added_by) references auth.users(id) on delete set null;

alter table purchase_history
  alter column added_by drop not null;
alter table purchase_history
  drop constraint purchase_history_added_by_fkey;
alter table purchase_history
  add constraint purchase_history_added_by_fkey
    foreign key (added_by) references auth.users(id) on delete set null;

-- Rollback caveat: the `set not null` step fails if any rows have
-- NULL added_by (from a user deletion that fired the new ON DELETE
-- SET NULL semantics, or from seed/test data). The rollback self-
-- cleans by deleting those rows first — DESTRUCTIVE on prod. Before
-- running in prod, decide whether to purge or backfill (copy to an
-- archive table, then delete) based on the business value of rows
-- with unknown attribution.
--
-- ROLLBACK:
-- delete from list_entries where added_by is null;
-- delete from purchase_history where added_by is null;
-- alter table list_entries drop constraint list_entries_added_by_fkey;
-- alter table list_entries alter column added_by set not null;
-- alter table list_entries add constraint list_entries_added_by_fkey
--   foreign key (added_by) references auth.users(id);
-- alter table purchase_history drop constraint purchase_history_added_by_fkey;
-- alter table purchase_history alter column added_by set not null;
-- alter table purchase_history add constraint purchase_history_added_by_fkey
--   foreign key (added_by) references auth.users(id);
