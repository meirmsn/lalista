// What: Theme auto-detection E2E — prefers-color-scheme: dark → `.dark` on <html>
// Why: ThemeProvider must survive the round-trip from OS preference to CSS var
//      so dark mode "just works" at first launch
// Does NOT: Assert specific token values — we just confirm the class toggle

import { expect, test } from '@playwright/test';

test.describe('theme auto-detection', () => {
  test('adds `.dark` to <html> when prefers-color-scheme is dark', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    // ThemeProvider is a client effect; give it a tick to attach.
    await page.waitForFunction(() =>
      document.documentElement.classList.contains('dark')
    );
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test('removes `.dark` when prefers-color-scheme is light', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    // Negative path — confirm the class isn't being force-added somewhere.
    await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });
});
