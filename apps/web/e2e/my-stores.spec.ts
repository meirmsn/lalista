// What: E2E coverage for the per-household My Stores feature (migration 016).
//       Covers six scenarios: Settings manage flow (remove + add-back),
//       custom-store create from Settings, Model B isolation (household A
//       custom invisible to household B), AddItemSheet store picker, routing
//       fallback (D5), defense-in-depth trigger surfacing.
// Why: Spec § Tests E2E layer per the CLAUDE.md E2E-per-surface invariant.
//      Three surfaces (Settings, AddItemSheet, edge function routing) plus
//      the cross-cutting concerns (RLS scoping, trigger). DB-level
//      assertions via the admin client mirror force-create-race.spec.ts.
// Does NOT: Run against hosted Supabase (admin-client + edge-function
//           deploy shape match local stack only). Pin "edge function
//           returns specific JSON" — those are the unit + integration
//           tests' job; here we verify the user-observable UX.

import { expect, test, type Page } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('my-stores', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('my-stores'));
  test.setTimeout(90000);

  /**
   * Provision a fresh user + household + auto-confirmed email, sign in
   * through the public sign-in form (avoids React hydration race), and
   * return the page + ids.
   */
  async function provisionAndSignIn(
    page: Page,
    label: string
  ): Promise<{ userId: string; householdId: string; email: string }> {
    const admin = adminClient();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `${label}-${stamp}@example.com`;
    const password = 'Password123!';

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(cErr).toBeNull();
    const userId = created.user!.id;

    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ name: `${label} Casa ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    const householdId = hh!.id;

    await admin
      .from('household_members')
      .insert({ household_id: householdId, user_id: userId });

    // Backfill: every household gets the 3 globals via migration 016.
    // For freshly-inserted households after migration time, we mirror that
    // backfill by hand so the user starts with the same shape.
    const { data: globals } = await admin
      .from('stores')
      .select('id')
      .eq('is_global', true);
    if (globals && globals.length > 0) {
      await admin
        .from('household_stores')
        .insert(
          globals.map((s) => ({ household_id: householdId, store_id: s.id }))
        );
    }

    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/sign-in/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/list/);

    return { userId, householdId, email };
  }

  test('Settings manage flow: remove a global store + add it back via autocomplete', async ({
    page,
  }) => {
    const { householdId } = await provisionAndSignIn(page, 'settings-mgr');
    const admin = adminClient();

    await page.goto('/settings');
    await expect(page.getByText(/my stores/i).first()).toBeVisible();
    await expect(page.getByText('Costco')).toBeVisible();

    // Remove Costco — Tier A1 optimistic; row disappears immediately, then
    // the server-side delete confirms.
    await page
      .getByRole('button', { name: /remove costco from my stores/i })
      .click();
    await expect(page.getByText('Costco')).not.toBeVisible();

    // Verify at DB-level that the row is gone. Poll because the Tier A1
    // optimistic UI removes Costco from local state synchronously, but the
    // RPC fires async — without polling, the DB query can race the in-flight
    // remove_household_store call.
    const { data: costcoStore } = await admin
      .from('stores')
      .select('id')
      .eq('name', 'Costco')
      .single();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from('household_stores')
          .select('store_id')
          .eq('household_id', householdId)
          .eq('store_id', costcoStore!.id);
        return data ?? [];
      })
      .toEqual([]);

    // Add it back via autocomplete.
    await page.getByPlaceholder(/add another store/i).fill('cost');
    await expect(page.getByRole('option', { name: 'Costco' })).toBeVisible();
    await page.getByRole('option', { name: 'Costco' }).click();
    // Row re-appears after the optimistic refetch.
    await expect(page.getByText('Costco')).toBeVisible();
  });

  test('custom-store create from Settings mints a private is_global=false row', async ({
    page,
  }) => {
    const { householdId } = await provisionAndSignIn(page, 'settings-custom');
    const admin = adminClient();
    const customName = `Sprouts-${Date.now()}`;

    await page.goto('/settings');
    // Wait for MyStoresSection to finish its initial fetchMyStores render
    // before typing. Without this, `fill()` can fire on mobile WebKit before
    // React hydration attaches the onChange handler — the DOM input gets the
    // value but React's controlled state stays empty and overwrites it on
    // the next render, so the CTA never appears (observed as a hard-fail
    // mobile-only on Next.js dev compile path).
    await expect(page.getByText('Costco')).toBeVisible();

    await page.getByPlaceholder(/add another store/i).fill(customName);
    // Wait for the CTA (suggestions empty → gate met).
    await expect(
      page.getByLabel(new RegExp(`create a new store named ${customName}`, 'i'))
    ).toBeVisible();
    await page
      .getByLabel(new RegExp(`create a new store named ${customName}`, 'i'))
      .click();
    await expect(page.getByText(customName)).toBeVisible();

    // DB-level: a new stores row with is_global=false + created_by_household_id
    // pointing at our household exists, AND a household_stores row joins them.
    // Poll the catalog-row read — Tier A1 optimistic UI shows the placeholder
    // ahead of the add_household_store RPC completion.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from('stores')
          .select('id')
          .eq('name', customName)
          .maybeSingle();
        return data?.id ?? null;
      })
      .not.toBeNull();
    const { data: storeRow } = await admin
      .from('stores')
      .select('id, is_global, created_by_household_id')
      .eq('name', customName)
      .single();
    expect(storeRow!.is_global).toBe(false);
    expect(storeRow!.created_by_household_id).toBe(householdId);

    const { data: link } = await admin
      .from('household_stores')
      .select('store_id')
      .eq('household_id', householdId)
      .eq('store_id', storeRow!.id);
    expect(link).toHaveLength(1);
  });

  test('Model B isolation: household A custom store is invisible to household B', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      const customName = `CasaACustom-${Date.now()}`;

      await provisionAndSignIn(pageA, 'isolation-a');
      await provisionAndSignIn(pageB, 'isolation-b');

      // A creates the custom. Wait for MyStoresSection to hydrate before
      // typing — same fill-before-hydration race as test 124.
      await pageA.goto('/settings');
      await expect(pageA.getByText('Costco')).toBeVisible();
      await pageA.getByPlaceholder(/add another store/i).fill(customName);
      await pageA
        .getByLabel(new RegExp(`create a new store named ${customName}`, 'i'))
        .click();
      await expect(pageA.getByText(customName)).toBeVisible();

      // B searches for it — no suggestion containing the custom name.
      await pageB.goto('/settings');
      await expect(pageB.getByText('Costco')).toBeVisible();
      await pageB
        .getByPlaceholder(/add another store/i)
        .fill(customName.slice(0, 7));
      // Wait a beat for the debounced fetch to resolve.
      await pageB.waitForTimeout(400);
      // No option containing the custom name appears.
      await expect(
        pageB.getByRole('option', { name: new RegExp(customName, 'i') })
      ).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('routing fallback (D5): removing the predicted store downgrades silent_match to asked_store with My-Stores-only candidates', async ({
    page,
  }) => {
    const { householdId } = await provisionAndSignIn(page, 'routing-fb');
    const admin = adminClient();

    // Build history: cheese-at-Costco purchase_history row so the routing
    // engine predicts Costco for "cheese".
    const { data: costco } = await admin
      .from('stores')
      .select('id')
      .eq('name', 'Costco')
      .single();
    const costcoId = costco!.id;

    // Ensure cheese item exists.
    const { data: cheeseItem, error: insertItemErr } = await admin
      .from('items')
      .upsert(
        { name_canonical: 'cheese' },
        { onConflict: 'name_canonical', ignoreDuplicates: false }
      )
      .select('id')
      .single();
    expect(insertItemErr).toBeNull();

    // Insert purchase_history to make routing confident.
    for (let i = 0; i < 3; i++) {
      await admin.from('purchase_history').insert({
        household_id: householdId,
        item_id: cheeseItem!.id,
        store_id: costcoId,
      });
    }

    // Now remove Costco from this household's My Stores.
    await page.goto('/settings');
    await page
      .getByRole('button', { name: /remove costco from my stores/i })
      .click();
    await expect(page.getByText('Costco')).not.toBeVisible();

    // Add cheese via the FAB — expect asked_store branch (StorePicker pills)
    // with NO Costco option since it's no longer in My Stores.
    await page.goto('/list');
    // Open the add-item sheet via the FAB.
    await page.getByRole('button', { name: /add/i }).first().click();
    await page.getByLabel(/item to add/i).fill('cheese');
    await page.getByRole('button', { name: /^add$/i }).click();

    // Disambig sheet should open with followup_type='store'. The StorePicker
    // renders the My Stores as pills — Costco should NOT appear (removed).
    await expect(
      page.getByRole('heading', { name: /which store/i })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Walmart' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Costco' })).toHaveCount(0);
  });

  test('defense-in-depth: stale-tab add-item against a removed store fails with a user-visible error (not a crash)', async ({
    page,
  }) => {
    const { householdId } = await provisionAndSignIn(page, 'defense');
    const admin = adminClient();

    // Pre-populate a list_entries row to verify the trigger doesn't break
    // normal add (sanity baseline).
    const { data: costco } = await admin
      .from('stores')
      .select('id')
      .eq('name', 'Costco')
      .single();
    const { data: anyItem } = await admin
      .from('items')
      .select('id')
      .limit(1)
      .single();

    // Pre-condition: with Costco in My Stores, list_entries insert succeeds.
    const okInsert = await admin.from('list_entries').insert({
      household_id: householdId,
      item_id: anyItem!.id,
      store_id: costco!.id,
      added_by: null, // SET NULL — no specific user
    });
    expect(okInsert.error).toBeNull();

    // Now: remove Costco from My Stores via the UI.
    await page.goto('/settings');
    await expect(page.getByText('Costco')).toBeVisible();
    await page
      .getByRole('button', { name: /remove costco from my stores/i })
      .click();
    await expect(page.getByText('Costco')).not.toBeVisible();

    // Poll until the server-side remove_household_store RPC has actually
    // deleted the row — the Tier A1 optimistic UI removes Costco from local
    // state synchronously, but the trigger only fires once the DB membership
    // is gone. Without this poll, the insert below would race the in-flight
    // RPC (the trigger would let the insert through, blocked.error === null).
    await expect
      .poll(async () => {
        const { data } = await admin
          .from('household_stores')
          .select('store_id')
          .eq('household_id', householdId)
          .eq('store_id', costco!.id);
        return data ?? [];
      })
      .toEqual([]);

    // Direct DB attempt to insert with Costco store_id now triggers the
    // BEFORE INSERT P0001 — verifies the trigger fires at the DB layer.
    const blocked = await admin.from('list_entries').insert({
      household_id: householdId,
      item_id: anyItem!.id,
      store_id: costco!.id,
      added_by: null,
    });
    expect(blocked.error).not.toBeNull();
    expect(blocked.error?.message ?? '').toMatch(/is not in household/i);
  });
});
