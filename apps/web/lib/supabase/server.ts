// What: Server-side Supabase client factory for React Server Components + route handlers
// Why: Onboarding page (server component) needs a client that reads the session
//      cookie so RLS-protected queries work inside the render tree
// Does NOT: Run inside middleware — middleware.ts builds its own client with a
//           request-cookies adapter because NextResponse needs direct cookie
//           propagation that the Next cookies() API can't do

import { createServerClient } from '@supabase/ssr';
import { assertNotProdUrlInTestEnv, type Database } from '@lalista/core';
import { cookies } from 'next/headers';

/**
 * Build a Supabase client for a server component / route handler. Each
 * request must build a fresh client per @supabase/ssr docs.
 *
 * The `setAll` handler is a no-op with a swallowed `try/catch` because server
 * components cannot mutate response cookies — middleware handles the refresh.
 * This matches the official Next App Router + @supabase/ssr pattern.
 *
 * `assertNotProdUrlInTestEnv` no-ops in dev + prod; it only throws when a
 * vitest run would accidentally dial the production project.
 */
export async function createClient() {
  // .trim() defends against whitespace-contaminated env vars on Vercel.
  // A trailing newline in NEXT_PUBLIC_SUPABASE_URL produced HTTP 500 on
  // production `/` (2026-04-26): SSR getUser() fetched the malformed URL
  // ("https://....supabase.co\n") and threw uncaught. The CSP header
  // showed the same `%0A` URL-encoded newline. Symmetric trim at every
  // read site makes future env-var fat-fingers benign at runtime. Same
  // pattern applied in client.ts, middleware.ts, and next.config.ts.
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  assertNotProdUrlInTestEnv(url);
  const cookieStore = await cookies();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — cookie refresh will happen on
          // the next middleware pass. Safe to ignore.
        }
      },
    },
  });
}
