// What: List entry read + delete + mark-bought operations
// Why: UI reads the grocery list and marks items bought; all writes go through RPC
// Does NOT: Write purchase_history directly (RLS blocks it — use mark_item_bought RPC)

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import type { HydratedListEntry, ListEntryStatus } from '../models';

type Client = SupabaseClient<Database>;

/**
 * Thrown by `fetchListEntries` when the response carries `currentHouseholdId
 * === null` — i.e. the caller has been removed from their household and the
 * RLS-bound REST surface has flipped, but the client's Supabase Realtime
 * channel hasn't yet been notified. The caller (`<ListClient>`) catches
 * this, tears down the realtime channel, and redirects to
 * `/onboarding?removed=1` (D6/A4 — bounds the leak window to ~1 round-trip).
 */
export class RemovedFromHouseholdError extends Error {
  constructor() {
    super('removed from household');
    this.name = 'RemovedFromHouseholdError';
  }
}

/**
 * Response shape from `fetchListEntries`. The `currentHouseholdId` thread is
 * load-bearing for the realtime leak-window mitigation in D6 — the caller
 * uses null detection to trigger the redirect.
 */
export interface ListEntriesResult {
  entries: HydratedListEntry[];
  currentHouseholdId: string | null;
}

/**
 * Fetch `profiles.display_name` for a set of user ids, returning a
 * userId -> displayName map. Missing rows (unknown user, or one outside
 * the caller's RLS scope) are simply absent from the map — callers branch
 * on `undefined` and fall back to the null path.
 *
 * Why a second query rather than a PostgREST join: the natural join chain is
 * list_entries.added_by -> auth.users.id <- profiles.user_id, which PostgREST
 * cannot express as a single nested select (auth.* is a different schema,
 * and PostgREST's relationship inference is scoped to public). Declaring a
 * direct FK from list_entries.added_by -> profiles.user_id would couple
 * migration 012 (profiles) to migration 009's ON DELETE SET NULL semantics,
 * which is a worse tradeoff than one extra round-trip per list fetch.
 * (D21 documented this fallback path — reached during implementation.)
 *
 * Resilience: if the `profiles` table is missing entirely (e.g. migration 012
 * hasn't been applied to this environment yet — the "front-end ships before
 * migration pushes to prod" window in the rollout plan, or a rolled-back
 * migration), returns an empty map rather than throwing. That preserves the
 * "null `addedByName` → UI renders 'someone'" fallback invariant instead of
 * breaking the entire list view on a missing optional column. Real errors
 * (RLS denial, network failure) still propagate.
 */
async function fetchDisplayNamesByUserId(
  client: Client,
  userIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;

  const { data, error } = await client
    .from('profiles')
    .select('user_id, display_name')
    .in('user_id', userIds);

  if (error) {
    // PGRST205 = "relation does not exist" (the profiles table itself is missing).
    // Treat as an empty hydration — UI falls back to 'someone'. Anything else
    // (RLS denial = PGRST301/42501, network error, etc.) is a real failure that
    // should surface.
    if (error.code === 'PGRST205') return map;
    throw error;
  }
  for (const row of data ?? []) {
    map.set(row.user_id, row.display_name);
  }
  return map;
}

/**
 * Fetch active list entries for a household, joined with item and store names
 * and hydrated with each author's `profiles.display_name`. Pass status to
 * filter; defaults to 'pending' (active list).
 *
 * Returns `{ entries, currentHouseholdId }` — `currentHouseholdId` reads the
 * `current_household_id()` migration-001 helper to detect the
 * removed-from-household state (D6/A4): when it returns null, the caller has
 * been removed but their realtime channel may still be emitting. We throw
 * `RemovedFromHouseholdError` so the caller's catch branch can tear down the
 * channel + redirect to `/onboarding?removed=1`.
 */
export async function fetchListEntries(
  client: Client,
  householdId: string,
  status: ListEntryStatus = 'pending'
): Promise<ListEntriesResult> {
  // Probe current_household_id() FIRST — if it returns null the caller has
  // already been kicked out of their household and the list query would
  // either return [] (RLS-filtered to zero rows) or fail noisily; either
  // way the page-level caller wants to redirect to /onboarding?removed=1
  // before showing stale data. Bound the leak to ~1 round-trip per D6/A4.
  const { data: currentHouseholdId, error: chErr } = await client.rpc(
    'current_household_id'
  );
  if (chErr) throw chErr;
  if (currentHouseholdId === null) {
    throw new RemovedFromHouseholdError();
  }

  const { data, error } = await client
    .from('list_entries')
    .select(
      'id, household_id, item_id, store_id, brand, quantity, unit, status, added_at, added_by, items(name_canonical), stores(name)'
    )
    .eq('household_id', householdId)
    .eq('status', status)
    .order('added_at', { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  const authorIds = Array.from(
    new Set(
      rows
        .map((r) => r.added_by)
        .filter((id): id is string => typeof id === 'string')
    )
  );
  const nameByUserId = await fetchDisplayNamesByUserId(client, authorIds);

  return {
    entries: rows.map((row) => ({
      id: row.id,
      householdId: row.household_id,
      itemId: row.item_id,
      itemName: row.items?.name_canonical ?? '',
      storeId: row.store_id,
      storeName: row.stores?.name ?? '',
      brand: row.brand,
      quantity: row.quantity,
      unit: row.unit,
      status: row.status as ListEntryStatus,
      addedAt: row.added_at,
      addedBy: row.added_by,
      addedByName: row.added_by
        ? (nameByUserId.get(row.added_by) ?? null)
        : null,
    })),
    currentHouseholdId,
  };
}

/**
 * Fetch a single list entry by id, joined with item and store names. Returns
 * null when the row isn't found so pages can render a clean 404 instead of
 * throwing on a PGRST116 "no rows" error.
 */
export async function fetchListEntryById(
  client: Client,
  entryId: string
): Promise<HydratedListEntry | null> {
  const { data, error } = await client
    .from('list_entries')
    .select(
      'id, household_id, item_id, store_id, brand, quantity, unit, status, added_at, added_by, items(name_canonical), stores(name)'
    )
    .eq('id', entryId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const nameByUserId = data.added_by
    ? await fetchDisplayNamesByUserId(client, [data.added_by])
    : null;

  return {
    id: data.id,
    householdId: data.household_id,
    itemId: data.item_id,
    itemName: data.items?.name_canonical ?? '',
    storeId: data.store_id,
    storeName: data.stores?.name ?? '',
    brand: data.brand,
    quantity: data.quantity,
    unit: data.unit,
    status: data.status as ListEntryStatus,
    addedAt: data.added_at,
    addedBy: data.added_by,
    addedByName:
      data.added_by && nameByUserId
        ? (nameByUserId.get(data.added_by) ?? null)
        : null,
  };
}

/** Mark a list entry as bought. Uses the mark_item_bought RPC — never direct writes. */
export async function markItemBought(
  client: Client,
  entryId: string
): Promise<void> {
  const { error } = await client.rpc('mark_item_bought', {
    p_entry_id: entryId,
  });
  if (error) throw error;
}

/** Remove a list entry (soft-delete is not modeled in schema; hard delete). */
export async function deleteListEntry(
  client: Client,
  entryId: string
): Promise<void> {
  const { error } = await client
    .from('list_entries')
    .delete()
    .eq('id', entryId);
  if (error) throw error;
}
