// What: Core-flows happy-path E2E — sign in → add item → list → buy → sign out
// Why: Assures the full user journey works across the 6 screens in PR 3's scope;
//      no single unit test covers the list + realtime + buy + settings stack
// Does NOT: Run locally without a reachable hosted Supabase; Phase 3 / CI run
//           this against a live environment per spec § Acceptance

import { expect, test } from '@playwright/test';

test.describe('core flows — happy path', () => {
  test('sign in → add milk → mark bought → sign out', async ({ page }) => {
    const email = `e2e-core-${Date.now()}@example.com`;
    const password = 'Password123!';

    // 1. Public landing → Get started → /sign-in
    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);

    // 2. Signup via fallback path
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // 3. Onboarding
    await page.waitForURL(/\/onboarding/);
    await page.getByLabel(/household name/i).fill('Casa E2E Core');
    await page.getByRole('button', { name: /create/i }).click();

    // 4. Land on /list (empty state)
    await page.waitForURL(/\/list/);
    await expect(page.getByText(/la lista está vacía/i)).toBeVisible();

    // 5. Add an item
    await page.getByRole('button', { name: /add item to lalista/i }).click();
    await page.getByRole('dialog', { name: /add to lalista/i }).waitFor();
    await page.getByLabel(/item to add/i).fill('milk');
    await page.getByRole('button', { name: /^add$/i }).click();

    // Wait for the add-item edge-function response to land before entering
    // the disambig loop — the Add click returns instantly, but the dialog
    // (or, on silent-match, the new row) renders only ~50-100ms later.
    // Without this, the loop's first isVisible() races the response and
    // returns false, breaking the loop before any radio is clicked.
    // (Trace from a prior failed run showed isVisible firing 4ms after
    // Add click while the response landed ~50ms in.)
    await Promise.race([
      page
        .getByRole('dialog', { name: /choose an option/i })
        .waitFor({ state: 'visible', timeout: 10000 }),
      page
        .getByRole('button', { name: /mark .* as bought/i })
        .first()
        .waitFor({ state: 'visible', timeout: 10000 }),
    ]);

    // The add may require up to N disambig rounds for a brand-new user.
    // For "milk" typed into a fresh household with no purchase_history:
    //   (a) ITEM follow-up (cold-start — "milk" English has zero trigram
    //       overlap with seeded Spanish items → add-new row is the only
    //       radio). Confirm picks it.
    //   (b) STORE cascade (no history → server can't route → followup
    //       lists stores). Post-f0fd133 this branch renders <StorePicker>
    //       pills (button[aria-pressed]), not role=radio.
    //   (c) Occasionally BRAND cascade if the server wants confirmation.
    // Loop until the sheet closes instead of guessing round count; each
    // iteration confirms the first selectable option (radio or pill),
    // waits briefly for the server to respond, then re-checks the sheet.
    // Bounded at 5 iterations so a runaway cascade doesn't hang the test.
    for (let i = 0; i < 5; i++) {
      const sheet = page.getByRole('dialog', { name: /choose an option/i });
      if (!(await sheet.isVisible().catch(() => false))) break;
      // Unified option locator: radios (item/brand/quantity cascades) OR
      // SelectPill buttons (store cascade — post-f0fd133 D5/D10).
      await sheet.locator('[role=radio], button[aria-pressed]').first().click();
      await sheet.getByRole('button', { name: /confirm/i }).click();
      // Give the server time to respond + state transition. Cascading
      // server round trips on CI take ~200-500ms; this is the simplest
      // reliable signal between "sheet still for this round" and
      // "sheet transitioning to next round or closing."
      await page.waitForTimeout(800);
    }

    // 6. The list shows the new row. The edge-function NLP normalizes
    //    "milk" → "Leche entera" (Spanish canonical) via pg_trgm, so don't
    //    assert literal /milk/ in the row — assert *a* row exists.
    await expect(
      page.getByRole('button', { name: /mark .* as bought/i }).first()
    ).toBeVisible();

    // 7. Mark whatever was added as bought (same NLP-normalization note as
    //    above — the button's aria-label carries the canonical name, not
    //    the user's typed utterance).
    await page
      .getByRole('button', { name: /mark .* as bought/i })
      .first()
      .click();

    // 8. Navigate to Settings + sign out.
    await page.getByRole('link', { name: /open settings/i }).click();
    await page.waitForURL(/\/settings/);
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(/\/sign-in/);
  });

  // PR 5 (disambig-add-new): the disambig sheet's "Add as new" escape hatch.
  // Typing a guaranteed-novel utterance forces the cold-start path → the
  // sheet renders the add-new row → confirming inserts a new items row and
  // routes the entry into list_entries (via the cascading store-disambig).
  test('add-new escape hatch: type novel utterance → pick "Add as new" → row lands', async ({
    page,
  }) => {
    const email = `e2e-add-new-${Date.now()}@example.com`;
    const password = 'Password123!';
    const utterance = `xyzzy-test-item-${Date.now()}`;

    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);

    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    await page.waitForURL(/\/onboarding/);
    await page.getByLabel(/household name/i).fill('Casa E2E AddNew');
    await page.getByRole('button', { name: /create/i }).click();

    await page.waitForURL(/\/list/);

    await page.getByRole('button', { name: /add item to lalista/i }).click();
    await page.getByRole('dialog', { name: /add to lalista/i }).waitFor();
    await page.getByLabel(/item to add/i).fill(utterance);
    await page.getByRole('button', { name: /^add$/i }).click();

    // Disambig sheet must surface — utterance is guaranteed not in seed/DB,
    // so the cold-start branch returns needs_followup: true. The add-new
    // row is the only escape hatch in this state (followup_options[] is
    // empty for cold-start).
    const disambig = page.getByRole('dialog', { name: /choose an option/i });
    await disambig.waitFor();
    await disambig
      .getByRole('radio', {
        name: new RegExp(`add .*${utterance}.* as new`, 'i'),
      })
      .click();
    await disambig.getByRole('button', { name: /confirm/i }).click();

    // Cascading store-disambig fires for the brand-new item (no purchase
    // history → server can't route). Wait for the ITEM cascade's add-new
    // radio to detach — confirms the sheet has transitioned to the STORE
    // cascade, which post-f0fd133 renders <StorePicker> pills (not radios)
    // — then click the first SelectPill (button[aria-pressed]).
    const cascading = page.getByRole('dialog', { name: /choose an option/i });
    if (await cascading.isVisible().catch(() => false)) {
      await cascading
        .getByRole('radio', { name: /add .* as new/i })
        .waitFor({ state: 'detached' });
      await cascading.locator('button[aria-pressed]').first().click();
      await cascading.getByRole('button', { name: /confirm/i }).click();
    }

    // The list now has a row with the typed utterance.
    await expect(
      page.getByText(new RegExp(utterance, 'i')).first()
    ).toBeVisible();
  });
});
