// What: The list view's client container — fetch + realtime + mutations + sheets
// Why: Single hub so the list stays reconciled across realtime events, optimistic
//      mark-bought fades, and add-item flows
// Does NOT: Authenticate (server parent does that), manage the theme, or decide
//           where `/list` lives in the routing tree

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteListEntry,
  fetchListEntries,
  markItemBought,
  RemovedFromHouseholdError,
  subscribeToList,
  type AddItemResponse,
  type HydratedListEntry,
  type ListEntry,
  type ListEntryChange,
} from '@lalista/core';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import { LoadingArea, useOptimisticMutation } from '@lalista/ui';
import type { BannerState } from '@lalista/ui';
import { createClient } from '@/lib/supabase/client';
import { trackItemBought } from '@/lib/analytics';
import { AddItemSheet } from './AddItemSheet';
import { ConfirmationToast } from './ConfirmationToast';
import { DisambiguationSheet } from './DisambiguationSheet';
import { EmptyListState } from './EmptyListState';
import { ListRow } from './ListRow';
import { StoreSection } from './StoreSection';
import { SyncErrorBanner, type SyncErrorBannerProps } from './SyncErrorBanner';

/**
 * Wake-recovery suppress-window (D3 of specs/sync-banner-pwa-recovery/spec.md).
 * When a visibility/online/focus event fires and the channel is unhealthy, we
 * bump `realtimeTick` to rebuild the channel and suppress the "Sync paused"
 * banner for up to this window so the wake transient doesn't show a false
 * positive. The suppress is cleared early via `onSubscribed` when the rebuilt
 * channel reports SUBSCRIBED — the 3000ms ceiling only matters if reconnect
 * is genuinely failing, in which case the banner surfaces so the user can
 * tap-to-retry.
 *
 * Page-local timing knob — NOT a design-system token (no UI-affordance
 * implication; lives here next to the only consumer).
 */
const SUPPRESS_WINDOW_MS = 3000;

export interface ListClientProps {
  householdId: string;
  /**
   * Household display name for the caption-cap header (D12). Caption header
   * tap-targets `/settings#household` — the editable name field lives there.
   */
  householdName: string;
  /**
   * The signed-in user's id + display name (null when the profiles row is
   * missing — e.g. migration 012 not yet applied; the trigger fallback to the
   * email local-part hasn't run, etc.). Resolved server-side in
   * `app/list/page.tsx` via `fetchMyProfile`. Threaded down so the optimistic
   * insert path + own-row realtime hydration can render the right name
   * without "added by someone" flashing on a brand-new user's first add.
   */
  currentUser: { id: string; displayName: string | null };
}

type LoadState = 'loading' | 'ready' | 'error';

type SyncError = NonNullable<SyncErrorBannerProps['error']>;

/**
 * Build a `Map<storeId, { storeName, entries }>` preserving insertion order.
 * Empty stores are never present because grouping runs over actual entries.
 */
function groupByStore(
  entries: HydratedListEntry[]
): Array<{ storeId: string; storeName: string; entries: HydratedListEntry[] }> {
  const map = new Map<
    string,
    { storeName: string; entries: HydratedListEntry[] }
  >();
  for (const entry of entries) {
    const existing = map.get(entry.storeId);
    if (existing) {
      existing.entries.push(entry);
    } else {
      map.set(entry.storeId, {
        storeName: entry.storeName,
        entries: [entry],
      });
    }
  }
  return Array.from(map.entries()).map(([storeId, value]) => ({
    storeId,
    storeName: value.storeName,
    entries: value.entries,
  }));
}

/** Re-hydrate a realtime `list_entries` row with its stored item/store names. */
function hydrateFromRealtime(
  next: ListEntry,
  fallback: HydratedListEntry | null,
  currentUser: { id: string; displayName: string | null }
): HydratedListEntry {
  // Realtime-delivered rows don't carry the profiles join. Three-tier fallback:
  //   1. fallback?.addedByName — the previous local row already had a hydrated
  //      name (most common: optimistic insert + realtime echo of own row).
  //   2. currentUser.displayName — the row's author is the signed-in user, so
  //      use the name we resolved server-side in /list/page.tsx. Catches the
  //      "realtime INSERT lands before our optimistic local insert" race.
  //   3. null — author is another household member; fetchListEntries' second
  //      query will rehydrate with their real name on next page revisit.
  let addedByName = fallback?.addedByName ?? null;
  if (!addedByName && next.added_by === currentUser.id) {
    addedByName = currentUser.displayName;
  }
  return {
    id: next.id,
    householdId: next.household_id,
    itemId: next.item_id,
    itemName: fallback?.itemName ?? '',
    storeId: next.store_id,
    storeName: fallback?.storeName ?? '',
    brand: next.brand,
    quantity: next.quantity,
    unit: next.unit,
    status: next.status as HydratedListEntry['status'],
    addedAt: next.added_at,
    addedBy: next.added_by,
    addedByName,
  };
}

/**
 * List view client — fetches on mount, subscribes to realtime, owns the
 * add-item + disambiguation sheets, and surfaces the sync-error banner.
 */
export function ListClient({
  householdId,
  householdName,
  currentUser,
}: ListClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  // Debounce timer for realtime-event-triggered refetches (D6/A4 — 1s window).
  const refetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether we've already initiated the RemovedFromHouseholdError
  // redirect so a flurry of realtime events can't push() multiple times.
  const removedRedirectFiredRef = useRef(false);
  // Wake-recovery suppress-window timestamp (epoch ms; 0 = no active suppress).
  // Set when a wake event triggers a channel rebuild — guards both
  // `setSyncError({ type: 'realtime' })` sites for up to SUPPRESS_WINDOW_MS
  // until the rebuilt channel's onSubscribed callback clears it early. See
  // specs/sync-banner-pwa-recovery/spec.md § D2 / D3 / D6.
  const suppressBannerUntilRef = useRef(0);
  // Captures whether a CHANNEL_ERROR fired DURING the suppress window so the
  // wake handler's deferred banner-check (setTimeout at +SUPPRESS_WINDOW_MS)
  // can fire the banner if the rebuild failed and onSubscribed never ran.
  // Cleared by onSubscribed alongside suppressBannerUntilRef. See spec D2.
  const pendingErrorDuringSuppressRef = useRef(false);

  const [entries, setEntries] = useState<HydratedListEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [syncError, setSyncError] = useState<SyncError | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [disambigResponse, setDisambigResponse] =
    useState<AddItemResponse | null>(null);
  const [disambigUtterance, setDisambigUtterance] = useState('');
  // Tier A2 submission-failure banner (D8, D15) — set by AddItemSheet's
  // useOptimisticMutation when its retry budget exhausts. Null when no
  // pending submission failure. Survives sheet close; the banner exposes
  // explicit Retry + Undo affordances wired to the hook.
  const [submissionBanner, setSubmissionBanner] = useState<BannerState | null>(
    null
  );

  // Wrap incoming banner callbacks so Undo / Dismiss clear THIS parent
  // state — not just the (now-unmounted) sheet hook's state. Auto-close
  // unmounts the sheet on banner appearance (so its backdrop overlay
  // doesn't intercept Retry / Undo clicks); after that, calls into the
  // hook's setBanner are no-ops on a dead component, so the parent's
  // state has to clean itself up.
  const handleSubmissionBanner = useCallback((banner: BannerState | null) => {
    if (!banner) {
      setSubmissionBanner(null);
      return;
    }
    setSubmissionBanner({
      label: banner.label,
      retry: banner.retry,
      undo: () => {
        banner.undo();
        setSubmissionBanner(null);
      },
      dismiss: () => {
        banner.dismiss();
        setSubmissionBanner(null);
      },
    });
  }, []);

  const runFetch = useCallback(async () => {
    setLoadState('loading');
    setSyncError((prev) => (prev?.type === 'query' ? null : prev));
    try {
      const { entries: rows } = await fetchListEntries(supabase, householdId);
      setEntries(rows);
      setLoadState('ready');
    } catch (err) {
      // D6/A4: when the user has been removed from their household, the
      // wrapper throws RemovedFromHouseholdError. Tear down the realtime
      // channel (the unsubscribe in the realtime useEffect's cleanup runs
      // when the component unmounts on /onboarding navigation) and route
      // to /onboarding?removed=1 so the OnboardingPage can render the
      // RemovedFromHouseholdNotice.
      if (err instanceof RemovedFromHouseholdError) {
        if (!removedRedirectFiredRef.current) {
          removedRedirectFiredRef.current = true;
          router.push('/onboarding?removed=1');
        }
        return;
      }
      setLoadState('error');
      setSyncError({ type: 'query' });
    }
  }, [supabase, householdId, router]);

  // Initial load + refetch hook for retry. Kicked off via queueMicrotask so
  // the setState cascade inside `runFetch` doesn't happen synchronously in
  // the effect body — keeps React 19's `react-hooks/set-state-in-effect`
  // happy without restructuring the data flow. Same behavior, one tick later.
  useEffect(() => {
    queueMicrotask(() => {
      void runFetch();
    });
  }, [runFetch]);

  // Realtime subscription. Resubscribe tick tokens bump when the retry button
  // fires so we build a fresh channel after a CHANNEL_ERROR.
  const [realtimeTick, setRealtimeTick] = useState(0);
  useEffect(() => {
    const onChange = (change: ListEntryChange) => {
      const incoming = change.new as ListEntry | undefined;
      const outgoing = change.old as Partial<ListEntry> | undefined;

      if (change.eventType === 'INSERT' && incoming) {
        setEntries((current) => {
          if (current.some((e) => e.id === incoming.id)) return current;
          return [hydrateFromRealtime(incoming, null, currentUser), ...current];
        });
      } else if (change.eventType === 'UPDATE' && incoming) {
        setEntries((current) =>
          current.map((e) =>
            e.id === incoming.id
              ? hydrateFromRealtime(incoming, e, currentUser)
              : e
          )
        );
      } else if (change.eventType === 'DELETE' && outgoing?.id) {
        setEntries((current) => current.filter((e) => e.id !== outgoing.id));
      }

      // D6/A4: debounce-refetch (1s) on every realtime event so a removed
      // user's session detects the access-loss within ~1 round-trip via
      // current_household_id() returning null, which fetchListEntries turns
      // into a RemovedFromHouseholdError → /onboarding?removed=1 redirect.
      if (refetchDebounceRef.current) {
        clearTimeout(refetchDebounceRef.current);
      }
      refetchDebounceRef.current = setTimeout(() => {
        void runFetch();
      }, 1000);
    };

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = subscribeToList(
        supabase,
        householdId,
        onChange,
        () => {
          // CHANNEL_ERROR / TIMED_OUT from supabase-js — surface the banner so
          // the user sees the broken state and can tap-to-retry. Defer to the
          // next tick so the effect-synchronous lint stays happy (same pattern
          // as the synchronous-throw branch below).
          //
          // D6: guard inside the microtask (not the listener body) so the
          // suppress check sees a fresh Date.now() at the moment of
          // intent-to-show-banner. The suppress ref is set by the wake-event
          // useEffect below when an unhealthy wake triggers a rebuild;
          // CHANNEL_ERROR is the path that would otherwise light the banner
          // mid-rebuild on iOS PWA resume.
          queueMicrotask(() => {
            if (Date.now() < suppressBannerUntilRef.current) {
              // Inside suppress window — record that an error fired so the
              // wake handler's deferred check can surface the banner if the
              // rebuild ultimately fails. Returning here without setting the
              // pending ref would silently swallow a real failure when CHANNEL_
              // ERROR fires once and is never retried by supabase-js.
              pendingErrorDuringSuppressRef.current = true;
              return;
            }
            setSyncError({ type: 'realtime' });
          });
        },
        () => {
          // D3 + D5: SUBSCRIBED — channel is live. Clear any active wake-
          // recovery suppress so subsequent errors are surfaced normally.
          // Fires on every successful (re)subscription including the first
          // connect (where the refs are already cleared, no-op); load-bearing
          // for the rebuilt-after-wake case where we want to clear before
          // the 3s ceiling.
          suppressBannerUntilRef.current = 0;
          pendingErrorDuringSuppressRef.current = false;
        }
      );
    } catch {
      // Subscribing failed synchronously — surface the sync banner so the
      // user sees the broken state and can tap-to-retry. Defer the setState
      // to the next tick so the effect-synchronous lint stays happy.
      queueMicrotask(() => {
        if (Date.now() < suppressBannerUntilRef.current) {
          pendingErrorDuringSuppressRef.current = true;
          return;
        }
        setSyncError({ type: 'realtime' });
      });
    }

    return () => {
      unsubscribe?.();
      if (refetchDebounceRef.current) {
        clearTimeout(refetchDebounceRef.current);
        refetchDebounceRef.current = null;
      }
    };
  }, [supabase, householdId, realtimeTick, currentUser, runFetch]);

  // Wake-recovery (D1, D2, D3 of specs/sync-banner-pwa-recovery/spec.md).
  //
  // iOS PWA / desktop-sleep resume can land the realtime channel in
  // CHANNEL_ERROR/TIMED_OUT after the OS reaps the WebSocket while the tab
  // is hidden. Without this handler, the "Sync paused" banner appears every
  // time the app returns to foreground — even on healthy resumes — because
  // supabase-js's status callback fires before any reconnect attempt
  // completes.
  //
  // Bind one handler to three browser events (visibilitychange / online /
  // focus) to catch every wake shape (iOS PWA fires visibilitychange; subway
  // wifi-flap fires online; some webviews skip visibilitychange so focus is
  // the belt-and-suspenders).
  //
  // On wake: ALWAYS arm the suppress window, bump realtimeTick to force a
  // fresh channel build, and refetch. The earlier probe-and-skip-if-healthy
  // optimization was dropped — `isConnected()` reads `socket.conn?.readyState`,
  // which iOS lies about for ~30s after a TCP-level kill until the supabase-js
  // heartbeat catches up. The probe would report healthy on a freshly-resumed
  // PWA whose WS is actually dead at the OS level, skipping the rebuild and
  // letting the banner appear 30s later via heartbeat — the exact bug this PR
  // exists to fix, just delayed. Always-rebuild is ~50ms of work and a fresh
  // ground-truth channel every wake; cheaper than a flicker.
  //
  // The deferred banner-check is the safety net for the "rebuild itself
  // failed" case: if CHANNEL_ERROR fires during the suppress window, the
  // onError guard records it via pendingErrorDuringSuppressRef but doesn't
  // surface the banner (avoiding the transient flicker). A setTimeout at
  // SUPPRESS_WINDOW_MS reads that ref and fires the banner if the rebuild
  // is still broken AND onSubscribed never ran (which would have cleared
  // the ref). Cleanup clears the timer on unmount.
  useEffect(() => {
    let deferredBannerTimer: ReturnType<typeof setTimeout> | null = null;

    const handleWake = () => {
      // visibilitychange fires on both hidden→visible and visible→hidden;
      // only run recovery on the becoming-visible edge. online/focus don't
      // need this guard but the check is cheap and an honest no-op.
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
        return;
      }

      // Arm suppress BEFORE bumping the tick so the rebuild's CHANNEL_ERROR
      // (if any) finds the guard already armed. Reset the pending-error ref
      // so this wake's deferred check sees a clean slate. setRealtimeTick is
      // a React state setter so it's safe to call directly in an event
      // handler (not in an effect body).
      suppressBannerUntilRef.current = Date.now() + SUPPRESS_WINDOW_MS;
      pendingErrorDuringSuppressRef.current = false;
      setRealtimeTick((t) => t + 1);

      // Always refetch — REST is the source of truth regardless of whether
      // the rebuild succeeds.
      queueMicrotask(() => {
        void runFetch();
      });

      // Deferred banner-check: at suppress expiry, fire the banner if a
      // CHANNEL_ERROR fired during the window and onSubscribed never
      // cleared the pending ref. Replaces a prior wake-event's pending
      // check if one was still in flight.
      if (deferredBannerTimer !== null) {
        clearTimeout(deferredBannerTimer);
      }
      deferredBannerTimer = setTimeout(() => {
        if (pendingErrorDuringSuppressRef.current) {
          setSyncError({ type: 'realtime' });
          pendingErrorDuringSuppressRef.current = false;
        }
        deferredBannerTimer = null;
      }, SUPPRESS_WINDOW_MS);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleWake);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleWake);
      window.addEventListener('focus', handleWake);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleWake);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleWake);
        window.removeEventListener('focus', handleWake);
      }
      if (deferredBannerTimer !== null) {
        clearTimeout(deferredBannerTimer);
      }
    };
    // realtimeTick is intentionally NOT a dep — the wake handler uses the
    // functional setter `setRealtimeTick((t) => t + 1)`, which doesn't close
    // over the value; including it would re-bind the three listeners on
    // every tick bump (the wake itself triggers — a self-rebuilding effect
    // with no behavioral payoff). supabase + householdId are also not read
    // by the handler post-simplification, so the only meaningful dep is
    // runFetch (read inside the microtask).
  }, [runFetch]);

  // Refetch on JWT refresh (D8 of specs/sync-banner-pwa-recovery/spec.md).
  //
  // A refreshed JWT can expand `current_household_id()`'s answer (e.g., the
  // user was removed mid-session and re-added; their realtime subscription's
  // RLS scope updates only on the next token refresh). The next realtime
  // event will arrive under the new JWT, but until that event fires the
  // page shows stale data. One-line refetch closes the gap. No banner
  // side-effects — pure refresh.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent) => {
        if (event === 'TOKEN_REFRESHED') {
          void runFetch();
        }
      }
    );
    return () => {
      data.subscription.unsubscribe();
    };
  }, [supabase, runFetch]);

  // Tier A1 (D1, D10) mark-bought: optimistic fade is the visual
  // "I heard you", realtime DELETE reconciles the success path, rollback
  // restores the row + toasts on hard failure. No retry — the rollback
  // IS the message; retrying would re-fade-then-restore which is more
  // confusing than fail-fast.
  const buyMutation = useOptimisticMutation<{ entry: HydratedListEntry }, void>(
    {
      applyOptimistic: ({ entry }) => {
        // Fade the row (50% opacity via ListRow's isBuying prop). Realtime
        // DELETE usually beats our local removal once mark_item_bought
        // completes; the reconciler is idempotent so double-removal is a
        // no-op.
        setBuyingId(entry.id);
      },
      mutate: async ({ entry }) => {
        await markItemBought(supabase, entry.id);
        const timeOnList = Math.max(
          0,
          Math.round((Date.now() - new Date(entry.addedAt).getTime()) / 1000)
        );
        trackItemBought({ time_on_list_seconds: timeOnList });
        // Defer the local cleanup so the optimistic fade is observable.
        // Without this, a fast RPC (~50ms on local Supabase) lets React
        // batch applyOptimistic + setBuyingId(null) into the same render
        // and the user / Playwright's poll never see opacity-50. The
        // 200ms window is well below the perceived-instant threshold
        // and gives the poll cycle time to land. Realtime DELETE may
        // race with this — both paths are idempotent.
        setTimeout(() => {
          setEntries((current) => current.filter((e) => e.id !== entry.id));
          setBuyingId(null);
        }, 200);
      },
      onFailure: {
        failureMode: 'rollback',
        rollback: () => {
          // Clear the fade + toast. queueMicrotask defer (inside the hook)
          // ensures the optimistic fade frame paints before the rollback
          // setState lands (spec gotcha 1).
          setBuyingId(null);
          setToast("Couldn't mark bought — try again");
        },
      },
    }
  );

  const handleBuy = useCallback(
    (entry: HydratedListEntry) => {
      void buyMutation.run({ entry });
    },
    [buyMutation]
  );

  const handleRemove = useCallback(
    async (entry: HydratedListEntry) => {
      try {
        await deleteListEntry(supabase, entry.id);
        setEntries((current) => current.filter((e) => e.id !== entry.id));
      } catch {
        setToast("Couldn't remove — try again");
      }
    },
    [supabase]
  );

  const handleAddResponse = useCallback(
    (response: AddItemResponse) => {
      // Cascading follow-up (e.g. the user picked an item; server now needs
      // a store). Swap the disambiguation sheet's `response` in place so the
      // user sees the next round of options instead of a silently-closed
      // sheet + no feedback.
      if (response.needs_followup) {
        setDisambigResponse(response);
        return;
      }

      // Happy path: optimistically insert the row so the user sees immediate
      // feedback. Realtime's INSERT event dedup-merges by id (see the
      // `current.some((e) => e.id === incoming.id)` guard in the Realtime
      // handler). This also masks the blank-names problem that hits when
      // Realtime alone seeds the row — it delivers only raw FK ids, not the
      // joined item/store names — because our optimistic entry uses the
      // server response which already carries the resolved names.
      if (response.entry_id && response.canonical_item && response.store) {
        const optimistic: HydratedListEntry = {
          id: response.entry_id,
          householdId,
          itemId: response.canonical_item.id,
          itemName: response.canonical_item.name,
          storeId: response.store.id,
          storeName: response.store.name,
          brand: response.brand ?? null,
          quantity: 1,
          unit: null,
          status: 'pending',
          addedAt: new Date().toISOString(),
          // The signed-in user IS the author of any add originating from this
          // client — the edge function's `added_by: user.id` write matches the
          // session's user. Populate locally so the row renders with the right
          // name immediately instead of flashing "added by someone" until the
          // next page revisit. `currentUser.displayName` is null when the
          // profiles row hasn't seeded yet (PGRST205 / pre-migration env);
          // ListRow's `?? 'someone'` fallback covers that.
          addedBy: currentUser.id,
          addedByName: currentUser.displayName,
        };
        setEntries((current) => {
          // Race: Realtime's INSERT might have landed first and added a
          // blank-name row (hydrateFromRealtime has no item/store join).
          // Whichever arrived first, we end up with the server-resolved
          // names from the AddItemResponse.
          const idx = current.findIndex((e) => e.id === optimistic.id);
          if (idx === -1) return [optimistic, ...current];
          const next = [...current];
          next[idx] = optimistic;
          return next;
        });
      }

      const itemLabel = response.canonical_item?.name ?? 'item';
      const storeLabel = response.store?.name;
      setToast(
        storeLabel
          ? `Added ${itemLabel} to ${storeLabel}`
          : `Added ${itemLabel}`
      );
    },
    [householdId, currentUser]
  );

  const handleDisambiguationNeeded = useCallback(
    (response: AddItemResponse, originalUtterance: string) => {
      setDisambigResponse(response);
      setDisambigUtterance(originalUtterance);
    },
    []
  );

  const groups = useMemo(() => groupByStore(entries), [entries]);
  const showEmpty = loadState === 'ready' && entries.length === 0;
  const showSkeleton = loadState === 'loading';

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SyncErrorBanner
        affordance="tap-to-retry"
        error={syncError}
        onDismiss={() => setSyncError(null)}
        onRetry={() => {
          // If it's a query error, just re-fetch. For a realtime error, bump
          // the tick so the useEffect builds a new channel.
          if (syncError?.type === 'query') {
            void runFetch();
          } else {
            setRealtimeTick((t) => t + 1);
          }
          setSyncError(null);
        }}
      />

      {/* Tier A2 submission-failure banner — fires when AddItemSheet's
          useOptimisticMutation exhausts its retry budget. Stays mounted
          across sheet close so users who navigate away still see the
          failure. Retry/Undo wire to the hook's BannerState handlers. */}
      <SyncErrorBanner
        affordance="retry-undo"
        error={submissionBanner ? { type: 'sync' } : null}
        label={submissionBanner?.label ?? ''}
        onDismiss={() => submissionBanner?.dismiss()}
        onRetry={() => submissionBanner?.retry()}
        onUndo={() => submissionBanner?.undo()}
      />

      {/* D12: caption-cap household-name header above the wordmark — soft
          tap-target → /settings#household. NOT a Fraunces moment per the
          design review (the list is a workspace; brand lives in empty
          states + sheets). 44px tap area; truncate on overflow. */}
      <Link
        href="/settings#household"
        aria-label={`Household: ${householdName} (tap to edit in Settings)`}
        className="inline-flex min-h-[44px] items-center px-md pt-md pb-xs"
      >
        <span className="truncate font-body text-[13px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          {householdName}
        </span>
      </Link>
      <header className="flex items-center justify-between px-md pb-md">
        <span className="font-display text-[28px] font-semibold text-text-primary">
          lalista
        </span>
        <Link
          href="/settings"
          aria-label="Open settings"
          className="flex h-[44px] w-[44px] items-center justify-center rounded-default text-text-secondary hover:bg-surface-2"
        >
          <span aria-hidden="true" className="font-body text-[20px]">
            ⚙
          </span>
        </Link>
      </header>

      <main className="flex flex-1 flex-col pb-[96px]">
        {showSkeleton && (
          <div className="flex flex-col gap-md p-md">
            {[0, 1, 2].map((i) => (
              <LoadingArea
                key={i}
                label="Loading your list"
                className="h-[72px]"
              />
            ))}
          </div>
        )}

        {loadState === 'error' && entries.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-sm p-xl text-center">
            <p className="font-body text-[15px] text-text-primary">
              Couldn&apos;t load your list.
            </p>
            <button
              type="button"
              onClick={() => void runFetch()}
              className="min-h-[44px] rounded-[100px] bg-primary px-md py-sm font-body text-[15px] font-medium text-white hover:bg-primary-pressed"
            >
              Retry
            </button>
          </div>
        )}

        {showEmpty && <EmptyListState onAddFirst={() => setAddOpen(true)} />}

        {!showSkeleton && !showEmpty && groups.length > 0 && (
          <div className="flex flex-col">
            {groups.map((group) => (
              <StoreSection
                key={group.storeId}
                storeName={group.storeName}
                itemCount={group.entries.length}
              >
                {group.entries.map((entry) => (
                  <ListRow
                    key={entry.id}
                    entry={entry}
                    onBuy={handleBuy}
                    onRemove={handleRemove}
                    isBuying={buyingId === entry.id}
                  />
                ))}
              </StoreSection>
            ))}
          </div>
        )}
      </main>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        aria-label="Add item to lalista"
        className="fixed bottom-lg right-lg z-10 min-h-[48px] rounded-[100px] bg-primary px-md py-sm font-body text-[15px] font-medium text-white shadow-lg hover:bg-primary-pressed"
      >
        + Add
      </button>

      {addOpen && (
        <AddItemSheet
          open={addOpen}
          onClose={() => setAddOpen(false)}
          householdId={householdId}
          client={supabase}
          onDisambiguationNeeded={handleDisambiguationNeeded}
          onItemAdded={handleAddResponse}
          onSubmissionBanner={handleSubmissionBanner}
        />
      )}

      {disambigResponse && (
        <DisambiguationSheet
          open={disambigResponse !== null}
          onClose={() => {
            setDisambigResponse(null);
            setDisambigUtterance('');
          }}
          householdId={householdId}
          client={supabase}
          onSubmissionBanner={handleSubmissionBanner}
          response={disambigResponse}
          originalUtterance={disambigUtterance}
          onItemAdded={handleAddResponse}
        />
      )}

      {toast && (
        <ConfirmationToast message={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
