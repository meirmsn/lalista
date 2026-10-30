// What: Integration tests for the fetchListEntries profiles hydration
// Why: Verify the `fetchDisplayNamesByUserId` two-query path resolves
//      `addedByName` when the author is household-visible, and falls back
//      to null when they aren't (cross-household RLS). Unit test mocks this
//      layer — only a real Postgres + RLS policies can verify the boundary
// Does NOT: Run outside the CI slow-job

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import { fetchListEntries, fetchListEntryById } from './items';

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
 *
 */
function adminClient(): Client {
  return createSupabaseClient<Database>(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 *
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
  const userId = signUp.data.user!.id;
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

describe.skipIf(!shouldRun)('items addedByName hydration (integration)', () => {
  const admin = shouldRun ? adminClient() : (null as never);
  const createdUsers: string[] = [];

  afterAll(async () => {
    if (!shouldRun) return;
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  beforeEach(() => {
    createdUsers.length = 0;
  });

  it('hydrates addedByName with profiles.display_name for a household-visible author', async () => {
    const alice = await signInAs(uniqueEmail('alice'), 'Password123!', 'Alice');
    createdUsers.push(alice.userId);

    const householdId = await createHouseholdWithOwner(alice.client, 'Casa A');

    // Insert a list_entry using Alice's JWT so added_by = alice.userId.
    // Need a valid item_id + store_id — seed.sql provides both.
    const { data: item } = await alice.client
      .from('items')
      .select('id')
      .eq('name_canonical', 'Leche entera')
      .single();
    const { data: store } = await alice.client
      .from('stores')
      .select('id')
      .eq('name', 'Whole Foods')
      .single();
    if (!item || !store) throw new Error('seed.sql items/stores missing');

    const { error: insertErr } = await alice.client
      .from('list_entries')
      .insert({
        household_id: householdId,
        item_id: item.id,
        store_id: store.id,
        status: 'pending',
        added_by: alice.userId,
      });
    if (insertErr) throw insertErr;

    const { entries } = await fetchListEntries(alice.client, householdId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.addedBy).toBe(alice.userId);
    expect(entries[0]?.addedByName).toBe('Alice');
  });

  it('returns addedByName: null when added_by is null (migration-009 SET NULL)', async () => {
    // migration 009 made list_entries.added_by nullable via ON DELETE SET
    // NULL; when the author row is cleared, fetchListEntries still returns
    // the entry but with addedByName: null so the UI renders "someone".
    // We admin-insert a list_entry with added_by: null directly (simulates
    // the post-deletion state without juggling signed-in user lifecycles).
    const bob = await signInAs(uniqueEmail('bob'), 'Password123!', 'Bob');
    createdUsers.push(bob.userId);
    const householdId = await createHouseholdWithOwner(bob.client, 'Casa B');

    const { data: item } = await bob.client
      .from('items')
      .select('id')
      .eq('name_canonical', 'Leche entera')
      .single();
    const { data: store } = await bob.client
      .from('stores')
      .select('id')
      .eq('name', 'Whole Foods')
      .single();
    if (!item || !store) throw new Error('seed.sql items/stores missing');

    // Admin client bypasses RLS; inserts a list_entry with added_by: null
    // (RLS on list_entries would still require household membership for an
    // anon insert, and clients never write added_by: null — this is the
    // post-ON-DELETE-SET-NULL shape).
    const { error: insertErr } = await admin.from('list_entries').insert({
      household_id: householdId,
      item_id: item.id,
      store_id: store.id,
      status: 'pending',
      added_by: null,
    });
    if (insertErr) throw insertErr;

    const { entries } = await fetchListEntries(bob.client, householdId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.addedBy).toBeNull();
    expect(entries[0]?.addedByName).toBeNull();

    // fetchListEntryById: same null-author path, also returns null addedByName
    // (no crash, no 500).
    const byId = await fetchListEntryById(bob.client, entries[0]!.id);
    expect(byId).not.toBeNull();
    expect(byId?.addedBy).toBeNull();
    expect(byId?.addedByName).toBeNull();
  });

  it('returns addedByName: null when the author is outside the caller RLS scope', async () => {
    // The profiles_select_household RLS policy only admits a profile row if
    // the caller and the profile owner share at least one household. If
    // list_entries.added_by points to a user the caller has no household
    // overlap with, fetchDisplayNamesByUserId returns an empty row set and
    // the caller sees addedByName: null — NOT a policy error, NOT a crash.
    //
    // Setup: Alice in Casa A, Bob in Casa B. Admin-client inserts a
    // list_entry in Casa B with added_by = alice.userId (Alice isn't a
    // member of Casa B, so Bob can't read Alice's profile row). Bob reads
    // the list; addedByName should be null.
    const alice = await signInAs(uniqueEmail('alice'), 'Password123!', 'Alice');
    const bob = await signInAs(uniqueEmail('bob'), 'Password123!', 'Bob');
    createdUsers.push(alice.userId, bob.userId);

    // Alice owns Casa A (irrelevant to Bob's query, but gives Alice a
    // real auth.users row + a profile row via the handle_new_user trigger).
    await createHouseholdWithOwner(alice.client, 'Casa A');
    const casaB = await createHouseholdWithOwner(bob.client, 'Casa B');

    const { data: item } = await bob.client
      .from('items')
      .select('id')
      .eq('name_canonical', 'Leche entera')
      .single();
    const { data: store } = await bob.client
      .from('stores')
      .select('id')
      .eq('name', 'Whole Foods')
      .single();
    if (!item || !store) throw new Error('seed.sql items/stores missing');

    // Admin-client inserts: FK requires added_by to be a real auth.users id,
    // so we point at Alice. RLS on list_entries would block Bob from seeing
    // a row he couldn't otherwise reach, but because the row is in Casa B
    // (Bob's household) he CAN read it — the hydration is the boundary test.
    const { error: insertErr } = await admin.from('list_entries').insert({
      household_id: casaB,
      item_id: item.id,
      store_id: store.id,
      status: 'pending',
      added_by: alice.userId,
    });
    if (insertErr) throw insertErr;

    const { entries } = await fetchListEntries(bob.client, casaB);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.addedBy).toBe(alice.userId);
    // The RLS boundary: Alice's profile row exists but Bob's JWT can't see
    // it (no shared household), so the hydration map is empty for Alice's
    // user_id and addedByName falls back to null.
    expect(entries[0]?.addedByName).toBeNull();

    // Sanity check the other direction: Alice CAN read her own profile, so
    // if SHE read this entry via fetchListEntryById with her JWT, the
    // hydration would resolve (confirms the boundary is caller-scoped, not
    // global). Alice isn't a member of Casa B though, so fetchListEntryById
    // can still find the entry by id (list_entries RLS only gates by
    // household_id for SELECT? — double-check)...
    // Rather than relying on that edge, we keep this test focused on the
    // Bob-can't-see-Alice's-name boundary that matters to the product.
  });
});
