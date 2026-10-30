// What: Shared 60s countdown hook for the resend buttons in
//       AwaitingConfirmationCard + /forgot-password.
// Why: Both surfaces had identical formatCountdown helpers, COUNTDOWN_SECONDS
//      constants, and useEffect-driven interval bookkeeping (~25 lines each).
//      One helper means one place to evolve the countdown UX (e.g. ramp up
//      to 5 minutes after N resends) and one place to bug-fix the cleanup.
// Does NOT: Trigger the resend itself (caller passes a `reset()` to call
//           after a successful resend), persist across reloads, or know
//           about the action being throttled — it's a pure timer.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Default resend gate — 60s per spec D2. Exported for callers that want to
 *  surface the same value in copy. */
export const RESEND_COUNTDOWN_SECONDS = 60;

/** Format an integer second count as M:SS for the countdown label. */
export function formatCountdown(secondsRemaining: number): string {
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface UseResendCountdownReturn {
  /** Whole seconds left in the current cooldown window (0 → ready). */
  secondsRemaining: number;
  /** True iff the cooldown has elapsed and the user can resend again. */
  canResend: boolean;
  /** Reset the timer to the full duration — call after a successful resend. */
  reset: () => void;
}

/**
 * Headless countdown for resend buttons.
 *
 * Pass `active=false` to keep the timer paused (the forgot-password flow uses
 * this to gate the countdown to the "sent" state). Pass `active=true` from
 * mount (AwaitingConfirmationCard's shape) to start counting down immediately.
 *
 * Always starts at `durationSeconds`. Use `reset()` after a successful resend
 * to start a fresh window without remounting the component.
 */
export function useResendCountdown(
  active: boolean,
  durationSeconds: number = RESEND_COUNTDOWN_SECONDS
): UseResendCountdownReturn {
  const [secondsRemaining, setSecondsRemaining] = useState(durationSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || secondsRemaining <= 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [active, secondsRemaining]);

  const reset = useCallback(() => {
    setSecondsRemaining(durationSeconds);
  }, [durationSeconds]);

  return {
    secondsRemaining,
    canResend: secondsRemaining <= 0,
    reset,
  };
}
