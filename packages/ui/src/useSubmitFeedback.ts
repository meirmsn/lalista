// What: Tier B latency-feedback hook — encapsulates the 250ms-threshold
//       spinner timer + cleanup state machine lifted from
//       AuthSubmitButton's inline useEffect pattern.
// Why: SubmitButton (web) and any future Tier B affordance — including
//      a possible native-platform equivalent at the framework level —
//      need the same threshold timing. Hook separates timing logic
//      from presentation so the policy lives in one place.
// Does NOT: Own isPending — caller drives it. Does not render UI.

'use client';

import { useEffect, useRef, useState } from 'react';
import { FEEDBACK_THRESHOLD_MS } from './tokens';

export interface UseSubmitFeedbackOptions {
  /** Threshold before showSpinner flips true. Defaults to FEEDBACK_THRESHOLD_MS (250ms). */
  thresholdMs?: number;
}

export interface UseSubmitFeedbackResult {
  /** True only after the threshold has elapsed AND isPending is still true. */
  showSpinner: boolean;
}

/**
 * Tier B threshold-spinner state machine.
 *
 * Schedules a setTimeout each time `isPending` flips true. When the
 * threshold elapses, sets `showSpinner = true`. The cleanup function
 * (returned from the effect) cancels any unfired timer AND resets
 * `showSpinner` via a functional setter so future renders see the
 * right value without a synchronous-in-effect setState.
 *
 * The setShowSpinner inside cleanup is React-safe — cleanup runs as
 * part of the next effect pass / unmount, NOT synchronously after the
 * render that triggered it. This is the load-bearing detail that makes
 * the threshold-then-clear sequencing race-free; preserving it is a
 * spec invariant (see CLAUDE.md gotcha note in app-snappiness spec).
 */
export function useSubmitFeedback(
  isPending: boolean,
  options: UseSubmitFeedbackOptions = {}
): UseSubmitFeedbackResult {
  const { thresholdMs = FEEDBACK_THRESHOLD_MS } = options;
  const [showSpinner, setShowSpinner] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isPending) return undefined;
    timerRef.current = setTimeout(() => {
      setShowSpinner(true);
    }, thresholdMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShowSpinner(false);
    };
  }, [isPending, thresholdMs]);

  return { showSpinner };
}
