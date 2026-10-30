// What: Settings → Members section — members list (MemberRow per row),
//       pending invites subsection, "invite someone" CTA, leave-household
//       button (member-only). Owner-only "remove" affordance on rows.
// Why: Composes the wrapper layer (fetchMembers / fetchPendingInvites /
//      removeMember / leaveHousehold / revokeInvite + MemberRow + RoleBadge).
//      Surfaces both fresh data on mount and post-mutation refetch.
// Does NOT: Render the InviteLinkSheet itself — the parent (settings page)
//           opens the sheet from the CTA. Realtime updates are NOT subscribed
//           (page-load freshness is the v0 contract).

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Divider, SubmitButton, Text } from '@lalista/ui';
import {
  fetchMembers,
  fetchPendingInvites,
  removeMember,
  leaveHousehold,
  revokeInvite,
  type Invite,
  type Member,
} from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { MemberRow } from './MemberRow';

export interface MembersSectionProps {
  currentUserId: string;
  viewerIsOwner: boolean;
  /** Called when the owner taps "invite someone". Parent owns the sheet. */
  onInviteCtaClick: () => void;
}

/**
 * Settings → Members. Loads members + pending invites in parallel, hands
 * mutations to the API wrappers, refetches after each successful write.
 */
export function MembersSection({
  currentUserId,
  viewerIsOwner,
  onInviteCtaClick,
}: MembersSectionProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [m, inv] = await Promise.all([
        fetchMembers(supabase),
        viewerIsOwner ? fetchPendingInvites(supabase) : Promise.resolve([]),
      ]);
      setMembers(m);
      setInvites(inv);
    } catch {
      setError("Couldn't load members. Try again.");
    } finally {
      setLoaded(true);
    }
  }, [supabase, viewerIsOwner]);

  // queueMicrotask defer mirrors ListClient's pattern — keeps React 19's
  // `react-hooks/set-state-in-effect` happy without restructuring the
  // data flow. Same behavior, one tick later.
  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const handleRemove = useCallback(
    async (member: Member) => {
      setRemovingId(member.userId);
      try {
        await removeMember(supabase, member.userId);
        await refresh();
      } catch {
        setError(
          `Couldn't remove ${member.displayName ?? 'member'} — try again.`
        );
      } finally {
        setRemovingId(null);
      }
    },
    [supabase, refresh]
  );

  const handleRevoke = useCallback(
    async (invite: Invite) => {
      setRevokingId(invite.id);
      try {
        await revokeInvite(supabase, invite.id);
        await refresh();
      } catch {
        setError("Couldn't revoke invite — try again.");
      } finally {
        setRevokingId(null);
      }
    },
    [supabase, refresh]
  );

  const handleLeave = useCallback(async () => {
    setLeaving(true);
    setError(null);
    try {
      await leaveHousehold(supabase);
      router.push('/onboarding');
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Couldn't leave — try again.";
      setError(message);
      setLeaving(false);
    }
  }, [supabase, router]);

  const isEmpty = members.length <= 1 && invites.length === 0;

  return (
    <section aria-label="Members" className="flex flex-col gap-sm">
      <Text
        as="h2"
        variant="caption"
        className="text-text-secondary uppercase tracking-[0.08em]"
      >
        Members
      </Text>

      {!loaded ? (
        <div
          aria-hidden="true"
          data-testid="members-skeleton"
          className="flex flex-col gap-xs"
        >
          <div className="h-[40px] animate-pulse rounded-default bg-surface-2" />
          <div className="h-[40px] animate-pulse rounded-default bg-surface-2 opacity-60" />
        </div>
      ) : (
        <div className="flex flex-col gap-xs">
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              isCurrentUser={m.userId === currentUserId}
              viewerIsOwner={viewerIsOwner}
              isRemoving={removingId === m.userId}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {loaded && viewerIsOwner && invites.length > 0 && (
        <>
          <Divider />
          {/* h3 (not span) so iOS Safari doesn't apply any inline-context
              quirks; pl-2xs gives a small left inset so a stray marker /
              focus artifact never visually overlaps the P. */}
          <Text
            as="h3"
            variant="caption"
            className="pl-2xs text-text-secondary uppercase tracking-[0.08em]"
          >
            Pending invites
          </Text>
          <div className="flex flex-col gap-xs">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className={`flex items-center gap-sm py-xs ${revokingId === invite.id ? 'pointer-events-none opacity-50' : ''}`}
                data-testid="pending-invite-row"
              >
                <Text
                  as="span"
                  variant="caption"
                  className="text-text-secondary"
                >
                  expires {new Date(invite.expiresAt).toLocaleDateString()}
                </Text>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(invite.url);
                  }}
                  className="ml-auto font-body text-[15px] text-primary hover:text-primary-pressed underline-offset-4 hover:underline"
                >
                  copy
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevoke(invite)}
                  className="font-body text-[15px] text-primary hover:text-primary-pressed underline-offset-4 hover:underline"
                >
                  revoke
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {loaded && viewerIsOwner && isEmpty && (
        <div className="flex flex-col items-start gap-xs pl-2xs pt-md pb-sm">
          {/* leading-[1.5] + pb gives the italic Fraunces `j` room for its
              descender curl and visually re-attaches the floating tittle to
              the body at this size+weight. Don't tighten without re-testing
              on iOS Safari (where the descender clips first). */}
          <Text
            as="p"
            variant="display-italic"
            className="leading-[1.5] pb-2xs"
          >
            just you so far
          </Text>
          <Text variant="body">send a link.</Text>
          <Text variant="caption" className="text-text-secondary">
            they&apos;ll join in seconds.
          </Text>
        </div>
      )}

      {viewerIsOwner && (
        <button
          type="button"
          onClick={onInviteCtaClick}
          className="mt-xs min-h-[44px] self-start rounded-[100px] bg-primary px-md py-sm font-body text-[15px] font-medium text-white hover:bg-primary-pressed"
        >
          invite someone
        </button>
      )}

      {!viewerIsOwner && (
        <SubmitButton
          type="button"
          onClick={() => void handleLeave()}
          isPending={leaving}
          pendingLabel="Leaving…"
          className="mt-md self-start bg-error hover:bg-error/80"
        >
          Leave household
        </SubmitButton>
      )}

      {error && (
        <Text variant="caption" className="text-error">
          {error}
        </Text>
      )}
    </section>
  );
}
