// What: One-off hero capture for PR 5 — screenshots the disambig sheet with the
//       "Add as new" escape hatch row visible, for specs/disambig-add-new/hero/
// Why: Pre-ship Gate 3 hero capture needs an image showing the UI the PR ships;
//       the existing core-flows qa-walk closes the sheet before the final frame
// Does NOT: Run in the main e2e projects — lives under qa-walk so the admin-API
//           helper + serial mode apply; skipped unless explicitly selected
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  createTestUser,
  deleteTestUser,
  TEST_EMAIL,
  TEST_PASSWORD,
} from './helpers/test-user';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HERO_DIR = path.join(REPO_ROOT, 'specs', 'disambig-add-new', 'hero');

test.describe.configure({ mode: 'serial' });

test.describe('disambig-add-new hero capture (hosted)', () => {
  test.beforeAll(async () => {
    mkdirSync(HERO_DIR, { recursive: true });
    await deleteTestUser();
    await createTestUser();
  });

  test.afterAll(async () => {
    await deleteTestUser();
  });

  test('captures the disambig sheet with the add-new row visible', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // Fresh household — no routing history → cascading store disambig will fire.
    await page.goto('/');
    await page.getByRole('link', { name: /create account/i }).click();
    await page.waitForURL(/\/sign-up/);
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    // May land on /list (existing household) or /onboarding.
    await page.waitForURL(/\/(list|onboarding)/, { timeout: 15_000 });
    if (page.url().includes('onboarding')) {
      await page.getByLabel(/household name/i).fill('Hero Capture');
      await page.getByRole('button', { name: /create/i }).click();
      await page.waitForURL(/\/list/);
    }

    // Trigger the disambig sheet via "leche" — known to produce multiple
    // candidates against the seed, so the escape hatch row is visible at the
    // bottom below real candidates (most visually interesting state).
    await page.getByRole('button', { name: /add item to lalista/i }).click();
    await page.getByRole('dialog', { name: /add to lalista/i }).waitFor();
    await page.getByLabel(/item to add/i).fill('leche');
    await page.getByRole('button', { name: /^add$/i }).click();

    await expect(
      page.getByRole('dialog', { name: /choose an option/i })
    ).toBeVisible({ timeout: 30_000 });
    // Ensure the add-new row rendered.
    await expect(
      page.getByRole('radio', { name: /add .*leche.* as new/i })
    ).toBeVisible();

    // Full-page at 1440×900 (default desktop viewport in qa-walk project).
    await page.screenshot({
      path: path.join(HERO_DIR, 'disambig-sheet.png'),
      fullPage: true,
    });
  });
});
