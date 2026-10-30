// What: E2E for the post-chapter-1l /sign-up flow — fresh user, click email
//       link in inbucket, land on /onboarding, finish setup, end at /list.
// Why: Pairs with /sign-up/page.tsx (Task 6) — the spec's "E2E-per-surface
//      invariant" requires every page under app/**/page.tsx to have a paired
//      E2E exercising its primary verb. This is that.
// Does NOT: Run against hosted Supabase — gates on isLocalSupabase() so
//           CI's hosted runs skip cleanly. Email-confirmation requires the
//           local inbucket relay to be up.

import { expect, test } from '@playwright/test';
import {
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';
import {
  extractMagicLink,
  fetchEmailBody,
  waitForLatestEmail,
} from './helpers/inbucket';

test.describe('sign-up flow', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('sign-up'));

  test('fresh user signs up, follows email link, completes onboarding', async ({
    page,
  }, testInfo) => {
    test.slow();
    const email = `sign-up-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    // 1. Land at /, tap "Create account" → /sign-up.
    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);

    // 2. Fill email + password → "Create account" submit.
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // 3. Two acceptable paths from here, depending on Supabase config:
    //    (a) Local stack with enable_confirmations=false → session issued
    //        immediately → router.push('/onboarding').
    //    (b) Local stack with confirmations on → AwaitingConfirmationCard.
    //    The local config defaults to (a), but we handle both so this spec
    //    survives a config flip.
    const onboardingHit = page
      .waitForURL(/\/onboarding/, { timeout: 15000 })
      .then(() => 'onboarding');
    const cardHit = page
      .getByRole('heading', { name: /check your email/i })
      .waitFor({ timeout: 15000 })
      .then(() => 'card');
    const reached = await Promise.race([onboardingHit, cardHit]);

    if (reached === 'card') {
      // Awaiting-confirmation path: click the link in inbucket.
      const summary = await waitForLatestEmail(email);
      const message = await fetchEmailBody(email, summary.id);
      const link = extractMagicLink(message);
      await page.goto(link);
      await page.waitForURL(/\/onboarding/, { timeout: 15000 });
    }

    // 4. Onboarding — fill name + household name, submit.
    await page.getByLabel(/your name/i).fill('Sign-up E2E');
    await page.getByLabel(/household name/i).fill('Casa Sign-up');
    await page.getByRole('button', { name: /^create$/i }).click();

    // 5. Land on /list with the empty-list copy visible.
    await page.waitForURL(/\/list/);
    await expect(page.getByText(/la lista está vacía/i)).toBeVisible();
  });
});
