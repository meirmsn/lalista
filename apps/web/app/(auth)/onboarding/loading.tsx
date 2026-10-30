// What: Tier C route placeholder for /(auth)/onboarding — paints a Card-
//       shaped LoadingArea while the server checks for an existing household.
// Why: Spec D1 — the post-signup redirect to /onboarding hits a server
//      component that runs fetchUserHouseholds. Anything visible during
//      that check is owed by this loading.tsx.
// Does NOT: Render the OnboardingForm — that's the page itself.

import { LoadingArea } from '@lalista/ui';

/**
 *
 */
export default function OnboardingLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-md py-lg">
      <div className="w-full max-w-[420px]">
        <LoadingArea
          label="Setting things up"
          className="h-[420px] rounded-default"
        />
      </div>
    </main>
  );
}
