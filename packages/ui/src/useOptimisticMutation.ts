// What: Tier A1 + A2 hook — optimistic-commit-then-retry mutation engine
//       with discriminated-union failure mode.
// Why: Same engine drives mark-bought / display-name save (A1: rollback) and
//      add-item / disambiguation-pick (A2: retry-then-banner). Centralizing
//      the timing + retry shape keeps every Tier A surface compliant with
//      the framework decision rule (D8 retry budget + backoff cadence).
// Does NOT: Render UI — caller wires the banner state into SyncErrorBanner.
//           Caller's applyOptimistic / rollback own the actual list mutation;
//           this hook just orchestrates timing.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RETRY_BACKOFF_MS, RETRY_BUDGET_MS } from './tokens';

/**
 * Discriminated union — `failureMode` selects between Tier A1 (rollback only)
 * and Tier A2 (retry then banner).
 */
export type OptimisticFailureMode =
  | { failureMode: 'rollback'; rollback: () => void }
  | {
      failureMode: 'banner';
      rollback: () => void;
      bannerLabel: string;
      onBannerDismiss?: () => void;
    };

export interface OptimisticMutationConfig<TArgs, TResult> {
  /** The async work that happens in the background after the optimistic commit. */
  mutate: (args: TArgs) => Promise<TResult>;
  /** Apply the optimistic state — runs synchronously when run() is called. */
  applyOptimistic: (args: TArgs) => void;
  /** Failure-mode discriminated union — see above. */
  onFailure: OptimisticFailureMode;
  /**
   * 4xx/5xx classifier — returns true for "server rejected, no retry".
   * Defaults to: any error with a numeric status >= 400 && < 600.
   */
  isHardError?: (err: unknown) => boolean;
}

export interface BannerState {
  label: string;
  /** Re-fire the most recent mutation. Closes the banner on success. */
  retry: () => void;
  /** Run the registered rollback and close the banner. */
  undo: () => void;
  /** Dismiss without retry/undo — caller-owned cleanup if any. */
  dismiss: () => void;
}

export interface OptimisticMutationResult<TArgs> {
  run: (args: TArgs) => Promise<void>;
  isPending: boolean;
  /** Banner-mode only — non-null when a hard failure surfaced. */
  banner: BannerState | null;
}

const RETRY_ATTEMPTS = RETRY_BACKOFF_MS.length;

/**
 *
 */
function defaultIsHardError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeStatus = (err as { status?: unknown }).status;
  if (typeof maybeStatus === 'number') {
    return maybeStatus >= 400 && maybeStatus < 600;
  }
  // No numeric status → treat as transient (network blip). Callers needing
  // custom classification (e.g. validation errors with no HTTP status)
  // override via the config.isHardError callback.
  return false;
}

/**
 * Tier A1 / A2 optimistic mutation engine.
 *
 * On run():
 *  1. applyOptimistic(args) commits visually (synchronously).
 *  2. mutate(args) fires in the background.
 *  3. On rejection:
 *     - rollback mode: rollback() — single attempt, no retry.
 *       Rollback is scheduled via queueMicrotask so React paints the
 *       optimistic frame BEFORE the rollback lands. Without this,
 *       React 19's auto-batching elides the visible "row appeared then
 *       disappeared" frame and the user sees no feedback at all.
 *     - banner mode: retry per RETRY_BACKOFF_MS unless isHardError(err)
 *       returns true. On exhaustion / hard error, surface a banner
 *       with retry + undo affordances.
 */
export function useOptimisticMutation<TArgs, TResult>(
  config: OptimisticMutationConfig<TArgs, TResult>
): OptimisticMutationResult<TArgs> {
  const [isPending, setIsPending] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);

  // Ref-based config mirror so callbacks captured by setBanner / setTimeout
  // always see the latest props without re-binding the run() callback identity.
  const configRef = useRef(config);
  configRef.current = config;

  // Track retry timers so unmount/dismiss/new-run clears them.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // runAttempt and escalateBanner reference each other. We use a ref to
  // break the circular forward-declaration so each closure captures the
  // ref (stable identity) rather than the other callback (which would
  // require declaration-order gymnastics).
  type AttemptFn = (
    args: TArgs,
    attempt: number,
    startedAt: number
  ) => Promise<void>;
  const runAttemptRef = useRef<AttemptFn | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const escalateBanner = useCallback(
    (args: TArgs) => {
      const cfg = configRef.current;
      if (cfg.onFailure.failureMode !== 'banner') return;
      const { rollback, bannerLabel, onBannerDismiss } = cfg.onFailure;

      const dismiss = () => {
        clearTimer();
        setBanner(null);
        setIsPending(false);
        if (onBannerDismiss) onBannerDismiss();
      };

      const undo = () => {
        clearTimer();
        rollback();
        setBanner(null);
        setIsPending(false);
      };

      const retry = () => {
        clearTimer();
        setBanner(null);
        setIsPending(true);
        const fn = runAttemptRef.current;
        if (fn) void fn(args, 0, Date.now());
      };

      setIsPending(false);
      setBanner({ label: bannerLabel, retry, undo, dismiss });
    },
    [clearTimer]
  );

  const runAttempt = useCallback<AttemptFn>(
    async (args, attempt, startedAt) => {
      const cfg = configRef.current;
      const isHard = cfg.isHardError ?? defaultIsHardError;

      try {
        await cfg.mutate(args);
        setIsPending(false);
      } catch (err) {
        if (cfg.onFailure.failureMode === 'rollback') {
          // Rollback after the optimistic frame paints, not synchronously.
          // queueMicrotask defers the rollback's setState one tick so
          // React 19's auto-batching can't elide the visible
          // "row appeared then disappeared" frame.
          queueMicrotask(() => {
            const latest = configRef.current.onFailure;
            if (latest.failureMode === 'rollback') {
              latest.rollback();
            }
            setIsPending(false);
          });
          return;
        }

        // Banner mode: retry-or-escalate.
        const elapsed = Date.now() - startedAt;
        const isLastAttempt = attempt >= RETRY_ATTEMPTS;
        const hardError = isHard(err);

        if (hardError || isLastAttempt) {
          escalateBanner(args);
          return;
        }

        const backoff = RETRY_BACKOFF_MS[attempt] ?? 0;
        // If we'd blow the budget, escalate now rather than scheduling a
        // doomed-to-be-ignored retry.
        if (elapsed + backoff > RETRY_BUDGET_MS) {
          escalateBanner(args);
          return;
        }

        clearTimer();
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          const fn = runAttemptRef.current;
          if (fn) void fn(args, attempt + 1, startedAt);
        }, backoff);
      }
    },
    [clearTimer, escalateBanner]
  );

  // Mirror runAttempt onto the ref so escalateBanner's retry handler can
  // call it without violating the dependency rule.
  runAttemptRef.current = runAttempt;

  // Cancel any pending retry timer on unmount — a queued setTimeout that
  // fires after the consumer unmounts would call setState on an unmounted
  // hook (React 18+ warns; the queued attempt also fires a side-effect-y
  // mutate that the caller no longer expects to run).
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const run = useCallback(
    async (args: TArgs) => {
      const cfg = configRef.current;
      // Clear any prior banner — a new run supersedes the old failure.
      setBanner(null);
      clearTimer();
      // applyOptimistic runs synchronously so the visual change commits
      // in the same render the click handler triggers.
      cfg.applyOptimistic(args);
      setIsPending(true);
      await runAttempt(args, 0, Date.now());
    },
    [clearTimer, runAttempt]
  );

  return { run, isPending, banner };
}
