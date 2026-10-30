// What: Wrapper for the add-item edge function
// Why: UI needs a typed call that models both resolved-add and disambiguation
//      responses, plus a runtime gate at the LLM boundary so a Claude-shape
//      drift (prompt tweak, model swap, schema rename) fails fast at this
//      seam instead of crashing at a downstream use-site.
// Does NOT: Perform local matching, write list_entries directly, or report
//      the validation failure to Sentry — apps catch AddItemValidationError
//      at the call site and route observability there (apps/web's Sentry
//      SDK is the source of truth for capture; @lalista/core stays
//      framework-neutral).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import type { AddItemResponse } from '../models';
import { AddItemResponseSchema } from '../schemas/addItem';
import { AddItemValidationError } from '../errors';

type Client = SupabaseClient<Database>;

export interface AddItemParams {
  utterance: string;
  householdId: string;
  candidateItemId?: string;
  confirmedStoreId?: string;
  confirmedBrand?: string;
  /**
   * When true, the edge function skips NLP/trigram/candidate_item_id
   * resolution and inserts a new `items` row with `name_canonical = utterance`.
   * On unique-violation, the request falls through to the existing-candidate
   * path. Used by the disambig sheet's "Add as new" row.
   */
  forceCreateWithLabel?: boolean;
}

/**
 * Invoke the add-item edge function. Returns either a resolved item
 * (entry_id present, needs_followup false) or a follow-up prompt with
 * candidate options the UI must surface (disambiguation flow).
 *
 * Throws `AddItemValidationError` if the server's response shape doesn't
 * match `AddItemResponseSchema` — the LLM-shape drift case. Throws the
 * Supabase SDK's error on transport / function-runtime failures.
 */
export async function invokeAddItem(
  client: Client,
  params: AddItemParams
): Promise<AddItemResponse> {
  const body = {
    utterance: params.utterance,
    household_id: params.householdId,
    candidate_item_id: params.candidateItemId,
    confirmed_store_id: params.confirmedStoreId,
    confirmed_brand: params.confirmedBrand,
    force_create_with_label: params.forceCreateWithLabel,
  };

  const { data, error } = await client.functions.invoke<unknown>('add-item', {
    body,
  });

  if (error) throw error;
  if (!data) {
    throw new Error('add-item returned an empty response');
  }

  const parsed = AddItemResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new AddItemValidationError(data, parsed.error.issues);
  }
  return parsed.data;
}
