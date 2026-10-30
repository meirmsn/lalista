// What: Settings → My Stores section — manage-mode picker over the
//       household's per-household store membership. Tier A1 (rollback)
//       latency wiring per D10.
// Why: Spec § Surface 1 — IA placement after Account/Household/Members/
//      Activity. Renders <StorePicker mode="manage" allowCreate /> with
//      the My Stores list at top + autocomplete-add input below; remove
//      affordance per row; "Add new store" CTA gated by D6 threshold.
// Does NOT: Render the autocomplete logic itself (StorePicker primitive
//           in @lalista/ui owns it). Latency-tier wiring is HERE — the
//           picker is decoupled from useOptimisticMutation so the same
//           primitive can carry Tier A1 (Settings) and Tier A2 (AddItemSheet).

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StorePicker, Text } from '@lalista/ui';
import type { PickerStore } from '@lalista/ui';
import {
  addHouseholdStore,
  fetchMyStores,
  fetchStoreCatalogSuggestions,
  removeHouseholdStore,
} from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import {
  trackCustomStoreCreated,
  trackMyStoreAdded,
  trackMyStoreRemoved,
} from '@/lib/analytics';

export interface MyStoresSectionProps {
  householdId: string;
}

/**
 * Settings → My Stores. Fetches My Stores on mount; renders the picker in
 * manage mode; Tier A1 rollback on add/remove failure (mirrors the
 * DisplayNameField save pattern).
 */
export function MyStoresSection({ householdId }: MyStoresSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const [myStores, setMyStores] = useState<PickerStore[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const rows = await fetchMyStores(supabase);
      setMyStores(rows.map((s) => ({ id: s.id, name: s.name })));
    } catch {
      setError("Couldn't load stores. Try again.");
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  // Tier A1 (D10): optimistic-add then rollback on failure. We keep a snapshot
  // of myStores in the closure of run() and restore it on RPC error; success
  // path refetches to pick up the server's resolved storeId + (for custom-
  // create) the canonical name.
  const handleAdd = useCallback(
    async (args: { storeId?: string; name?: string }) => {
      const snapshot = myStores;
      // Optimistic placeholder — show a row immediately with the typed name
      // (or the existing-store name if storeId given AND we can resolve it
      // from the suggestion list cached at click time; since this component
      // doesn't cache that, we just refetch after the RPC resolves).
      if (args.name) {
        setMyStores([
          ...snapshot,
          { id: `__pending_${args.name}`, name: args.name },
        ]);
      }
      try {
        const result = await addHouseholdStore(supabase, args);
        trackMyStoreAdded({
          store_id: result.storeId,
          was_created: result.wasCreated,
          source: 'settings',
          household_id: householdId,
        });
        if (result.wasCreated && args.name) {
          trackCustomStoreCreated({
            store_id: result.storeId,
            name: args.name,
            source: 'settings',
            household_id: householdId,
          });
        }
        // Refetch to drop the placeholder + pick up the canonical row.
        await refresh();
      } catch (e) {
        // Tier A1 rollback — restore snapshot. queueMicrotask defers the
        // setState one tick so React paints the optimistic frame BEFORE the
        // rollback lands (mirror of useOptimisticMutation's rollback path).
        queueMicrotask(() => {
          setMyStores(snapshot);
        });
        setError(
          e instanceof Error ? e.message : "Couldn't add store. Try again."
        );
      }
    },
    [supabase, myStores, householdId, refresh]
  );

  const handleRemove = useCallback(
    async (storeId: string) => {
      const snapshot = myStores;
      setMyStores(snapshot.filter((s) => s.id !== storeId));
      try {
        await removeHouseholdStore(supabase, storeId);
        trackMyStoreRemoved({
          store_id: storeId,
          source: 'settings',
          household_id: householdId,
        });
      } catch (e) {
        queueMicrotask(() => {
          setMyStores(snapshot);
        });
        setError(
          e instanceof Error ? e.message : "Couldn't remove store. Try again."
        );
      }
    },
    [supabase, myStores, householdId]
  );

  return (
    <section aria-label="My Stores" className="flex flex-col gap-sm">
      <Text
        as="h2"
        variant="caption"
        className="text-text-secondary uppercase tracking-[0.08em]"
      >
        my stores
      </Text>
      <StorePicker
        mode="manage"
        allowCreate
        myStores={myStores}
        fetchSuggestions={(q) => fetchStoreCatalogSuggestions(supabase, q)}
        onAdd={(args) => {
          void handleAdd(args);
        }}
        onRemove={(storeId) => {
          void handleRemove(storeId);
        }}
      />
      {error && (
        <p role="alert" className="font-body text-[13px] text-error">
          {error}
        </p>
      )}
    </section>
  );
}
