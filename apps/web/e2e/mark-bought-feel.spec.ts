// What: Tier A1 mark-bought feel E2E — adds a list entry directly via
//       admin-client, navigates to /list, taps the buy button, asserts
//       the row's container shifts to opacity-50 (the optimistic fade)
//       and that the row eventually disappears via realtime DELETE.
// Why: Spec § Tests / D6 — pins that the optimistic visual change is
//      instant (Tier A1's "rollback IS the message" depends on the
//      fade landing before the RPC resolves). useOptimisticMutation
//      tests pin the queueMicrotask-defer mechanics; this E2E pins
//      the integration through ListClient + ListRow + the markItemBought
//      RPC.
// Does NOT: Inject an RPC failure to assert the rollback restores
//           opacity — exercising that requires page.route()-aborting
//           the supabase RPC POST, which doesn't have a clean URL match
//           pattern (the rpc/mark_item_bought endpoint is hit via the
//           supabase-js client which the route interceptor doesn't
//           always see). The rollback path is pinned in
//           useOptimisticMutation.test.ts (queueMicrotask defer +
//           rollback handler invocation).

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('mark-bought — Tier A1 optimistic fade', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('mark-bought-feel'));

  test('row fades immediately on tap then disappears via realtime', async ({
    page,
  }, testInfo) => {
    const admin = adminClient();
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const email = `mark-bought-${stamp}@example.com`;
    const password = 'Password123!';

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    const userId = created.user!.id;

    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Casa Bought ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    const householdId = hh!.id;

    const { error: memErr } = await admin
      .from('household_members')
      .insert({ household_id: householdId, user_id: userId });
    expect(memErr).toBeNull();

    // Insert a list entry directly so we hit /list with one row already
    // present — same pattern as realtime.spec.ts, sidesteps the AddItem
    // flow which is exercised elsewhere.
    // `items` has columns id / name_canonical / category — no `name`.
    // Selecting a non-existent column makes PostgREST return null + an
    // error and the test crashes on `items!.id`. Match the realtime spec.
    const { data: items } = await admin
      .from('items')
      .select('id')
      .eq('name_canonical', 'Leche entera')
      .single();
    const { data: stores } = await admin
      .from('stores')
      .select('id, name')
      .eq('name', 'Walmart')
      .single();

    const uniqueBrand = `mark-bought-${stamp}`;
    const { data: entry, error: insertErr } = await admin
      .from('list_entries')
      .insert({
        household_id: householdId,
        item_id: items!.id,
        store_id: stores!.id,
        status: 'pending',
        added_by: userId,
        brand: uniqueBrand,
        quantity: 1,
      })
      .select('id')
      .single();
    expect(insertErr).toBeNull();
    const entryId = entry!.id;

    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/sign-in/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/list/);

    // The row should be visible by its unique brand text.
    await expect(page.getByText(uniqueBrand).first()).toBeVisible();

    // Tap the buy button (mark-bought). The row's ListRow container
    // immediately receives the opacity-50 class via the isBuying prop
    // (ListClient.handleBuy → applyOptimistic → setBuyingId).
    const row = page.getByTestId(`list-row-${entryId}`);
    await expect(row).toBeVisible();
    await page
      .getByRole('button', { name: new RegExp(`mark .* as bought`, 'i') })
      .click();

    // Optimistic fade: the row's class flips to include "opacity-50".
    // We poll on the className via a getAttribute check rather than a
    // visual one because the fade is a class swap, not a CSS animation.
    await expect
      .poll(async () => (await row.getAttribute('class')) ?? '', {
        message: 'list row should drop to opacity-50 on tap (Tier A1 fade)',
        timeout: 1000,
      })
      .toMatch(/opacity-50/);

    // Realtime DELETE eventually removes the row from the list.
    await expect(row).toHaveCount(0, { timeout: 10000 });

    // DB-level cross-check: list_entries row is gone, purchase_history row exists.
    const { data: rowsAfter } = await admin
      .from('list_entries')
      .select('id')
      .eq('id', entryId);
    expect(rowsAfter, 'list_entries row should be deleted').toHaveLength(0);

    // purchase_history doesn't carry a list_entry_id FK back to list_entries —
    // mark_item_bought writes (household_id, item_id, store_id, brand,
    // bought_at, added_by) per migration 002 / 010. Use the test's
    // unique-per-run brand string (line 74) as the structural identifier.
    const { data: history } = await admin
      .from('purchase_history')
      .select('id')
      .eq('brand', uniqueBrand);
    expect(
      history,
      'purchase_history should record the bought entry'
    ).toHaveLength(1);
  });
});
