// What: Sticky amber banner atop the list view when realtime/query breaks
//       OR when an optimistic-mutation retry budget is exhausted (Tier A2).
// Why: Users working from stale data without a hint would silently miss shared
//      updates. An obvious-but-non-destructive banner restores confidence.
//      Discriminated `affordance` switches between the existing tap-to-retry
//      bar (realtime/query) and the new retry/undo affordance for Tier A2
//      optimistic-mutation failures.
// Does NOT: Rebuild the subscription itself — the list-view owner wires up the
//           retry handler; this component is presentational + metric-firing

'use client';

import { useEffect } from 'react';
import type { ErrorType } from '@/lib/analytics';
import { trackErrorDisplayed } from '@/lib/analytics';

export type SyncErrorAffordance =
  | {
      /**
       * Realtime/query failure UX (pre-existing): tap anywhere on the bar
       * to retry, ✕ to dismiss. Banner stays generic ("Sync paused").
       */
      affordance: 'tap-to-retry';
    }
  | {
      /**
       * Tier A2 optimistic-mutation failure UX: explicit "Retry" and
       * "Undo" buttons, plus a label naming the failed item. Used by
       * useOptimisticMutation's banner state.
       */
      affordance: 'retry-undo';
      /** Item label rendered in the banner copy ("Couldn't save 'milk'"). */
      label: string;
      /** Run the rollback registered with the optimistic mutation. */
      onUndo: () => void;
    };

export type SyncErrorBannerProps = {
  /**
   * null when healthy; set to a typed error when realtime or query fails.
   * The banner fires `error_displayed` once per null → non-null transition.
   */
  error: { type: ErrorType } | null;
  /** Dismiss click — hides until the next error sets a new value. */
  onDismiss: () => void;
  /** Retry handler — for tap-to-retry, fired by bar-tap; for retry-undo, fired by Retry button. */
  onRetry: () => void;
  /** Screen label for the `error_displayed` event. Defaults to "list". */
  screen?: string;
} & SyncErrorAffordance;

/** Amber bar — renders above the scrollable list area. */
export function SyncErrorBanner(props: SyncErrorBannerProps) {
  const { error, onDismiss, onRetry, screen = 'list' } = props;

  // Fire once when error transitions null → non-null. Keyed on the error type
  // so a subsequent transition (e.g. realtime → query) re-fires; same-type
  // re-renders don't re-capture.
  const errorType = error?.type;
  useEffect(() => {
    if (errorType) {
      trackErrorDisplayed({ error_type: errorType, screen });
    }
  }, [errorType, screen]);

  if (!error) return null;

  if (props.affordance === 'retry-undo') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-sm bg-warning-bg px-md py-sm text-warning"
      >
        <span
          className="font-body text-[14px] font-medium"
          data-testid="sync-error-label"
        >
          {props.label}
        </span>
        <span className="ml-auto flex items-center gap-xs">
          <button
            type="button"
            onClick={onRetry}
            className="px-sm py-xs font-body text-[14px] font-semibold underline-offset-2 hover:underline"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={props.onUndo}
            className="px-sm py-xs font-body text-[14px] font-semibold underline-offset-2 hover:underline"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss sync warning"
            className="px-xs py-xs font-body text-[16px] leading-none"
          >
            ✕
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-10 flex items-center justify-between gap-sm bg-warning-bg px-md py-sm text-warning"
    >
      <button
        type="button"
        onClick={onRetry}
        className="flex-1 text-left font-body text-[14px] font-medium"
      >
        Sync paused — tap to retry
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss sync warning"
        className="px-xs py-xs font-body text-[16px] leading-none"
      >
        ✕
      </button>
    </div>
  );
}
