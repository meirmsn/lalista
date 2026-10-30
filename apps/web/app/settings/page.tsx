// What: Settings page — Account (sign out + display name) + Household
//       (rename / role-aware) + Members (invite/remove/leave) + Activity
//       (audit feed). IA order per Pass 1.
// Why: v0 ships the household-collaborators surface here so management
//      flows live alongside Account. Server component does auth +
//      household resolution; SettingsClient owns the ephemeral sheet
//      state.
// Does NOT: Render Stores management (deferred per D5 / spec Out of scope).

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Text } from '@lalista/ui';
import { fetchMyHousehold, fetchMyProfile } from '@lalista/core';
import { createClient } from '@/lib/supabase/server';
import { DisplayNameSection } from '@/components/DisplayNameSection';
import { SignOutButton } from '@/components/SignOutButton';
import { SettingsClient } from './SettingsClient';

/** Server component. Loads user + household, hands off to SettingsClient. */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already handles unauth; defense in depth.
  if (!user) redirect('/sign-in?next=/settings');

  const household = await fetchMyHousehold(supabase);
  if (!household) redirect('/onboarding');

  // Load the user's current display_name so the inline field can prefill.
  // Post-migration-012 this always returns a row (trigger seeds on signup,
  // backfill covers pre-existing users) but we fall back defensively.
  const profile = await fetchMyProfile(supabase);
  const displayName =
    profile?.display_name || user.email?.split('@')[0] || 'someone';

  return (
    <main className="flex min-h-screen flex-col bg-background px-md pt-lg pb-[50vh]">
      <Link
        href="/list"
        aria-label="Back to list"
        className="mb-md inline-flex h-[44px] w-fit items-center gap-xs rounded-default px-xs text-text-secondary hover:bg-surface-2"
      >
        <span aria-hidden="true" className="font-body text-[18px] leading-none">
          ←
        </span>
        <span className="font-body text-[15px]">back</span>
      </Link>

      <Text as="h1" variant="heading-lg">
        Settings
      </Text>

      <section aria-label="Account" className="mt-lg flex flex-col gap-sm">
        <Text
          as="h2"
          variant="caption"
          className="text-text-secondary uppercase tracking-[0.08em]"
        >
          Account
        </Text>
        <DisplayNameSection initialValue={displayName} />
        <SignOutButton />
      </section>

      <SettingsClient household={household} currentUserId={user.id} />
    </main>
  );
}
