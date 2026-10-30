// What: Notice card rendered above OnboardingForm when /onboarding?removed=1
//       is present (D15/OV1 — owner removed the user from their household).
// Why: Explains the state to the removed user without surfacing the (now
//      irrelevant) household name. Provides a sign-out text link so the
//      user can re-auth as someone else.
// Does NOT: Sign the user out itself — the link triggers the existing
//           SignOutButton flow via the `/sign-out` flow handled by
//           Supabase + redirect.

'use client';

import { useMemo } from 'react';
import { Card, Text } from '@lalista/ui';
import { signOut } from '@lalista/core';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** Renders the "removed from household" notice above OnboardingForm. */
export function RemovedFromHouseholdNotice() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  /**
   *
   */
  async function handleSignOut() {
    try {
      await signOut(supabase);
    } finally {
      router.push('/sign-in');
    }
  }

  return (
    <Card
      className="flex flex-col gap-xs p-lg"
      aria-label="Removed from household"
    >
      <Text
        as="span"
        variant="caption"
        className="text-text-secondary uppercase tracking-[0.08em]"
      >
        Removed from household
      </Text>
      <Text variant="body">
        the household owner removed you. you can create your own household
        below, or sign out.
      </Text>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="self-start font-body text-[15px] text-primary hover:text-primary-pressed underline-offset-4 hover:underline"
      >
        ← sign out and use a different account
      </button>
    </Card>
  );
}
