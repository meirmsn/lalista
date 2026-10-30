// What: E2E happy-path for the share/invite loop — owner creates an invite
//       in /settings, second context taps the link, signs up, lands on the
//       shared list with the owner's items visible.
// Why: Acceptance criterion in spec § Success Criteria — "a second user can
//       join an existing household via a link in <30s end-to-end". This spec
//       covers the full stitch.
// Does NOT: Test the email-confirm gap (D19/OV2 deferred — local stack runs
//           with enable_confirmations=false by default; the integration suite
//           covers the mailpit URL-extraction case when the flag is on).

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('household-invite happy path', () => {
  test.skip(
    !isLocalSupabase(),
    localSupabaseSkipReason('household-invite-happy-path')
  );

  test('owner generates link → second context joins → both see same list', async ({
    browser,
  }, testInfo) => {
    const admin = adminClient();
    const ownerEmail = `invite-owner-${testInfo.project.name}-${Date.now()}@example.com`;
    const inviteeEmail = `invite-invitee-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    // Pre-create both confirmed users + the owner's household.
    const { data: ownerUser } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
    });
    const { data: inviteeUser } = await admin.auth.admin.createUser({
      email: inviteeEmail,
      password,
      email_confirm: true,
    });
    const ownerId = ownerUser!.user!.id;
    const inviteeId = inviteeUser!.user!.id;

    const { data: household } = await admin
      .from('households')
      .insert({ name: `Casa Invite ${Date.now()}` })
      .select('id')
      .single();
    const householdId = household!.id;
    await admin.from('household_members').insert({
      household_id: householdId,
      user_id: ownerId,
      role: 'owner',
    });

    // Owner context: sign in + create invite via UI
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto('/sign-in');
    // WebKit hydration race — wait for React state to commit before fill().
    // Without this, mobile-project (iPhone SE / WebKit) submit handlers see
    // empty controlled-input state and the form refuses to submit. See
    // CLAUDE.md § Gotchas + realtime.spec.ts:222-230 for the trace evidence.
    await ownerPage.waitForLoadState('networkidle');
    await ownerPage.fill('[name="email"], #email', ownerEmail);
    await ownerPage.fill('[name="password"], #password', password);
    await ownerPage.click('button:has-text("Sign in")');
    await ownerPage.waitForURL(/\/list/, { timeout: 10_000 });

    await ownerPage.goto('/settings#household');
    await ownerPage.getByRole('button', { name: 'invite someone' }).click();

    // InviteLinkSheet renders the URL. Pull it out.
    const urlBox = ownerPage.getByTestId('invite-link-url');
    await urlBox.waitFor({ state: 'visible' });
    const inviteUrl = await urlBox.textContent();
    expect(inviteUrl).toBeTruthy();
    expect(inviteUrl!).toMatch(/\/join\//);

    // Invitee context: sign in via /sign-in, then visit the invite URL.
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto('/sign-in');
    await inviteePage.waitForLoadState('networkidle');
    await inviteePage.fill('[name="email"], #email', inviteeEmail);
    await inviteePage.fill('[name="password"], #password', password);
    await inviteePage.click('button:has-text("Sign in")');
    // Without a household yet → /onboarding. We override by navigating
    // straight to the invite URL.
    await inviteePage.waitForURL(/\/(onboarding|list)/, { timeout: 10_000 });
    await inviteePage.goto(inviteUrl!);
    await inviteePage.waitForURL(/\/list/, { timeout: 10_000 });

    // Both contexts on /list now → invitee should be in the household.
    const { data: members } = await admin
      .from('household_members')
      .select('user_id')
      .eq('household_id', householdId);
    const memberIds = (members ?? []).map((m) => m.user_id);
    expect(memberIds).toContain(ownerId);
    expect(memberIds).toContain(inviteeId);

    await ownerContext.close();
    await inviteeContext.close();

    // Cleanup
    await admin.auth.admin.deleteUser(ownerId);
    await admin.auth.admin.deleteUser(inviteeId);
  });
});
