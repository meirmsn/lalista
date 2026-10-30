// What: Single-row presentation of a household member in Settings → Members.
// Why: Composes the @lalista/ui RoleBadge primitive (D20) with avatar +
//      name + remove button. Stays page-level (apps/web) per D20 — only
//      the role pill is design-system primitive.
// Does NOT: Run the remove RPC itself — `onRemove` is called by the parent
//           which owns the optimistic-mutation flow + cross-screen banner.

'use client';

import { RoleBadge, Text } from '@lalista/ui';
import type { Member } from '@lalista/core';

export interface MemberRowProps {
  member: Member;
  /** True when this member's id matches the signed-in user. */
  isCurrentUser: boolean;
  /** True for owner-mode rendering: shows the remove button on non-owner rows. */
  viewerIsOwner: boolean;
  /** Visual hint that the row is mid-removal (Tier A1 fade). */
  isRemoving?: boolean;
  /** Click-handler for the remove button. Parent runs the mutation. */
  onRemove?: (member: Member) => void;
}

/** Initial of the display_name (or '?' when name is unknown). */
function initialOf(name: string | null): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed[0]!.toUpperCase();
}

/**
 * Member row — 32px avatar circle + name + RoleBadge + optional remove button.
 * The remove button hides on the owner's own row (no self-remove; owner uses
 * leave_household instead — but owners can't leave in v0 either, so this is
 * a pure no-affordance row for them) and on non-owner viewers. `isCurrentUser`
 * appends the " (you)" suffix in a smaller secondary tone per Pass 5.
 */
export function MemberRow({
  member,
  isCurrentUser,
  viewerIsOwner,
  isRemoving = false,
  onRemove,
}: MemberRowProps) {
  const displayName = member.displayName ?? 'someone';
  const showRemoveButton =
    viewerIsOwner && !isCurrentUser && member.role !== 'owner';

  return (
    <div
      className={`flex items-center gap-sm py-xs ${isRemoving ? 'pointer-events-none opacity-50' : ''}`}
      data-testid="member-row"
    >
      <span
        aria-hidden="true"
        className="flex h-[32px] w-[32px] flex-none items-center justify-center rounded-full bg-primary-soft font-body text-[15px] font-semibold text-primary"
      >
        {initialOf(member.displayName)}
      </span>
      <Text as="span" variant="body" className="font-medium">
        {displayName}
      </Text>
      {isCurrentUser && (
        <Text as="span" variant="caption" className="text-text-tertiary">
          (you)
        </Text>
      )}
      <RoleBadge role={member.role} className="ml-auto" />
      {showRemoveButton && (
        <button
          type="button"
          onClick={() => onRemove?.(member)}
          aria-label={`Remove ${displayName}`}
          className="min-h-[44px] px-sm font-body text-[13px] text-text-tertiary hover:text-error"
          disabled={isRemoving}
        >
          remove
        </button>
      )}
    </div>
  );
}
