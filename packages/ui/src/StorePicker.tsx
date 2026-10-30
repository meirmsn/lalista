// What: Dual-mode reusable picker for the per-household My Stores feature.
//       `mode='select'` renders existing stores as tap-to-pick pills (for
//       AddItemSheet's asked_store / store-followup branches);
//       `mode='manage'` renders them as tap-to-remove rows (for Settings →
//       My Stores). Both modes share the autocomplete input + suggestion
//       list + optional "Add new store" CTA (gated by `allowCreate`).
// Why: Spec § Screens calls for a single picker primitive reused across
//      Settings, AddItemSheet, and the DisambiguationSheet store-followup.
//      Centralizing the autocomplete + CTA-gate decision means the D6
//      threshold lives in one place (server side via the wrapper), the
//      ARIA contract is consistent, and the empty-state Fraunces shape
//      doesn't drift.
// Does NOT: Wrap the latency-tier mutation engine (`useOptimisticMutation`)
//           — callers in Settings (Tier A1 rollback) and AddItemSheet (Tier
//           A2 banner) own the wiring. The picker exposes `onAdd` / `onRemove`
//           / `onSelect` callbacks; consumers wrap them per D10.

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/** A store row as rendered by the picker. */
export interface PickerStore {
  id: string;
  name: string;
}

/** Discriminated union — `mode` determines which actions the picker exposes. */
export type StorePickerMode =
  | {
      mode: 'manage';
      /** Remove a store from the household's My Stores. */
      onRemove: (storeId: string) => void;
    }
  | {
      mode: 'select';
      /** Pick an existing store (e.g. for the in-flight AddItemSheet add). */
      onSelect: (storeId: string) => void;
      /** Optional: highlight the currently-selected pill. */
      selectedStoreId?: string;
    };

export type StorePickerProps = {
  /** The caller's My Stores — flat list, already sorted by name. */
  myStores: PickerStore[];
  /**
   * Whether to render the autocomplete + "Add new store" CTA. Defaults to
   * `true`. `false` is only used for read-only audit-style surfaces (none
   * in v0).
   */
  allowCreate?: boolean;
  /** Fetch autocomplete suggestions for the typed query. Debounced 200ms. */
  fetchSuggestions: (query: string) => Promise<PickerStore[]>;
  /**
   * Add a store. Called either with `{storeId}` (existing suggestion picked)
   * or `{name}` (custom-create branch). Tier A1 / A2 wiring lives in caller.
   */
  onAdd: (args: { storeId?: string; name?: string }) => void;
} & StorePickerMode;

const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH_FOR_CTA = 3;

/**
 * Dual-mode store picker. See `StorePickerProps` for the discriminated union
 * shape. ARIA: input gets `aria-autocomplete="list" aria-controls=<listId>
 * aria-expanded={hasSuggestions}`. Each suggestion is `role="option"`. The
 * "Add new store" CTA gets a descriptive `aria-label`. Remove text-links
 * (manage mode) get `aria-label="Remove {storeName} from my stores"`.
 */
export function StorePicker(props: StorePickerProps) {
  const { myStores, allowCreate = true, fetchSuggestions, onAdd } = props;
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PickerStore[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const listId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the latest query so a slow request that returns out of order can't
  // overwrite the current state (e.g. user types "ab" then quickly "abc";
  // the "ab" response should be ignored if it lands after "abc"'s).
  const latestQueryRef = useRef('');

  // Debounce fetchSuggestions; clear on unmount.
  useEffect(() => {
    latestQueryRef.current = query;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (query.trim().length === 0) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    debounceRef.current = setTimeout(() => {
      const myQuery = query;
      void fetchSuggestions(myQuery).then(
        (results) => {
          if (latestQueryRef.current !== myQuery) return;
          // Filter out stores already in My Stores — picker is for
          // ADDING; surfacing existing ones is noise.
          const myStoreIds = new Set(myStores.map((s) => s.id));
          setSuggestions(results.filter((r) => !myStoreIds.has(r.id)));
          setIsLoading(false);
        },
        () => {
          if (latestQueryRef.current !== myQuery) return;
          setSuggestions([]);
          setIsLoading(false);
        }
      );
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [query, fetchSuggestions, myStores]);

  const handleSuggestionTap = useCallback(
    (s: PickerStore) => {
      onAdd({ storeId: s.id });
      setQuery('');
      setSuggestions([]);
    },
    [onAdd]
  );

  const handleCreateTap = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    onAdd({ name: trimmed });
    setQuery('');
    setSuggestions([]);
  }, [query, onAdd]);

  const showCta =
    allowCreate &&
    query.trim().length >= MIN_QUERY_LENGTH_FOR_CTA &&
    !isLoading &&
    suggestions.length === 0;

  const isEmpty = myStores.length === 0;

  return (
    <div className="flex flex-col gap-sm">
      {isEmpty && props.mode === 'manage' ? (
        <div className="flex flex-col gap-xs py-md text-center">
          <p className="font-display text-[36px] font-light italic leading-[1.2] text-text-primary">
            tus tiendas
          </p>
          <p className="font-body text-[17px] text-text-secondary">
            (your stores)
          </p>
          <p className="font-body text-[13px] text-text-tertiary">
            add the places you shop.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-xs">
          {myStores.map((store) => (
            <li key={store.id}>
              {props.mode === 'manage' ? (
                <ManageRow store={store} onRemove={props.onRemove} />
              ) : (
                <SelectPill
                  store={store}
                  isSelected={props.selectedStoreId === store.id}
                  onSelect={props.onSelect}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {allowCreate ? (
        <div className="flex flex-col gap-xs">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="add another store…"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={suggestions.length > 0}
            className="rounded-sm border border-border bg-surface px-md py-sm font-body text-[16px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary"
          />

          {suggestions.length > 0 ? (
            <ul
              id={listId}
              role="listbox"
              className="flex flex-col gap-xs rounded-sm border border-border bg-surface"
            >
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleSuggestionTap(s)}
                    className="block w-full min-h-[44px] px-md py-sm text-left font-body text-[15px] text-text-primary hover:bg-surface-muted"
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {showCta ? (
            <button
              type="button"
              onClick={handleCreateTap}
              aria-label={`Create a new store named ${query.trim()}`}
              className="self-start rounded-full border border-primary bg-transparent px-md py-sm font-body text-[15px] font-medium text-primary hover:bg-primary hover:text-text-on-primary"
            >
              Add new store: &lsquo;{query.trim()}&rsquo;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface ManageRowProps {
  store: PickerStore;
  onRemove: (storeId: string) => void;
}

/**
 *
 */
function ManageRow({ store, onRemove }: ManageRowProps) {
  return (
    <div className="flex items-center justify-between min-h-[44px] px-sm">
      <span className="font-body text-[15px] font-medium text-text-primary">
        {store.name}
      </span>
      <button
        type="button"
        onClick={() => onRemove(store.id)}
        aria-label={`Remove ${store.name} from my stores`}
        className="font-body text-[13px] text-text-tertiary hover:text-error"
      >
        remove
      </button>
    </div>
  );
}

interface SelectPillProps {
  store: PickerStore;
  isSelected: boolean;
  onSelect: (storeId: string) => void;
}

/**
 *
 */
function SelectPill({ store, isSelected, onSelect }: SelectPillProps) {
  const cls = isSelected
    ? 'bg-primary text-text-on-primary border-primary'
    : 'bg-transparent text-primary border-primary hover:bg-primary/10';
  return (
    <button
      type="button"
      onClick={() => onSelect(store.id)}
      aria-pressed={isSelected}
      className={`min-h-[44px] rounded-full border px-md py-sm font-body text-[15px] font-medium ${cls}`}
    >
      {store.name}
    </button>
  );
}
