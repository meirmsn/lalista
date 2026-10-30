// What: Auth edge-case E2E coverage — sign-in (existing user), sign-out
//       cookie invalidation, duplicate-email friendly error mapping,
//       email-not-confirmed friendly error, rate-limited signup friendly error.
// Why: `auth.spec.ts` covers fresh signup + onboarding (post-chapter-1l, via
//      /sign-up); this spec covers the reverse path (existing user signing
//      in via /sign-in) and the sign-out / friendly-error surfaces. The
//      duplicate-email + rate-limit tests now drive /sign-up directly
//      (chapter 1l removed the /sign-in fallback path). The
//      password-reset-happy-path scenario migrated to a dedicated
//      `forgot-password.spec.ts`.
// Does NOT: Run against hosted Supabase (signup rate-limits, email validator
//           friction); the local-stack predicate at the top of the describe
//           skips the whole suite when `SUPABASE_URL` isn't 127.0.0.1 /
//           localhost.

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('auth edge cases', () => {
  // Skip when no local Supabase is reachable. Mirrors `add-new.spec.ts:38-42`.
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('auth-edge-cases'));

  test('sign-in (existing user) returns to /list', async ({
    page,
  }, testInfo) => {
    // Pre-create a confirmed user with an existing household so this path is
    // distinct from auth.spec.ts (which exercises fresh-signup → onboarding).
    // example.com (RFC 2606 reserved) is the right TLD here: this user's
    // email is dialed back through the public form (not just admin.createUser),
    // and the form runs HTML5 type=email validation which WebKit (mobile
    // project) rejects for `.invalid`. Same convention as the duplicate-email
    // test below + auth.spec.ts.
    const email = `auth-edge-signin-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    const admin = adminClient();
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    expect(createErr, 'admin.createUser should not error').toBeNull();
    const userId = created.user!.id;

    // Provision a household + membership directly so sign-in lands on /list,
    // not /onboarding. Mirrors realtime.spec.ts's two-member shape minus the
    // second user.
    const { data: household, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Casa SignIn ${testInfo.project.name} ${Date.now()}` })
      .select('id')
      .single();
    expect(hhErr, 'household insert should not error').toBeNull();
    const householdId = household!.id;

    const { error: memberErr } = await admin
      .from('household_members')
      .insert({ household_id: householdId, user_id: userId });
    expect(memberErr, 'membership insert should not error').toBeNull();

    // Drive the sign-in UI via the same `/` → "Get started" → /sign-in path
    // that auth.spec.ts uses. Direct `goto('/sign-in')` on WebKit (mobile
    // project) lands the page into a state where Playwright's fill races the
    // React form's controlled-input state hydration; the trace shows the
    // fill log but the validator at submit time reports an empty `email`
    // state (no `auth/v1/token` call ever fires). Mirroring auth.spec.ts's
    // navigation eliminates the race.
    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/sign-in/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Existing user with a household → land on /list (NOT /onboarding).
    await page.waitForURL(/\/list/);

    // DB-level: membership row is the one we created.
    const { data: members, error: membersErr } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId);
    expect(membersErr, 'membership read should not error').toBeNull();
    expect(members, 'user should have exactly one household').toHaveLength(1);
    expect(members![0]!.household_id).toBe(householdId);
  });

  test('sign-out invalidates the session cookie', async ({
    page,
  }, testInfo) => {
    // Provision a confirmed user + household so we can sign in fast.
    // example.com (not .invalid) — the public sign-in form runs HTML5
    // type=email validation which WebKit rejects for `.invalid`.
    const email = `auth-edge-signout-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    const admin = adminClient();
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    const userId = created.user!.id;

    const { data: household, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Casa SignOut ${testInfo.project.name} ${Date.now()}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    await admin
      .from('household_members')
      .insert({ household_id: household!.id, user_id: userId });

    // Sign in via the UI to land on /list. Use the `/` → "Get started"
    // navigation pattern (matches auth.spec.ts) — direct goto('/sign-in')
    // races React form-state hydration on WebKit, see sign-in test above.
    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/sign-in/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/list/);

    // Navigate to /settings and tap Sign out.
    await page.getByRole('link', { name: /open settings/i }).click();
    await page.waitForURL(/\/settings/);
    await page.getByRole('button', { name: /^sign out$/i }).click();
    await page.waitForURL(/\/sign-in/);

    // Cookie must be invalidated — next /list visit redirects to /sign-in.
    // Match `/sign-in` only (not `?next=/list`); the redirect URL shape is
    // an implementation detail of middleware that we don't pin here.
    await page.goto('/list');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('duplicate-email signup surfaces friendly already-registered error (auto-confirm path)', async ({
    page,
  }, testInfo) => {
    // example.com is RFC-2606 reserved and accepted by Supabase's email
    // validator (auth.spec.ts:13 documents the .local rejection).
    const email = `auth-edge-dup-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    // First signup — drive /sign-up explicitly (post-chapter-1l: no
    // sign-in fallback). New email + new password = success.
    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // Either /onboarding (auto-confirmed, has session) OR the awaiting-
    // confirmation card (no session). For local supabase with default
    // enable_confirmations=false, /onboarding is the path.
    await Promise.race([
      page.waitForURL(/\/onboarding/, { timeout: 10000 }),
      page
        .getByRole('heading', { name: /check your email/i })
        .waitFor({ timeout: 10000 }),
    ]);

    // Clear cookies to simulate a "different browser session" without
    // walking through onboarding (would over-test it).
    await page.context().clearCookies();

    // Second signup with the same email + a different (also compliant)
    // password.
    //
    // **Two-shape behavior** depending on the project's
    // `[auth.email].enable_confirmations` flag:
    //   - When TRUE (prod's posture): Supabase returns the
    //     `{ user: { identities: [] }, session: null }` no-enumeration shape.
    //     The /sign-up page branches into AwaitingConfirmationCard — same
    //     UI as a fresh signup. No leak of "this email already exists."
    //     That branch is pinned at the unit level
    //     (`apps/web/app/(auth)/sign-up/page.test.tsx:162` —
    //     "no session + identities=[] (existing-account) → AwaitingConfirmationCard").
    //   - When FALSE (local-stack auto-confirm, CI's posture): Supabase
    //     returns an explicit `User already registered` error and
    //     `friendlyAuthError` maps it to "That email is already registered.
    //     Try signing in instead." The error is visible to the user.
    //
    // This E2E runs on the local stack (auto-confirm = true), so we assert
    // the auto-confirm-shaped behavior. The prod no-enumeration story is
    // covered by the unit test cited above.
    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('Different9Pass!');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(
      page.getByText(/already registered.*try signing in/i)
    ).toBeVisible();
  });

  test("email-not-confirmed user can't sign in until confirmed", async ({
    page,
  }, testInfo) => {
    // Reframe note: the original test name said "bounced from /list", which
    // implied a middleware gate. Wrong — Supabase rejects sign-in for
    // email_confirmed_at: null users at /auth/v1/token, so the user never
    // gets a session and never reaches /list. The friendly error
    // ("Check your email to confirm your account first") shows on /sign-in
    // instead. friendlyAuthError() at sign-in/page.tsx:32 maps the
    // /email.*not.*confirmed/i regex.
    const email = `auth-edge-unconf-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    const admin = adminClient();
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
      });
    expect(createErr, 'admin.createUser should not error').toBeNull();
    expect(created.user, 'user should be created').not.toBeNull();

    // Drive the sign-in form via the same `/` → "Get started" path that
    // auth.spec.ts uses (WebKit form-state-hydration race avoidance).
    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/sign-in/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Stay on /sign-in and surface the friendly copy. Supabase auth rejects
    // unconfirmed users; the form's INVALID_CREDENTIALS regex doesn't match
    // "Email not confirmed", so the fallback signup path is NOT taken — the
    // raw error goes straight through friendlyAuthError().
    await expect(
      page.getByText(/check your email to confirm your account first/i)
    ).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('rate-limited signup surfaces friendly error', async ({
    page,
  }, testInfo) => {
    // Mock the signup endpoint at the network layer (TODOS.md option (b))
    // rather than burning a real Supabase rate-limit window. The friendly
    // copy is what we're verifying — friendlyAuthError maps the
    // /email.*rate.*limit|rate.*limit.*email/i regex against the Supabase
    // response body's `msg` field.
    await page.route('**/auth/v1/signup', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'over_email_send_rate_limit',
          msg: 'email rate limit exceeded',
        }),
      })
    );

    const email = `auth-edge-rl-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(
      page.getByText(/too many attempts.*try again in a few minutes/i)
    ).toBeVisible();
    await expect(page).toHaveURL(/\/sign-up/);
  });
});
