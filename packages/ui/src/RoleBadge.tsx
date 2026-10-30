// What: Compact OWNER / MEMBER role pill rendered inline next to a member's
//       name in MembersSection (or anywhere else the design system needs to
//       distinguish role).
// Why: D20 lifts this primitive to @lalista/ui because the same shape recurs
//      across the household feature and is design-token-clean. Keeping it in
//      the design system means a v1 "moderator" or "guest" role drops a new
//      variant in one place rather than per-feature copies.
// Does NOT: Render an avatar, ship interactivity, or care about i18n —
//           caption-cap "OWNER" / "MEMBER" is the entire surface.

import type { HTMLAttributes } from 'react';

export interface RoleBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  role: 'owner' | 'member';
}

/**
 * Caption-cap role pill — uppercase letterspacing, soft surface background,
 * 13px font-body. Text color uses --color-text-secondary by default;
 * design hierarchy lets the pill recede next to the member's name.
 */
export function RoleBadge({ role, className = '', ...rest }: RoleBadgeProps) {
  const label = role === 'owner' ? 'OWNER' : 'MEMBER';
  return (
    <span
      role="status"
      aria-label={`Role: ${label}`}
      className={`inline-flex items-center rounded-default bg-surface-2 px-xs py-[2px] font-body text-[13px] font-semibold uppercase tracking-[0.08em] text-text-secondary ${className}`}
      {...rest}
    >
      {label}
    </span>
  );
}
