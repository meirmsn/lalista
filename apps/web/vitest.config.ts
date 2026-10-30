// What: Vitest config for the Next.js web app
// Why: Unit tests for middleware, supabase client helpers, and (auth) screens
// Does NOT: Run Playwright — see playwright.config.ts

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// See `packages/core/vitest.config.ts` for the fast/slow split convention.
const isIntegration = Boolean(process.env.VITEST_INTEGRATION);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: isIntegration
      ? [
          'app/**/*.integration.test.ts',
          'app/**/*.integration.test.tsx',
          'components/**/*.integration.test.ts',
          'components/**/*.integration.test.tsx',
          'lib/**/*.integration.test.ts',
          'lib/**/*.integration.test.tsx',
        ]
      : [
          'app/**/*.test.ts',
          'app/**/*.test.tsx',
          'components/**/*.test.ts',
          'components/**/*.test.tsx',
          'lib/**/*.test.ts',
          'lib/**/*.test.tsx',
          'middleware.test.ts',
        ],
    exclude: isIntegration
      ? ['node_modules', '.next', 'e2e']
      : [
          'node_modules',
          '.next',
          'e2e',
          '**/*.integration.test.ts',
          '**/*.integration.test.tsx',
        ],
    globals: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
