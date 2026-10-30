// What: End-to-end walk against hosted Supabase — unauth /sign-in → sign-in →
//       /onboarding → create household → home, refresh, direct-nav guard.
//       Captures the 8-shot 4-combo hero matrix (2 screens × 2 viewports × 2
//       themes) and an append-only audit log at specs/auth/qa-walk.log.
// Why: Closes PR 2's blocked Gate 9 (happy-path walk) with positive evidence
//       against the real hosted stack. Admin-API-backed test user bypasses
//       hosted rate-limit + email-domain-allowlist (see specs/auth/review.md
//       Gate 9 for the original blocker).
// Does NOT: Run in CI. Runs once against --project=desktop (manages its own
//           viewport sizing internally).

import { expect, test } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createTestUser,
  deleteTestUser,
  TEST_EMAIL,
  TEST_PASSWORD,
} from './helpers/test-user';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HERO_DIR = path.join(REPO_ROOT, 'specs', 'auth', 'hero');
const LOG_PATH = path.join(REPO_ROOT, 'specs', 'auth', 'qa-walk.log');

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '375', width: 375, height: 667 },
] as const;

const THEMES = ['light', 'dark'] as const;

/**
 *
 */
function log(line: string): void {
  appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
}

test.describe.configure({ mode: 'serial' });

test.describe('qa-walk (hosted)', () => {
  test.beforeAll(async () => {
    mkdirSync(HERO_DIR, { recursive: true });
    writeFileSync(LOG_PATH, '');
    log('== qa-walk start ==');
    await deleteTestUser();
    log('pre-run cleanup: ok');
    const { id } = await createTestUser();
    log(`admin-created test user (id=${id.slice(0, 8)}…)`);
  });

  test.afterAll(async () => {
    log('== post-run cleanup ==');
    try {
      await deleteTestUser();
      log('cleanup: ok');
      log('== qa-walk end ==');
    } catch (e) {
      log(`cleanup error: ${(e as Error).message}`);
      throw e;
    }
  });

  test('walks full flow and captures the 4-combo × 2-screen matrix', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Surface browser-side diagnostics in the audit log so a failing walk
    // names the cause (console error, failed request) instead of timing out
    // silently.
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        log(`browser [${msg.type()}]: ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => log(`browser pageerror: ${err.message}`));
    page.on('requestfailed', (req) =>
      log(
        `req failed: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`
      )
    );
    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('supabase') && !url.includes('realtime')) {
        log(`supabase ${res.status()} ${res.request().method()} ${url}`);
      }
    });

    // Scenario 1 — /sign-in empty state (unauth) × 4 combos.
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const theme of THEMES) {
        await page.goto('/sign-in');
        await expect(
          page.getByRole('button', { name: /create account/i })
        ).toBeVisible();
        await applyTheme(page, theme);
        const file = `signin-${vp.name}-${theme}.png`;
        await page.screenshot({
          path: path.join(HERO_DIR, file),
          fullPage: true,
        });
        log(`captured ${file}`);
      }
    }

    // Scenario 2 — sign in, capture /onboarding × 4 combos, then create household.
    await page.setViewportSize({ width: 1440, height: 900 });
    await applyTheme(page, 'light');
    await page.goto('/sign-in');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/onboarding$/, { timeout: 15_000 });
    log('signed in → /onboarding reached');

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const theme of THEMES) {
        await page.goto('/onboarding');
        await expect(
          page.getByRole('button', { name: /create/i })
        ).toBeVisible();
        await applyTheme(page, theme);
        const file = `onboarding-${vp.name}-${theme}.png`;
        await page.screenshot({
          path: path.join(HERO_DIR, file),
          fullPage: true,
        });
        log(`captured ${file}`);
      }
    }

    // Scenario 3 — create household, land home, refresh, direct-nav guard.
    await page.setViewportSize({ width: 1440, height: 900 });
    await applyTheme(page, 'light');
    await page.goto('/onboarding');
    await page.getByLabel(/household name/i).fill('Casa QA Walk');
    await page.getByRole('button', { name: /create/i }).click();

    // Wait for either navigation to /list OR the inline error text element,
    // whichever first. Using the specific `text-error` class instead of the
    // generic `role=alert` because Next.js dev's build-status indicator
    // spuriously matches role=alert. Post-D7 (core-flows PR 3): authed home
    // moved from `/` to `/list`, so onboarding redirects here.
    const outcome = await Promise.race([
      page
        .waitForURL(/localhost:3000\/list(\?.*)?$/, {
          timeout: 60_000,
          waitUntil: 'domcontentloaded',
        })
        .then(() => 'navigated' as const),
      page
        .locator('p.text-error[role="alert"]')
        .waitFor({ timeout: 60_000, state: 'visible' })
        .then(() => 'error' as const),
    ]).catch(() => 'neither' as const);

    if (outcome !== 'navigated') {
      // Write failure diagnostic to test-results/ (gitignored) so a crashed
      // walk doesn't leave a debug PNG beside the committed hero shots.
      const failureDir = path.join(__dirname, '..', 'test-results', 'qa-walk');
      mkdirSync(failureDir, { recursive: true });
      await page.screenshot({
        path: path.join(failureDir, 'create-household-failure.png'),
        fullPage: true,
      });
      let alertText = '';
      try {
        alertText =
          (await page
            .locator('p.text-error[role="alert"]')
            .textContent({ timeout: 2_000 })) ?? '';
      } catch {
        /* no alert */
      }
      const url = page.url();
      log(
        `FAILED: create household — outcome=${outcome}, url=${url}, alert="${alertText}"`
      );
      throw new Error(
        `Household create did not redirect. outcome=${outcome}, url=${url}, alert="${alertText}"`
      );
    }
    // Post-D7: the list view masthead is the lalista wordmark. Empty state
    // or loaded state both render the masthead.
    await expect(page.getByText(/lalista/i).first()).toBeVisible();
    log('household created → /list reached + home masthead visible');

    await page.reload();
    await expect(page).toHaveURL(/\/list/);
    log('refresh at /list → still authed');

    await page.goto('/onboarding');
    await page.waitForURL(/\/list/, { timeout: 10_000 });
    log('direct-nav /onboarding while household exists → /list (RSC guard)');
  });
});

/**
 *
 */
async function applyTheme(
  page: import('@playwright/test').Page,
  theme: (typeof THEMES)[number]
): Promise<void> {
  // Theme bootstrap isn't wired in app code yet — decision pending at /ak-spec
  // time for PR 3 (core flows) per PLAN.md. Toggle .dark on <html> explicitly
  // here — the CSS variables in globals.css respond to that class.
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  // Small settle for CSS transitions on the card (duration token is 150ms).
  await page.waitForTimeout(200);
}
