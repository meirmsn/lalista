// What: Tier B latency-feedback button — instant disable + 250ms-threshold
//       spinner + post-success label swap. Built on useSubmitFeedback.
// Why: Lifted from apps/web/components/AuthSubmitButton.tsx so non-auth
//      callers (Settings → Sign out, etc.) can adopt the same affordance
//      from the design system rather than each re-implementing the
//      threshold timer. Behavior identical to AuthSubmitButton —
//      verified by porting its test cases (see SubmitButton.test.tsx).
// Does NOT: Manage form state, dispatch network calls, or own the
//           pending/success flags — caller passes them in. Failure path
//           is the caller's responsibility (this is a presentational
//           component; for retrying optimistic mutations, see
//           useOptimisticMutation).

'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from './Button';
import { useSubmitFeedback } from './useSubmitFeedback';

export interface SubmitButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  /** Visible label in the idle state. */
  children: ReactNode;
  /** True while the form's network call is in-flight. */
  isPending: boolean;
  /** Label swapped in once the spinner threshold elapses. Defaults to children. */
  pendingLabel?: ReactNode;
  /** True after the action resolved successfully (caller-controlled). */
  isSuccess?: boolean;
  /** Label swapped in on success. Defaults to children. Button stays disabled. */
  successLabel?: ReactNode;
}

/**
 * Tier B submit button: instant disable on click + spinner-after-250ms.
 *
 * The disabled flag flips synchronously when isPending=true, communicating
 * "I heard you" without waiting on the threshold. The spinner only appears
 * if the action is still in flight after FEEDBACK_THRESHOLD_MS — fast
 * resolves (<250ms) feel snappy without flashing a spinner.
 */
export function SubmitButton({
  children,
  isPending,
  pendingLabel,
  isSuccess = false,
  successLabel,
  className = '',
  type = 'submit',
  disabled: disabledProp,
  ...rest
}: SubmitButtonProps) {
  const { showSpinner } = useSubmitFeedback(isPending);

  const disabled = isPending || isSuccess || Boolean(disabledProp);
  const label = isSuccess
    ? (successLabel ?? children)
    : showSpinner
      ? (pendingLabel ?? children)
      : children;

  return (
    <Button
      {...rest}
      type={type}
      disabled={disabled}
      aria-busy={isPending}
      className={`w-full ${className}`}
    >
      <span className="inline-flex items-center justify-center gap-xs">
        {showSpinner && !isSuccess && (
          <span
            data-testid="submit-button-spinner"
            aria-hidden="true"
            className="inline-block h-[14px] w-[14px] animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        )}
        <span>{label}</span>
      </span>
    </Button>
  );
}
