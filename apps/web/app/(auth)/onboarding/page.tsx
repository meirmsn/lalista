// What: Household onboarding gate — skips to `/list` if the user already has one
// Why: First sign-in flow needs a household before the list view is usable. This
//      is a server component so the DB check runs before any client bundle ships
// Does NOT: Handle invite accept — that ships in a later PR (placeholder only)

import { redirect } from 'next/navigation';
import { fetchUserHouseholds } from '@lalista/core';
import { createClient } from '@/lib/supabase/server';
import { OnboardingForm } from './OnboardingForm';
import { RemovedFromHouseholdNotice } from '@/components/RemovedFromHouseholdNotice';

interface OnboardingPageProps {
  searchParams: Promise<{ removed?: string }>;
}

/** Server component: if a household exists, redirect; else render the form. */
export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already sent unauthed users to /sign-in, but defend in depth:
  // if we somehow got here without a user, kick back to the sign-in screen.
  if (!user) {
    redirect('/sign-in');
  }

  const households = await fetchUserHouseholds(supabase, user.id);
  if (households.length > 0) {
    // Post-D7 (specs/core-flows/spec.md): `/list` is the authed list home.
    redirect('/list');
  }

  // household-collaborators (D15/OV1): `?removed=1` arrives after a member
  // is kicked from their household via the RemovedFromHouseholdError
  // redirect in ListClient. Render the notice card above the existing
  // OnboardingForm so the user understands the state + can re-onboard
  // (create a new household) or sign-out-and-try-again.
  const params = await searchParams;
  const wasRemoved = params.removed === '1';

  return (
    <div className="flex flex-col gap-md">
      {wasRemoved && <RemovedFromHouseholdNotice />}
      <OnboardingForm />
    </div>
  );
}
