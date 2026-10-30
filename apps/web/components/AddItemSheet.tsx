// What: Bottom-sheet / centered-card add-item dialog — wraps invokeAddItem,
//       emits telemetry, and runs the submission through useOptimisticMutation
//       (Tier A2) so transient network blips retry silently and hard failures
//       surface via the parent's SyncErrorBanner.
// Why: Primary entry point for the user's core action on the list view; also
//      owns the branch to the disambiguation sheet when NLP needs follow-up.
//      Tier A2 (D1, D10) covers the "I added 'milk eggs bread', walked away,
//      all 3 silently rolled back" failure mode — bounded retry inside the
//      RETRY_BUDGET_MS window then explicit retry/undo banner on hard fail.
// Does NOT: Own the list view, render the FAB, or manage the disambig sheet
//           state — parents pass an `onDisambiguationNeeded` callback and a
//           `onSubmissionBanner` for the Tier A2 banner state, and close/reset
//           on their own schedule.

'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input, Text, useOptimisticMutation } from '@lalista/ui';
import type { BannerState } from '@lalista/ui';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AddItemValidationError,
  invokeAddItem,
  type AddItemResponse,
  type Database,
} from '@lalista/core';
import {
  trackDisambiguationShown,
  trackItemAdded,
  trackStoreRouted,
  trackStoreRoutingFallbackFired,
} from '@/lib/analytics';
import { detectInputLanguage } from '@/lib/inputLanguage';
import { reportAddItemValidationError } from '@/lib/reportAddItemValidationError';

export interface AddItemSheetProps {
  open: boolean;
  onClose: () => void;
  householdId: string;
  client: SupabaseClient<Database>;
  /** Called when the edge function resolves to `needs_followup === true`. */
  onDisambiguationNeeded: (
    response: AddItemResponse,
    originalUtterance: string
  ) => void;
  /**
   * Called on a silent-resolve (`needs_followup === false`). Parents render
   * the confirmation toast — we stay out of toast state here so the list
   * view can reconcile realtime + toast together.
   */
  onItemAdded: (response: AddItemResponse) => void;
  /**
   * Tier A2 banner state — non-null when the retry budget for this
   * submission is exhausted OR the server returned a hard error. Parent
   * mounts SyncErrorBanner with this state so the banner survives sheet
   * close + intra-app navigation.
   */
  onSubmissionBanner: (banner: BannerState | null) => void;
}

/** Add-item bottom sheet — opens on FAB tap, submits to the add-item edge function. */
export function AddItemSheet({
  open,
  onClose,
  householdId,
  client,
  onDisambiguationNeeded,
  onItemAdded,
  onSubmissionBanner,
}: AddItemSheetProps) {
  const [utterance, setUtterance] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount. Component unmounts when `open` flips to false,
  // so state resets naturally — no need to setState inside an effect.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes the sheet (treated as Cancel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Tier A2 mutation: invokeAddItem + dispatch to onItemAdded /
  // onDisambiguationNeeded. applyOptimistic is a no-op — per spec gotcha 2,
  // the optimistic row uses the entry_id resolved by the server, so the
  // commit happens inside the success branch (onItemAdded → ListClient's
  // handleAddResponse). The hook's value here is the retry budget +
  // banner escalation.
  const submission = useOptimisticMutation<
    { trimmed: string; client: SupabaseClient<Database>; householdId: string },
    AddItemResponse
  >({
    applyOptimistic: () => {
      // No optimistic visual commit at this layer — see comment above.
    },
    mutate: async (args) => {
      const response = await invokeAddItem(args.client, {
        utterance: args.trimmed,
        householdId: args.householdId,
      });
      if (response.needs_followup) {
        trackDisambiguationShown({
          candidate_count: response.followup_options?.length ?? 0,
          followup_type: response.followup_type ?? 'item',
        });
        // D5: when the silent_match routing decision was downgraded because
        // the predicted store isn't in My Stores, the server sets
        // store_routing_fallback_fired. Echo it as a client-side PostHog
        // event so PR analytics can count this distinct event separately
        // from disambiguation_shown.
        const fallback = (
          response as { store_routing_fallback_fired?: boolean }
        ).store_routing_fallback_fired;
        const fallbackStoreId = (
          response as { store_routing_fallback_removed_store_id?: string }
        ).store_routing_fallback_removed_store_id;
        if (fallback && fallbackStoreId && response.canonical_item) {
          trackStoreRoutingFallbackFired({
            removed_store_id: fallbackStoreId,
            item_canonical: response.canonical_item.name,
            household_id: args.householdId,
          });
        }
        onDisambiguationNeeded(response, args.trimmed);
        onClose();
        return response;
      }
      // Silent-match success path.
      if (response.store?.name) {
        trackStoreRouted({
          store_name: response.store.name,
          confidence_score: response.store_confidence ?? null,
        });
      }
      if (response.store?.id) {
        trackItemAdded({
          store_id: response.store.id,
          was_disambiguated: false,
          input_language: detectInputLanguage(args.trimmed),
        });
      }
      onItemAdded(response);
      onClose();
      return response;
    },
    isHardError: (e) => {
      // Validation drift from the LLM boundary is non-retriable — the
      // server can't accept this payload regardless of how many times
      // we re-fire it.
      if (e instanceof AddItemValidationError) {
        reportAddItemValidationError(e);
        return true;
      }
      return false;
    },
    onFailure: {
      failureMode: 'banner',
      // No row was inserted optimistically, so undo just dismisses the
      // banner — there's nothing to roll back. The user can re-tap Add
      // if they want to try again later.
      rollback: () => {},
      bannerLabel: utterance.trim()
        ? `Couldn't save '${utterance.trim()}'`
        : "Couldn't save",
    },
  });

  // Hoist banner state up to the parent so the banner survives this sheet's
  // unmount on Cancel / navigation. Stash the latest callback in a ref so
  // changes to the parent's identity don't re-fire the effect; we only
  // want to push when the banner state itself transitions.
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

  if (!open || typeof document === 'undefined') return null;

  /**
   *
   */
  async function handleAdd() {
    const trimmed = utterance.trim();
    if (trimmed.length === 0) return;
    setError(null);
    try {
      await submission.run({ trimmed, client, householdId });
    } catch {
      // run() never throws — it surfaces failures via the banner state.
      // Keep the inline catch as a defense-in-depth in case the hook
      // contract drifts.
      setError("Couldn't add. Check your connection and try again.");
    }
  }

  const submitting = submission.isPending;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add to lalista"
      className="fixed inset-0 z-30 flex items-end justify-center md:items-center"
    >
      {/* Scrim — mouse-click closes on mobile + desktop. */}
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
        <div className="flex flex-col gap-xs">
          <Text as="h2" variant="heading-md">
            Add to lalista
          </Text>
          <Text variant="body" className="text-text-secondary">
            Type what you need — we&apos;ll route it to the right store.
          </Text>
        </div>

        <label className="flex flex-col gap-xs" htmlFor="add-item-input">
          <Text as="span" variant="caption" className="text-text-secondary">
            Item
          </Text>
          <Input
            ref={inputRef}
            id="add-item-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            placeholder="What do you need?"
            aria-label="Item to add"
            value={utterance}
            onChange={(e) => setUtterance(e.target.value)}
            disabled={submitting}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && utterance.trim().length > 0) {
                e.preventDefault();
                void handleAdd();
              }
            }}
          />
        </label>

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
            onClick={handleAdd}
            disabled={submitting || utterance.trim().length === 0}
          >
            {submitting ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
