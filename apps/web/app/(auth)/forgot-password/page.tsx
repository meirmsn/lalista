// What: Forgot-password screen — single email input, no-enumeration success state,
//       60s visible-countdown resend per spec D2.
// Why: Standard reset flow, but the no-enumeration promise is structural
//      (gotcha (c) in the spec): we never inspect resetPasswordForEmail's
//      response shape — Supabase intentionally returns success either way
//      and we mirror that.
// Does NOT: Tell the user whether their email exists. Even on errors that
//           aren't related to enumeration (e.g. a transport failure), the
//           generic "if an account exists with that email…" copy stays.

'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Card, Input, SubmitButton, Text } from '@lalista/ui';
import { createClient } from '@/lib/supabase/client';
import { AuthErrorDisplay } from '@/components/AuthErrorDisplay';
import {
  formatCountdown,
  useResendCountdown,
} from '@/components/auth/useResendCountdown';
import { trackPasswordResetRequested } from '@/lib/analytics';
import { useAuthEmail } from '../_email-context';

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Forgot-password screen — submit → success copy + resend countdown. */
export default function ForgotPasswordPage() {
  const { email, setEmail } = useAuthEmail();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const { secondsRemaining, canResend, reset } = useResendCountdown(sent);

  /** Build the absolute callback URL — Supabase needs an absolute origin. */
  function buildRedirectTo(): string {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:3000';
    return `${origin}/auth/callback?type=recovery`;
  }

  /** POST the reset email; returns true on success, false on transport error. */
  async function sendResetEmail(): Promise<boolean> {
    const supabase = createClient();
    try {
      // Fire and forget — we never inspect the response shape (no-enumeration).
      // Supabase intentionally returns success either way; mirror that.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildRedirectTo(),
      });
      trackPasswordResetRequested();
      return true;
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
      return false;
    }
  }

  /**
   *
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!EMAIL_FORMAT.test(email)) {
      setError('Enter a valid email address.');
      return;
    }

    setSubmitting(true);
    const ok = await sendResetEmail();
    setSubmitting(false);
    if (ok) {
      setSent(true);
      reset();
    }
  }

  /**
   *
   */
  async function handleResend() {
    if (!canResend) return;
    setError(null);
    setSubmitting(true);
    const ok = await sendResetEmail();
    setSubmitting(false);
    if (ok) {
      reset();
    }
  }

  /**
   *
   */
  function handleEditEmail() {
    setSent(false);
    setError(null);
    // Email kept (in context) so the user only edits the typo.
  }

  if (sent) {
    const resendLabel = canResend
      ? 'Resend reset email'
      : `Resend in ${formatCountdown(secondsRemaining)}`;
    return (
      <Card className="flex flex-col gap-md p-lg">
        <div className="flex flex-col gap-xs">
          <Text as="h1" variant="heading-lg">
            Check your email
          </Text>
          <Text variant="body" className="text-text-secondary">
            If <strong>{email}</strong> is registered, a reset link is on its
            way.
          </Text>
        </div>

        <AuthErrorDisplay error={error} />

        <SubmitButton
          type="button"
          onClick={handleResend}
          isPending={submitting}
          pendingLabel="Resending…"
          disabled={!canResend}
        >
          {resendLabel}
        </SubmitButton>

        <div className="text-center">
          <button
            type="button"
            onClick={handleEditEmail}
            className="font-body text-[13px] text-text-secondary underline underline-offset-2 hover:text-text-primary"
          >
            Edit email
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-md p-lg">
      <div className="flex flex-col gap-xs">
        <Text as="h1" variant="heading-lg">
          Reset your password
        </Text>
        <Text variant="body" className="text-text-secondary">
          Enter your email and we’ll send a link to set a new password.
        </Text>
      </div>

      <form
        className="flex flex-col gap-sm"
        onSubmit={handleSubmit}
        aria-label="Reset password"
        noValidate
      >
        <label className="flex flex-col gap-xs" htmlFor="email">
          <Text as="span" variant="caption" className="text-text-secondary">
            Email
          </Text>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            required
          />
        </label>

        <AuthErrorDisplay error={error} />

        <SubmitButton
          isPending={submitting}
          pendingLabel="Sending…"
          className="mt-sm"
        >
          Send reset link
        </SubmitButton>
      </form>

      <div className="text-center">
        <Text variant="caption" className="text-text-secondary">
          Remembered it?{' '}
          <Link
            href="/sign-in"
            className="underline underline-offset-2 hover:text-text-primary"
          >
            Sign in
          </Link>
        </Text>
      </div>
    </Card>
  );
}
