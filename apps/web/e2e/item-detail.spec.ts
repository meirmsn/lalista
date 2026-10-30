// What: Single-walk item-detail E2E — admin-client seed → /item/[id] →
//       store-cascade re-add (delete + admin UPDATE) → delete + verify
//       redirect + DB removal.
// Why: PR 3 shipped /item/[id] read-only with a Remove button; PR 4's audit
//      noted no dedicated E2E covers the navigate-attribute-grid-delete walk.
//      This spec exercises the full surface end-to-end and asserts both the
//      UI redirect AND the DB-level deletion (defense-in-depth via admin
//      client per `add-new.spec.ts` precedent).
// Does NOT: Drive store/brand edits via UI — the item-detail page is
//           read-only today (per its `Does NOT` block, edits are delete +
//           re-add). The "change store" step uses an admin-client UPDATE to
//           assert the data flow; when `item-display-name-editing` (v1 TODO)
//           lands true edit UX, refresh this test to drive it through the UI.

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
  userIdFromSignIn,
} from './helpers/admin-client';

test.describe('item-detail walk', () => {
  // Local-stack predicate — admin-client seed needs service-role JWT against
  // a stack we control. Hosted Supabase isn't a viable target (rate limits +
  // signup friction).
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('item-detail'));

  test('seed → navigate → store-cascade re-add → delete → assert removal', async ({
    page,
  }, testInfo) => {
    // Provision a fresh user via the public signup form so the household-
    // membership row gets the real auth flow.
    const email = `item-detail-${testInfo.project.name}-${Date.now()}@example.com`;
    const password = 'Password123!';

    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    await page.waitForURL(/\/onboarding/);
    await page
      .getByLabel(/household name/i)
      .fill(`Casa ItemDetail ${testInfo.project.name}`);
    await page.getByRole('button', { name: /create/i }).click();
    await page.waitForURL(/\/list/);

    // Resolve the user UUID by re-authing with the anon-key client.
    // `admin.auth.admin.listUsers({ perPage: 1000 })` is unreliable on a
    // slow-job stack with accumulated test users (returns intermittent
    // "Database error finding users" 500s); a single signInWithPassword
    // round-trip is more robust and gets the same `user.id`.
    const admin = adminClient();
    const userId = await userIdFromSignIn(email, password);

    const { data: memberships, error: mErr } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId);
    expect(mErr).toBeNull();
    expect(memberships).toHaveLength(1);
    const householdId = memberships![0]!.household_id;

    // Pull two distinct seeded items + two distinct seeded stores so the
    // store-cascade UPDATE has somewhere to move the entry.
    const { data: items, error: itemsErr } = await admin
      .from('items')
      .select('id, name_canonical')
      .in('name_canonical', ['Leche entera', 'Mantequilla']);
    expect(itemsErr).toBeNull();
    const seedItem = items!.find((i) => i.name_canonical === 'Leche entera')!;

    const { data: stores, error: storesErr } = await admin
      .from('stores')
      .select('id, name')
      .in('name', ['Walmart', 'Costco']);
    expect(storesErr).toBeNull();
    const initialStore = stores!.find((s) => s.name === 'Walmart')!;
    const movedStore = stores!.find((s) => s.name === 'Costco')!;

    // Step 1 — seed an entry directly via admin client. UI add would also
    // work; admin-client save shaves ~10s of disambig walking per spec D7
    // ("admin-client seed is acceptable if it shaves >10s").
    const { data: seeded, error: seedErr } = await admin
      .from('list_entries')
      .insert({
        household_id: householdId,
        item_id: seedItem.id,
        store_id: initialStore.id,
        status: 'pending',
        added_by: userId,
        quantity: 1,
      })
      .select('id')
      .single();
    expect(seedErr, 'list_entries seed should succeed').toBeNull();
    const entryId = seeded!.id;

    // Reload /list so the server-rendered fetchListEntries picks up the row.
    await page.reload();
    await expect(
      page.getByRole('link', { name: /Leche entera.*Walmart/i }).first()
    ).toBeVisible();

    // Step 2 — navigate to /item/[id] by clicking the row's body link.
    await page
      .getByRole('link', { name: /Leche entera.*Walmart/i })
      .first()
      .click();
    await page.waitForURL(/\/item\/.+/);
    expect(page.url()).toContain(`/item/${entryId}`);

    // Read-only attribute grid renders.
    await expect(page.getByText(/^store$/i).first()).toBeVisible();
    await expect(page.getByText(/^brand$/i).first()).toBeVisible();
    await expect(page.getByText(/^quantity$/i).first()).toBeVisible();
    await expect(page.getByText(/^added by$/i).first()).toBeVisible();
    await expect(page.getByText(/^added$/i).first()).toBeVisible();
    // The initial store renders in the attribute grid.
    await expect(page.getByText('Walmart').first()).toBeVisible();

    // Step 3 — change store via admin-client UPDATE (item-detail is read-only
    // today, so we exercise the data flow at the DB layer + verify the list
    // re-renders the moved row under the new store's section).
    const { error: updateErr } = await admin
      .from('list_entries')
      .update({ store_id: movedStore.id })
      .eq('id', entryId);
    expect(updateErr, 'store_id UPDATE should succeed').toBeNull();

    // Navigate back to /list and confirm the row now sits under Costco.
    await page.goto('/list');
    await expect(
      page.getByRole('link', { name: /Leche entera.*Costco/i }).first()
    ).toBeVisible();

    // DB-level: store_id is now the moved store.
    const { data: postUpdate, error: readErr } = await admin
      .from('list_entries')
      .select('store_id')
      .eq('id', entryId)
      .single();
    expect(readErr).toBeNull();
    expect(postUpdate!.store_id).toBe(movedStore.id);

    // Step 4 — delete via the UI. Navigate back to /item/[id] and tap Remove.
    await page
      .getByRole('link', { name: /Leche entera.*Costco/i })
      .first()
      .click();
    await page.waitForURL(/\/item\/.+/);
    await page.getByRole('button', { name: /remove from list/i }).click();

    // Redirect back to /list.
    await page.waitForURL(/\/list$/);

    // Row is gone from the list (empty state OR the row is no longer present).
    await expect(
      page.getByRole('link', { name: /Leche entera.*Costco/i })
    ).toHaveCount(0);

    // DB-level: list_entries row is deleted.
    const { data: postDelete, error: postDelErr } = await admin
      .from('list_entries')
      .select('id')
      .eq('id', entryId);
    expect(postDelErr).toBeNull();
    expect(
      postDelete,
      'entry should be deleted from list_entries'
    ).toHaveLength(0);
  });
});
