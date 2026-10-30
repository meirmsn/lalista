// What: Admin-API lifecycle for the QA-walk test user. Creates + idempotently
//       deletes one fixed test account used by the pre-ship walk against
//       hosted Supabase.
// Why: Hosted Supabase signup is rate-limited + email-domain-gated; admin API
//       bypasses both. A fixed email + cascade-aware cleanup means a crashed
//       walk never orphans test data long-term.
// Does NOT: Accept any email other than TEST_EMAIL (safety assertion in every
//           mutating call). Work when SUPABASE_SERVICE_ROLE_KEY is unset.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Fixed test account. `.invalid` is RFC 2606 reserved — guaranteed unroutable. */
export const TEST_EMAIL = 'preship-qa@lalista-test.invalid';
export const TEST_PASSWORD = 'preship-qa-password-1';

/**
 *
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} required but unset`);
  return v;
}

/**
 *
 */
function admin(): SupabaseClient {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 *
 */
function assertTestEmail(email: string) {
  if (email !== TEST_EMAIL) {
    throw new Error(
      `Refusing to operate on non-test email: got "${email}", only "${TEST_EMAIL}" allowed`
    );
  }
}

/**
 *
 */
async function findUserByEmail(email: string) {
  assertTestEmail(email);
  const client = admin();
  const perPage = 1000;
  let page = 1;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const match = data.users.find((u) => u.email === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

/**
 * Idempotently remove the test user + any households where they are the sole
 * member. Safe to call whether the user exists or not; safe to re-run after a
 * previous crashed walk.
 */
export async function deleteTestUser(
  email: string = TEST_EMAIL
): Promise<void> {
  assertTestEmail(email);
  const client = admin();
  const user = await findUserByEmail(email);
  if (!user) return;

  // Households have no FK to auth.users, so user deletion alone would orphan
  // them. Delete households where the test user is the sole member first —
  // that cascades to list_entries, purchase_history, etc.
  const { data: memberships } = await client
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id);
  for (const m of memberships ?? []) {
    const { count } = await client
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', m.household_id);
    if (count === 1) {
      await client.from('households').delete().eq('id', m.household_id);
    }
  }

  const { error } = await client.auth.admin.deleteUser(user.id);
  if (error && !/not.*found/i.test(error.message)) throw error;
}

/** Create the test user with email pre-confirmed so they can sign in immediately. */
export async function createTestUser(
  email: string = TEST_EMAIL,
  password: string = TEST_PASSWORD
): Promise<{ id: string; email: string }> {
  assertTestEmail(email);
  const client = admin();
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  if (!data.user?.email) throw new Error('admin.createUser returned no user');
  return { id: data.user.id, email: data.user.email };
}
