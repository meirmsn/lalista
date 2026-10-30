// What: Authed list home — server wrapper that resolves household + renders ListClient
// Why: Content previously destined for `/` before D7's IA flip; keeps the
//      authoritative household gate on the server so the first byte over the
//      wire is correct for the user's actual state
// Does NOT: Handle middleware redirects for unauth visits (middleware owns that),
//           nor own the subscribe/fetch loop (that's ListClient)

import { redirect } from 'next/navigation';
import { fetchMyHousehold, fetchMyProfile } from '@lalista/core';
import { createClient } from '@/lib/supabase/server';
import { ListClient } from '@/components/ListClient';

/** Authed list home — fetches household membership, else redirects. */
export default async function ListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defense in depth — middleware already blocks unauth requests.
  if (!user) {
    redirect('/sign-in?next=/list');
  }

  // fetchMyHousehold (household-collaborators wrapper) returns the
  // household + role in one call. Replaces fetchUserHouseholds[0] for the
  // /list path so the header caption can render the name without an
  // extra round-trip.
  const household = await fetchMyHousehold(supabase);
  if (!household) {
    redirect('/onboarding');
  }

  // Resolve the current user's display_name server-side so ListClient can
  // populate `addedByName` on optimistic inserts + own-row realtime events
  // without a "added by someone" flash that resolves to the right name on
  // page revisit. `fetchMyProfile` returns null when profiles is missing
  // (PGRST205) — we tolerate that and pass null through; ListClient
  // gracefully falls back to the "someone" path when the name is absent.
  const profile = await fetchMyProfile(supabase);

  return (
    <ListClient
      householdId={household.id}
      householdName={household.name}
      currentUser={{
        id: user.id,
        displayName: profile?.display_name ?? null,
      }}
    />
  );
}
