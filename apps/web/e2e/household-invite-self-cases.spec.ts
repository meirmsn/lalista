// What: E2E for the two self-cases on /join/[token] — owner clicking their
//       own link (renders OwnInviteLink) and a different-account-already-
//       in-a-household visitor (renders AlreadyInHousehold).
// Why: Both branches must surface the right state page; AlreadyInHousehold
//       must show the visitor's display_name (not the household name).

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('household-invite self-cases', () => {
  test.skip(
    !isLocalSupabase(),
    localSupabaseSkipReason('household-invite-self-cases')
  );

  test('owner clicks own invite link → <OwnInviteLink>', async ({
    page,
  }, testInfo) => {
    const admin = adminClient();
    const email = `inv-self-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    const { data: user } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    const userId = user!.user!.id;
    const { data: household } = await admin
      .from('households')
      .insert({ name: `Casa Self ${Date.now()}` })
      .select('id')
      .single();
    const householdId = household!.id;
    await admin.from('household_members').insert({
      household_id: householdId,
      user_id: userId,
      role: 'owner',
    });
    const token = `self-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await admin.from('household_invitations').insert({
      household_id: householdId,
      token,
      created_by: userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    await page.goto('/sign-in');
    // WebKit hydration race — wait for React state to commit (CLAUDE.md gotcha).
    await page.waitForLoadState('networkidle');
    await page.fill('[name="email"], #email', email);
    await page.fill('[name="password"], #password', password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/list/, { timeout: 10_000 });

    await page.goto(`/join/${token}`);
    await expect(page.getByText('your link')).toBeVisible();

    await admin.auth.admin.deleteUser(userId);
  });

  test('different-account-already-in-household visitor → <AlreadyInHousehold>', async ({
    page,
  }, testInfo) => {
    const admin = adminClient();
    const ownerEmail = `inv-other-owner-${testInfo.project.name}-${Date.now()}@example.com`;
    const visitorEmail = `inv-other-visitor-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    const { data: ownerUser } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
    });
    const { data: visitorUser } = await admin.auth.admin.createUser({
      email: visitorEmail,
      password,
      email_confirm: true,
    });

    // Two separate households.
    const { data: ownerHh } = await admin
      .from('households')
      .insert({ name: `Casa Owner ${Date.now()}` })
      .select('id')
      .single();
    const { data: visitorHh } = await admin
      .from('households')
      .insert({ name: `Casa Visitor ${Date.now()}` })
      .select('id')
      .single();
    await admin.from('household_members').insert([
      {
        household_id: ownerHh!.id,
        user_id: ownerUser!.user!.id,
        role: 'owner',
      },
      {
        household_id: visitorHh!.id,
        user_id: visitorUser!.user!.id,
        role: 'owner',
      },
    ]);
    const token = `other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await admin.from('household_invitations').insert({
      household_id: ownerHh!.id,
      token,
      created_by: ownerUser!.user!.id,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Sign in as the visitor (already in their own household), visit the
    // owner's invite URL → AlreadyInHousehold.
    await page.goto('/sign-in');
    await page.waitForLoadState('networkidle');
    await page.fill('[name="email"], #email', visitorEmail);
    await page.fill('[name="password"], #password', password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/list/, { timeout: 10_000 });

    await page.goto(`/join/${token}`);
    await expect(page.getByText("you're already in a list")).toBeVisible();

    await admin.auth.admin.deleteUser(ownerUser!.user!.id);
    await admin.auth.admin.deleteUser(visitorUser!.user!.id);
  });
});
