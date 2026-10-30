// What: Hard-gate card shown after sign-up while awaiting email confirmation.
//       Visible until onAuthStateChange fires SIGNED_IN (post-link-click).
//       60s visible-countdown resend button per spec D2.
// Why: Without this, post-signup users with no session would push to
//      /onboarding and middleware would bounce them back to /sign-in
//      silently — looks like a broken form. Hard-gate so they understand
//      the flow + give them a single recover-able action (resend).
// Does NOT: Time out, auto-dismiss, or poll. Listens to the auth event
//           stream and trusts Supabase to fire SIGNED_IN once the user
//           clicks the link in another tab and that tab updates the
//           shared session cookie. (Gotcha (d) in the spec.)

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, SubmitButton, Text } from '@lalista/ui';
import { onAuthStateChange } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { AuthErrorDisplay } from './AuthErrorDisplay';
import { friendlyAuthError } from './auth/friendlyAuthError';
import { formatCountdown, useResendCountdown } from './auth/useResendCountdown';
import { trackEmailConfirmationResent } from '@/lib/analytics';

interface AwaitingConfirmationCardProps {
  email: string;
  /**
   * Optional callback for the "Edit and try again" back-link. The card itself
   * is rendered by /sign-up's local `awaitingConfirmation` state, so a plain
   * <Link href="/sign-up"> would no-op (the user is already on /sign-up).
   * The callback flips the parent's state back so the form re-renders.
   */
  onEdit?: () => void;
  /**
   * True when the parent screen has an invite token in the URL — appends
   * the "your invite is saved" caption per Pass 2 of the household-
   * collaborators design. Default false preserves the prior shape.
   */
  inviteContext?: boolean;
}

/** Awaiting-confirmation card with 60s visible-countdown resend. */
export function AwaitingConfirmationCard({
  email,
  onEdit,
  inviteContext = false,
}: AwaitingConfirmationCardProps) {
  const router = useRouter();
  const { secondsRemaining, canResend, reset } = useResendCountdown(true);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listen for the SIGNED_IN event so we auto-redirect when the user
  // clicks the confirmation link in another tab and Supabase syncs the
  // shared session cookie.
  useEffect(() => {
    const supabase = createClient();
    const subscription = onAuthStateChange(supabase, (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        router.replace('/onboarding');
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  /**
   *
   */
  async function handleResend() {
    if (!canResend) return;
    setResending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (resendError) {
        setError(friendlyAuthError(resendError.message));
        return;
      }
      trackEmailConfirmationResent({ source: 'sign-up' });
      reset();
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  const resendLabel = canResend
    ? 'Resend confirmation email'
    : `Resend in ${formatCountdown(secondsRemaining)}`;

  return (
    <Card className="flex flex-col gap-md p-lg">
      <div className="flex flex-col gap-xs">
        <Text as="h1" variant="heading-lg">
          Check your email
        </Text>
        <Text variant="body" className="text-text-secondary">
          We sent a confirmation link to <strong>{email}</strong>. Click it to
          finish creating your account — we’ll bring you in automatically.
        </Text>
        {inviteContext && (
          <Text
            variant="caption"
            className="text-text-tertiary"
            data-testid="awaiting-confirmation-invite-caption"
          >
            your invite is saved — confirm your email and you&apos;ll land in
            the list.
          </Text>
        )}
      </div>

      <AuthErrorDisplay error={error} />

      <SubmitButton
        type="button"
        onClick={handleResend}
        isPending={resending}
        pendingLabel="Resending…"
        disabled={!canResend}
      >
        {resendLabel}
      </SubmitButton>

      {onEdit && (
        <div className="text-center">
          <Text variant="caption" className="text-text-secondary">
            Wrong email?{' '}
            <button
              type="button"
              onClick={onEdit}
              className="underline underline-offset-2 hover:text-text-primary"
            >
              Edit and try again
            </button>
          </Text>
        </div>
      )}
    </Card>
  );
}
