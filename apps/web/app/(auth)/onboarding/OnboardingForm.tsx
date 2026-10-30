// What: Client form for first-time onboarding — collects display name + household name.
// Why: Onboarding is the first user-mutating step after signup. Per chapter 1l,
//      it picks up the display name (moved here from /sign-up per spec D11) so
//      the user enters it once with helpful context, then provisions the
//      household. Update profile FIRST so a household-create failure doesn't
//      orphan the name edit.
// Does NOT: Accept invites, handle joining an existing household, or fetch
//           any data — parent component confirms zero households before
//           rendering this.

'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Divider, Input, SubmitButton, Text } from '@lalista/ui';
import { createHousehold, getUser, updateMyProfile } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { AuthErrorDisplay } from '@/components/AuthErrorDisplay';

const MAX_NAME_LENGTH = 80; // mirrors profiles CHECK constraint
const MAX_HOUSEHOLD_LENGTH = 64;
const GENERIC_ERROR =
  "Can't reach the server. Check your connection and try again.";

/** Onboarding form — display name + household name → updateMyProfile + createHousehold → /list. */
export function OnboardingForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   *
   */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmedHousehold = householdName.trim();
    if (trimmedHousehold.length === 0) {
      setError('Give your household a name.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const user = await getUser(supabase);
      if (!user) {
        setError('Your session has expired. Please sign in again.');
        router.push('/sign-in');
        return;
      }

      // Update profile FIRST so a household-create failure doesn't orphan
      // the name edit. The name field is optional — when empty we skip the
      // call and the trigger's email-local-part fallback (migration 012) stays
      // in effect.
      const trimmedName = displayName.trim();
      if (trimmedName.length > 0) {
        try {
          await updateMyProfile(supabase, trimmedName);
        } catch (profileErr) {
          if (profileErr instanceof Error && profileErr.message) {
            setError(profileErr.message);
          } else {
            setError("Couldn't save your name. Please try again.");
          }
          return;
        }
      }

      await createHousehold(supabase, trimmedHousehold);
      router.push('/list');
    } catch (err) {
      // D7/C2: when a two-tab race trips the household_members_one_per_user_v0
      // unique constraint (the user's other tab already created/joined a
      // household between this tab's check and insert), Postgres surfaces a
      // 23505 with constraint-name match. Auto-recover by routing to /list
      // — the membership exists; the user just landed on onboarding by
      // mistake.
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === '23505' &&
        'message' in err &&
        typeof (err as { message?: string }).message === 'string' &&
        ((err as { message: string }).message ?? '').includes(
          'household_members_one_per_user_v0'
        )
      ) {
        router.push('/list');
        return;
      }
      if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError(GENERIC_ERROR);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <Card className="flex flex-col gap-md p-lg">
        <div className="flex flex-col gap-xs">
          <Text as="h1" variant="heading-lg">
            Set up your household
          </Text>
          <Text variant="body" className="text-text-secondary">
            One name for you, one for your shared list. You can rename either
            later.
          </Text>
        </div>

        <form
          className="flex flex-col gap-sm"
          onSubmit={handleSubmit}
          aria-label="Onboarding"
          noValidate
        >
          <label className="flex flex-col gap-xs" htmlFor="display-name">
            <Text as="span" variant="caption" className="text-text-secondary">
              Your name
            </Text>
            <Input
              id="display-name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
              maxLength={MAX_NAME_LENGTH}
            />
            <Text as="span" variant="caption" className="text-text-tertiary">
              Shared lists show who added each item. You can edit this anytime
              in Settings.
            </Text>
          </label>

          <label className="flex flex-col gap-xs" htmlFor="household-name">
            <Text as="span" variant="caption" className="text-text-secondary">
              Household name
            </Text>
            <Input
              id="household-name"
              type="text"
              autoComplete="off"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              maxLength={MAX_HOUSEHOLD_LENGTH}
              disabled={submitting}
              required
            />
          </label>

          <AuthErrorDisplay error={error} />

          <SubmitButton
            isPending={submitting}
            pendingLabel="Creating…"
            className="mt-sm"
          >
            Create
          </SubmitButton>
        </form>
      </Card>

      <Divider />

      <Card className="flex flex-col gap-xs p-lg">
        <Text as="h2" variant="heading-md">
          Joining someone else?
        </Text>
        <Text variant="body" className="text-text-secondary">
          Ask a family member to add you to their household. Invite support is
          coming soon.
        </Text>
      </Card>
    </div>
  );
}
