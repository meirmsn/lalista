// What: E2E for the /forgot-password → email link → /reset-password → /list
//       happy path. Pre-creates a confirmed user via the admin client so the
//       reset request hits a real account.
// Why: Pairs with /forgot-password/page.tsx + /reset-password/page.tsx +
//      /auth/callback/route.ts (Tasks 7 + 8). The full recovery flow is
//      worth exercising end-to-end because the magic-link round-trip is
//      where multi-component bugs surface (callback redirect, session
//      cookie shape, etc.).
// Does NOT: Run against hosted Supabase — gates on isLocalSupabase().
//           Skips the no-enumeration assertion (covered by unit tests at
//           the page level — would slow this spec down for no gain).

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';
import {
  extractMagicLink,
  fetchEmailBody,
  waitForLatestEmail,
} from './helpers/inbucket';

test.describe('forgot-password flow', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('forgot-password'));

  test('request reset → follow email link → set new password → sign in with new password', async ({
    page,
  }, testInfo) => {
    test.slow();
    const email = `forgot-pw-${testInfo.project.name}-${Date.now()}@example.com`;
    const oldPassword = 'OldPassword123!';
    const newPassword = 'NewPassword456!';

    // Pre-create a confirmed user via the admin client. Mirrors the boilerplate
    // in auth-edge-cases.spec.ts.
    const admin = adminClient();
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: oldPassword,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    expect(created.user).not.toBeNull();

    // 1. /sign-in → "Forgot password?" → land on /forgot-password.
    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/sign-in/);
    await page.getByRole('link', { name: /forgot password\?/i }).click();
    await page.waitForURL(/\/forgot-password/);

    // 2. Submit the email → success state with the email shown back.
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(
      page.getByRole('heading', { name: /check your email/i })
    ).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // 3. Follow the recovery link from inbucket.
    const summary = await waitForLatestEmail(email);
    expect(summary.subject.toLowerCase()).toContain('reset');
    const message = await fetchEmailBody(email, summary.id);
    const link = extractMagicLink(message);
    expect(link).toContain('type=recovery');
    await page.goto(link);

    // 4. /auth/callback exchanges → redirects to /reset-password.
    await page.waitForURL(/\/reset-password/, { timeout: 15000 });

    // 5. Set a new password → recovery completes; the post-recovery
    //    destination (/list vs /onboarding) depends on whether the user has
    //    a household, which we don't here (admin-created without one). Just
    //    assert we leave /reset-password — that's the "recovery succeeded"
    //    signal, regardless of which authed surface middleware lands us on.
    //
    //    Using id selectors + pressSequentially + post-fill value assertion:
    //    on mobile/WebKit, plain `.fill()` on freshly hydrated controlled
    //    inputs has surfaced a race where React's state hadn't sync'd to
    //    the DOM value attribute by the time fill resolved (verified across
    //    runs 25258858879 / 25259626169 / 25260400981, all on the same SHA's
    //    test code, two failing identically). Real keystrokes via
    //    pressSequentially reliably fire onChange; the value-equality assert
    //    auto-retries so we fail-fast at the broken field if the regression
    //    ever resurfaces.
    await page.locator('#password').click();
    await page
      .locator('#password')
      .pressSequentially(newPassword, { delay: 10 });
    await expect(page.locator('#password')).toHaveValue(newPassword);
    await page.locator('#password-confirm').click();
    await page
      .locator('#password-confirm')
      .pressSequentially(newPassword, { delay: 10 });
    await expect(page.locator('#password-confirm')).toHaveValue(newPassword);
    await page.getByRole('button', { name: /set new password/i }).click();
    await page.waitForURL((url) => !/\/reset-password/.test(url.pathname), {
      timeout: 15000,
    });

    // 6. Verify the new password actually persisted server-side. The
    //    cleanest proof is a fresh signInWithPassword call against the
    //    admin client — succeeding here means Supabase's auth.users row
    //    was updated, not just that the form said "success."
    const { data: signedIn, error: signInErr } =
      await admin.auth.signInWithPassword({ email, password: newPassword });
    expect(signInErr).toBeNull();
    expect(signedIn.session).not.toBeNull();

    // 7. The OLD password must NOT work — bonus assertion that we didn't
    //    accidentally end up with both passwords valid (bug shape from
    //    other auth-stack incidents).
    const { error: oldSignInErr } = await admin.auth.signInWithPassword({
      email,
      password: oldPassword,
    });
    expect(oldSignInErr).not.toBeNull();
  });
});
