// What: Sign-up screen — email + password only (no name, no confirm-password per D11)
// Why: Post-chapter-1l split, sign-up is a dedicated screen. Name moves to
//      onboarding; confirm-password is friction without security gain
//      (browsers' password managers handle the round-trip).
// Does NOT: Collect display name (onboarding does), pre-fire auth_signed_up
//           (providers.tsx does it on the SIGNED_IN event), or render the
//           awaiting-confirmation card inline — that lives in
//           AwaitingConfirmationCard.

'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, Input, SubmitButton, Text } from '@lalista/ui';
import { signUpWithPassword } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { AuthErrorDisplay } from '@/components/AuthErrorDisplay';
import { AwaitingConfirmationCard } from '@/components/AwaitingConfirmationCard';
import { friendlyAuthError } from '@/components/auth/friendlyAuthError';
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from '@/components/auth/validatePassword';
import { useAuthEmail } from '../_email-context';

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_ERROR =
  "Can't reach the server. Check your connection and try again.";

/**
 * Sign-up screen — email + password → AwaitingConfirmationCard (or /onboarding
 * if auto-confirm). Wraps the form in a Suspense boundary because `SignUpForm`
 * reads `useSearchParams()` for `?invite=<token>` (Next.js 16 prerender requires
 * the boundary; mirrors the /sign-in pattern).
 */
export default function SignUpPage() {
  return (
    <Suspense fallback={<SignUpFormFallback />}>
      <SignUpForm />
    </Suspense>
  );
}

/** Inner client component — owns all the auth state + the searchParams read. */
function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const { email, setEmail } = useAuthEmail();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  /** Submit handler — calls signUpWithPassword, branches on session vs. identities. */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!EMAIL_FORMAT.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      // 5th positional arg is the invite token from the ?invite= query param
      // (D4). When present, signUpWithPassword wires up emailRedirectTo so
      // the confirmation email's link returns through /auth/callback?invite=…
      // → /join/<token> → accept_invite RPC.
      const result = await signUpWithPassword(
        supabase,
        email,
        password,
        undefined,
        inviteToken ?? undefined
      );

      if (result.error) {
        setError(friendlyAuthError(result.error.message));
        return;
      }

      // Auto-confirm path: project has enable_confirmations=false.
      if (result.data.session) {
        router.push('/onboarding');
        return;
      }

      // Default path: hand off to the awaiting-confirmation card. We
      // deliberately do NOT branch on Supabase's empty-identities signal
      // (the marker for "this email already has a confirmed account") —
      // surfacing that to the user would defeat the no-enumeration parity
      // we already maintain on /forgot-password and /sign-in. Existing-
      // account users see the same "Check your email" screen as new users
      // and never receive an email; they figure it out via the resend
      // countdown / Edit email path. Trade-off documented in
      // CLAUDE.md § Gotchas (sign-up no-enumeration).
      setAwaitingConfirmation(true);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  if (awaitingConfirmation) {
    return (
      <AwaitingConfirmationCard
        email={email}
        inviteContext={Boolean(inviteToken)}
        onEdit={() => {
          // Flip back to the form so the user can fix a typo'd email or
          // bail out. Email stays in context (kept across renders); password
          // is cleared because we don't keep secrets cached around state
          // transitions, even client-side.
          setAwaitingConfirmation(false);
          setError(null);
          setPassword('');
        }}
      />
    );
  }

  return (
    <Card className="flex flex-col gap-md p-lg">
      {/* Pass 3: subtle context line above the form when ?invite= is present.
          Doesn't surface the household name (privacy: pre-auth lookup of
          households.name would leak identity to anyone with a token-shaped
          URL). aria-live="polite" so screen readers learn they're in an
          invite flow. */}
      {inviteToken && (
        <p
          aria-live="polite"
          className="text-text-secondary text-[13px] font-medium mb-sm"
          data-testid="sign-up-invite-context"
        >
          joining a lalista household.
        </p>
      )}
      <div className="flex flex-col gap-xs">
        <Text as="h1" variant="heading-lg">
          Create your account
        </Text>
        <Text variant="body" className="text-text-secondary">
          One email, one password. We’ll set you up.
        </Text>
      </div>

      <form
        className="flex flex-col gap-sm"
        onSubmit={handleSubmit}
        aria-label="Create account"
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

        <label className="flex flex-col gap-xs" htmlFor="password">
          <Text as="span" variant="caption" className="text-text-secondary">
            Password
          </Text>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>

        <AuthErrorDisplay error={error} />

        <SubmitButton
          isPending={submitting}
          pendingLabel="Creating account…"
          className="mt-sm"
        >
          Create account
        </SubmitButton>
      </form>

      <div className="text-center">
        <Text variant="caption" className="text-text-secondary">
          Already have an account?{' '}
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

/**
 * SSR/prerender fallback while Suspense waits for client-side `useSearchParams`.
 * Mirrors the form skeleton so layout doesn't shift on hydration.
 */
function SignUpFormFallback() {
  return (
    <Card className="flex flex-col gap-md p-lg" aria-busy="true">
      <div className="flex flex-col gap-xs">
        <Text as="h1" variant="heading-lg">
          Create your account
        </Text>
        <Text variant="body" className="text-text-secondary">
          One email, one password. We’ll set you up.
        </Text>
      </div>
    </Card>
  );
}
