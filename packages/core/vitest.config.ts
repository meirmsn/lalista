import { defineConfig } from 'vitest/config';

// Unit tests live in `*.test.ts` and run in the fast CI job.
// Integration tests live in `*.integration.test.ts` and run only when the
// slow CI job brings up a local Supabase stack (see `.github/workflows/ci.yml`
// + `scripts/ci-rollback-explain.sh`). Locally, `VITEST_INTEGRATION=1` opts
// in; the default unit run excludes them so `pnpm turbo run test:unit` stays
// fast and DB-free.
//
// Migration-paired tests (e.g. `src/migrations/015_for_update.test.ts`) live
// here in `packages/core` rather than alongside the SQL in `supabase/migrations/`
// because `supabase/` has no package.json and vitest's include globs are
// rooted at the config dir. The tests reference the SQL file by repo-relative
// path so they stay paired with the migration they cover.
export default defineConfig({
  test: {
    include: process.env.VITEST_INTEGRATION
      ? ['src/**/*.integration.test.ts']
      : ['src/**/*.test.ts'],
    exclude: process.env.VITEST_INTEGRATION
      ? ['node_modules', 'dist']
      : ['node_modules', 'dist', 'src/**/*.integration.test.ts'],
  },
});
