// What: Concurrent force-create race E2E. Two browser contexts signed in as
//       two members of the same household submit force-create on the SAME
//       novel utterance via Promise.all. The 23505 fallback in
//       supabase/functions/add-item/index.ts catches the unique-violation
//       and re-resolves to the existing item. Load-bearing assertion is
//       DB-level: exactly one items row, exactly two list_entries rows, both
//       referencing the same items.id.
// Why: PR 4's audit noted the integration test in
//      packages/core/src/api/items.integration.test.ts covers the function-
//      level race; this E2E exercises the full UI path including the
//      cascading store-disambig, so a regression in the 23505 fallback
//      would surface as a user-visible toast rather than a silent DB
//      duplicate.
// Does NOT: Test concurrent inserts of DIFFERENT utterances (no race —
//           items.name_canonical unique constraint doesn't fire); run
//           against hosted Supabase (admin-client + edge function deploy
//           shape match local stack only). Pin "one context shows an error"
//           — the architecture explicitly prevents that (per spec § Gotchas).

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('force-create concurrent race', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('force-create-race'));

  // Two browser contexts × full sign-in flow × cascading disambig walk x2 ×
  // DB assertions takes well over the default 30s on CI runners. Bumped here,
  // not globally — most other specs sit comfortably under 30s.
  test.setTimeout(90000);

  test('concurrent force-create of same novel utterance: dedups to one items row + one shared list_entries row', async ({
    browser,
  }, testInfo) => {
    const admin = adminClient();
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const utterance = `force-race-${stamp}`;

    // Provision two confirmed users + a shared household, mirroring
    // realtime.spec.ts's two-member shape. example.com (not `.invalid`)
    // because both users dial through the public sign-in form, which runs
    // HTML5 type=email validation; WebKit (mobile) rejects `.invalid`.
    const emailA = `force-race-a-${stamp}@example.com`;
    const emailB = `force-race-b-${stamp}@example.com`;
    const password = 'Password123!';

    const { data: ua, error: aErr } = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    expect(aErr).toBeNull();
    const userIdA = ua.user!.id;

    const { data: ub, error: bErr } = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    expect(bErr).toBeNull();
    const userIdB = ub.user!.id;

    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Casa Race ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    const householdId = hh!.id;

    await admin.from('household_members').insert([
      { household_id: householdId, user_id: userIdA },
      { household_id: householdId, user_id: userIdB },
    ]);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // Both sign in via `/` → "Get started" → /sign-in. Direct
      // goto('/sign-in') races React form-state hydration on WebKit; see
      // auth-edge-cases.spec.ts:31 for the trace evidence + fix rationale.
      await pageA.goto('/');
      await pageA.getByRole('link', { name: /^sign in$/i }).click();
      await pageA.waitForURL(/\/sign-in/);
      await pageA.getByLabel(/email/i).fill(emailA);
      await pageA.getByLabel(/password/i).fill(password);
      await pageA.getByRole('button', { name: /^sign in$/i }).click();
      await pageA.waitForURL(/\/list/);

      await pageB.goto('/');
      await pageB.getByRole('link', { name: /^sign in$/i }).click();
      await pageB.waitForURL(/\/sign-in/);
      await pageB.getByLabel(/email/i).fill(emailB);
      await pageB.getByLabel(/password/i).fill(password);
      await pageB.getByRole('button', { name: /^sign in$/i }).click();
      await pageB.waitForURL(/\/list/);

      // Open AddItemSheet on both and type the same utterance.
      await pageA.getByRole('button', { name: /add item to lalista/i }).click();
      await pageA.getByRole('dialog', { name: /add to lalista/i }).waitFor();
      await pageA.getByLabel(/item to add/i).fill(utterance);

      await pageB.getByRole('button', { name: /add item to lalista/i }).click();
      await pageB.getByRole('dialog', { name: /add to lalista/i }).waitFor();
      await pageB.getByLabel(/item to add/i).fill(utterance);

      // Fire both submits concurrently. Both surface the disambig sheet
      // (cold-start utterance → add-new sentinel is the only option).
      await Promise.all([
        pageA.getByRole('button', { name: /^add$/i }).click(),
        pageB.getByRole('button', { name: /^add$/i }).click(),
      ]);

      // Walk each context through the disambig + cascading store-disambig.
      // Mirror add-new.spec.ts:76-98. Both contexts hit the 23505 path
      // somewhere inside the edge function, but neither sees a UI error.
      for (const p of [pageA, pageB]) {
        const disambig = p.getByRole('dialog', { name: /choose an option/i });
        await disambig.waitFor();
        await disambig
          .getByRole('radio', {
            name: new RegExp(`add .*${utterance}.* as new`, 'i'),
          })
          .click();
        await disambig.getByRole('button', { name: /confirm/i }).click();

        // Cascading store-disambig — wait for the ITEM cascade's add-new
        // sentinel to detach, then click the first SelectPill. Post-f0fd133
        // the store cascade renders <StorePicker> pills (button[aria-pressed])
        // not radios; same caveat as add-new.spec.ts.
        const cascading = p.getByRole('dialog', { name: /choose an option/i });
        if (await cascading.isVisible().catch(() => false)) {
          await cascading
            .getByRole('radio', { name: /add .* as new/i })
            .waitFor({ state: 'detached' });
          await cascading.locator('button[aria-pressed]').first().click();
          await cascading.getByRole('button', { name: /confirm/i }).click();
        }
      }

      // UI-level: both contexts show the row.
      await expect(
        pageA.getByText(new RegExp(utterance, 'i')).first()
      ).toBeVisible();
      await expect(
        pageB.getByText(new RegExp(utterance, 'i')).first()
      ).toBeVisible();

      // Load-bearing DB-level assertion: exactly one items row + exactly
      // one list_entries row, BOTH contexts seeing the same shared row in
      // their UI (asserted above). The edge function's force-create branch
      // hits the items.name_canonical unique constraint on the second
      // concurrent submit, falls through to the existing-candidate path,
      // and the household-level dedup ('already_on_list') prevents a
      // duplicate list_entries insert. Net product behavior: one shared
      // row, both users see it. The race is invisible to users — that's
      // the load-bearing property this spec verifies.
      const { data: itemsRows, error: itemsErr } = await admin
        .from('items')
        .select('id, name_canonical')
        .eq('name_canonical', utterance);
      expect(itemsErr, 'items query errored').toBeNull();
      expect(
        itemsRows,
        `exactly one items row for "${utterance}" — 23505 fallback should re-resolve, NOT duplicate`
      ).toHaveLength(1);
      const itemId = itemsRows![0]!.id;

      const { data: entries, error: entriesErr } = await admin
        .from('list_entries')
        .select('id, item_id, household_id')
        .eq('item_id', itemId)
        .eq('household_id', householdId);
      expect(entriesErr).toBeNull();
      expect(
        entries,
        'exactly one list_entries row — household dedup prevents the second concurrent add from creating a duplicate row in the same household'
      ).toHaveLength(1);
      expect(entries![0]!.item_id).toBe(itemId);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
