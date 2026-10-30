// What: Household + membership queries used by onboarding + Settings → Household
// Why: First-sign-in flow needs to check membership and create a household;
//      Settings adds rename + leave (members) + the new fetchMyHousehold reader.
// Does NOT: Manage invites (invitations.ts) or audit feed (audit.ts).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import type { Household, HouseholdMember } from '../models';
import { throwMappedInviteError } from './inviteErrors';

type Client = SupabaseClient<Database>;

/** Fetch households the user belongs to. Empty array = needs onboarding. */
export async function fetchUserHouseholds(
  client: Client,
  userId: string
): Promise<Household[]> {
  const { data, error } = await client
    .from('household_members')
    .select('households(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.households as Household | null)
    .filter((h): h is Household => h !== null);
}

/** Fetch membership rows for a user (includes role). */
export async function fetchUserMemberships(
  client: Client,
  userId: string
): Promise<HouseholdMember[]> {
  const { data, error } = await client
    .from('household_members')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

/**
 * Create a household and register the caller as owner. Runs through the
 * `create_household_with_owner` RPC so both inserts land in one transaction
 * and the owner id is derived server-side from `auth.uid()` (caller can't
 * spoof another user). See `supabase/migrations/008_*.sql` for the SQL.
 *
 * A naive two-insert-from-the-client pattern fails here: PostgREST's INSERT
 * RETURNING needs the SELECT RLS policy to pass, but `households_select`
 * requires membership — which doesn't exist until the second insert.
 */
export async function createHousehold(
  client: Client,
  name: string
): Promise<Household> {
  const { data: id, error: rpcError } = await client.rpc(
    'create_household_with_owner',
    { p_name: name }
  );
  if (rpcError) throw rpcError;
  if (!id) throw new Error('create_household_with_owner returned no id');

  // SELECT is legal now: the RPC already inserted the owner membership.
  const { data: household, error: selectError } = await client
    .from('households')
    .select('*')
    .eq('id', id)
    .single();
  if (selectError) throw selectError;
  return household;
}

/**
 * Caller's current household + their role within it. Returns null when the
 * caller is not in any household (the v0 invariant means at most one).
 *
 * Why a dedicated wrapper rather than reusing `fetchUserHouseholds`: Settings
 * + /list header need the role for owner-vs-member rendering branches; the
 * existing `fetchUserHouseholds` only returns the household row, not the
 * membership row's role. Two queries here keep the join shape simple — one
 * for membership (to learn the role + household_id), one for the household
 * row itself.
 */
export interface MyHousehold {
  id: string;
  name: string;
  createdAt: string;
  myRole: 'owner' | 'member';
}

/**
 *
 */
export async function fetchMyHousehold(
  client: Client
): Promise<MyHousehold | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const { data: membership, error: memErr } = await client
    .from('household_members')
    .select('household_id, role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!membership) return null;

  const { data: household, error: hErr } = await client
    .from('households')
    .select('id, name, created_at')
    .eq('id', membership.household_id)
    .single();
  if (hErr) throw hErr;

  return {
    id: household.id,
    name: household.name,
    createdAt: household.created_at,
    myRole: membership.role as 'owner' | 'member',
  };
}

/**
 * Owner-only. Calls `rename_household(p_new_name)` RPC. Maps:
 * - `P0001 'name must be 1-60 chars'` → `InviteError 'name_invalid'`.
 * - `42501` re-thrown verbatim (UI hides the input for non-owners).
 */
export async function renameHousehold(
  client: Client,
  name: string
): Promise<void> {
  const { error } = await client.rpc('rename_household', { p_new_name: name });
  if (error) throwMappedInviteError(error);
}

/**
 * Member-only. Calls `leave_household()` RPC. Maps:
 * - `P0001 'owner cannot leave (transfer ownership first ...)'` →
 *   `InviteError 'owner_cannot_leave'`.
 * - `P0001 'cannot orphan household'` → `InviteError 'cannot_orphan'`.
 * - `P0001 'not in a household'` re-thrown verbatim (defense-in-depth — UI
 *   shouldn't surface this state in normal flows).
 */
export async function leaveHousehold(client: Client): Promise<void> {
  const { error } = await client.rpc('leave_household');
  if (error) throwMappedInviteError(error);
}
