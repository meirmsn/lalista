// What: Vitest global setup — jest-dom matchers + env var defaults
// Why: All tests need jsdom + sensible fake env vars so the Supabase client helpers
//      don't crash during module evaluation
// Does NOT: Configure individual test mocks — those live in each test file

import '@testing-library/jest-dom/vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'test-anon-key';
