// What: Client wrapper that hosts the AlreadyInHousehold + OwnInviteLink
//       state pages — both need user interactions (sign-out / copy) which
//       can't run from a server component.
// Why: Server page.tsx renders these via the discriminated `state` prop.
// Does NOT: Run accept_invite — that's page.tsx's job.

'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { signOut } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import {
  InviteUnavailable,
  AlreadyInHousehold,
  OwnInviteLink,
} from './_states';

type JoinClientState =
  | { kind: 'unavailable' }
  | { kind: 'already_in_household'; displayName: string }
  | { kind: 'own_invite_link'; url: string };

/** Render the right state with its interaction wiring. */
export function JoinClient({ state }: { state: JoinClientState }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  if (state.kind === 'unavailable') {
    return <InviteUnavailable />;
  }
  if (state.kind === 'already_in_household') {
    return (
      <AlreadyInHousehold
        displayName={state.displayName}
        onSignOut={async () => {
          try {
            await signOut(supabase);
          } finally {
            router.push('/sign-in');
          }
        }}
      />
    );
  }
  return <OwnInviteLink url={state.url} />;
}
