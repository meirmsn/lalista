// What: Supabase wrappers for household_members reads + the remove_member RPC.
// Why: Settings → Members lists the household roster + lets owners remove
//      others; the two-query display-name hydration mirrors the addedByName
//      pattern in items.ts (D13 / C1 — `auth.users` is a different schema, so
//      PostgREST relationship inference doesn't chain through it).
// Does NOT: Insert into household_members (accept_invite RPC owns that),
//           write to profiles, or call leave_household (households.ts owns that).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import { throwMappedInviteError } from './inviteErrors';

type Client = SupabaseClient<Database>;

/**
 * Member-row shape surfaced to UI. `displayName` is null when the profile
 * row is missing or the user was deleted (auth.users on-delete-set-null);
 * UI renders `'someone'` in that case (mirrors `addedByName`).
 */
export interface Member {
  userId: string;
  displayName: string | null;
  role: 'owner' | 'member';
  joinedAt: string;
}

/**
 * List members of caller's household. Two-query hydration:
 *   1. Select household_members rows (RLS scopes to caller's household).
 *   2. Profile-name lookup via `profiles.select('user_id, display_name')
 *      .in('user_id', uniqueUserIds)`.
 *
 * Why two queries instead of a join: the natural chain is
 *   household_members.user_id -> auth.users.id <- profiles.user_id
 * which PostgREST cannot express as a single nested select (auth.* is a
 * different schema; relationship inference is scoped to public). Mirrors
 * the addedByName fallback in items.ts.
 */
export async function fetchMembers(client: Client): Promise<Member[]> {
  const { data, error } = await client
    .from('household_members')
    .select('user_id, role, joined_at')
    .order('joined_at', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  const uniqueIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const nameByUserId = new Map<string, string>();
  if (uniqueIds.length > 0) {
    const { data: profiles, error: profErr } = await client
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', uniqueIds);
    if (profErr) {
      // Same PGRST205 tolerance as items.ts — if the profiles table is
      // missing entirely (rolled-back migration / pre-migration env), fall
      // through to all-null names rather than blowing up the page.
      if (profErr.code !== 'PGRST205') throw profErr;
    } else {
      for (const row of profiles ?? []) {
        if (row.display_name) nameByUserId.set(row.user_id, row.display_name);
      }
    }
  }

  return rows.map((row) => ({
    userId: row.user_id,
    displayName: nameByUserId.get(row.user_id) ?? null,
    role: row.role as 'owner' | 'member',
    joinedAt: row.joined_at,
  }));
}

/**
 * Owner-only. Calls `remove_member(user_id)` RPC. Maps:
 * - `P0001 'use leave_household to remove yourself'` — re-thrown verbatim
 *   (UI should never offer this affordance on the owner's own row, so this
 *   is defense-in-depth; it doesn't fit the typed InviteError union).
 * - `P0001 'member not found'` → `not_found_or_used`.
 * - `42501 'only owners can remove members'` — re-thrown verbatim.
 */
export async function removeMember(
  client: Client,
  userId: string
): Promise<void> {
  const { error } = await client.rpc('remove_member', { p_user_id: userId });
  if (error) throwMappedInviteError(error);
}
