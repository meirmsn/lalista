-- Migration 015: household-collaborators
--
-- Adds the share/invite loop on top of the existing households + household_members
-- + role columns (migrations 001 + 008). Two new tables, six new SECURITY DEFINER
-- RPCs, and one DB-layer single-household v0 invariant.
--
-- v0 invariant (drop in v1+ multi-household chapter):
--   household_members.household_members_one_per_user_v0 — UNIQUE(user_id)
--   When v1 ships multi-household, drop this constraint AND audit every RLS
--   subquery against household_members for `user_id = auth.uid()` semantics.

-- 1. household_invitations
create table household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  token text not null unique,                         -- 32-char URL-safe random
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,                    -- created_at + 7 days
  used_at timestamptz,                                -- null = pending
  used_by uuid references auth.users(id) on delete set null
);

create index on household_invitations (household_id) where used_at is null;
create index on household_invitations (token) where used_at is null;
-- A2.c FK indexes
create index on household_invitations (created_by);
create index on household_invitations (used_by);

alter table household_invitations enable row level security;

-- Members see only PENDING invitations of their household. Used invites are
-- visible only via household_audit_events (canonical post-hoc store).
-- A2.b: wrap auth.uid() in (select auth.uid()) for planner caching.
create policy "household_invitations_select" on household_invitations
  for select using (
    used_at is null
    and household_id in (
      select household_id from household_members where user_id = (select auth.uid())
    )
  );

-- No client INSERT/UPDATE/DELETE policies — all writes via SECURITY DEFINER
-- RPCs below. Default-deny for the authenticated role.

-- 2. household_audit_events (no metadata jsonb — every event has dedicated cols)
create table household_audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'invite_created', 'invite_revoked', 'invite_used',
    'member_removed', 'member_left', 'household_renamed'
  )),
  target_user_id uuid references auth.users(id) on delete set null,
  invite_id uuid references household_invitations(id) on delete set null,
  old_name text,                                      -- only for household_renamed
  new_name text,                                      -- only for household_renamed
  created_at timestamptz not null default now()
);

create index on household_audit_events (household_id, created_at desc);
-- A2.c FK indexes
create index on household_audit_events (actor_user_id);
create index on household_audit_events (target_user_id);
create index on household_audit_events (invite_id);

alter table household_audit_events enable row level security;

-- A2.b: wrap auth.uid() in (select auth.uid()) for planner caching.
create policy "household_audit_events_select" on household_audit_events
  for select using (
    household_id in (select household_id from household_members where user_id = (select auth.uid()))
  );
-- Writes: SECURITY DEFINER RPCs only.

-- 3. Single-household v0 invariant (A3 / D7).
-- LOAD-BEARING(do-not-remove without v1 plan): backstops the application-layer
-- "already in household" check in accept_invite against the two-tab race.
-- 23505 from this constraint maps to InviteError 'already_in_household' in
-- API wrappers and is caught by OnboardingForm to bounce the user to /list.
alter table household_members
  add constraint household_members_one_per_user_v0 unique (user_id);

comment on constraint household_members_one_per_user_v0 on household_members is
  'v0 single-household invariant: a user belongs to at most one household. '
  'Drop this constraint when v1 multi-household ships, and audit every RLS '
  'subquery against household_members for user_id = auth.uid() semantics.';

-- 4. RPCs (6 total — every owner action + invitee acceptance + helper)
-- A1: revoke from public + revoke execute from anon + grant to authenticated/service_role
-- A2.a: search_path = public, pg_temp on every function

-- Helper: is the caller the owner of this household?
create or replace function is_household_owner(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from household_members
    where household_id = p_household_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;
revoke all on function is_household_owner(uuid) from public;
revoke execute on function is_household_owner(uuid) from anon;
grant execute on function is_household_owner(uuid) to authenticated, service_role;

-- create_invite: owner-only, returns the token (client builds the URL)
create or replace function create_invite()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
  v_token text;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select household_id into v_household_id
    from household_members where user_id = v_user and role = 'owner';
  if v_household_id is null then
    raise exception 'only owners can create invites' using errcode = '42501';
  end if;

  -- Note: gen_random_bytes() ships in pgcrypto, which Supabase installs into
  -- the `extensions` schema. Our search_path is `public, pg_temp` (D11.a) so
  -- we qualify the call explicitly rather than widening the search_path —
  -- keeps the search_path tight (no accidental shadowing of public functions
  -- by extension functions) and prevents prod from breaking when pgcrypto
  -- isn't on the function-level path.
  v_token := encode(extensions.gen_random_bytes(24), 'base64');
  v_token := replace(replace(replace(v_token, '+', '-'), '/', '_'), '=', '');

  insert into household_invitations (household_id, token, created_by, expires_at)
    values (v_household_id, v_token, v_user, now() + interval '7 days');

  insert into household_audit_events (household_id, actor_user_id, event_type, invite_id)
    select v_household_id, v_user, 'invite_created', id
      from household_invitations where token = v_token;

  return v_token;
end;
$$;
revoke all on function create_invite() from public;
revoke execute on function create_invite() from anon;
grant execute on function create_invite() to authenticated, service_role;

-- revoke_invite: owner-only, deletes pending invite (RLS DELETE policy not needed —
-- we use SECURITY DEFINER instead of relying on a delete policy, for consistency).
create or replace function revoke_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select household_id into v_household_id
    from household_invitations where id = p_invite_id and used_at is null;
  if v_household_id is null then
    raise exception 'invite not found or already used' using errcode = 'P0001';
  end if;
  if not is_household_owner(v_household_id) then
    raise exception 'only owners can revoke invites' using errcode = '42501';
  end if;

  -- Insert audit BEFORE delete so the FK reference (on delete set null) is
  -- satisfied at insert time. Doing this in the reverse order would FK-fail
  -- (23503) because at audit-insert time the referenced row would already be
  -- gone — `on delete set null` only fires on rows that already point at the
  -- deleted row, not on inserts of new rows pointing at a deleted target.
  -- The audit event row itself will end up with invite_id = NULL after the
  -- delete cascades (set-null), preserving the "we revoked invite X" record
  -- via event_type without leaking the now-deleted FK reference.
  insert into household_audit_events (household_id, actor_user_id, event_type, invite_id)
    values (v_household_id, v_user, 'invite_revoked', p_invite_id);
  delete from household_invitations where id = p_invite_id;
end;
$$;
revoke all on function revoke_invite(uuid) from public;
revoke execute on function revoke_invite(uuid) from anon;
grant execute on function revoke_invite(uuid) to authenticated, service_role;

-- accept_invite: invitee acceptance. Race-safe via FOR UPDATE row lock.
-- Postgres semantics under READ COMMITTED: when transaction T2 blocks on
-- the row lock T1 holds, then T1 commits (setting used_at = now()), T2's
-- EvaluatePlanQual (EPQ) re-applies the WHERE clause to the now-updated
-- row version. The `used_at IS NULL` predicate fails on the updated row,
-- T2's SELECT returns zero rows, and the `not found` branch fires. So:
-- two concurrent acceptances of the same token → one succeeds, one gets
-- `P0001 'invite invalid or expired'`. Do NOT remove the FOR UPDATE.
create or replace function accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_invite household_invitations%rowtype;
  v_user uuid := auth.uid();
  v_existing_household uuid;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select household_id into v_existing_household
    from household_members where user_id = v_user limit 1;
  if v_existing_household is not null then
    raise exception 'already in a household' using errcode = 'P0001';
  end if;

  -- LOAD-BEARING(do-not-remove): FOR UPDATE — Postgres EPQ semantics back the single-use guarantee
  select * into v_invite from household_invitations
    where token = p_token and used_at is null and expires_at > now()
    for update;
  if not found then
    raise exception 'invite invalid or expired' using errcode = 'P0001';
  end if;

  insert into household_members (household_id, user_id, role)
    values (v_invite.household_id, v_user, 'member');
  update household_invitations set used_at = now(), used_by = v_user
    where id = v_invite.id;
  insert into household_audit_events (household_id, actor_user_id, event_type, target_user_id, invite_id)
    values (v_invite.household_id, v_user, 'invite_used', v_user, v_invite.id);

  return v_invite.household_id;
end;
$$;
revoke all on function accept_invite(text) from public;
revoke execute on function accept_invite(text) from anon;
grant execute on function accept_invite(text) to authenticated, service_role;

-- remove_member: owner-only, cannot remove self (use leave_household).
create or replace function remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;
  if p_user_id = v_user then
    raise exception 'use leave_household to remove yourself' using errcode = 'P0001';
  end if;

  select household_id into v_household_id
    from household_members where user_id = p_user_id;
  if v_household_id is null then
    raise exception 'member not found' using errcode = 'P0001';
  end if;
  if not is_household_owner(v_household_id) then
    raise exception 'only owners can remove members' using errcode = '42501';
  end if;

  delete from household_members where household_id = v_household_id and user_id = p_user_id;
  insert into household_audit_events (household_id, actor_user_id, event_type, target_user_id)
    values (v_household_id, v_user, 'member_removed', p_user_id);
end;
$$;
revoke all on function remove_member(uuid) from public;
revoke execute on function remove_member(uuid) from anon;
grant execute on function remove_member(uuid) to authenticated, service_role;

-- leave_household: any member, blocks last-member orphaning. Owner cannot
-- leave in v0 (would orphan; ownership transfer is v1+).
create or replace function leave_household()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
  v_role text;
  v_count int;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select household_id, role into v_household_id, v_role
    from household_members where user_id = v_user;
  if v_household_id is null then
    raise exception 'not in a household' using errcode = 'P0001';
  end if;
  if v_role = 'owner' then
    raise exception 'owner cannot leave (transfer ownership first — v1 feature)' using errcode = 'P0001';
  end if;

  select count(*) into v_count from household_members where household_id = v_household_id;
  if v_count <= 1 then
    raise exception 'cannot orphan household' using errcode = 'P0001';
  end if;

  delete from household_members where household_id = v_household_id and user_id = v_user;
  insert into household_audit_events (household_id, actor_user_id, event_type, target_user_id)
    values (v_household_id, v_user, 'member_left', v_user);
end;
$$;
revoke all on function leave_household() from public;
revoke execute on function leave_household() from anon;
grant execute on function leave_household() to authenticated, service_role;

-- rename_household: owner-only. Note: there is intentionally NO client UPDATE
-- policy on `households` (verified — migration 001 has only households_select).
-- All writes to households.name go through this RPC, which is SECURITY DEFINER
-- and bypasses RLS. Spec author: do NOT add a redundant UPDATE policy.
create or replace function rename_household(p_new_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_household_id uuid;
  v_old_name text;
begin
  if v_user is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  p_new_name := nullif(trim(p_new_name), '');
  if p_new_name is null or length(p_new_name) > 60 then
    raise exception 'name must be 1-60 chars' using errcode = 'P0001';
  end if;

  select household_id into v_household_id
    from household_members where user_id = v_user and role = 'owner';
  if v_household_id is null then
    raise exception 'only owners can rename' using errcode = '42501';
  end if;

  select name into v_old_name from households where id = v_household_id;
  update households set name = p_new_name where id = v_household_id;
  insert into household_audit_events (household_id, actor_user_id, event_type, old_name, new_name)
    values (v_household_id, v_user, 'household_renamed', v_old_name, p_new_name);
end;
$$;
revoke all on function rename_household(text) from public;
revoke execute on function rename_household(text) from anon;
grant execute on function rename_household(text) to authenticated, service_role;

-- Tell PostgREST to reload its schema cache so the new RPCs are callable
-- via the rest API immediately on deploy. (Migration 008 pattern.)
notify pgrst, 'reload schema';

-- ROLLBACK:
-- -- Drop the 6 RPCs (function signatures must match the CREATE OR REPLACE forms above).
-- drop function if exists public.rename_household(text);
-- drop function if exists public.leave_household();
-- drop function if exists public.remove_member(uuid);
-- drop function if exists public.accept_invite(text);
-- drop function if exists public.revoke_invite(uuid);
-- drop function if exists public.create_invite();
-- drop function if exists public.is_household_owner(uuid);
-- -- Drop the v0 single-household invariant. After this, two members per
-- -- user is allowed at the DB level — application-layer checks become the
-- -- only line of defense, so verify nothing depends on the constraint
-- -- before running this rollback.
-- alter table public.household_members drop constraint if exists household_members_one_per_user_v0;
-- -- Drop the two new tables. CASCADE chases dependent rows, FKs, and the
-- -- RLS policies attached to them — no manual policy drops needed.
-- drop table if exists public.household_audit_events cascade;
-- drop table if exists public.household_invitations cascade;
-- notify pgrst, 'reload schema';
