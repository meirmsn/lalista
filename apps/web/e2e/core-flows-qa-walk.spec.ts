// What: Pre-ship QA walk — exercises every verb declared in spec.md's `## Core
//       user story` section against hosted Supabase, captures one
//       `verb-N-<slug>.png` artifact per verb at specs/core-flows/qa-walk/, and
//       writes the audit log at specs/core-flows/qa-walk.log.
// Why: Closes Gate 9 for PR 3 with positive evidence per verb. The artifact
//       contract (preship-verify-story.sh verify-all) blocks pre-ship when any
//       verb's screenshot is missing — the rule exists because the original PR-3
//       walk reported `pass` after only opening the add-sheet and pressing
//       Escape, masking the cascading-disambig bug user-reported on PR 15.
// Does NOT: Capture hero screenshots here — those are at specs/core-flows/hero/.
//           Cover side trips (item-detail, settings, sign-out) — those are in
//           core-flows.spec.ts. Only the Core user story verbs land here.

import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createTestUser,
  deleteTestUser,
  TEST_EMAIL,
  TEST_PASSWORD,
} from './helpers/test-user';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FEATURE_DIR = path.join(REPO_ROOT, 'specs', 'core-flows');
const LOG_PATH = path.join(FEATURE_DIR, 'qa-walk.log');
const QA_WALK_DIR = path.join(FEATURE_DIR, 'qa-walk');

/**
 *
 */
function log(line: string): void {
  appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
}

/**
 * Capture the per-verb artifact required by Gate 9. Path layout matches
 * preship-verify-story.sh's `verb-<N>-*.{png,json}` glob.
 */
async function captureVerb(
  page: Page,
  n: number,
  slug: string,
  description: string
): Promise<void> {
  const file = path.join(QA_WALK_DIR, `verb-${n}-${slug}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log(`verb ${n} captured: ${path.basename(file)} — ${description}`);
}

test.describe.configure({ mode: 'serial' });

test.describe('core-flows qa-walk (hosted)', () => {
  test.beforeAll(async () => {
    mkdirSync(QA_WALK_DIR, { recursive: true });
    mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    writeFileSync(LOG_PATH, '');
    log('== core-flows qa-walk start ==');
    await deleteTestUser();
    log('pre-run cleanup: ok');
    const { id } = await createTestUser();
    log(`admin-created test user (id=${id.slice(0, 8)}…)`);

    // Seed a household + 2 list entries so verb 1's "land on the grouped-by-store
    // list" has an observable loaded state (not the empty-state screen).
    const admin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: h, error: hErr } = await admin
      .from('households')
      .insert({ name: 'QA Pre-Ship Core-Flows' })
      .select()
      .single();
    if (hErr) throw hErr;
    await admin
      .from('household_members')
      .insert({ user_id: id, household_id: h.id, role: 'owner' });

    // Use Leche entera + Leche 2% explicitly (the two seeded leche items most
    // likely to surface in any disambig of "leche" — but NOT Leche lactaid,
    // which verb 3 will add via cascading disambig). Falling back to .limit(2)
    // would couple the test to insertion order in seed.sql.
    const { data: items } = await admin
      .from('items')
      .select('id, name_canonical')
      .in('name_canonical', ['Leche entera', 'Leche 2%']);
    const { data: stores } = await admin
      .from('stores')
      .select('id, name')
      .eq('name', 'Whole Foods');
    if (!items || !stores || items.length < 2 || stores.length < 1) {
      throw new Error(
        'seed: Leche entera/2% items or Whole Foods store not present; run supabase seed.sql first'
      );
    }
    await admin.from('list_entries').insert(
      items.map((it) => ({
        household_id: h.id,
        item_id: it.id,
        store_id: stores[0].id,
        added_by: id,
        quantity: 1,
      }))
    );
    log(`seed: household ${h.id.slice(0, 8)}… with 2 list entries`);
  });

  test.afterAll(async () => {
    log('== post-run cleanup ==');
    try {
      await deleteTestUser();
      log('cleanup: ok');
      log('== core-flows qa-walk end ==');
    } catch (e) {
      log(`cleanup error: ${(e as Error).message}`);
      throw e;
    }
  });

  test('walks all 4 Core user story verbs and captures per-verb artifacts', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Diagnostic wiring — surface browser-side console/network errors into the
    // audit log so a failing walk names the cause instead of timing out silently.
    page.on('console', (msg) => {
      const t = msg.text();
      if (
        (msg.type() === 'error' || msg.type() === 'warning') &&
        // PostHog telemetry errors don't matter for functional QA
        !t.includes('ERR_ADDRESS_UNREACHABLE') &&
        !t.includes('posthog')
      ) {
        log(`browser [${msg.type()}]: ${t.slice(0, 200)}`);
      }
    });
    page.on('pageerror', (err) => log(`pageerror: ${err.message}`));
    // Log non-2xx Supabase responses so we can tell rpc/REST/edge-function
    // failures apart from the generic "Failed to load resource" the browser
    // emits. Skip Realtime websocket frames (firehose).
    page.on('response', async (res) => {
      const url = res.url();
      const status = res.status();
      if (
        url.includes('supabase') &&
        !url.includes('realtime') &&
        status >= 400
      ) {
        log(
          `supabase ${status} ${res.request().method()} ${url.split('?')[0]}`
        );
      }
    });

    // ───── Verb 1: Sign in to the household and land on /list ─────
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: /create account/i })
    ).toBeVisible();
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/(list|onboarding)/, { timeout: 15_000 });
    if (page.url().includes('onboarding')) {
      // Already-householded user — Onboarding RSC redirects to /list.
      await page.waitForURL(/\/list/, { timeout: 10_000 });
    }
    await expect(page.locator('a[href^="/item/"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await captureVerb(
      page,
      1,
      'list-loaded',
      'signed in, /list reached, seeded rows visible'
    );

    // ───── Verb 2: Add Tilapia (single canonical match → store disambig) ─────
    await page.getByRole('button', { name: /add item to lalista/i }).click();
    await expect(
      page.getByRole('dialog', { name: /add to lalista/i })
    ).toBeVisible();
    await page.getByLabel(/item to add/i).fill('Tilapia');
    await page.getByRole('button', { name: /^add$/i }).click();
    // Server returns followup_type='store' (no purchase_history → can't auto-route).
    // AddItemSheet routes the response into ListClient → opens DisambiguationSheet.
    await expect(
      page.getByRole('dialog', { name: /choose an option/i })
    ).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole('radio', { name: /Whole Foods|Costco|Walmart/i })
      .first()
      .click();
    await page.getByRole('button', { name: /^confirm$/i }).click();
    await expect(
      page.getByRole('dialog', { name: /choose an option/i })
    ).not.toBeVisible({ timeout: 30_000 });
    // The new entry surfaces — either via the optimistic insert in
    // ListClient.handleAddResponse OR the Realtime INSERT replacing it
    // (id-match dedup, dc4c9f2 fix #3). Target the row link specifically so
    // the post-add ConfirmationToast ("Added Tilapia to Costco") doesn't
    // collide with the row's text under getByText.
    await expect(page.getByRole('link', { name: /Tilapia/i })).toBeVisible({
      timeout: 10_000,
    });
    await captureVerb(
      page,
      2,
      'tilapia-added',
      'Tilapia confirmed via store disambig, row visible in /list'
    );

    // ───── Verb 3: Add "leche" (item disambig → cascading store disambig) ─────
    await page.getByRole('button', { name: /add item to lalista/i }).click();
    await expect(
      page.getByRole('dialog', { name: /add to lalista/i })
    ).toBeVisible();
    await page.getByLabel(/item to add/i).fill('leche');
    await page.getByRole('button', { name: /^add$/i }).click();
    // Round 1: item disambig — pick Leche lactaid (NOT in seeded list, so
    // server won't shortcut to already_on_list+quantity).
    await expect(
      page.getByRole('dialog', { name: /choose an option/i })
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('radio', { name: /Leche lactaid/i }).click();
    await page.getByRole('button', { name: /^confirm$/i }).click();
    // Round 2 (cascade): the SAME dialog stays mounted with new store options.
    // This is the dc4c9f2 fix path — pre-fix, the sheet would close here and
    // the user's pick would silently drop. Wait for the heading question to
    // change OR a store-shaped option to appear.
    await expect(
      page.getByRole('radio', { name: /Whole Foods|Costco|Walmart/i }).first()
    ).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole('radio', { name: /Whole Foods|Costco|Walmart/i })
      .first()
      .click();
    await page.getByRole('button', { name: /^confirm$/i }).click();
    await expect(
      page.getByRole('dialog', { name: /choose an option/i })
    ).not.toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('link', { name: /Leche lactaid/i })
    ).toBeVisible({ timeout: 10_000 });
    await captureVerb(
      page,
      3,
      'leche-cascading-disambig',
      'Leche lactaid confirmed via cascading item→store disambig, row visible'
    );

    // ───── Verb 4: Mark Tilapia bought → row disappears ─────
    await page.getByRole('button', { name: /Mark Tilapia as bought/i }).click();
    // ListClient flips isBuying → row fades to opacity-50, then mark_item_bought
    // RPC succeeds and Realtime DELETE removes the row. Either ordering ends
    // with the Tilapia link gone from the DOM (we target the row link, not
    // generic text — a buy-confirmation toast may still be visible briefly).
    await expect(page.getByRole('link', { name: /Tilapia/i })).not.toBeVisible({
      timeout: 15_000,
    });
    await captureVerb(
      page,
      4,
      'tilapia-bought',
      'Tilapia row disappeared from /list after buy-button tap'
    );

    log('all 4 verbs exercised');
  });
});
