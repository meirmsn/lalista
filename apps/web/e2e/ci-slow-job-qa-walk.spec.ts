// What: PR 4 Gate 9 qa-walk — exercises the 5 verbs in
//       `specs/ci-slow-job/spec.md § Core user story`, captures one
//       `verb-N-<slug>.png` artifact per verb at specs/ci-slow-job/qa-walk/,
//       writes the audit log at specs/ci-slow-job/qa-walk/run.log (repo-root
//       *.log is gitignored; the one inside qa-walk/ is a runtime artifact
//       that CI's upload-artifact step scoops up on failure).
// Why: Closes Gate 9 for PR 4 with positive evidence per verb. The five
//      verbs cover the display-name plumbing end-to-end: (1) sign up with a
//      name, (2) see the profile row exist, (3) land on /list with real
//      "added by <Name>" render, (4) edit the name in Settings, (5) see the
//      list render the new name after reload. The raw DB assertions
//      (profiles row, display_name update) are duplicated in
//      profiles.integration.test.ts; this walk proves the UI surfaces
//      them.
// Does NOT: Cover hero screenshots (those land at specs/ci-slow-job/hero/)
//           or any non-display-name surfaces (core-flows-qa-walk owns those).
//
// Runs in both contexts:
// 1. CI slow-job: `SUPABASE_URL=http://127.0.0.1:54321 ... pnpm playwright
//    test --project=qa-walk` — boots `next dev` + local Supabase, exercises
//    the walk end-to-end, uploads artifacts on failure via GH-Actions
//    artifact step.
// 2. Pre-ship: `pnpm playwright test --project=qa-walk` against hosted
//    Supabase — same admin-API lifecycle, same verb assertions.

import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FEATURE_DIR = path.join(REPO_ROOT, 'specs', 'ci-slow-job');
const QA_WALK_DIR = path.join(FEATURE_DIR, 'qa-walk');
// Put the runtime log inside qa-walk/ so it sits alongside the per-verb
// screenshots. Repo-root *.log is gitignored — this path isn't, but the run
// log is a runtime artifact (CI artifact upload will scoop it up on failure).
const LOG_PATH = path.join(QA_WALK_DIR, 'run.log');

// Dedicated email so this walk doesn't collide with core-flows-qa-walk's
// preship-qa@. `.invalid` is RFC 2606 reserved (unroutable).
const TEST_EMAIL = 'preship-qa-display@lalista-test.invalid';
const TEST_PASSWORD = 'preship-qa-password-1';
const INITIAL_NAME = 'Meir';
const EDITED_NAME = 'Dad';

/**
 *
 */
function log(line: string): void {
  appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
}

/**
 *
 */
function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 *
 */
async function deleteTestUser(): Promise<void> {
  const client = admin();
  const { data } = await client.auth.admin.listUsers({ perPage: 1000 });
  const user = data?.users.find((u) => u.email === TEST_EMAIL);
  if (!user) return;
  // Cascade households where the test user is the sole member so the next run
  // starts fresh.
  const { data: memberships } = await client
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id);
  for (const m of memberships ?? []) {
    const { count } = await client
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', m.household_id);
    if (count === 1) {
      await client.from('households').delete().eq('id', m.household_id);
    }
  }
  const { error } = await client.auth.admin.deleteUser(user.id);
  if (error && !/not.*found/i.test(error.message)) throw error;
}

/**
 *
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

test.describe('ci-slow-job qa-walk (display-name plumbing)', () => {
  test.beforeAll(async () => {
    mkdirSync(QA_WALK_DIR, { recursive: true });
    mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    writeFileSync(LOG_PATH, '');
    log('== ci-slow-job qa-walk start ==');
    await deleteTestUser();
    log('pre-run cleanup: ok');
  });

  test.afterAll(async () => {
    log('== post-run cleanup ==');
    try {
      await deleteTestUser();
      log('cleanup: ok');
      log('== ci-slow-job qa-walk end ==');
    } catch (e) {
      log(`cleanup error: ${(e as Error).message}`);
      throw e;
    }
  });

  test('walks all 5 display-name Core user story verbs', async ({ page }) => {
    test.setTimeout(180_000);

    page.on('console', (msg) => {
      const t = msg.text();
      if (
        (msg.type() === 'error' || msg.type() === 'warning') &&
        !t.includes('ERR_ADDRESS_UNREACHABLE') &&
        !t.includes('posthog')
      ) {
        log(`browser [${msg.type()}]: ${t.slice(0, 200)}`);
      }
    });
    page.on('pageerror', (err) => log(`pageerror: ${err.message}`));
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

    // ───── Verb 1: Sign up with display name "Meir" ─────
    await page.goto('/sign-in');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/your name/i).fill(INITIAL_NAME);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    // New signup → /onboarding (creates household) OR if awaiting-confirmation,
    // admin-confirm via email_confirm flag is only available to the creator.
    // Here the form runs sign-in-first, fails with invalid-credentials, then
    // signs up. Hosted Supabase projects with email confirmation enabled will
    // render the "Check your email" screen; in CI slow-job local Supabase has
    // mailer_autoconfirm=true so the user lands on /onboarding directly.
    await page.waitForURL(/\/(onboarding|sign-in)/, { timeout: 30_000 });
    if (page.url().includes('/sign-in')) {
      // Awaiting-confirmation branch: admin-confirm the email so we can
      // proceed, then sign in.
      const client = admin();
      const { data } = await client.auth.admin.listUsers({ perPage: 1000 });
      const user = data?.users.find((u) => u.email === TEST_EMAIL);
      if (user && !user.email_confirmed_at) {
        await client.auth.admin.updateUserById(user.id, {
          email_confirm: true,
        });
      }
      await page.goto('/sign-in');
      await page.getByLabel(/email/i).fill(TEST_EMAIL);
      await page.getByLabel(/password/i).fill(TEST_PASSWORD);
      await page.getByRole('button', { name: /create account/i }).click();
      await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    }
    await captureVerb(
      page,
      1,
      'signup-with-name',
      `signed up with display_name="${INITIAL_NAME}"`
    );

    // ───── Verb 2: Profile row exists via handle_new_user trigger ─────
    // Hit the DB directly to assert the trigger fired. This is the
    // structural invariant the next three verbs all depend on.
    const client = admin();
    const { data: users } = await client.auth.admin.listUsers({
      perPage: 1000,
    });
    const user = users?.users.find((u) => u.email === TEST_EMAIL);
    expect(user, 'signup created auth.users row').toBeTruthy();
    const { data: profile } = await client
      .from('profiles')
      .select('user_id, display_name')
      .eq('user_id', user!.id)
      .maybeSingle();
    expect(
      profile?.display_name,
      'handle_new_user trigger seeded profile'
    ).toBe(INITIAL_NAME);
    log(
      `verb 2: trigger seeded profiles.display_name="${profile?.display_name}"`
    );
    // No screenshot — the invariant is DB-level; verbs 3+5 capture the UI side.

    // ───── Verb 3: Land on /list; add an item; see "added by Meir" ─────
    // Complete onboarding → creates a household → routes to /list.
    await page.getByLabel(/household name/i).fill('Casa Meir');
    await page.getByRole('button', { name: /create|continue/i }).click();
    await page.waitForURL(/\/list/, { timeout: 15_000 });

    // Add a list entry via admin (simpler than the full add-item disambig
    // walk — display-name rendering is what we care about, not the add
    // flow, which core-flows-qa-walk owns).
    const { data: households } = await client
      .from('household_members')
      .select('household_id')
      .eq('user_id', user!.id);
    const householdId = households?.[0]?.household_id;
    if (!householdId) throw new Error('post-onboarding: no household');
    const { data: item } = await client
      .from('items')
      .select('id')
      .eq('name_canonical', 'Leche entera')
      .single();
    const { data: store } = await client
      .from('stores')
      .select('id')
      .eq('name', 'Whole Foods')
      .single();
    await client.from('list_entries').insert({
      household_id: householdId,
      item_id: item!.id,
      store_id: store!.id,
      added_by: user!.id,
      quantity: 1,
      status: 'pending',
    });

    await page.reload();
    await expect(
      page.getByText(new RegExp(`added by ${INITIAL_NAME}`, 'i'))
    ).toBeVisible({
      timeout: 10_000,
    });
    await captureVerb(
      page,
      3,
      'list-shows-meir',
      `/list renders "added by ${INITIAL_NAME}"`
    );

    // ───── Verb 4: Edit display name to "Dad" in Settings ─────
    await page.goto('/settings');
    const nameInput = page.getByLabel(/your name/i);
    await expect(nameInput).toHaveValue(INITIAL_NAME);
    await nameInput.fill(EDITED_NAME);
    await nameInput.blur();
    // Wait for the debounced/on-blur save to land in the DB.
    await expect
      .poll(
        async () => {
          const { data } = await client
            .from('profiles')
            .select('display_name')
            .eq('user_id', user!.id)
            .maybeSingle();
          return data?.display_name;
        },
        { timeout: 10_000, intervals: [250, 500, 1000] }
      )
      .toBe(EDITED_NAME);
    await captureVerb(
      page,
      4,
      'settings-renamed',
      `display_name updated to "${EDITED_NAME}" via Settings`
    );

    // ───── Verb 5: Reload /list; same row renders "added by Dad" ─────
    await page.goto('/list');
    await expect(
      page.getByText(new RegExp(`added by ${EDITED_NAME}`, 'i'))
    ).toBeVisible({
      timeout: 10_000,
    });
    await captureVerb(
      page,
      5,
      'list-shows-dad',
      `/list renders "added by ${EDITED_NAME}" after profile update`
    );

    log('all 5 verbs exercised');
  });
});
