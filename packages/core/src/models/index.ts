// What: Public domain types — aliases over the generated Database schema
// Why: Consumers import Item, Store, etc. without touching the raw Database type
// Does NOT: Define runtime values; pure type re-exports

import type { z } from 'zod';
import type { Tables } from '../supabase.types';
import type {
  AddItemResponseSchema,
  DisambiguationCandidateSchema,
} from '../schemas/addItem';

export type { Database } from '../supabase.types';

export type Item = Tables<'items'>;
export type Store = Tables<'stores'>;
export type Household = Tables<'households'>;
export type HouseholdMember = Tables<'household_members'>;
export type ListEntry = Tables<'list_entries'>;
export type PurchaseHistory = Tables<'purchase_history'>;
export type BrandPreference = Tables<'brand_preferences'>;
export type Profile = Tables<'profiles'>;

export type ListEntryStatus = 'pending' | 'bought';

/** List entry joined with its item and store — shape returned by fetchListEntries. */
export interface HydratedListEntry {
  id: string;
  householdId: string;
  itemId: string;
  itemName: string;
  storeId: string;
  storeName: string;
  brand: string | null;
  quantity: number;
  unit: string | null;
  status: ListEntryStatus;
  addedAt: string;
  /**
   * auth.users(id) of the user who added this entry, or null if that user
   * has since been deleted (migration 009 switched the FK to ON DELETE SET
   * NULL). UI must render an "added by someone" fallback when null.
   */
  addedBy: string | null;
  /**
   * Display name of the user who added this entry, sourced from
   * profiles.display_name via a left join on added_by (see migration 012).
   * Null when added_by is null (the original user was deleted) OR when the
   * profiles row isn't visible to the current caller (RLS boundary — only
   * household-members are readable). UI falls back to "someone" in both
   * cases — rendering code is `entry.addedByName ?? 'someone'`.
   */
  addedByName: string | null;
}

/**
 * One candidate returned by the add-item edge function when NLP is ambiguous.
 * Inferred from the runtime Zod schema (single source of truth — see
 * `schemas/addItem.ts`).
 */
export type DisambiguationCandidate = z.infer<
  typeof DisambiguationCandidateSchema
>;

/**
 * Response from the add-item edge function. Inferred from the runtime Zod
 * schema in `schemas/addItem.ts` so the compile-time type and the runtime
 * validator can't drift. The schema uses `.passthrough()` on objects, so
 * forward-compat fields the server adds in the future flow through without
 * either rejecting at runtime or breaking the type.
 *
 * Notable optional fields (set on specific paths only):
 * - `store_confidence` (0–1) — server-side routing confidence; emitted on
 *   history-routed successes for the `store_routed` telemetry event.
 * - `added_new` — true when the resolution path was force-create (disambig
 *   sheet's "Add as new" row). Tags the `item_added` PostHog event.
 */
export type AddItemResponse = z.infer<typeof AddItemResponseSchema>;
