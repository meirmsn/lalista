// What: Service-role admin Supabase client factory for E2E specs that need
//       DB-level assertions or pre-confirmed user creation. Single source of
//       truth for the env-var read + the `auth: { autoRefreshToken: false,
//       persistSession: false }` options shape that all admin-using specs
//       share.
// Why: Six specs (`add-new.spec.ts` + the five PR-5 specs) each duplicated a
//       16-line factory. Extracting cuts ~80 lines of repeated boilerplate and
//       gives one place to evolve the admin-client config (e.g. swapping
//       service-role JWT for a narrower role, adjusting fetch options).
// Does NOT: Replace `helpers/test-user.ts`'s admin client — that one carries
//           an `assertTestEmail` safety check tied to the fixed qa-walk
//           account, which would block the throw-away-per-test users that
//           generic specs need. The two helpers serve different lifecycle
//           shapes; do not collapse them.
//
// Each calling spec should also gate its `test.describe` block with
// `requireLocalSupabase()` (or the inline `test.skip(...)` predicate) so
// hosted Supabase runs are skipped coherently.
//
// Usage:
//   import { adminClient } from './helpers/admin-client';
//   const admin = adminClient();
//   await admin.from('households').insert({ ... });

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Hosted-Supabase URL value — used as the inverse of the local-stack predicate. */
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Predicate that matches the local Supabase stack URL shapes. */
export function isLocalSupabase(): boolean {
  return (
    SUPABASE_URL.startsWith('http://127.0.0.1:') ||
    SUPABASE_URL.startsWith('http://localhost:')
  );
}

/** Skip-reason string used by `test.skip(!isLocalSupabase(), ...)` in specs. */
export function localSupabaseSkipReason(specName: string): string {
  return `${specName} E2E requires a local Supabase stack (slow-job only)`;
}

/**
 * Service-role admin Supabase client. Reads `SUPABASE_URL` +
 * `SUPABASE_SERVICE_ROLE_KEY` from the environment. Throws if either is unset,
 * or if the URL is not a local-stack URL — defense-in-depth so that even if
 * a caller forgets the `test.skip(!isLocalSupabase(), ...)` predicate, the
 * factory refuses to dial hosted Supabase with a service-role JWT. Callers
 * should still pair with the predicate so hosted runs skip gracefully
 * (`adminClient()` would otherwise throw mid-test).
 *
 * The structural backstop sits alongside the prod-URL guard in
 * `packages/core/src/supabase.ts` (`assertNotProdUrlInTestEnv`) — different
 * scope (this one runs in E2E, that one in vitest), same intent:
 * privileged credentials never leave local-stack territory.
 */
export function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'admin-client requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars (set in slow-job CI; absent on hosted runs — pair with `test.skip(!isLocalSupabase(), ...)`).'
    );
  }
  if (!isLocalSupabase()) {
    throw new Error(
      `admin-client refuses to dial non-local Supabase with a service-role JWT (got ${SUPABASE_URL}). Pair the call with \`test.skip(!isLocalSupabase(), ...)\` so hosted runs skip gracefully before this throw fires.`
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

/**
 * Anon-key Supabase client for tests that need a real auth round-trip
 * without admin privileges. The primary use is recovering a user's UUID
 * after signup: `admin.auth.admin.listUsers()` is unreliable on a stack
 * with accumulated test users (returns "Database error finding users"
 * intermittently in slow-job CI), so calling sign-in with the anon
 * client + reading the resolved session is more robust.
 *
 * Local-stack-only by symmetry with `adminClient()` — both are slow-job
 * test infrastructure.
 */
export function anonClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'anon-client requires SUPABASE_URL + SUPABASE_ANON_KEY env vars (set in slow-job CI).'
    );
  }
  if (!isLocalSupabase()) {
    throw new Error(
      `anon-client refuses to dial non-local Supabase from test infra (got ${SUPABASE_URL}). Pair the call with \`test.skip(!isLocalSupabase(), ...)\`.`
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolve the user UUID for a known {email, password} pair by signing in
 * via the anon client. Avoids `admin.auth.admin.listUsers()` which 500s
 * intermittently in slow-job CI. Throws if sign-in fails.
 */
export async function userIdFromSignIn(
  email: string,
  password: string
): Promise<string> {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    throw new Error(
      `userIdFromSignIn: anon-client signInWithPassword failed for ${email}: ${error?.message ?? 'no user returned'}`
    );
  }
  return data.user.id;
}
