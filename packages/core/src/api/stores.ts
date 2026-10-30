// What: Store directory queries — global catalog + per-household My Stores
//       membership (migration 016).
// Why: Add-item flow needs the visible-to-caller catalog for disambiguation;
//      Settings + AddItemSheet pickers need the household's My Stores +
//      autocomplete suggestions; SECURITY DEFINER RPCs cover add/remove writes.
// Does NOT: Mutate `stores` directly (no client INSERT/UPDATE/DELETE policy on
//           that table — all custom-create flows through `add_household_store`).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import type { Store } from '../models';
import { throwMappedStoreError } from './storeErrors';

type Client = SupabaseClient<Database>;

/**
 * Fetch all stores VISIBLE to the caller (Model B RLS — globals + own customs),
 * ordered by name. Existing consumer for admin/ops scripts; UI surfaces should
 * prefer `fetchMyStores` (caller's My Stores) or `fetchStoreCatalogSuggestions`
 * (autocomplete).
 */
export async function fetchStores(client: Client): Promise<Store[]> {
  const { data, error } = await client.from('stores').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch the caller's My Stores via the household_stores join. Ordered by store
 * name ascending. Reads through RLS — the `household_stores_select` policy
 * (migration 016) scopes to the caller's household.
 */
export async function fetchMyStores(client: Client): Promise<Store[]> {
  const { data, error } = await client
    .from('household_stores')
    .select('stores(*)');
  if (error) throw error;
  // PostgREST returns rows of shape `{ stores: Store | null }` for an inner
  // join. Flatten, drop any nulls (defensive — should not happen given the
  // FK), and sort by name asc.
  const stores: Store[] = ((data ?? []) as Array<{ stores: Store | null }>)
    .map((row) => row.stores)
    .filter((s): s is Store => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return stores;
}

/**
 * Autocomplete: fuzzy-matches against the catalog VISIBLE to the caller
 * (globals + own customs under Model B RLS). Returns up to 5 results, ranked
 * by `similarity(name, query) desc, name asc`. The fuzzy threshold (D6) lives
 * in the `config` row `store_name_match_threshold` and is enforced via the
 * `pg_trgm` `%` operator: callers above this threshold are returned; the UI's
 * "Add new store" CTA gate uses `results.length === 0` as the signal that no
 * suggestion crossed the threshold.
 *
 * For empty / blank queries, returns the empty array without hitting the
 * database.
 */
export async function fetchStoreCatalogSuggestions(
  client: Client,
  query: string
): Promise<Store[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // Fetch a small ILIKE candidate set; the authoritative similarity check
  // happens server-side inside `add_household_store` (D6's
  // `store_name_match_threshold`, default 0.6, runtime-tunable via the
  // `config` row). Client-side we don't have pg_trgm, so ILIKE substring
  // matching is the closest approximation — accepted because (a) the
  // catalog stays small (3 globals + 1-2 customs per household), and (b)
  // the CTA-gate decision uses `results.length === 0`, not a numerical
  // threshold comparison. PostgREST can't compute `similarity()` inline,
  // so we don't fetch the threshold from `config` here — the RPC reads it.
  const { data, error } = await client
    .from('stores')
    .select('*')
    .ilike('name', `%${trimmed}%`)
    .order('name')
    .limit(20);
  if (error) throw error;
  return (data ?? []).slice(0, 5);
}

/**
 * Add a store to caller's My Stores. Pass either an existing `storeId` OR a
 * `name` (custom-create branch). Returns the resolved storeId + a flag
 * indicating whether a new catalog row was minted.
 *
 * Throws `StoreRpcError` for P0001 errors mapped per `storeErrors.ts`:
 * - `'not_member'` — caller is not in a household.
 * - `'unknown_store'` — neither `storeId` nor `name` was provided.
 * - `'name_invalid'` — `name` was empty after trim, or > 60 chars.
 *
 * Tier A1 (Settings) / Tier A2 (AddItemSheet) latency wiring per D10 — the
 * caller wraps the call in `useOptimisticMutation`.
 */
export async function addHouseholdStore(
  client: Client,
  args: { storeId?: string; name?: string }
): Promise<{ storeId: string; wasCreated: boolean }> {
  const { data, error } = await client.rpc('add_household_store', {
    p_store_id: args.storeId,
    p_name: args.name,
  });
  if (error) throwMappedStoreError(error);
  const row = (data ?? [])[0];
  if (!row) throw new Error('add_household_store returned no row');
  return { storeId: row.store_id, wasCreated: row.was_created };
}

/**
 * Remove a store from caller's My Stores. Idempotent: removing a non-membership
 * row is a no-op (no error). Catalog row is untouched — existing `list_entries`
 * and `purchase_history` referencing the store remain readable.
 *
 * Throws `StoreRpcError` for P0001 errors mapped per `storeErrors.ts` (only
 * `'not_member'` is currently raised by this RPC).
 */
export async function removeHouseholdStore(
  client: Client,
  storeId: string
): Promise<void> {
  const { error } = await client.rpc('remove_household_store', {
    p_store_id: storeId,
  });
  if (error) throwMappedStoreError(error);
}
