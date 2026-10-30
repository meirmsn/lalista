// What: Supabase auth primitives wrapped for the lalista UI
// Why: Framework-agnostic surface so web + future native can share the same calls
// Does NOT: Persist sessions itself (Supabase handles that) or manage household state

import type {
  AuthChangeEvent,
  AuthResponse,
  Session,
  Subscription,
  SupabaseClient,
  User,
} from '@supabase/supabase-js';
import type { Database } from '../supabase.types';

type Client = SupabaseClient<Database>;

/**
 * Resolve the site origin for `emailRedirectTo`. Prefers
 * `NEXT_PUBLIC_SITE_URL` when set (canonical-URL pin); falls back to
 * `window.location.origin` so any environment self-routes correctly without
 * configuration. Trailing slashes stripped to avoid `//auth/callback`.
 */
function resolveAuthSiteOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

/** Sign in with email + password. Returns the session on success. */
export async function signInWithPassword(
  client: Client,
  email: string,
  password: string
): Promise<AuthResponse> {
  return client.auth.signInWithPassword({ email, password });
}

/**
 * Create an account with email + password. Optional `displayName` is threaded
 * into `options.data.display_name`, where the `handle_new_user` trigger
 * (migration 012) picks it up to seed the user's `profiles.display_name`.
 * When omitted, the trigger falls back to the email local-part.
 *
 * Optional `inviteToken` (5th positional arg, NOT options-bag — preserves
 * binary compatibility with existing 3- and 4-arg callers). When set:
 * - `options.emailRedirectTo` becomes
 *   `${NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback?invite=<token>`,
 *   so the confirmation email's link carries the token through to the
 *   server-side callback (D3 token transport). Encoded with
 *   encodeURIComponent so unusual tokens can't break URL parsing.
 * - When `displayName` is also set, both keys merge into a single
 *   `options` object (`{ data: { display_name }, emailRedirectTo }`).
 *
 * Auto-confirms per Supabase project settings.
 */
export async function signUpWithPassword(
  client: Client,
  email: string,
  password: string,
  displayName?: string,
  inviteToken?: string
): Promise<AuthResponse> {
  const trimmedName = displayName?.trim();
  const hasName = Boolean(trimmedName);
  const hasInvite = Boolean(inviteToken);

  if (!hasName && !hasInvite) {
    return client.auth.signUp({ email, password });
  }

  // Deliberately omit `options.data` when no displayName is provided —
  // passing `{ display_name: undefined }` would cause the trigger's coalesce
  // to see an explicit `null` key instead of no key, which short-circuits
  // the email-local-part fallback (gotcha preserved from pre-invite behavior).
  const options: {
    data?: { display_name: string };
    emailRedirectTo?: string;
  } = {};
  if (hasName) options.data = { display_name: trimmedName! };
  if (hasInvite) {
    const origin = resolveAuthSiteOrigin();
    options.emailRedirectTo = `${origin}/auth/callback?invite=${encodeURIComponent(inviteToken!)}`;
  }
  return client.auth.signUp({ email, password, options });
}

/** Sign out the current user. Clears local session. */
export async function signOut(client: Client): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

/** Get the current session (or null if signed out). */
export async function getSession(client: Client): Promise<Session | null> {
  const { data } = await client.auth.getSession();
  return data.session;
}

/** Get the current user (or null if signed out). */
export async function getUser(client: Client): Promise<User | null> {
  const { data } = await client.auth.getUser();
  return data.user;
}

/**
 * Subscribe to auth state changes. Returns the Subscription — caller should
 * call `subscription.unsubscribe()` on cleanup.
 */
export function onAuthStateChange(
  client: Client,
  callback: (event: AuthChangeEvent, session: Session | null) => void
): Subscription {
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange(callback);
  return subscription;
}
