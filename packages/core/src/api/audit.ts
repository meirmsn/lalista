// What: Supabase wrapper for the household_audit_events feed.
// Why: Settings → Activity surfaces the last N state-change events (invite
//      created/used/revoked, member removed/left, household renamed). RLS
//      SELECT scopes to caller's household; display-name hydration mirrors
//      the addedByName two-query pattern (D13/C1) since both actor_user_id
//      and target_user_id FK to auth.users (different schema, can't be a
//      PostgREST nested join).
// Does NOT: Subscribe to realtime — the feed is page-load only by design
//           (spec § Out of scope: "Realtime audit feed updates").

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';

type Client = SupabaseClient<Database>;

/** Discriminated event types from migration 015's CHECK constraint. */
export type AuditEventType =
  | 'invite_created'
  | 'invite_revoked'
  | 'invite_used'
  | 'member_removed'
  | 'member_left'
  | 'household_renamed';

/** Hydrated audit-feed row surfaced to UI. */
export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  actorUserId: string | null;
  /** Null when actor profile is missing or auth.users row is gone — UI renders 'someone'. */
  actorName: string | null;
  targetUserId: string | null;
  /** Null when target profile is missing or auth.users row is gone — UI renders 'someone'. */
  targetName: string | null;
  inviteId: string | null;
  oldName: string | null;
  newName: string | null;
  createdAt: string;
}

/**
 * Fetch the household audit feed (default last 20). Two-query display-name
 * hydration per D13/C1: select audit rows, union actor_user_id +
 * target_user_id into a unique-ids set, then issue one
 * `profiles.select('user_id, display_name').in('user_id', uniqueIds)` call.
 *
 * Do NOT attempt a PostgREST nested join through `auth.users` — it doesn't
 * resolve (auth.* is a different schema). Every consumer of `auth.users.id`
 * via FK in this codebase uses this two-query shape.
 */
export async function fetchHouseholdAudit(
  client: Client,
  limit = 20
): Promise<AuditEvent[]> {
  const { data, error } = await client
    .from('household_audit_events')
    .select(
      'id, event_type, actor_user_id, target_user_id, invite_id, old_name, new_name, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.actor_user_id) ids.add(row.actor_user_id);
    if (row.target_user_id) ids.add(row.target_user_id);
  }

  const nameByUserId = new Map<string, string>();
  if (ids.size > 0) {
    const { data: profiles, error: profErr } = await client
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', Array.from(ids));
    if (profErr) {
      // Same PGRST205 tolerance — keep audit rendering with 'someone'
      // fallbacks rather than throwing on a missing profiles table.
      if (profErr.code !== 'PGRST205') throw profErr;
    } else {
      for (const row of profiles ?? []) {
        if (row.display_name) nameByUserId.set(row.user_id, row.display_name);
      }
    }
  }

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type as AuditEventType,
    actorUserId: row.actor_user_id,
    actorName: row.actor_user_id
      ? (nameByUserId.get(row.actor_user_id) ?? null)
      : null,
    targetUserId: row.target_user_id,
    targetName: row.target_user_id
      ? (nameByUserId.get(row.target_user_id) ?? null)
      : null,
    inviteId: row.invite_id,
    oldName: row.old_name,
    newName: row.new_name,
    createdAt: row.created_at,
  }));
}
