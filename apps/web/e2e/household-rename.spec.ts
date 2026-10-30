// What: E2E for household rename + the owner-vs-member view of HouseholdSection.
// Why: T14 — owner sees an editable input; member sees read-only + "only
//       owners can rename." caption. Renaming surfaces in /list header on
//       next page load.

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('household-rename', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('household-rename'));

  test('owner renames household; new name shows on /list header', async ({
    page,
  }, testInfo) => {
    const admin = adminClient();
    const email = `rename-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    const { data: user } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    const userId = user!.user!.id;
    const initialName = `Casa Original ${Date.now()}`;
    const { data: household } = await admin
      .from('households')
      .insert({ name: initialName })
      .select('id')
      .single();
    await admin.from('household_members').insert({
      household_id: household!.id,
      user_id: userId,
      role: 'owner',
    });

    await page.goto('/sign-in');
    // WebKit hydration race — wait for React state to commit (CLAUDE.md gotcha).
    await page.waitForLoadState('networkidle');
    await page.fill('[name="email"], #email', email);
    await page.fill('[name="password"], #password', password);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/list/, { timeout: 10_000 });

    // Header caption shows the initial name.
    await expect(page.getByText(initialName)).toBeVisible();

    // Settings → Household: edit the name.
    await page.goto('/settings#household');
    const newName = `Casa Renamed ${Date.now()}`;
    const householdInput = page
      .getByRole('region', { name: /household/i })
      .getByLabel(/household name/i);
    // Use pressSequentially (real per-character keyboard events) instead of
    // fill() to populate the field. fill() on WebKit mobile sets input.value
    // but doesn't propagate the input event into React's synthetic event
    // system (verified via trace inspection of CI runs 25637143418 +
    // 25643271746 + 25643685734: rename_household RPC count = 0 with fill()
    // + blur(), fill() + click-elsewhere, or fill() + press('Tab')).
    // pressSequentially fires keydown/keypress/input/keyup per character,
    // which React's controlled-input handler observes reliably across
    // chromium + webkit. The 300ms debounce timer in DisplayNameField then
    // fires the commit naturally, no separate blur trigger needed.
    await householdInput.click(); // focus
    await householdInput.fill(''); // clear (fill('') still works to clear)
    await householdInput.pressSequentially(newName, { delay: 30 });
    // Wait past the 300ms debounce + RPC round-trip with margin.
    await page.waitForTimeout(1500);

    // Verify the rename landed in the DB.
    const { data: refreshed } = await admin
      .from('households')
      .select('name')
      .eq('id', household!.id)
      .single();
    expect(refreshed!.name).toBe(newName);

    // Reload /list and assert the header caption updates.
    await page.goto('/list');
    await expect(page.getByText(newName)).toBeVisible();

    await admin.auth.admin.deleteUser(userId);
  });
});
