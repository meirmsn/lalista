// What: Integration tests for migration 015 — invite/accept races, audit feed
//       hydration, RPC error mapping, name-length boundaries, and (optionally)
//       the email-confirm-gap mailpit URL-extraction case.
// Why: T1, T2a, T2b are CRITICAL race-correctness tests for accept_invite's
//      load-bearing FOR UPDATE row lock; cases 4-7 cover the remaining
//      coverage matrix from `.gstack/projects/.../node-feat-household-
//      collaborators-eng-review-test-plan-...md`. Only a real Postgres + RLS +
//      auth.users + concurrent transactions can verify these — unit-mocked
//      tests cannot exercise EvaluatePlanQual semantics.
// Does NOT: Run outside the CI slow-job (or local with `VITEST_INTEGRATION=1`
//      against `supabase-runner`). Skipped at file-load when SUPABASE_URL is
//      remote / not set, or when SERVICE_ROLE_KEY is missing.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const isLocalSupabase =
  SUPABASE_URL.startsWith('http://127.0.0.1:') ||
  SUPABASE_URL.startsWith('http://localhost:') ||
  // Option 3 compose isolation: workspace reaches local via host.docker.internal.
  SUPABASE_URL.startsWith('http://host.docker.internal:');
const shouldRun =
  Boolean(process.env.CI_SLOW_JOB || process.env.VITEST_INTEGRATION) &&
  isLocalSupabase &&
  Boolean(SUPABASE_ANON_KEY) &&
  Boolean(SUPABASE_SERVICE_ROLE_KEY);

type Client = SupabaseClient<Database>;

/** Build a service-role admin client for fixtures + admin user creation. */
function adminClient(): Client {
  return createSupabaseClient<Database>(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );
}

/** Sign up a fresh user, return an authenticated anon-key client + their id. */
async function signUpFresh(
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
  const userId = signUp.data.user!.id;
  // If confirmations are disabled (default local), session is live now.
  // Otherwise need a sign-in step — but the integration tests below don't
  // need confirmations on for the SQL-level cases. Mailpit case 8 owns the
  // confirmations flip.
  if (!signUp.data.session) {
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
  }
  return { client: anon, userId };
}

/**
 *
 */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

/**
 *
 */
async function createHouseholdWithOwner(
  client: Client,
  name: string
): Promise<string> {
  const { data, error } = await client.rpc('create_household_with_owner', {
    p_name: name,
  });
  if (error) throw error;
  if (!data) throw new Error('create_household_with_owner returned no id');
  return data;
}

/**
 * Create a fresh user, give them an owned household, return the auth'd
 * client + ids. Used as setup for every test below.
 */
async function provisionOwner(
  prefix: string
): Promise<{ client: Client; userId: string; householdId: string }> {
  const email = uniqueEmail(prefix);
  const { client, userId } = await signUpFresh(
    email,
    'Password123!',
    `${prefix} Owner`
  );
  const householdId = await createHouseholdWithOwner(client, `${prefix} Casa`);
  return { client, userId, householdId };
}

describe.skipIf(!shouldRun)(
  'migration 015 — household-collaborators integration',
  () => {
    const admin = shouldRun ? adminClient() : (null as never);
    const createdUsers: string[] = [];

    // Track every user so afterAll cleans them up — auth.users CASCADE drops
    // households + members + invitations + audit rows.
    /**
     *
     */
    function trackUser(id: string) {
      createdUsers.push(id);
    }

    afterAll(async () => {
      if (!shouldRun) return;
      for (const id of createdUsers) {
        try {
          await admin.auth.admin.deleteUser(id);
        } catch {
          // best-effort cleanup
        }
      }
    });

    beforeEach(() => {
      createdUsers.length = 0;
    });

    // ---------------------------------------------------------------
    // T1 CRITICAL — Concurrent accept_invite race
    // ---------------------------------------------------------------
    it('T1: concurrent accept_invite calls — exactly one wins, the other gets P0001 invite invalid or expired', async () => {
      const owner = await provisionOwner('t1-owner');
      trackUser(owner.userId);

      // Owner creates an invite.
      const { data: token, error: createErr } =
        await owner.client.rpc('create_invite');
      if (createErr) throw createErr;
      expect(typeof token).toBe('string');

      // Two distinct invitees race to accept the same token.
      const a = await signUpFresh(uniqueEmail('t1-a'), 'Password123!', 'T1 A');
      const b = await signUpFresh(uniqueEmail('t1-b'), 'Password123!', 'T1 B');
      trackUser(a.userId);
      trackUser(b.userId);

      // Promise.all (not allSettled) — each branch's error is what we assert
      // on, but Promise.all with reflective wrapping. We use allSettled so
      // BOTH outcomes can be inspected.
      const results = await Promise.allSettled([
        a.client.rpc('accept_invite', { p_token: token! }),
        b.client.rpc('accept_invite', { p_token: token! }),
      ]);

      // Each rpc resolves to {data, error}; we examine that shape.
      const winLossPairs = results.map((r) => {
        if (r.status === 'rejected') return { error: r.reason };
        return r.value;
      });
      const wins = winLossPairs.filter(
        (r) => 'data' in r && r.data && (!('error' in r) || !r.error)
      );
      const losses = winLossPairs.filter(
        (r) =>
          'error' in r &&
          r.error &&
          (r.error as { code?: string }).code === 'P0001'
      );
      expect(wins.length).toBe(1);
      expect(losses.length).toBe(1);
      const lossErr = (losses[0] as { error: { message: string } }).error;
      expect(lossErr.message).toMatch(/invite invalid or expired/i);
    });

    // ---------------------------------------------------------------
    // T2a CRITICAL — Token expiry boundary (just-inside)
    // ---------------------------------------------------------------
    it('T2a: invite that expires in 1 second is acceptable within the window', async () => {
      const owner = await provisionOwner('t2a-owner');
      trackUser(owner.userId);

      const { data: token } = await owner.client.rpc('create_invite');
      // Squeeze the expiry to 1s out via admin client (bypasses RLS).
      const { error: updErr } = await admin
        .from('household_invitations')
        .update({ expires_at: new Date(Date.now() + 1000).toISOString() })
        .eq('token', token!);
      if (updErr) throw updErr;

      const invitee = await signUpFresh(
        uniqueEmail('t2a-i'),
        'Password123!',
        'T2a I'
      );
      trackUser(invitee.userId);

      // Within the 1s window: accept should succeed.
      const { data: hid, error } = await invitee.client.rpc('accept_invite', {
        p_token: token!,
      });
      expect(error).toBeNull();
      expect(typeof hid).toBe('string');
    });

    // ---------------------------------------------------------------
    // T2b CRITICAL — Token expiry boundary (just-outside)
    // ---------------------------------------------------------------
    it('T2b: invite that expired 1 second ago returns P0001 invite invalid or expired', async () => {
      const owner = await provisionOwner('t2b-owner');
      trackUser(owner.userId);

      const { data: token } = await owner.client.rpc('create_invite');
      // Push expiry 1s into the past.
      const { error: updErr } = await admin
        .from('household_invitations')
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq('token', token!);
      if (updErr) throw updErr;

      const invitee = await signUpFresh(
        uniqueEmail('t2b-i'),
        'Password123!',
        'T2b I'
      );
      trackUser(invitee.userId);

      const { data: hid, error } = await invitee.client.rpc('accept_invite', {
        p_token: token!,
      });
      expect(hid).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe('P0001');
      expect(error!.message).toMatch(/invite invalid or expired/i);
    });

    // ---------------------------------------------------------------
    // Case 4 — 23505 from unique (user_id) constraint race
    // ---------------------------------------------------------------
    it('case 4: direct insert into household_members for a user already in a household raises 23505 with constraint name match', async () => {
      const owner = await provisionOwner('c4-owner');
      trackUser(owner.userId);
      // Provision a second owner with their own household, so we have a target
      // household that the c4-owner is NOT a member of. provisionOwner already
      // calls createHouseholdWithOwner; we just grab the household id off it.
      const other = await provisionOwner('c4-other');
      trackUser(other.userId);

      // Now try to insert a second membership row for the c4-owner via the
      // admin client (RLS bypassed). This simulates the racy two-tab path that
      // the unique constraint backstops.
      const { error } = await admin.from('household_members').insert({
        household_id: other.householdId,
        user_id: owner.userId,
        role: 'member',
      });
      expect(error).not.toBeNull();
      // pg unique-violation errcode is 23505. The constraint name lets API
      // wrappers map this to InviteError 'already_in_household' (D7).
      expect(error!.code).toBe('23505');
      expect(error!.message).toMatch(/household_members_one_per_user_v0/i);
    });

    // ---------------------------------------------------------------
    // Case 5 — rename_household name-length boundaries
    // ---------------------------------------------------------------
    it('case 5: rename_household — empty (after trim) → P0001; 60 chars → ok; 61 chars → P0001', async () => {
      const owner = await provisionOwner('c5-owner');
      trackUser(owner.userId);

      // 0 chars (whitespace-only)
      {
        const { error } = await owner.client.rpc('rename_household', {
          p_new_name: '   ',
        });
        expect(error).not.toBeNull();
        expect(error!.code).toBe('P0001');
        expect(error!.message).toMatch(/name must be 1-60 chars/i);
      }
      // 60 chars
      {
        const name = 'a'.repeat(60);
        const { error } = await owner.client.rpc('rename_household', {
          p_new_name: name,
        });
        expect(error).toBeNull();
      }
      // 61 chars
      {
        const name = 'a'.repeat(61);
        const { error } = await owner.client.rpc('rename_household', {
          p_new_name: name,
        });
        expect(error).not.toBeNull();
        expect(error!.code).toBe('P0001');
        expect(error!.message).toMatch(/name must be 1-60 chars/i);
      }
    });

    // ---------------------------------------------------------------
    // Case 7 — revoke_invite + accept_invite race
    // ---------------------------------------------------------------
    it('case 7: revoke vs accept race — one of {accept ok / revoke no-op} OR {accept P0001 / revoke ok}, never torn', async () => {
      const owner = await provisionOwner('c7-owner');
      trackUser(owner.userId);

      const { data: token } = await owner.client.rpc('create_invite');
      expect(typeof token).toBe('string');

      // Find the invite id for the revoke call.
      const { data: rows, error: selErr } = await owner.client
        .from('household_invitations')
        .select('id')
        .eq('token', token!)
        .single();
      if (selErr) throw selErr;
      const inviteId = rows!.id;

      const invitee = await signUpFresh(
        uniqueEmail('c7-i'),
        'Password123!',
        'C7 I'
      );
      trackUser(invitee.userId);

      // Race revoke vs accept. The FOR UPDATE row lock in accept_invite
      // serializes against the revoke's DELETE.
      const [acceptResult, revokeResult] = await Promise.allSettled([
        invitee.client.rpc('accept_invite', { p_token: token! }),
        owner.client.rpc('revoke_invite', { p_invite_id: inviteId }),
      ]);

      // Two valid outcomes:
      //   A: accept succeeded + revoke is a no-op-or-P0001 (already used)
      //   B: revoke succeeded + accept got P0001 (invalid or expired)
      const acceptValue =
        acceptResult.status === 'fulfilled' ? acceptResult.value : null;
      const revokeValue =
        revokeResult.status === 'fulfilled' ? revokeResult.value : null;

      const acceptOk = acceptValue && !acceptValue.error && acceptValue.data;
      const revokeOk = revokeValue && !revokeValue.error;

      if (acceptOk) {
        // Outcome A: revoke must have failed with P0001 (invite already used).
        expect(revokeValue!.error).not.toBeNull();
        expect(revokeValue!.error!.code).toBe('P0001');
      } else {
        // Outcome B: revoke must have succeeded; accept must have P0001'd.
        expect(revokeOk).toBe(true);
        expect(acceptValue!.error).not.toBeNull();
        expect(acceptValue!.error!.code).toBe('P0001');
      }

      // Either way, invariant: the membership table reflects the outcome.
      const { data: members } = await admin
        .from('household_members')
        .select('user_id')
        .eq('household_id', owner.householdId);
      if (acceptOk) {
        expect(members!.map((m) => m.user_id)).toContain(invitee.userId);
      } else {
        expect(members!.map((m) => m.user_id)).not.toContain(invitee.userId);
      }
    });

    // ---------------------------------------------------------------
    // Case 6 — Audit feed display-name hydration (lands in task 8 once audit.ts exists)
    // ---------------------------------------------------------------
    // Deferred: runs after `packages/core/src/api/audit.ts` lands in task 4.
    // The hydration assertion requires the wrapper to exist; SQL-level audit
    // rows are exercised implicitly by T1, T2a/b, case 7 (which insert into
    // household_audit_events).

    // ---------------------------------------------------------------
    // Case 8 — mailpit URL-extraction (D19/OV2)
    // ---------------------------------------------------------------
    // Deferred: requires `enable_confirmations = true` on the local stack.
    // The cmd-relay does not (yet) support flipping this, and the SQL-level
    // tests above don't need it. Slow-job CI runs with confirmations on per
    // ci.yml; local-dev devs can opt-in by editing supabase/config.toml +
    // restarting the auth service. Keeping case 8 documented here as a
    // marker so the test plan stays traceable.
  }
);
