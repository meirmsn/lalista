// What: Destructive-styled sign-out button for the Settings page —
//       Tier B affordance: instant disable + 250ms-threshold spinner +
//       success label "Signing out…".
// Why: Settings is the authoritative home for sign-out per spec D5; keeps the
//      list-view header clean of auth widgets. Tier B (D1) — user is waiting
//      on a server round-trip with no local state to commit, action gates
//      further progress (router.push to /sign-in). The destructive border +
//      text-error styling is a design decision that doesn't fit SubmitButton's
//      primary-bg presentation, so this component composes useSubmitFeedback
//      directly while still obeying the Tier B framework: instant disable,
//      threshold-gated spinner, post-success label swap.
// Does NOT: Confirm before signing out — sign-in is one-tap fallback so the
//           mistake cost is tiny (and matches iOS/HIG)

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@lalista/core';
import { useSubmitFeedback } from '@lalista/ui';
import { createClient } from '@/lib/supabase/client';

/** Sign-out button. Calls signOut → redirects to /sign-in. */
export function SignOutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showSpinner } = useSubmitFeedback(submitting);

  /**
   *
   */
  async function handleSignOut() {
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      await signOut(supabase);
      // Keep the button disabled with the post-success label while the
      // navigation completes — submitting flips false but success stays true
      // so the button doesn't briefly re-enable before the route changes.
      setSuccess(true);
      setSubmitting(false);
      router.push('/sign-in');
    } catch {
      setError("Couldn't sign out. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  const disabled = submitting || success;
  const label = success
    ? 'Signing out…'
    : showSpinner
      ? 'Signing out…'
      : 'Sign out';

  return (
    <div className="flex flex-col gap-xs">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={disabled}
        aria-busy={submitting}
        className="min-h-[44px] rounded-default border border-error bg-transparent px-md py-sm font-body text-[15px] font-medium text-error hover:bg-error-bg disabled:opacity-50"
      >
        <span className="inline-flex items-center justify-center gap-xs">
          {showSpinner && !success && (
            <span
              data-testid="sign-out-spinner"
              aria-hidden="true"
              className="inline-block h-[14px] w-[14px] animate-spin rounded-full border-2 border-error/40 border-t-error"
            />
          )}
          <span>{label}</span>
        </span>
      </button>
      {error && (
        <span role="alert" className="font-body text-[13px] text-error">
          {error}
        </span>
      )}
    </div>
  );
}
