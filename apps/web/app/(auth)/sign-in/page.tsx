// What: Email + password sign-in screen — the simple version
// Why: Post-chapter-1l, /sign-up is its own screen and /sign-in no longer
//      falls back to signup. One call, one branch on success/error, friendly
//      error mapping for the common cases.
// Does NOT: Offer OAuth (deferred to v1), exercise the awaiting-confirmation
//           card (that's /sign-up's job), or render a name field (moved to
//           onboarding per spec D11).

'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, Input, SubmitButton, Text } from '@lalista/ui';
import { signInWithPassword } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { AuthErrorDisplay } from '@/components/AuthErrorDisplay';
import {
  friendlyAuthError,
  isInvalidCredentialsError,
} from '@/components/auth/friendlyAuthError';
import { useAuthEmail } from '../_email-context';

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_ERROR =
  "Can't reach the server. Check your connection and try again.";

/**
 * Sign-in screen. Submits → signIn → on success → /onboarding.
 * Wraps the form in a Suspense boundary because `SignInForm` reads
 * `useSearchParams()` (Next.js 15 prerender requires the boundary).
 */
export default function SignInPage() {
  return (
    <Suspense fallback={<SignInFormFallback />}>
      <SignInForm />
    </Suspense>
  );
}

/** Inner client component — owns all the auth state + the searchParams read. */
function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { email, setEmail } = useAuthEmail();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Side-flag for the "trying to create an account instead?" hint. Tracks the
  // server's classification (not just any error string) so client-side
  // validation errors don't accidentally trigger the suggestion.
  const [showCreateAccountHint, setShowCreateAccountHint] = useState(false);

  // Surface the friendly error when the /auth/callback handler bounced an
  // expired link back here. Computed during render (not in an effect) so
  // there's no cascading-render loop. Two query keys distinguish recovery
  // vs. signup; the locally-set `error` (post-submit) wins because we
  // overwrite via setState in handleSubmit.
  const queryError = ((): string | null => {
    if (searchParams.get('reset-error') === 'expired') {
      return 'That reset link expired. Request a fresh one below.';
    }
    if (searchParams.get('confirm-error') === 'expired') {
      return 'That confirmation link expired. Sign in or request a fresh one.';
    }
    return null;
  })();
  const displayedError = error ?? queryError;

  /** Submit handler — validates inputs, calls signInWithPassword, branches on result. */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setShowCreateAccountHint(false);

    if (!EMAIL_FORMAT.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length === 0) {
      setError('Enter a password.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const result = await signInWithPassword(supabase, email, password);
      if (result.error) {
        setError(friendlyAuthError(result.error.message));
        if (isInvalidCredentialsError(result.error.message)) {
          setShowCreateAccountHint(true);
        }
        return;
      }
      router.push('/onboarding');
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-md p-lg">
      <div className="flex flex-col gap-xs">
        <Text as="h1" variant="heading-lg">
          Welcome back
        </Text>
        <Text variant="body" className="text-text-secondary">
          Sign in to pick up your list.
        </Text>
      </div>

      <form
        className="flex flex-col gap-sm"
        onSubmit={handleSubmit}
        aria-label="Sign in"
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            required
          />
        </label>

        <AuthErrorDisplay error={displayedError} />
        {showCreateAccountHint && (
          <Text variant="caption" className="text-text-secondary">
            Trying to{' '}
            <Link
              href="/sign-up"
              className="underline underline-offset-2 hover:text-text-primary"
            >
              create an account
            </Link>{' '}
            instead?
          </Text>
        )}

        <SubmitButton
          isPending={submitting}
          pendingLabel="Signing in…"
          className="mt-sm"
        >
          Sign in
        </SubmitButton>
      </form>

      <div className="flex flex-col gap-xs text-center">
        <Text variant="caption" className="text-text-secondary">
          <Link
            href="/forgot-password"
            className="underline underline-offset-2 hover:text-text-primary"
          >
            Forgot password?
          </Link>
        </Text>
        <Text variant="caption" className="text-text-secondary">
          Don’t have an account?{' '}
          <Link
            href="/sign-up"
            className="underline underline-offset-2 hover:text-text-primary"
          >
            Create one
          </Link>
        </Text>
      </div>
    </Card>
  );
}

/**
 * SSR/prerender fallback while Suspense waits for client-side `useSearchParams`.
 * Mirrors the form skeleton so layout doesn't shift on hydration; inputs are
 * disabled until the inner client form mounts.
 */
function SignInFormFallback() {
  return (
    <Card className="flex flex-col gap-md p-lg" aria-busy="true">
      <div className="flex flex-col gap-xs">
        <Text as="h1" variant="heading-lg">
          Welcome back
        </Text>
        <Text variant="body" className="text-text-secondary">
          Sign in to pick up your list.
        </Text>
      </div>
    </Card>
  );
}
