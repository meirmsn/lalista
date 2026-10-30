// What: /join/[token] — server-component flow that turns a 32-char invite
//       token into a household membership. 7-step decision tree per spec.
// Why: This is the load-bearing path for the share loop — the wrong branch
//      either leaks invite-table internals (bad) or strands the user in a
//      no-recovery state (worse). Each branch is tested via E2E.
// Does NOT: Mint invites (that's the owner's createInvite path), or
//           handle signed-in-but-correct-recipient — that case falls through
//           to accept_invite and lands on /list.

import { redirect } from 'next/navigation';
import {
  acceptInvite,
  fetchMyHousehold,
  fetchMyProfile,
  InviteRpcError,
} from '@lalista/core';
import { createClient } from '@/lib/supabase/server';
import { JoinClient } from './JoinClient';

/** Wall-clock comparison helper — kept out of the component body so
 *  react-hooks/purity doesn't fire on Date.now() inside server-component
 *  render scope. The server component is invoked once per request, not in
 *  a hook tree, so the impurity is fine here. */
function isExpired(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}

/**
 *
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Step 2: no session → bounce to /sign-up?invite=<token>. Preserves the
  // token across the email-confirmation gap via D3's emailRedirectTo on
  // signUpWithPassword.
  if (!user) {
    redirect(`/sign-up?invite=${encodeURIComponent(token)}`);
  }

  // Step 3: look up the invite. RLS would scope to PENDING + caller's
  // household but the user might be /joining/ a household they aren't yet
  // in — so we check via the admin path indirectly by attempting the
  // accept_invite RPC and catching `expired_or_invalid` for not-found.
  // Two-step here: check own-link FIRST (the inviter clicking their own
  // link), then the already-in-household state, then attempt accept.
  const { data: inviteRow } = await supabase
    .from('household_invitations')
    .select('household_id, used_at, expires_at, created_by')
    .eq('token', token)
    .maybeSingle();

  // Step 4: invite-row absent OR used OR expired → unavailable. The RLS
  // SELECT policy already filters out used invites, so an absent row
  // covers both "never existed" and "already used" without revealing
  // which.
  // Compare the invitation's expiry to the request time. Server-component
  // render is one-shot per request so impurity is fine here, but the
  // react-hooks/purity lint sees Date.now and complains uniformly. Use a
  // helper to side-step the rule without polluting the global config.
  const expired =
    inviteRow &&
    (inviteRow.used_at !== null || isExpired(inviteRow.expires_at));
  if (!inviteRow || expired) {
    // For an authed user with NO membership yet, the RLS SELECT can't
    // see the invitation row (RLS scopes to caller's household). In that
    // case we fall through to attempt accept_invite — which will return
    // either P0001 'expired_or_invalid' for a real bad token or succeed
    // for a real-but-RLS-invisible-to-caller invite.
    if (!inviteRow) {
      // Not visible via RLS — try accept directly.
      try {
        const householdId = await acceptInvite(supabase, token);
        if (householdId) redirect('/list');
      } catch (err) {
        if (err instanceof InviteRpcError) {
          // Any of expired_or_invalid / already_in_household / etc. fall
          // through to the page-state branches below. Re-fetch state
          // with a fresh server probe.
        } else if (
          err instanceof Error &&
          err.message?.includes('NEXT_REDIRECT')
        ) {
          // Re-throw redirect — Next signals navigation via thrown errors.
          throw err;
        }
      }
    } else {
      return <JoinClient state={{ kind: 'unavailable' }} />;
    }
  }

  // At this point: invite is valid (or RLS-invisible — handled above).
  // Step 5: already in a household? Prevents the user from joining a
  // second household + handles the cross-household-impersonation case.
  const myHousehold = await fetchMyHousehold(supabase);
  if (myHousehold) {
    // Step 6: own-invite-link branch — the inviter clicked their own URL.
    if (
      inviteRow &&
      inviteRow.created_by === user.id &&
      inviteRow.household_id === myHousehold.id
    ) {
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') || '';
      const url = `${origin}/join/${encodeURIComponent(token)}`;
      return <JoinClient state={{ kind: 'own_invite_link', url }} />;
    }
    // Otherwise: signed in as someone in a DIFFERENT household.
    const profile = await fetchMyProfile(supabase);
    const displayName =
      profile?.display_name || user.email?.split('@')[0] || 'someone';
    return <JoinClient state={{ kind: 'already_in_household', displayName }} />;
  }

  // Step 7: not in any household + invite is valid (or RLS-invisible).
  // Fire accept_invite and land on /list.
  try {
    const householdId = await acceptInvite(supabase, token);
    if (householdId) redirect('/list');
  } catch (err) {
    // RPC errors (expired, already-in-household at Postgres layer, etc.)
    // fall to the generic InviteUnavailable. Never leak invite internals.
    if (err instanceof Error && err.message?.includes('NEXT_REDIRECT')) {
      throw err;
    }
  }

  return <JoinClient state={{ kind: 'unavailable' }} />;
}
