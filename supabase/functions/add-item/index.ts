// lalista — add-item Edge Function
// Deno/TypeScript, deployed via `supabase functions deploy add-item --no-verify-jwt`
// (see TODOS.md → redeploy-add-item-without-no-verify-jwt)
//
// Single orchestration call from the iOS client (App Intent or FAB).
// Runs server-side in parallel:
//   (a) Claude API NLP normalization — async, non-blocking
//   (b) pg_trgm item match confirmation
//   (c) Deduplication check (same item + store already pending)
//   (d) History-based store routing (time-weighted recency)
//   (e) Brand preference lookup
// Logs every decision to disambiguation_log.
// Returns: { canonical_item, store, brand, needs_followup, followup_question }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface AddItemRequest {
  utterance: string;
  household_id: string;
  candidate_item_id?: string;
  // Disambiguation follow-up answers (if client is confirming a prior needs_followup)
  confirmed_store_id?: string;
  confirmed_brand?: string;
  // User picked "Add as new" in the disambig sheet — bypass NLP/trigram and
  // insert items(name_canonical = utterance) verbatim. See PR 5.
  force_create_with_label?: boolean;
}

interface AddItemResponse {
  entry_id?: string;
  canonical_item: { id: string; name: string } | null;
  store: { id: string; name: string } | null;
  brand: string | null;
  needs_followup: boolean;
  followup_type?: 'store' | 'item' | 'brand' | 'quantity';
  followup_question?: string;
  followup_options?: Array<{ id: string; label: string }>;
  already_on_list?: boolean;
  error?: string;
  // Server-side routing confidence (0–1), only for history-routed paths.
  store_confidence?: number;
  // True when the request was resolved via the force-create branch — the
  // client tags `item_added` PostHog events with `was_force_created: true`.
  added_new?: boolean;
  // D5 (migration 016): set when the silent_match routing decision was
  // downgraded to asked_store because the predicted store isn't in the
  // caller's My Stores. The client fires the `store_routing_fallback_fired`
  // PostHog event off this flag (server-side PostHog post would require a
  // separate ingestion key that's not currently provisioned — TODO
  // server-side-posthog-key).
  store_routing_fallback_fired?: boolean;
  // The predicted-but-removed store_id that triggered the fallback, so the
  // client can include it in the PostHog event properties.
  store_routing_fallback_removed_store_id?: string;
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '') ?? null;
    if (!token) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body: AddItemRequest = await req.json();
    const {
      utterance,
      household_id,
      candidate_item_id,
      confirmed_store_id,
      confirmed_brand,
      force_create_with_label,
    } = body;

    if (!utterance || !household_id) {
      return jsonResponse(
        { error: 'utterance and household_id are required' },
        400
      );
    }

    // -----------------------------------------------------------------------
    // Force-create branch — user picked "Add as new" in the disambig sheet.
    // Bypass NLP / trigram / candidate_item_id resolution; insert the
    // utterance verbatim as `items.name_canonical`. On 23505 unique-violation
    // (race), look up the existing row and proceed via the existing-candidate
    // path. We skip `disambiguation_log` entirely — this is a user override,
    // not an NLP scoring decision worth logging. The auth gate above (lines
    // ~60–76) already covers the request; do not re-check.
    // -----------------------------------------------------------------------
    let forceCreateChosenItem: Item | null = null;
    if (force_create_with_label) {
      // Insert uses the user-context client; RLS policy `items_insert`
      // (migration 011) allows authenticated users to insert. Scoped to the
      // table-level instead of escalating the whole function to service_role
      // — narrower blast radius (admin client can write any table).
      const { data: inserted, error: insertItemError } = await supabase
        .from('items')
        .insert({ name_canonical: utterance })
        .select('id, name_canonical')
        .single();

      if (inserted) {
        forceCreateChosenItem = inserted as Item;
      } else if (insertItemError && insertItemError.code === '23505') {
        // Race: another writer just inserted the same name_canonical.
        // Fall through to the existing-candidate path with the dup row.
        const { data: existingRow } = await supabase
          .from('items')
          .select('id, name_canonical')
          .eq('name_canonical', utterance)
          .single();
        if (!existingRow) {
          return jsonResponse({ error: 'Failed to add item' }, 500);
        }
        forceCreateChosenItem = existingRow as Item;
      } else {
        console.error('items insert error (force-create):', insertItemError);
        return jsonResponse({ error: 'Failed to add item' }, 500);
      }
    }

    // Fetch config thresholds (cached per invocation)
    const { data: configRows } = await supabase
      .from('config')
      .select('key, value');
    const config: Record<string, number> = {};
    for (const row of configRows ?? []) {
      config[row.key] = parseFloat(row.value);
    }
    const itemMatchThreshold = config['item_match_threshold'] ?? 0.85;
    const storeRoutingThreshold = config['store_routing_threshold'] ?? 0.7;

    // chosenItem / matchScore are populated either by the force-create branch
    // (already set above) or by the NLP/trigram/cold-start path below.
    let chosenItem: Item | null = forceCreateChosenItem;
    let matchScore = forceCreateChosenItem ? 1.0 : 0;

    if (!force_create_with_label) {
      // -----------------------------------------------------------------------
      // (a) Claude NLP normalization — fire-and-inform, never blocking
      //     Converts Spanglish utterances to canonical English for pg_trgm match.
      //     We start this concurrently but don't await it before the pg_trgm call.
      //     Result is used if it completes; otherwise we fall back to raw utterance.
      // -----------------------------------------------------------------------
      let nlpNormalizedPromise: Promise<string | null> = Promise.resolve(null);
      if (anthropicKey && !isLikelyEnglish(utterance)) {
        nlpNormalizedPromise = normalizeWithClaude(
          anthropicKey,
          utterance
        ).catch(() => null);
      }

      // -----------------------------------------------------------------------
      // (b) pg_trgm item match — runs in parallel with NLP
      // -----------------------------------------------------------------------
      const rawMatch = findItemByTrigram(
        supabase,
        utterance,
        itemMatchThreshold
      );
      const candidateMatch = candidate_item_id
        ? supabase
            .from('items')
            .select('id, name_canonical')
            .eq('id', candidate_item_id)
            .single()
        : Promise.resolve({ data: null });

      const [rawMatchResult, candidateResult, nlpNormalized] =
        await Promise.all([rawMatch, candidateMatch, nlpNormalizedPromise]);

      // If NLP returned something useful, try matching the normalized form too
      let nlpMatchResult: { data: Item | null; score: number } | null = null;
      if (nlpNormalized && nlpNormalized !== utterance) {
        nlpMatchResult = await findItemByTrigram(
          supabase,
          nlpNormalized,
          itemMatchThreshold
        );
      }

      // If still no confident match, try stripping plural suffix (s / es)
      // so "palmitos" → "palmito", "ziplocs" → "ziploc" at full confidence.
      let depluralMatchResult: { data: Item | null; score: number } | null =
        null;
      if (!rawMatchResult?.data && !nlpMatchResult?.data) {
        const depluralForms: string[] = [];
        if (utterance.endsWith('es'))
          depluralForms.push(utterance.slice(0, -2));
        if (utterance.endsWith('s')) depluralForms.push(utterance.slice(0, -1));
        for (const form of depluralForms) {
          const result = await findItemByTrigram(
            supabase,
            form,
            itemMatchThreshold
          );
          if (result.data) {
            depluralMatchResult = result;
            break;
          }
        }
      }

      // Choose best candidate: candidate_item_id > NLP match > deplural match > raw trigram match
      chosenItem =
        candidateResult.data ??
        (nlpMatchResult?.data &&
        nlpMatchResult.score > (rawMatchResult?.score ?? 0)
          ? nlpMatchResult.data
          : (depluralMatchResult?.data ?? rawMatchResult?.data ?? null));

      matchScore = candidateResult.data
        ? 1.0
        : nlpMatchResult?.data
          ? nlpMatchResult.score
          : depluralMatchResult?.data
            ? depluralMatchResult.score
            : (rawMatchResult?.score ?? 0);

      // If no item found and no NLP result, needs followup (cold start)
      if (!chosenItem) {
        // Log cold start
        await logDecision(supabase, {
          household_id,
          utterance,
          candidate_item_id: null,
          chosen_item_id: null,
          confidence_score: 0,
          store_id: null,
          decision_type: 'cold_start',
        });
        return jsonResponse<AddItemResponse>({
          canonical_item: null,
          store: null,
          brand: null,
          needs_followup: true,
          followup_type: 'item',
          followup_question: `Couldn't find "${utterance}" — can you be more specific?`,
        });
      }

      // Check for ambiguity — always run when item not yet confirmed.
      // Even confident tier-1 matches can be ambiguous (e.g. "leche" → 4 leche variants
      // all score 1.0 on word_similarity). Disambiguation fires when multiple candidates
      // survive the relative-score filter; single matches fall through silently.
      if (!candidate_item_id) {
        const rawAlternatives = await findItemAlternatives(
          supabase,
          utterance,
          6
        );
        // Exact match — skip disambiguation entirely
        const exactMatch = rawAlternatives.find(
          (a) => a.name_canonical.toLowerCase() === utterance.toLowerCase()
        );
        if (exactMatch) {
          chosenItem = exactMatch;
        } else {
          const topScore = (rawAlternatives[0] as any)?.similarity ?? 0;
          const alternatives = rawAlternatives.filter(
            (a) => ((a as any).similarity ?? 0) >= topScore * 0.4
          );
          // Single match — proceed silently (e.g. "palmitos" → "palmito")
          if (alternatives.length <= 1) {
            // fall through to store routing
          } else {
            // Multiple matches — ask user to pick (e.g. "leche" → 4 options)
            await logDecision(supabase, {
              household_id,
              utterance,
              candidate_item_id: chosenItem.id,
              chosen_item_id: null,
              confidence_score: matchScore,
              store_id: null,
              decision_type: 'asked_item',
            });
            return jsonResponse<AddItemResponse>({
              canonical_item: {
                id: chosenItem.id,
                name: chosenItem.name_canonical,
              },
              store: null,
              brand: null,
              needs_followup: true,
              followup_type: 'item',
              followup_question: `Which one?`,
              followup_options: alternatives.map((a) => ({
                id: a.id,
                label: a.name_canonical,
              })),
            });
          }
        } // end else (no exact match)
      }
    } // end if (!force_create_with_label)

    // chosenItem must be set by here — either via force-create or NLP path.
    // Type-narrow the rest of the handler.
    if (!chosenItem) {
      console.error('chosenItem unexpectedly null after resolution');
      return jsonResponse({ error: 'Failed to add item' }, 500);
    }

    // -----------------------------------------------------------------------
    // (c) Deduplication — same item + store already pending?
    // -----------------------------------------------------------------------
    // We need to know the store first for an exact dedup check. If store is
    // confirmed, check now. If not, we'll dedup after routing.
    if (confirmed_store_id) {
      const { data: existing } = await supabase
        .from('list_entries')
        .select('id, quantity')
        .eq('household_id', household_id)
        .eq('item_id', chosenItem.id)
        .eq('store_id', confirmed_store_id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existing) {
        const { data: storeRow } = await supabase
          .from('stores')
          .select('name')
          .eq('id', confirmed_store_id)
          .single();
        return jsonResponse<AddItemResponse>({
          entry_id: existing.id,
          canonical_item: {
            id: chosenItem.id,
            name: chosenItem.name_canonical,
          },
          store: { id: confirmed_store_id, name: storeRow?.name ?? '' },
          brand: confirmed_brand ?? null,
          needs_followup: true,
          followup_type: 'quantity',
          already_on_list: true,
          followup_question: `${chosenItem.name_canonical} is already on your ${storeRow?.name ?? 'store'} list. Want to increase the quantity?`,
          added_new: force_create_with_label ? true : undefined,
        });
      }
    }

    // -----------------------------------------------------------------------
    // (d) History-based store routing (time-weighted recency)
    // -----------------------------------------------------------------------
    let resolvedStoreId: string | null = confirmed_store_id ?? null;
    let resolvedStoreName: string | null = null;
    // Server-side routing confidence surfaced back to the client so the
    // `store_routed` PostHog event can record it. Only populated for
    // history-routed paths; confirmed_store_id paths leave it undefined.
    let resolvedStoreConfidence: number | undefined;

    if (resolvedStoreId) {
      const { data: storeRow } = await supabase
        .from('stores')
        .select('name')
        .eq('id', resolvedStoreId)
        .single();
      resolvedStoreName = storeRow?.name ?? null;
    }

    if (!resolvedStoreId) {
      const routing = await routeToStore(
        supabase,
        household_id,
        chosenItem.id,
        storeRoutingThreshold
      );

      // D5 (migration 016): membership gate on the silent_match path. The
      // `supabase` client at index.ts:72 uses service-role + forwards
      // Authorization → RLS is bypassed BUT auth.uid() resolves via the JWT
      // → current_household_id() works correctly. Query is a single PK
      // lookup on household_stores.
      // LOAD-BEARING(do-not-remove): without this gate, a high-confidence
      // routing decision can silently route to a store the household removed.
      let routedStoreInMyStores = false;
      if (routing.storeId) {
        const { data: membership } = await supabase
          .from('household_stores')
          .select('store_id')
          .eq('household_id', household_id)
          .eq('store_id', routing.storeId)
          .maybeSingle();
        routedStoreInMyStores = !!membership;
      }

      if (
        routing.storeId &&
        routing.confidence >= storeRoutingThreshold &&
        routedStoreInMyStores // D5: silent_match requires membership
      ) {
        resolvedStoreId = routing.storeId;
        resolvedStoreName = routing.storeName;
        resolvedStoreConfidence = routing.confidence;
      } else {
        // Needs store disambiguation.
        // D5: candidates are scoped to My Stores via household_stores join
        // so a household that removed Costco doesn't see Costco offered.
        const { data: myStoreRows } = await supabase
          .from('household_stores')
          .select('store_id, stores(id, name)')
          .eq('household_id', household_id);

        const availableStores = (myStoreRows ?? [])
          .map(
            (row: { stores: { id: string; name: string } | null }) => row.stores
          )
          .filter(
            (
              s: { id: string; name: string } | null
            ): s is {
              id: string;
              name: string;
            } => s !== null
          )
          .sort(
            (
              a: { id: string; name: string },
              b: { id: string; name: string }
            ) => a.name.localeCompare(b.name)
          );

        // Skip logDecision for the force-create branch (user override, not
        // an NLP scoring decision). The cascading store-disambig response
        // still carries `added_new: true` so the eventual confirm tags
        // the `item_added` event correctly.
        if (!force_create_with_label) {
          await logDecision(supabase, {
            household_id,
            utterance,
            candidate_item_id: chosenItem.id,
            chosen_item_id: chosenItem.id,
            confidence_score: matchScore,
            store_id: null,
            decision_type: routing.storeId ? 'asked_store' : 'cold_start',
          });
        }

        // D5: detect the downgrade (routing succeeded but predicted store
        // isn't in My Stores) so the client can fire store_routing_fallback_fired.
        const fallbackFired = !!(routing.storeId && !routedStoreInMyStores);

        return jsonResponse<AddItemResponse>({
          canonical_item: {
            id: chosenItem.id,
            name: chosenItem.name_canonical,
          },
          store: null,
          brand: null,
          needs_followup: true,
          followup_type: 'store',
          followup_question: 'Which store?',
          followup_options: availableStores.map((s) => ({
            id: s.id,
            label: s.name,
          })),
          ...(fallbackFired
            ? {
                store_routing_fallback_fired: true,
                store_routing_fallback_removed_store_id:
                  routing.storeId ?? undefined,
              }
            : {}),
        });
      }
    }

    // -----------------------------------------------------------------------
    // (e) Brand preference lookup
    // -----------------------------------------------------------------------
    let resolvedBrand: string | null = confirmed_brand ?? null;

    if (!resolvedBrand && resolvedStoreId) {
      const { data: pref } = await supabase
        .from('brand_preferences')
        .select('preferred_brand')
        .eq('household_id', household_id)
        .eq('item_id', chosenItem.id)
        .eq('store_id', resolvedStoreId)
        .maybeSingle();

      if (pref?.preferred_brand) {
        resolvedBrand = pref.preferred_brand;
      }
    }

    // -----------------------------------------------------------------------
    // Dedup check with resolved store (if we didn't check above)
    // -----------------------------------------------------------------------
    if (!confirmed_store_id && resolvedStoreId) {
      const { data: existing } = await supabase
        .from('list_entries')
        .select('id, quantity')
        .eq('household_id', household_id)
        .eq('item_id', chosenItem.id)
        .eq('store_id', resolvedStoreId)
        .eq('status', 'pending')
        .maybeSingle();

      if (existing) {
        return jsonResponse<AddItemResponse>({
          entry_id: existing.id,
          canonical_item: {
            id: chosenItem.id,
            name: chosenItem.name_canonical,
          },
          store: { id: resolvedStoreId, name: resolvedStoreName ?? '' },
          brand: resolvedBrand,
          needs_followup: true,
          followup_type: 'quantity',
          already_on_list: true,
          followup_question: `${chosenItem.name_canonical} is already on your ${resolvedStoreName ?? 'list'}. Want to increase the quantity?`,
          added_new: force_create_with_label ? true : undefined,
        });
      }
    }

    // -----------------------------------------------------------------------
    // All resolved — write list_entries
    // -----------------------------------------------------------------------
    const { data: newEntry, error: insertError } = await supabase
      .from('list_entries')
      .insert({
        household_id,
        item_id: chosenItem.id,
        store_id: resolvedStoreId,
        brand: resolvedBrand,
        quantity: 1,
        status: 'pending',
        added_by: user.id,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('list_entries insert error:', insertError);
      return jsonResponse({ error: 'Failed to add item' }, 500);
    }

    // Write NLP variant if applicable (fire-and-forget, non-blocking)
    // The iOS client handles SwiftData write-back; server just logs success.

    // Log successful decision — skip when force-create: an explicit user
    // override is not an NLP scoring decision worth logging.
    if (!force_create_with_label) {
      await logDecision(supabase, {
        household_id,
        utterance,
        candidate_item_id: chosenItem.id,
        chosen_item_id: chosenItem.id,
        confidence_score: matchScore,
        store_id: resolvedStoreId!,
        decision_type: 'silent_match',
      });
    }

    return jsonResponse<AddItemResponse>({
      entry_id: newEntry.id,
      canonical_item: { id: chosenItem.id, name: chosenItem.name_canonical },
      store: { id: resolvedStoreId!, name: resolvedStoreName ?? '' },
      brand: resolvedBrand,
      needs_followup: false,
      store_confidence: resolvedStoreConfidence,
      added_new: force_create_with_label ? true : undefined,
    });
  } catch (err) {
    console.error('add-item error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Item {
  id: string;
  name_canonical: string;
}

/**
 *
 */
async function findItemByTrigram(
  supabase: ReturnType<typeof createClient>,
  query: string,
  threshold: number
): Promise<{ data: Item | null; score: number }> {
  // Use pg_trgm similarity via RPC (standard Supabase approach)
  const { data, error } = await supabase.rpc('find_item_by_trgm', {
    p_query: query,
    p_threshold: threshold,
  });
  if (error || !data || data.length === 0) {
    return { data: null, score: 0 };
  }
  return { data: data[0] as Item, score: data[0].similarity ?? 0 };
}

/**
 *
 */
async function findItemAlternatives(
  supabase: ReturnType<typeof createClient>,
  query: string,
  limit: number
): Promise<Item[]> {
  const { data } = await supabase.rpc('find_item_alternatives', {
    p_query: query,
    p_limit: limit,
  });
  return (data ?? []) as Item[];
}

interface StoreRoutingResult {
  storeId: string | null;
  storeName: string | null;
  confidence: number;
}

/**
 *
 */
async function routeToStore(
  supabase: ReturnType<typeof createClient>,
  household_id: string,
  item_id: string,
  _threshold: number
): Promise<StoreRoutingResult> {
  // Time-weighted recency: recent purchases count more.
  // Weight = 1 / (1 + days_since_purchase * 0.05)
  // Returns the store with the highest weighted share of purchases.
  const { data } = await supabase.rpc('route_item_to_store', {
    p_household_id: household_id,
    p_item_id: item_id,
  });

  if (!data || data.length === 0) {
    return { storeId: null, storeName: null, confidence: 0 };
  }

  const top = data[0];
  return {
    storeId: top.store_id,
    storeName: top.store_name,
    confidence: top.weighted_share,
  };
}

/**
 *
 */
async function logDecision(
  supabase: ReturnType<typeof createClient>,
  params: {
    household_id: string;
    utterance: string;
    candidate_item_id: string | null;
    chosen_item_id: string | null;
    confidence_score: number;
    store_id: string | null;
    decision_type: string;
  }
): Promise<void> {
  await supabase
    .from('disambiguation_log')
    .insert(params)
    .then(({ error }) => {
      if (error)
        console.warn('disambiguation_log insert failed:', error.message);
    });
}

/**
 *
 */
async function normalizeWithClaude(
  apiKey: string,
  utterance: string
): Promise<string | null> {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    messages: [
      {
        role: 'user',
        content: `Convert this grocery item utterance to its canonical English name only.
Reply with ONLY the canonical name, nothing else. No punctuation, no explanation.
If already in English and clear, return it unchanged.

Utterance: "${utterance}"`,
      },
    ],
  });
  const text =
    message.content[0]?.type === 'text' ? message.content[0].text.trim() : null;
  return text && text.length < 100 ? text : null;
}

/**
 *
 */
function isLikelyEnglish(text: string): boolean {
  // Very simple heuristic — skip NLP for clearly English inputs
  const spanishWords =
    /\b(agrega|agregar|añade|añadir|leche|queso|manzana|pollo|carne|pan|huevos|arroz|frijoles|tomate|cebolla|ajo|aguacate|limón|naranja|platano|fresa)\b/i;
  return !spanishWords.test(text);
}

/**
 *
 */
function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
