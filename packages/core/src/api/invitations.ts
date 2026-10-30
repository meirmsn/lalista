// What: Supabase wrappers for the household-invitations RPCs (migration 015).
// Why: UI surfaces (Settings / /join/[token]) need a typed surface for
//      create / list / revoke / accept; ALL writes go through SECURITY
//      DEFINER RPCs so RLS-bypass stays auditable. URL building is centralized
//      here so the `NEXT_PUBLIC_SITE_URL ?? window.location.origin` rule
//      from D5 has one definition.
// Does NOT: Read mutable data outside its own table — `fetchPendingInvites`
//           uses RLS-scoped SELECT; everything else is RPC.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import { throwMappedInviteError } from './inviteErrors';

type Client = SupabaseClient<Database>;

/** Pending invite as surfaced in Settings → Members → Pending invites. */
export interface Invite {
  id: string;
  token: string;
  /** Computed: `${siteUrl}/join/<token>`. Built client-side per D5. */
  url: string;
  expiresAt: string;
  createdAt: string;
}

/** Just-created invite returned from `createInvite` for the InviteLinkSheet. */
export interface CreatedInvite {
  token: string;
  url: string;
  expiresAt: string;
}

/**
 * Resolve the site origin per D5. NEXT_PUBLIC_SITE_URL is operator-set on
 * Vercel Production ONLY (preview falls through to window.location.origin
 * because preview URLs are ephemeral and a 7-day link from a preview deploy
 * would 404 by the time the invitee confirms).
 *
 * SSR-safe: when `window` is undefined (server), require the env var or
 * fall back to a placeholder that the caller's URL will look obviously
 * wrong with — better to have a visible URL bug than to silently emit a
 * link that 404s.
 */
function resolveSiteOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  // Last-resort SSR-no-env fallback. Keep visible-broken rather than
  // pretending to work (e.g., `http://localhost`) — the URL won't resolve
  // for a real invitee, and that's the right surface to debug from.
  return '';
}

/** Build the `/join/<token>` URL using D5 origin resolution. */
function buildInviteUrl(token: string): string {
  const origin = resolveSiteOrigin();
  return `${origin}/join/${encodeURIComponent(token)}`;
}

/**
 * Owner-only. Calls `create_invite()` RPC, builds the URL client-side,
 * returns the bundle. The RPC enforces ownership via `auth.uid()` +
 * `role = 'owner'` (migration 015) — UI doesn't need to pre-check.
 */
export async function createInvite(client: Client): Promise<CreatedInvite> {
  const { data: token, error } = await client.rpc('create_invite');
  if (error) throwMappedInviteError(error);
  if (!token) throw new Error('create_invite returned no token');

  // Look up expires_at separately so the InviteLinkSheet can render a real
  // "expires in 7 days" caption tied to the row's timestamp.
  const { data: row, error: selErr } = await client
    .from('household_invitations')
    .select('expires_at')
    .eq('token', token)
    .single();
  if (selErr) throw selErr;

  return {
    token,
    url: buildInviteUrl(token),
    expiresAt: row.expires_at,
  };
}

/**
 * List pending invitations for the caller's household. RLS SELECT
 * `household_invitations_select` filters to `used_at IS NULL` AND
 * `household_id IN (caller's households)`.
 */
export async function fetchPendingInvites(client: Client): Promise<Invite[]> {
  const { data, error } = await client
    .from('household_invitations')
    .select('id, token, expires_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    token: row.token,
    url: buildInviteUrl(row.token),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/**
 * Owner-only. Calls `revoke_invite(invite_id)` RPC. Maps `P0001 'invite not
 * found or already used'` → `InviteError 'not_found_or_used'`.
 */
export async function revokeInvite(
  client: Client,
  inviteId: string
): Promise<void> {
  const { error } = await client.rpc('revoke_invite', {
    p_invite_id: inviteId,
  });
  if (error) throwMappedInviteError(error);
}

/**
 * Calls `accept_invite(token)` RPC. Returns the `household_id` the user just
 * joined. Maps:
 * - `P0001 'already in a household'` → `'already_in_household'`
 * - `P0001 'invite invalid or expired'` → `'expired_or_invalid'`
 * - `23505` (unique-constraint race, D7) → `'already_in_household'`
 */
export async function acceptInvite(
  client: Client,
  token: string
): Promise<string> {
  const { data, error } = await client.rpc('accept_invite', { p_token: token });
  if (error) throwMappedInviteError(error);
  if (!data) throw new Error('accept_invite returned no household_id');
  return data;
}
