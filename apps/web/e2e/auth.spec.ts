// What: Happy-path E2E — fresh sign-up → onboarding (name + household) → land on /list
// Why: Post-chapter-1l, sign-up has its own surface. This spec drives a brand-
//      new email through /sign-up, handles the local-Supabase auto-confirm path
//      (session arrives immediately) vs. the awaiting-confirmation path
//      (production-shape; the user clicks the link in inbucket).
// Does NOT: Exercise sign-out (settings page covers it) or Apple Sign-In.

import { expect, test } from '@playwright/test';

test.describe('auth happy path — new user', () => {
  test('signs up, completes onboarding, and lands on /list', async ({
    page,
  }) => {
    // example.com (RFC-2606) is accepted by Supabase's email validator;
    // .local is rejected. Same convention as auth-edge-cases.spec.ts.
    const email = `e2e-${Date.now()}@example.com`;
    const password = 'Password123!';

    // 1. Unauthed visit to `/` → public landing → "Create account" CTA →
    //    land on /sign-up.
    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);

    // 2. Fresh email + password → Create account.
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // 3. Two acceptable paths from here, depending on Supabase config:
    //    (a) Local stack with enable_confirmations=false → session issued
    //        immediately → router.push('/onboarding').
    //    (b) Default Supabase config → AwaitingConfirmationCard renders.
    //    For the slow-job CI local stack we expect (a).
    await Promise.race([
      page.waitForURL(/\/onboarding/, { timeout: 15000 }),
      page
        .getByRole('heading', { name: /check your email/i })
        .waitFor({ timeout: 15000 }),
    ]);

    // 4. Onboarding — fill name (optional) + household name.
    if (/onboarding/.test(page.url())) {
      await page.getByLabel(/your name/i).fill('E2E Tester');
      await page.getByLabel(/household name/i).fill('Casa E2E');
      await page.getByRole('button', { name: /^create$/i }).click();

      await page.waitForURL(/\/list/);
      await expect(page.getByText(/la lista está vacía/i)).toBeVisible();
    } else {
      // Awaiting-confirmation branch — pin the user-facing copy as a
      // smoke that the card mounts. The full link-click flow is exercised
      // by sign-up.spec.ts (Task 16).
      await expect(page.getByText(email)).toBeVisible();
    }
  });
});
