// What: Tier C route placeholder for /settings — back-link chrome + page
//       title + LoadingArea blocks for the Account / Household sections.
// Why: Spec D1 — tap "Open settings" (gear icon), see a placeholder within
//      100ms. Page-loading E2E spec (task 15) targets this route.
// Does NOT: Render real account / household data — that's the page itself.

import Link from 'next/link';
import { LoadingArea, Text } from '@lalista/ui';

/**
 *
 */
export default function SettingsLoading() {
  return (
    <main className="flex min-h-screen flex-col bg-background px-md py-lg">
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

      <div className="mt-lg flex flex-col gap-md">
        <LoadingArea label="Loading account" className="h-[120px]" />
        <LoadingArea label="Loading household" className="h-[80px]" />
      </div>
    </main>
  );
}
