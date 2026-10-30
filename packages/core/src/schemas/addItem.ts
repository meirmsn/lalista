// What: Runtime Zod schema mirroring the add-item edge function's response shape.
// Why: client.functions.invoke<AddItemResponse>(...) is a compile-time cast
//      only — the Claude-shaped JSON inside the edge function flows through
//      untyped at runtime. A prompt tweak, model swap, or function refactor
//      that drops a field crashes the client at the use-site instead of failing
//      fast at the boundary. This schema is the runtime gate.
// Does NOT: Validate DB queries (generated types + CI drift check cover that),
//      form inputs (HTML5 + Supabase SDK cover that), or the request payload.
//      See /devshop/kit/docs/guide/conventions.md § Runtime Validation at LLM /
//      Edge-Function Boundaries for the convention this implements.

import { z } from 'zod';

/**
 * One candidate option in a disambiguation follow-up.
 * `.passthrough()` so unknown fields don't throw — forward-compat for future
 * server-side additions to a candidate (e.g. confidence, store hint).
 */
export const DisambiguationCandidateSchema = z
  .object({
    id: z.string(),
    label: z.string(),
  })
  .passthrough();

/**
 * Response from the add-item edge function. Either resolved (entry_id present,
 * needs_followup false) or a follow-up prompt with candidate options
 * (needs_followup true). `.passthrough()` on the top-level object so a future
 * server-side field (e.g. PR 7's `entries[]`) doesn't crash older clients.
 */
export const AddItemResponseSchema = z
  .object({
    entry_id: z.string().optional(),
    canonical_item: z
      .object({ id: z.string(), name: z.string() })
      .passthrough()
      .nullable(),
    store: z
      .object({ id: z.string(), name: z.string() })
      .passthrough()
      .nullable(),
    brand: z.string().nullable(),
    needs_followup: z.boolean(),
    followup_type: z.enum(['store', 'item', 'brand', 'quantity']).optional(),
    followup_question: z.string().optional(),
    followup_options: z.array(DisambiguationCandidateSchema).optional(),
    already_on_list: z.boolean().optional(),
    error: z.string().optional(),
    store_confidence: z.number().optional(),
    added_new: z.boolean().optional(),
  })
  .passthrough();
