// What: Browser-side Supabase client factory for Next.js App Router
// Why: Client components (sign-in form, onboarding form, providers) need a
//      singleton Supabase client that reads cookies via @supabase/ssr
// Does NOT: Run on the server — see server.ts for that; does not duplicate any
//           of the wrappers from @lalista/core/api

'use client';

import { createBrowserClient } from '@supabase/ssr';
import { assertNotProdUrlInTestEnv, type Database } from '@lalista/core';

/**
 * Build a browser Supabase client. Uses the `NEXT_PUBLIC_*` env vars that
 * Next.js exposes to the client bundle. @supabase/ssr manages cookies via
 * the browser's document.cookie under the hood when `cookies` is omitted.
 *
 * `assertNotProdUrlInTestEnv` no-ops in dev + prod; it only throws when a
 * vitest run would accidentally dial the production project (see
 * `packages/core/src/supabase.ts` for the guard's rationale).
 */
export function createClient() {
  // .trim() defends against whitespace-contaminated env vars on Vercel —
  // a trailing newline in NEXT_PUBLIC_SUPABASE_URL produced HTTP 500 on
  // SSR `/` (2026-04-26). See server.ts for the full incident note.
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  assertNotProdUrlInTestEnv(url);
  return createBrowserClient<Database>(url, anonKey);
}
