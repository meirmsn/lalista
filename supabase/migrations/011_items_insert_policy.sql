-- Allow authenticated users to INSERT into `items`.
--
-- Background: the original schema (migration 001) gave `items` only an
-- `items_select` policy — no INSERT. That was correct when items were a
-- read-only canonical catalog populated by seed.sql / NLP-resolved trigram
-- matches. PR 5 (disambig-add-new) ships the "Add as new" escape hatch
-- which lets a user insert a brand-new item from the UI when no existing
-- candidate matches their utterance — making INSERT a first-class user
-- action.
--
-- Why a policy, not service-role escalation in the edge function:
-- The narrower fix. Escalating the whole edge function to service_role
-- would let it write any table (purchase_history, list_entries.added_by,
-- etc.) — way larger blast radius than is needed. A scoped table-level
-- policy keeps least-privilege intact and lets future write paths (mobile
-- app, manual scripts) reuse the same flow without re-implementing
-- escalation in every call site.
--
-- Spam concern: any authenticated user can now create new `items` rows.
-- Mitigated by:
--   - the existing `name_canonical text not null unique` constraint
--     (no duplicates of the same name)
--   - the items table holds no privileged data — text + category, no
--     secrets, no per-user state
--   - rate-limiting at the function layer is tracked separately in
--     TODOS.md (`add-item-rate-limit`); applies to all add-item paths,
--     not just force-create
--
-- Cross-household leak: items has no household_id — it's a global
-- namespace. items_select already lets every authenticated user see
-- every item; adding INSERT doesn't widen that surface.

create policy "items_insert" on items
  for insert
  to authenticated
  with check (auth.uid() is not null);

-- ROLLBACK:
-- drop policy if exists "items_insert" on items;
