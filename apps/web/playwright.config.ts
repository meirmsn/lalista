import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile',
      testIgnore: /qa-walk\.spec\.ts$/,
      use: { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
    },
    {
      name: 'desktop',
      testIgnore: /qa-walk\.spec\.ts$/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      // qa-walk manages its own viewport (captures 4 viewport×theme combos
      // inline). Isolated so `pnpm exec playwright test` doesn't pick it up.
      // executablePath points at the full Chromium (headless_shell download
      // is firewall-blocked in the devcontainer; the full binary runs
      // headless too).
      name: 'qa-walk',
      testMatch: /qa-walk\.spec\.ts$/,
      fullyParallel: false,
      use: {
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
            '/home/node/.cache/ms-playwright/chromium-1217/chrome-linux/chrome',
        },
      },
    },
  ],
  // E2E_TARGET=worker serves the OpenNext build (`pnpm build:worker` first) in wrangler's local
  // Workers runtime, the one production runs on; CI's slow job uses it. Otherwise `next dev`.
  webServer: {
    command:
      process.env.E2E_TARGET === 'worker'
        ? 'pnpm exec wrangler dev --port 3000 --ip 127.0.0.1'
        : 'pnpm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
