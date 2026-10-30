// What: Tier A2 add-item submission-failure E2E — uses
//       page.route() to abort the add-item edge function call, asserts
//       the SyncErrorBanner surfaces with the failed item label and the
//       Retry / Undo affordances are wired.
// Why: Spec § Tests / D6 — the Tier A2 banner-on-network-failure path
//      is the most complex new behavior in this PR. Unit tests pin the
//      hook's mechanics; this E2E pins the user-facing surface
//      (sheet → retry budget → banner with retry+undo) end-to-end.
// Does NOT: Test the full retry sequence end-to-end (15s in real time
//           is too slow for E2E). The hook's retry timing is pinned in
//           useOptimisticMutation.test.ts. This spec asserts the
//           banner DOES appear after the abort cycle resolves AND the
//           Undo / Retry buttons are present + clickable.

import { expect, test } from '@playwright/test';
import {
  adminClient,
  isLocalSupabase,
  localSupabaseSkipReason,
} from './helpers/admin-client';

test.describe('AddItemSheet — Tier A2 submission failure banner', () => {
  test.skip(!isLocalSupabase(), localSupabaseSkipReason('add-item-banner'));

  // Sign-in flow + 11s of [1,3,7]s retry backoffs + abort RTT + post-banner
  // assertions cumulatively hit ~25–30s in slow-CI mobile. Default 30s test
  // timeout is too tight; bump to 60s with the per-assertion timeout below
  // owning the granular wait.
  test.setTimeout(60000);

  test('aborted add-item function fires retries then surfaces SyncErrorBanner with Retry + Undo', async ({
    page,
  }, testInfo) => {
    const admin = adminClient();
    const stamp = `${testInfo.project.name}-${Date.now()}`;
    const email = `add-banner-${stamp}@example.com`;
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
      .insert({ name: `Casa Banner ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    const { error: memErr } = await admin
      .from('household_members')
      .insert({ household_id: hh!.id, user_id: userId });
    expect(memErr).toBeNull();

    // Abort the add-item edge-function call so every retry attempt fails.
    // The hook's [1s, 3s, 7s] backoff sums to 11s; we wait the banner out
    // with a generous timeout (the test's fake-timer-equivalent is being
    // patient on a real clock).
    await page.route('**/functions/v1/add-item', (route) => route.abort());

    await page.goto('/');
    await page.getByRole('link', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/sign-in/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/list/);

    // Open AddItemSheet via the FAB.
    await page.getByRole('button', { name: /add item to lalista/i }).click();
    await expect(
      page.getByRole('dialog', { name: /add to lalista/i })
    ).toBeVisible();

    // Type the utterance and submit. The hook will retry per RETRY_BACKOFF_MS
    // [1s, 3s, 7s] then escalate to the banner.
    await page.getByLabel(/item to add/i).fill('milk');
    await page.getByRole('button', { name: /^add$/i }).click();

    // Banner surfaces after the retry budget exhausts. ~13s is the upper
    // bound (1+3+7 = 11s of backoff + ~2s slack for the abort cycle and
    // React state propagation). Slow-job CI variance has bitten similar
    // realtime specs (see realtime.spec.ts:151) so we leave headroom —
    // 25s observed in CI on mobile project (see PR #49 fix-loop logs).
    const bannerLabel = page.getByTestId('sync-error-label');
    await expect(bannerLabel).toBeVisible({ timeout: 25000 });
    await expect(bannerLabel).toHaveText(/couldn't save 'milk'/i);

    // Retry + Undo affordances are present.
    await expect(page.getByRole('button', { name: /^retry$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^undo$/i })).toBeVisible();

    // Tap Undo to clear the banner. (Retry would re-fire the same failing
    // request and burn another 11s of backoff; Undo is the fast clean-up.)
    await page.getByRole('button', { name: /^undo$/i }).click();
    await expect(bannerLabel).toBeHidden();
  });
});
