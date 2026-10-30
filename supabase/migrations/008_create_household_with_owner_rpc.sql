-- Atomic household + owner-membership creation.
--
-- Why this exists: the prior two-insert pattern in `createHousehold` (insert
-- household → insert membership) hit PostgREST's INSERT+RETURNING behavior.
-- PostgREST requires the SELECT RLS policy to pass on the returned row;
-- `households_select` requires the caller be a household member, which they
-- aren't yet at INSERT time, so the RETURNING failed with a 403 RLS violation
-- and the second insert never ran. Every new user was blocked at onboarding.
--
-- Mirrors the `mark_item_bought` pattern: a SECURITY DEFINER function that
-- wraps multi-table writes in a single transaction, validates identity via
-- auth.uid(), and returns only the new id (callers SELECT full rows
-- afterward — legal because the membership row exists by then).

create or replace function public.create_household_with_owner(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into households (name)
    values (p_name)
    returning id into v_household_id;

  insert into household_members (household_id, user_id, role)
    values (v_household_id, v_user_id, 'owner');

  return v_household_id;
end;
$$;

-- Tighten the default grant. Supabase's default `ALTER DEFAULT PRIVILEGES`
-- grants EXECUTE to anon + authenticated + service_role for new public
-- functions; REVOKE FROM public alone doesn't strip those explicit grants.
-- Revoke from each role that shouldn't hold it, then grant to authenticated
-- (and service_role, which keeps admin-side callability).
revoke all on function public.create_household_with_owner(text) from public;
revoke execute on function public.create_household_with_owner(text) from anon;
grant execute on function public.create_household_with_owner(text)
  to authenticated, service_role;

-- Refresh PostgREST's schema cache so the RPC becomes callable immediately.
-- (This NOTIFY is harmless when the cache is already fresh.)
notify pgrst, 'reload schema';

-- Post-apply verification (2026-04-20): prosecdef=true,
-- search_path=public,auth; grants = authenticated + service_role +
-- postgres (anon and public excluded).
--
-- Rollback drops the function; the client still has the two-insert
-- fallback path so the feature doesn't break.
--
-- ROLLBACK:
-- drop function if exists public.create_household_with_owner(text);
-- notify pgrst, 'reload schema';

