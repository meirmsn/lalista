// What: Bottom-sheet / centered-card disambiguation for an ambiguous add
// Why: Server signals `needs_followup: true` with typed options; the sheet lets
//      the user pick one candidate and re-submits with the right slot filled.
//      For followup_type === 'store', renders the per-household My Stores
//      picker (D10 Tier A2) so the user isn't dead-ended when the store they
//      shop at isn't in their household's My Stores — they can mint a custom
//      one mid-flow and continue the add.
// Does NOT: Re-fetch stores for the 'item' / 'brand' / 'quantity' followup
//           branches — `followup_options` from the server is authoritative
//           for those. Only the 'store' branch reaches out to fetch My Stores
//           directly so the picker has live data.

'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, StorePicker, Text, useOptimisticMutation } from '@lalista/ui';
import type { BannerState, PickerStore } from '@lalista/ui';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AddItemValidationError,
  addHouseholdStore,
  fetchMyStores,
  fetchStoreCatalogSuggestions,
  invokeAddItem,
  type AddItemResponse,
  type Database,
} from '@lalista/core';
import {
  trackCustomStoreCreated,
  trackDisambiguationShown,
  trackItemAdded,
  trackMyStoreAdded,
  trackStoreRouted,
} from '@/lib/analytics';
import { detectInputLanguage } from '@/lib/inputLanguage';
import { reportAddItemValidationError } from '@/lib/reportAddItemValidationError';

export interface DisambiguationSheetProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  client: SupabaseClient<Database>;
  /** The response that triggered this sheet (original + follow-up metadata). */
  response: AddItemResponse | null;
  /** The user's original utterance — we keep sending it on the follow-up call. */
  originalUtterance: string;
  /** Fired when the add resolves silently after confirm. */
  onItemAdded: (response: AddItemResponse) => void;
  /**
   * Tier A2 banner state — same shape as AddItemSheet.onSubmissionBanner.
   * The list view's submission-banner slot is shared between AddItemSheet
   * and DisambiguationSheet (D10) so a user adding multiple items in a
   * row sees a single coalesced banner rather than a stack.
   */
  onSubmissionBanner: (banner: BannerState | null) => void;
}

/**
 * Sentinel `selectedId` used by the "Add as new" radio row. Distinct from
 * any server-issued option id (those are UUIDs). When `handleConfirm` sees
 * this value, it skips slot-mapping and calls `invokeAddItem` with
 * `forceCreateWithLabel: true`. NEVER send this value to the server — it's
 * a UI-only marker.
 */
const ADD_NEW_SENTINEL = '__add_new__';

/**
 * Disambiguation bottom sheet. Radio-list over `followup_options[]`; confirm
 * re-invokes the add-item edge function with the selected value mapped to
 * the right parameter based on `followup_type`.
 */
export function DisambiguationSheet({
  open,
  onClose,
  householdId,
  client,
  response,
  originalUtterance,
  onItemAdded,
  onSubmissionBanner,
}: DisambiguationSheetProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // My Stores fetched lazily for the store-followup branch (D5/D10).
  // Empty until the sheet opens with followup_type === 'store'.
  const [myStores, setMyStores] = useState<PickerStore[]>([]);

  // Lazy-fetch My Stores when the sheet opens for the store-followup branch.
  // Cleared when the sheet closes so the next open re-fetches fresh data.
  useEffect(() => {
    if (!open || response?.followup_type !== 'store') return;
    let cancelled = false;
    void fetchMyStores(client).then(
      (rows) => {
        if (cancelled) return;
        setMyStores(rows.map((s) => ({ id: s.id, name: s.name })));
      },
      () => {
        if (cancelled) return;
        setMyStores([]);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [open, response?.followup_type, client]);

  // Escape closes the sheet (treated as Cancel). Parents own the
  // mount/unmount gate so state resets cleanly on each fresh open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Tier A2 mutation: invokeAddItem with the user's pick. Same retry/banner
  // shape as AddItemSheet — failures retry silently inside RETRY_BUDGET_MS,
  // hard failures surface via the parent's SyncErrorBanner with the same
  // affordance="retry-undo" label.
  type RunArgs = Parameters<typeof invokeAddItem>[1];
  const submission = useOptimisticMutation<RunArgs, AddItemResponse>({
    applyOptimistic: () => {
      // No optimistic visual commit at this layer — handleAddResponse in
      // ListClient owns the row insert after the server resolves.
    },
    mutate: async (args) => {
      const next = await invokeAddItem(client, args);
      if (next.needs_followup) {
        // Server chained a second follow-up round.
        trackDisambiguationShown({
          candidate_count: next.followup_options?.length ?? 0,
          followup_type: next.followup_type ?? 'item',
        });
        setSelectedId(null);
        onItemAdded(next);
        return next;
      }
      if (next.store?.name) {
        trackStoreRouted({
          store_name: next.store.name,
          confidence_score: next.store_confidence ?? null,
        });
      }
      if (next.store?.id) {
        trackItemAdded({
          store_id: next.store.id,
          was_disambiguated: true,
          input_language: detectInputLanguage(originalUtterance),
          ...(next.added_new === true ? { was_force_created: true } : {}),
        });
      }
      onItemAdded(next);
      onClose();
      return next;
    },
    isHardError: (e) => {
      if (e instanceof AddItemValidationError) {
        reportAddItemValidationError(e);
        return true;
      }
      return false;
    },
    onFailure: {
      failureMode: 'banner',
      rollback: () => {},
      bannerLabel: originalUtterance.trim()
        ? `Couldn't save '${originalUtterance.trim()}'`
        : "Couldn't save",
    },
  });

  // Hoist banner state to parent so the sheet's close doesn't strand it.
  const onSubmissionBannerRef = useRef(onSubmissionBanner);
  useEffect(() => {
    onSubmissionBannerRef.current = onSubmissionBanner;
  }, [onSubmissionBanner]);
  useEffect(() => {
    onSubmissionBannerRef.current(submission.banner);
  }, [submission.banner]);

  // Auto-close the sheet when the retry budget exhausts and the banner
  // appears at the page level. Without this, the sheet's backdrop overlay
  // (z-30, fullscreen aria-label="Close" button) intercepts Retry / Undo
  // clicks on the banner — reported in CI on PR #49 as a Playwright
  // pointer-events failure. The banner state is hoisted to the parent
  // via the useEffect above before this fires, so banner display survives
  // the sheet's unmount.
  useEffect(() => {
    if (submission.banner) onClose();
  }, [submission.banner, onClose]);

  if (!open || !response || typeof document === 'undefined') return null;

  const followupType = response.followup_type ?? 'item';
  const options = response.followup_options ?? [];
  const alreadyOnList = response.already_on_list === true;
  // Suppress the add-new row when one of the candidates IS the user's
  // utterance (case-insensitive). Force-create would just hit the
  // name_canonical UNIQUE constraint and fall through to that same
  // candidate — same outcome as picking it from the list, but the
  // "+ Add 'papas' as new" label misleads the user into thinking they're
  // creating a new item.
  const utteranceLower = originalUtterance.trim().toLowerCase();
  const utteranceMatchesCandidate = options.some(
    (option) => option.label.toLowerCase() === utteranceLower
  );
  const showAddNewRow = followupType === 'item' && !utteranceMatchesCandidate;

  /**
   *
   */
  async function handleConfirm() {
    if (!response) return;

    // Special case: already_on_list + quantity follow-up — v0 just ack's
    // without re-hitting the edge function (quantity resize is v+).
    if (alreadyOnList && followupType === 'quantity') {
      onItemAdded(response);
      onClose();
      return;
    }

    if (!selectedId) return;
    setError(null);

    const isAddNew = selectedId === ADD_NEW_SENTINEL;
    const selectedOption = isAddNew
      ? undefined
      : options.find((o) => o.id === selectedId);
    const confirmedBrand =
      !isAddNew && followupType === 'brand' ? selectedOption?.label : undefined;

    const args: RunArgs = isAddNew
      ? {
          // Force-create branch — skip every slot mapping. The server
          // inserts items(name_canonical = utterance) and routes the
          // entry into list_entries (cascading store-disambig if no
          // history exists for the brand-new item).
          utterance: originalUtterance,
          householdId,
          forceCreateWithLabel: true,
        }
      : {
          utterance: originalUtterance,
          householdId,
          candidateItemId:
            followupType === 'item'
              ? selectedId
              : (response.canonical_item?.id ?? undefined),
          confirmedStoreId:
            followupType === 'store'
              ? selectedId
              : (response.store?.id ?? undefined),
          confirmedBrand,
        };

    await submission.run(args);
  }

  const submitting = submission.isPending;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose an option"
      className="fixed inset-0 z-30 flex items-end justify-center md:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        className="relative flex w-full flex-col gap-md rounded-t-lg bg-surface p-lg md:w-full md:max-w-[28rem] md:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <Text as="h2" variant="heading-md">
          {response.followup_question ?? 'Which one?'}
        </Text>

        {alreadyOnList && followupType === 'quantity' ? (
          <Text variant="body" className="text-text-secondary">
            {response.canonical_item?.name ?? 'This item'} is already on your
            list.
          </Text>
        ) : followupType === 'store' ? (
          // D5/D10: store-followup branch uses <StorePicker> so a user whose
          // shopping store isn't yet in My Stores can mint a custom one
          // mid-flow (avoids first-time-user dead-end). The picker's onAdd
          // mints the custom store via add_household_store first, then we
          // hand the resolved storeId to the in-flight invokeAddItem call.
          <StorePicker
            mode="select"
            myStores={myStores}
            selectedStoreId={selectedId ?? undefined}
            fetchSuggestions={(q) => fetchStoreCatalogSuggestions(client, q)}
            onSelect={(storeId) => setSelectedId(storeId)}
            onAdd={async (args) => {
              try {
                const result = await addHouseholdStore(client, args);
                trackMyStoreAdded({
                  store_id: result.storeId,
                  was_created: result.wasCreated,
                  source: 'disambig',
                  household_id: householdId,
                });
                if (result.wasCreated && args.name) {
                  trackCustomStoreCreated({
                    store_id: result.storeId,
                    name: args.name,
                    source: 'disambig',
                    household_id: householdId,
                  });
                }
                // Push the newly-added store into My Stores immediately so
                // it renders as a selectable pill, AND select it for the
                // current add.
                setMyStores((prev) =>
                  prev.some((s) => s.id === result.storeId)
                    ? prev
                    : [
                        ...prev,
                        {
                          id: result.storeId,
                          name: args.name ?? result.storeId,
                        },
                      ]
                );
                setSelectedId(result.storeId);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Couldn't add store. Try again."
                );
              }
            }}
          />
        ) : (
          <div
            role="radiogroup"
            aria-label={response.followup_question ?? 'Choose an option'}
            className="flex flex-col gap-xs"
          >
            {options.map((option) => {
              const checked = option.id === selectedId;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setSelectedId(option.id)}
                  className="flex min-h-[44px] items-center gap-sm rounded-default border border-border px-md py-sm text-left font-body text-[15px] text-text-primary hover:bg-surface-2"
                >
                  <span
                    aria-hidden="true"
                    className="relative inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[100px] border border-border"
                  >
                    {checked && (
                      <span className="h-[12px] w-[12px] rounded-[100px] bg-primary" />
                    )}
                  </span>
                  <span>{option.label}</span>
                </button>
              );
            })}
            {/*
              "Add as new" escape hatch — only rendered for the ITEM
              follow-up. Cascading store / brand / quantity follow-ups
              are picking among existing typed slots, not an item; the
              add-new row would be nonsensical and confusing there.
              Rendered outside the options.map so it appears even when
              followup_options is empty (cold-start path returns
              needs_followup: true with no options). Picking this row
              triggers the force-create branch in handleConfirm.

              Visual: a thin top-border + extra top-padding on the button
              itself acts as the separator gap above (per D4).
            */}
            {showAddNewRow && (
              <button
                key={ADD_NEW_SENTINEL}
                type="button"
                role="radio"
                aria-checked={selectedId === ADD_NEW_SENTINEL}
                onClick={() => setSelectedId(ADD_NEW_SENTINEL)}
                className="mt-sm flex min-h-[44px] items-center gap-sm rounded-default border border-border px-md py-sm pt-md text-left font-body text-[15px] text-text-primary hover:bg-surface-2"
              >
                <span
                  aria-hidden="true"
                  className="relative inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[100px] border border-border"
                >
                  {selectedId === ADD_NEW_SENTINEL && (
                    <span className="h-[12px] w-[12px] rounded-[100px] bg-primary" />
                  )}
                </span>
                <span>
                  <span aria-hidden="true">+ </span>
                  Add &ldquo;{originalUtterance}&rdquo; as new
                </span>
              </button>
            )}
          </div>
        )}

        {error && (
          <Text as="p" variant="caption" className="text-error" role="alert">
            {error}
          </Text>
        )}

        <div className="flex items-center justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-[44px] rounded-default px-md py-sm font-body text-[15px] font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={
              submitting ||
              (!alreadyOnList && !selectedId) ||
              (alreadyOnList && followupType !== 'quantity')
            }
          >
            {submitting ? 'Saving…' : alreadyOnList ? 'OK' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
