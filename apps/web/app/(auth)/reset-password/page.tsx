// What: Reset-password screen — set a new password, confirm it, submit
// Why: Reached only after /auth/callback?type=recovery exchanges the
//      magic-link code for a session and redirects here (per D10). The
//      session is already live; we just call updateUser({ password }).
//      Confirm-password is required because there's no email round-trip
//      safety net — a typo would lock the user out of their own account.
// Does NOT: Validate the recovery token itself (callback already did);
//           handle the no-session case (middleware lets the page render
//           authed-or-not since it might be the first step after callback).

'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Input, SubmitButton, Text } from '@lalista/ui';
import { createClient } from '@/lib/supabase/client';
import { AuthErrorDisplay } from '@/components/AuthErrorDisplay';
import { friendlyAuthError } from '@/components/auth/friendlyAuthError';
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from '@/components/auth/validatePassword';
import { trackPasswordResetCompleted } from '@/lib/analytics';

const GENERIC_ERROR =
  "Can't reach the server. Check your connection and try again.";

/** Reset-password screen — submit → updateUser → router.push('/list'). */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   *
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(friendlyAuthError(updateError.message));
        return;
      }
      trackPasswordResetCompleted();
      router.push('/list');
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
          Set a new password
        </Text>
        <Text variant="body" className="text-text-secondary">
          Pick something you can remember. We’ll sign you in once it’s saved.
        </Text>
      </div>

      <form
        className="flex flex-col gap-sm"
        onSubmit={handleSubmit}
        aria-label="Set new password"
        noValidate
      >
        <label className="flex flex-col gap-xs" htmlFor="password">
          <Text as="span" variant="caption" className="text-text-secondary">
            New password
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

        <label className="flex flex-col gap-xs" htmlFor="password-confirm">
          <Text as="span" variant="caption" className="text-text-secondary">
            Confirm new password
          </Text>
          <Input
            id="password-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={submitting}
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
        </label>

        <AuthErrorDisplay error={error} />

        <SubmitButton
          isPending={submitting}
          pendingLabel="Saving…"
          className="mt-sm"
        >
          Set new password
        </SubmitButton>
      </form>
    </Card>
  );
}
