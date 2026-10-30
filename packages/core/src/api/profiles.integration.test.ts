// What: Integration tests for the profiles table — trigger + RLS + backfill
// Why: The `handle_new_user` trigger, own-row RLS, and household-member RLS
//      are SQL-level behavior that unit tests (mocked Supabase client) can't
//      verify. These run in the CI slow-job against a fresh `supabase start`
//      stack + seed.sql; locally they skip (no live DB in the devcontainer).
// Does NOT: Run in the fast CI job or locally by default. Opt-in via
//           `VITEST_INTEGRATION=1` AND a reachable Supabase URL.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import { fetchMyProfile, updateMyProfile } from './profiles';

// The CI slow-job sets SUPABASE_URL to http://127.0.0.1:54321 (the stock
// `supabase start` port) and provides the local anon + service-role keys.
// Running these against prod would be dangerous — the admin client deletes
// users during cleanup. So we only run when the URL is the localhost one.
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const isLocalSupabase =
  SUPABASE_URL.startsWith('http://127.0.0.1:') ||
  SUPABASE_URL.startsWith('http://localhost:') ||
  // Option 3 compose isolation: workspace reaches the local stack via
  // Docker Desktop's host.docker.internal. Hostname is Docker-only,
  // can never accidentally resolve to prod (.supabase.co).
  SUPABASE_URL.startsWith('http://host.docker.internal:');
const shouldRun =
  Boolean(process.env.CI_SLOW_JOB || process.env.VITEST_INTEGRATION) &&
  isLocalSupabase &&
  Boolean(SUPABASE_ANON_KEY) &&
  Boolean(SUPABASE_SERVICE_ROLE_KEY);

type Client = SupabaseClient<Database>;

/**
 * Build an authenticated client for the caller. `createUser` uses the
 * admin client to create a fresh auth.users row + provision a password,
 * then signs the caller in so the returned client carries the user's JWT.
 */
async function signInAs(
  email: string,
  password: string,
  displayName: string
): Promise<{ client: Client; userId: string }> {
  const anon = createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  const signUp = await anon.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (signUp.error) throw signUp.error;
  const userId = signUp.data.user?.id;
  if (!userId) throw new Error('signUp returned no user id');
  // Some projects gate session issuance on email confirmation; integration
  // test seed sets mailer_autoconfirm = true so we should have a session.
  if (!signUp.data.session) {
    // Fallback: explicit sign-in. Happens when confirm-email is on.
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
  }
  return { client: anon, userId };
}

/** Service-role client — used for test setup + cleanup. */
function adminClient(): Client {
  return createSupabaseClient<Database>(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );
}

/** Unique-per-run email to avoid collisions when seed already ran. */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

describe.skipIf(!shouldRun)('profiles integration', () => {
  const admin = shouldRun ? adminClient() : (null as never);
  // Track created user ids for teardown so each test starts fresh.
  const createdUsers: string[] = [];

  afterAll(async () => {
    if (!shouldRun) return;
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  beforeEach(() => {
    // Reset between tests so a failing setup doesn't cross-contaminate.
    createdUsers.length = 0;
  });

  it('creates a profiles row with display_name when signup includes it', async () => {
    const email = uniqueEmail('alice');
    const { client, userId } = await signInAs(email, 'Password123!', 'Alice');
    createdUsers.push(userId);

    // The trigger fires synchronously inside the signup transaction — no
    // polling needed.
    const profile = await fetchMyProfile(client);
    if (!profile) {
      throw new Error(
        'expected profile to exist post-signup; handle_new_user trigger did not fire'
      );
    }
    expect(profile.display_name).toBe('Alice');
    expect(profile.user_id).toBe(userId);
  });

  it('falls back to email local-part when signup omits display_name', async () => {
    const email = uniqueEmail('nameless');
    const local = email.split('@')[0];
    const anon = createSupabaseClient<Database>(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );
    const signUp = await anon.auth.signUp({ email, password: 'Password123!' });
    if (signUp.error) throw signUp.error;
    const userId = signUp.data.user!.id;
    createdUsers.push(userId);

    const profile = await fetchMyProfile(anon);
    if (!profile) {
      throw new Error(
        'expected profile to exist post-signup without display_name; trigger did not fire'
      );
    }
    expect(profile.display_name).toBe(local);
  });

  it('allows the owner to update their own display_name', async () => {
    const { client, userId } = await signInAs(
      uniqueEmail('updater'),
      'Password123!',
      'Before'
    );
    createdUsers.push(userId);

    const updated = await updateMyProfile(client, 'After');
    expect(updated.display_name).toBe('After');
  });

  it('forbids a user from updating another user’s profile (own-row RLS)', async () => {
    const a = await signInAs(uniqueEmail('rls-a'), 'Password123!', 'A');
    const b = await signInAs(uniqueEmail('rls-b'), 'Password123!', 'B');
    createdUsers.push(a.userId, b.userId);

    // A tries to update B's row using its own client/JWT — the RLS policy
    // should either return zero rows (silent no-op) or a policy error.
    const { data, error } = await a.client
      .from('profiles')
      .update({ display_name: 'HIJACK' })
      .eq('user_id', b.userId)
      .select('user_id, display_name');

    // Either the policy rejects (data=null, error present) OR it silently
    // matches zero rows. Both are acceptable — the key invariant is that
    // B's row is unchanged.
    if (error) {
      expect(error.message).toMatch(/row-level|rls|permission|policy/i);
    } else {
      expect(data).toEqual([]);
    }

    const bProfile = await b.client
      .from('profiles')
      .select('display_name')
      .eq('user_id', b.userId)
      .single();
    expect(bProfile.data?.display_name).toBe('B');
  });

  // Pins the migration-014 combined `profiles_select` policy: A and B in the
  // same household — A reads B's profile (combined policy's household-visibility
  // branch) but A cannot update B (profiles_update_own scopes to user_id =
  // auth.uid()). Pre-migration this was guarded by two separate permissive
  // SELECT policies (profiles_select_own + profiles_select_household);
  // post-migration it's one combined policy with the same OR'd visibility.
  // If a future "simplification" of the policy drops the household branch,
  // this test fails on the SELECT.
  it('two-user same-household: A reads B via combined policy; A cannot UPDATE B', async () => {
    const stamp = Date.now();
    const a = await signInAs(uniqueEmail('combo-a'), 'Password123!', 'Alice');
    const b = await signInAs(uniqueEmail('combo-b'), 'Password123!', 'Bob');
    createdUsers.push(a.userId, b.userId);

    // Set up shared household via admin (RLS-bypassing) to avoid
    // depending on the create_household_with_owner RPC for this test.
    // Pattern mirrors apps/web/e2e/force-create-race.spec.ts:24.
    const { data: hh, error: hhErr } = await admin
      .from('households')
      .insert({ name: `Combo ${stamp}` })
      .select('id')
      .single();
    expect(hhErr).toBeNull();
    const householdId = hh!.id;

    const { error: memErr } = await admin.from('household_members').insert([
      { household_id: householdId, user_id: a.userId, role: 'owner' },
      { household_id: householdId, user_id: b.userId, role: 'member' },
    ]);
    expect(memErr).toBeNull();

    // Assertion 1: A reads B's profile via the household-visibility branch
    // of the combined `profiles_select` policy.
    const { data: bSeenByA, error: selectErr } = await a.client
      .from('profiles')
      .select('user_id, display_name')
      .eq('user_id', b.userId)
      .single();
    expect(selectErr).toBeNull();
    expect(bSeenByA?.display_name).toBe('Bob');

    // Assertion 2: A cannot UPDATE B's profile — profiles_update_own scopes
    // updates to the caller's own row regardless of household membership.
    const { data: updateData, error: updateErr } = await a.client
      .from('profiles')
      .update({ display_name: 'HIJACK' })
      .eq('user_id', b.userId)
      .select('user_id, display_name');

    if (updateErr) {
      expect(updateErr.message).toMatch(/row-level|rls|permission|policy/i);
    } else {
      expect(updateData).toEqual([]);
    }

    // Load-bearing invariant: B's row is unchanged.
    const bAfter = await b.client
      .from('profiles')
      .select('display_name')
      .eq('user_id', b.userId)
      .single();
    expect(bAfter.data?.display_name).toBe('Bob');
  });
});
