// What: Supabase wrappers for the `profiles` table (display_name source)
// Why: UI needs a typed surface for reading + updating the current user's
//      display name; shared across Settings (edit), sign-up (seed), and any
//      future surface that exposes "your name"
// Does NOT: Handle household-member lookups or seed new profiles — that's the
//           `handle_new_user` trigger's job (see migration 012)

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase.types';
import type { Profile } from '../models';

type Client = SupabaseClient<Database>;

/**
 * Fetch the current user's profile. Returns null when unauthenticated, when
 * the profile row is missing, or when the `profiles` table itself is missing
 * (PGRST205 — e.g. migration 012 not yet applied in this environment). The
 * table-missing path is load-bearing: Settings calls this in a Server
 * Component, and front-end deploys can land before `supabase db push` runs in
 * prod (the rollout window explicitly called out in the spec's Post-merge
 * manual actions). Swallowing PGRST205 here means Settings renders with an
 * email-local-part fallback instead of a 500. All other errors (RLS denial,
 * network failure) still propagate.
 */
export async function fetchMyProfile(client: Client): Promise<Profile | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const { data, error } = await client
    .from('profiles')
    .select('user_id, display_name, created_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST205') return null;
    throw error;
  }
  return data;
}

/**
 * Update the current user's `display_name`. Trims whitespace, rejects empty
 * strings (callers should gate the submit-side too, but we guard here as
 * defense in depth). Returns the updated row.
 */
export async function updateMyProfile(
  client: Client,
  displayName: string
): Promise<Profile> {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new Error('display_name cannot be empty');
  }
  // Mirrors the CHECK(char_length <= 80) in migration 012. The DB will
  // reject an over-long value anyway, but failing fast here gives a
  // clearer error than a Postgres constraint-violation bubbling up.
  if (trimmed.length > 80) {
    throw new Error('display_name must be 80 characters or fewer');
  }

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('updateMyProfile requires an authenticated user');
  }

  const { data, error } = await client
    .from('profiles')
    .update({ display_name: trimmed })
    .eq('user_id', user.id)
    .select('user_id, display_name, created_at')
    .single();

  if (error) throw error;
  return data;
}
