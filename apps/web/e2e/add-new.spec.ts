// What: Force-create E2E — carry-forward from PR 5 (disambig-add-new).
// Why: PR 5 couldn't end-to-end-verify the force_create_with_label edge-
//      function branch because no slow-job CI existed to deploy add-item
//      against. PR 4 closes that gap: slow-job deploys add-item to local
//      Supabase, this spec exercises the branch, asserts DB-level rows via
//      a service-role admin client (NOT through the UI), and closes the
//      disambig-add-new verification debt.
// Does NOT: Run in fast CI (Playwright is a slow-job step); run outside
//           the GH-Actions runner (needs a reachable Supabase + deployed
//           add-item). Each test provisions its own user via signup.
//
// Runs at both viewports per playwright.config.ts's mobile + desktop
// projects — the add-new flow is a primary user action, so 4-combo
// evidence applies (viewport × theme is orthogonal; theme is covered
// by qa-walk).

import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Service-role admin client for DB-level assertions. Never used for UI. */
function adminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'add-new.spec.ts requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test.describe('force-create ("Add as new") E2E', () => {
  // Skip when no local Supabase is reachable (e.g. a dev running
  // Playwright against a branch preview without the slow-job harness).
  test.skip(
    !SUPABASE_URL.startsWith('http://127.0.0.1:') &&
      !SUPABASE_URL.startsWith('http://localhost:'),
    'force-create E2E requires a local Supabase stack (slow-job only)'
  );

  test('cold-start utterance → add-new row → new items + list_entries rows persist', async ({
    page,
  }, testInfo) => {
    // Unique-per-run utterance so repeated invocations don't trip 23505 on
    // the second test run's force-create (migration 011's items.name_canonical
    // unique constraint).
    const utterance = `xyzzy-test-${testInfo.project.name}-${Date.now()}`;
    const email = `e2e-addnew-${testInfo.project.name}-${Date.now()}@test.local`;
    const password = 'Password123!';

    // 1. Sign up through the sign-in fallback path.
    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // 2. Onboarding: create the household.
    await page.waitForURL(/\/onboarding/);
    await page
      .getByLabel(/household name/i)
      .fill(`Casa ${testInfo.project.name}`);
    await page.getByRole('button', { name: /create/i }).click();

    // 3. Land on /list → open AddItemSheet → type novel utterance.
    await page.waitForURL(/\/list/);
    await page.getByRole('button', { name: /add item to lalista/i }).click();
    await page.getByRole('dialog', { name: /add to lalista/i }).waitFor();
    await page.getByLabel(/item to add/i).fill(utterance);
    await page.getByRole('button', { name: /^add$/i }).click();

    // 4. DisambiguationSheet opens with the "Add {utterance} as new" row.
    const disambig = page.getByRole('dialog', { name: /choose an option/i });
    await disambig.waitFor();
    await disambig
      .getByRole('radio', {
        name: new RegExp(`add .*${utterance}.* as new`, 'i'),
      })
      .click();
    await disambig.getByRole('button', { name: /confirm/i }).click();

    // 5. Cascading store-disambig (no purchase history → server asks which
    // store). Wait for the ITEM cascade's add-new sentinel to detach —
    // confirms the sheet has transitioned to the STORE cascade, which
    // post-f0fd133 renders <StorePicker> pills (button[aria-pressed]),
    // not radios — then click the first SelectPill.
    const cascading = page.getByRole('dialog', { name: /choose an option/i });
    if (await cascading.isVisible().catch(() => false)) {
      await cascading
        .getByRole('radio', { name: /add .* as new/i })
        .waitFor({ state: 'detached' });
      await cascading.locator('button[aria-pressed]').first().click();
      await cascading.getByRole('button', { name: /confirm/i }).click();
    }

    // 6. UI-level assertion: the list has the new row.
    await expect(
      page.getByText(new RegExp(utterance, 'i')).first()
    ).toBeVisible();

    // 7. DB-level assertions via admin client — closes PR 5's verification
    // debt. Both rows must exist and reference each other by FK.
    const admin = adminClient();

    const { data: itemRows, error: itemsErr } = await admin
      .from('items')
      .select('id, name_canonical')
      .eq('name_canonical', utterance);
    expect(itemsErr, 'items query errored').toBeNull();
    expect(
      itemRows,
      `items row for "${utterance}" should exist post-force-create`
    ).toHaveLength(1);
    const itemId = itemRows![0]!.id;

    const { data: entries, error: entriesErr } = await admin
      .from('list_entries')
      .select('id, item_id, household_id, status')
      .eq('item_id', itemId);
    expect(entriesErr, 'list_entries query errored').toBeNull();
    expect(
      entries,
      `list_entries row referencing new items.id should exist`
    ).toHaveLength(1);
    expect(entries![0]!.status).toBe('pending');
  });
});
