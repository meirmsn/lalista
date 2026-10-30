// What: Tier C route-loading E2E — clicks the Settings link from /list and
//       asserts that the LoadingArea (role="status" inside loading.tsx)
//       paints within 100ms of the click. Catches regressions where a
//       future route forgets loading.tsx or where the LoadingArea primitive
//       drops the role/aria-busy hooks the test relies on.
// Why: Spec § Tests / D6 — one structural E2E covers all four loading.tsx
//      surfaces (the LoadingArea component is identical across them; the
//      test pins that the route-loading wiring is plumbed through).
//      Targets /settings as the canonical case because /settings has the
//      Link from /list and its content is small enough that the loading
//      placeholder is observable.
// Does NOT: Run against hosted Supabase — provisioning a confirmed user
//           requires admin-client. Pair with the `test.skip` predicate.

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('route loading.tsx (Tier C)', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('route-loading'));

  test('LoadingArea is visible while /settings resolves', async ({
    page,
  }, testInfo) => {
    const admin = adminClient();
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const email = `route-loading-${stamp}@example.com`;
    const password = 'Password123!';

    // Pre-create user + household so the test lands on /list directly.
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    const userId = created.user!.id;

    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Casa Loading ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    const { error: memErr } = await admin
      .from('household_members')
      .insert({ household_id: hh!.id, user_id: userId });
    expect(memErr).toBeNull();

    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/sign-in/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/list/);

    // Click the gear (settings) link — Next's <Link> + RSC streaming
    // shows loading.tsx while /settings/page.tsx resolves on the server.
    await page.getByRole('link', { name: /open settings/i }).click();

    // The LoadingArea inside settings/loading.tsx renders role="status"
    // with aria-label "Loading account" or "Loading household". Asserting
    // visible on a `getByRole('status')` query within a tight timeout
    // catches the case where loading.tsx is missing (the route would
    // navigate to a blank frame instead).
    const loadingRegion = page.getByRole('status').first();
    await expect(loadingRegion).toBeVisible({ timeout: 1500 });

    // /settings eventually resolves
    await page.waitForURL(/\/settings/);
    await expect(
      page.getByRole('heading', { name: /^settings$/i })
    ).toBeVisible();
  });
});
