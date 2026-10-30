// What: Settings E2E — household-info read-only display matches DB; sign-out
//       button click → next /list redirects to /sign-in.
// Why: PR 4's audit flagged household-info read-only view + sign-out cookie
//      invalidation as untested. Display-name editing is already covered by
//      `ci-slow-job-qa-walk.spec.ts`'s 5-verb walk; don't duplicate.
// Does NOT: Drive the display-name edit field (covered elsewhere); test
//           Stores management or member-management UX (deferred per
//           settings/page.tsx `Does NOT`). Sign-out test #2 here is partial
//           counterpart to auth-edge-cases.spec.ts test 2 — kept per spec D8
//           because the trigger differs (Settings UI button vs. direct call).

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('settings', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('settings'));

  test('household-info read-only display matches DB', async ({
    page,
  }, testInfo) => {
    const householdName = `Casa Settings ${testInfo.project.name} ${Date.now()}`;
    const email = `settings-read-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    // Signup → onboarding → /list with the household name we want to assert
    // on. Going through the public form (vs. admin-client provisioning) keeps
    // this test exercising the full happy-path data flow.
    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/onboarding/);
    await page.getByLabel(/household name/i).fill(householdName);
    await page.getByRole('button', { name: /create/i }).click();
    await page.waitForURL(/\/list/);

    // Tap the gear icon to navigate /list → /settings.
    await page.getByRole('link', { name: /open settings/i }).click();
    await page.waitForURL(/\/settings/);

    // The Household section renders the name we set during onboarding. Per
    // chapter 1m / spec D12, the owner view exposes the household name as
    // the value of an editable input (DisplayNameField), not as standalone
    // page text — so assert against the input's `value` within the
    // Household region, not `getByText`. Members would see it as plain text
    // (the read-only branch); a member-side assertion is covered by
    // household-rename.spec.ts T14.
    const householdInput = page
      .getByRole('region', { name: /household/i })
      .getByLabel(/household name/i);
    await expect(householdInput).toHaveValue(householdName);

    // DB-level: admin-client confirms exactly one households row matches.
    const admin = adminClient();
    const { data: hh, error: hhErr } = await admin
      .from('households')
      .select('id, name')
      .eq('name', householdName);
    expect(hhErr).toBeNull();
    expect(
      hh,
      `households row for "${householdName}" should exist`
    ).toHaveLength(1);
  });

  test('sign-out button click → next /list request redirects to /sign-in', async ({
    page,
  }, testInfo) => {
    const email = `settings-signout-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/onboarding/);
    await page
      .getByLabel(/household name/i)
      .fill(`Casa SignOutBtn ${testInfo.project.name}`);
    await page.getByRole('button', { name: /create/i }).click();
    await page.waitForURL(/\/list/);

    // /list → /settings via gear icon, then click Sign out.
    await page.getByRole('link', { name: /open settings/i }).click();
    await page.waitForURL(/\/settings/);
    await page.getByRole('button', { name: /^sign out$/i }).click();
    await page.waitForURL(/\/sign-in/);

    // Verify the cookie was invalidated by walking to /list directly.
    // Middleware kicks unauth visitors back to /sign-in. We don't pin the
    // `?next=/list` query — that's an implementation detail of the redirect.
    await page.goto('/list');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
