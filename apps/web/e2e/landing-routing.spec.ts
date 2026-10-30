// What: IA routing E2E for D7 — unauth `/` lands, unauth `/list` redirects
// Why: The IA flip is easy to regress; a single E2E guards the routing matrix
// Does NOT: Exercise authed redirects (covered in core-flows.spec.ts' sign-in step)

import { expect, test } from '@playwright/test';

test.describe('IA routing — unauth visitors', () => {
  test('unauth `/` renders the public landing with paired auth CTAs', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /lalista/i, level: 1 })
    ).toBeVisible();
    const primary = page.getByRole('link', { name: /create account/i });
    await expect(primary).toBeVisible();
    await expect(primary).toHaveAttribute('href', '/sign-up');
    const secondary = page.getByRole('link', { name: /^sign in$/i });
    await expect(secondary).toBeVisible();
    await expect(secondary).toHaveAttribute('href', '/sign-in');
  });

  test('unauth `/list` redirects to /sign-in with next=/list', async ({
    page,
  }) => {
    await page.goto('/list');
    await page.waitForURL(/\/sign-in/);
    const url = new URL(page.url());
    expect(url.searchParams.get('next')).toBe('/list');
  });
});
