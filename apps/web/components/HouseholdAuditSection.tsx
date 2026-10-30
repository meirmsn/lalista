// What: Settings → Activity collapsible audit feed.
// Why: Surfaces the household_audit_events stream — the v0 state-change
//      observability surface (no PostHog events; per spec § Metrics).
//      Page-load only (Realtime on this table is intentionally NOT
//      subscribed — out of scope per spec).
// Does NOT: Render the raw event_type strings — formats each event into a
//           human sentence per Pass 4 voice doctrine.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Text } from '@lalista/ui';
import { fetchHouseholdAudit, type AuditEvent } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';

const AUDIT_LIMIT = 20;

/**
 * Format a single audit event into a human sentence per Pass 4 voice. Falls
 * back to 'someone' when the actor or target name resolves to null.
 */
function describe(event: AuditEvent): string {
  const actor = event.actorName ?? 'someone';
  const target = event.targetName ?? 'someone';
  switch (event.eventType) {
    case 'invite_created':
      return `${actor} created an invite link.`;
    case 'invite_revoked':
      return `${actor} revoked an invite.`;
    case 'invite_used':
      return `${target} joined via invite.`;
    case 'member_removed':
      return `${actor} removed ${target}.`;
    case 'member_left':
      return `${actor} left.`;
    case 'household_renamed':
      return `${actor} renamed the household${event.newName ? ` to ${event.newName}` : ''}.`;
    default:
      return `something happened.`;
  }
}

/**
 * Relative-time label for the right column. Caption-cap, tabular-nums for
 * even alignment per Pass 5.
 */
function relativeTime(iso: string): string {
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Collapsible (`<details>`) feed of the last 20 audit events. Default
 * collapsed per Pass 1 Subtraction.
 */
export function HouseholdAuditSection() {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchHouseholdAudit(supabase, AUDIT_LIMIT)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load activity.");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <section aria-label="Activity" className="flex flex-col gap-sm">
      <details className="group flex flex-col gap-sm">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-sm py-xs">
          <span
            aria-hidden="true"
            className="inline-block font-body text-[14px] leading-none text-text-secondary transition-transform duration-200 group-open:rotate-90"
          >
            ▶
          </span>
          <Text
            as="span"
            variant="caption"
            className="text-text-secondary uppercase tracking-[0.08em]"
          >
            Activity
            {events && events.length > 0 && (
              <span className="ml-xs text-text-tertiary normal-case tracking-normal">
                ({events.length} event{events.length === 1 ? '' : 's'})
              </span>
            )}
          </Text>
        </summary>
        {error && (
          <Text variant="caption" className="text-error">
            {error}
          </Text>
        )}
        {events && events.length === 0 && !error && (
          <Text variant="caption" className="text-text-tertiary italic">
            no activity yet.
          </Text>
        )}
        {events && events.length > 0 && (
          <ul className="flex flex-col gap-xs mt-md">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-baseline justify-between gap-sm"
              >
                <Text variant="body">{describe(event)}</Text>
                <Text
                  as="span"
                  variant="caption"
                  className="text-text-tertiary tabular-nums"
                >
                  {relativeTime(event.createdAt)}
                </Text>
              </li>
            ))}
          </ul>
        )}
        {events && events.length === AUDIT_LIMIT && (
          <Text variant="caption" className="text-text-tertiary mt-xs">
            showing last {AUDIT_LIMIT}.
          </Text>
        )}
      </details>
    </section>
  );
}
