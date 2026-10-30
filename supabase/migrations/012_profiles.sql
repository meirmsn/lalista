-- 012_profiles.sql
--
-- Adds a `profiles` table mirroring `auth.users` 1:1, with the user's chosen
-- display name. Replaces the pre-existing "added by someone" literal
-- fallback: `fetchListEntries` now joins `profiles` on `list_entries.added_by`
-- and hydrates `addedByName` so UI can render the real name when available
-- and keep falling back to "someone" when the join returns null (user deleted
-- via migration 009's ON DELETE SET NULL, or RLS boundary — household-member
-- scope excludes any stranger profiles).
--
-- Why a dedicated table (not `raw_user_meta_data`):
--   - RLS-policy-friendly: we can scope reads to household members without
--     granting blanket access to auth.users.
--   - Queryable/joinable from PostgREST via the FK chain
--     list_entries.added_by -> auth.users.id <- profiles.user_id.
--   - Mutable from the client without the /auth/v1 user-update endpoint.
--
-- Trigger sources the initial display_name from
-- `raw_user_meta_data.display_name` (set when the sign-up form includes a
-- "Your name" value) and falls back to the email local-part
-- (`split_part(email, '@', 1)`) when that is empty/missing.
--
-- See `specs/ci-slow-job/spec.md § Data model changes` for the full rationale.

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Bounded length as defense-in-depth against storage bloat + UI layout
  -- break. 80 chars covers real names (see Guinness entries at 747) without
  -- inviting a user to paste a megabyte. The UI also sets `maxLength={80}`;
  -- this CHECK is the server-side backstop.
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Own-row: read + write. (No insert policy — trigger is the only writer of
-- new rows; see handle_new_user below. Inserts from the client would bypass
-- the trigger's security-definer wrapper and violate least-privilege.)
create policy "profiles_select_own" on profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy "profiles_update_own" on profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Household-member read: see display names of anyone in any of my households.
-- Explicit self-join on household_members so the policy admits "me" whenever
-- profile.user_id shares ANY household with auth.uid().
create policy "profiles_select_household" on profiles
  for select to authenticated
  using (
    exists (
      select 1
      from household_members hm_self
      join household_members hm_other
        on hm_other.household_id = hm_self.household_id
      where hm_self.user_id = auth.uid()
        and hm_other.user_id = profiles.user_id
    )
  );

-- Trigger: auto-create a profile row whenever a new auth.users row is
-- inserted (the sign-up path). `security definer` bypasses RLS so the row
-- is written regardless of the caller's policies; the fixed search_path
-- prevents search-path-injection attacks from hijacking the insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Truncate to the CHECK-constraint ceiling so a sign-up form that
  -- bypasses the client-side maxLength (attacker-crafted raw_user_meta_data)
  -- doesn't fail the trigger's insert and leave the user in a weird
  -- half-created state. left() is null-safe via coalesce below.
  insert into profiles (user_id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
        split_part(new.email, '@', 1)
      ),
      80
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill existing users. Uses email local-part as the default
-- display_name; users can update later via Settings. `on conflict ... do
-- nothing` makes the migration idempotent in case the trigger fired mid-
-- migration for a just-created user.
-- Backfill uses the same left(..., 80) truncation as the trigger so an
-- existing user with an 80+ char email local-part doesn't fail the CHECK.
insert into profiles (user_id, display_name)
select id, left(split_part(email, '@', 1), 80)
from auth.users
on conflict (user_id) do nothing;

-- ROLLBACK:
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop policy if exists "profiles_select_household" on profiles;
-- drop policy if exists "profiles_update_own" on profiles;
-- drop policy if exists "profiles_select_own" on profiles;
-- drop table if exists profiles;
