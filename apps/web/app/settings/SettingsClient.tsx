// What: Client-shell for /settings — wires HouseholdSection +
//       MembersSection + HouseholdAuditSection together so the
//       "invite someone" CTA can open the InviteLinkSheet via shared state.
// Why: Server component (page.tsx) does the auth + household resolution,
//      passes the resolved data into this client wrapper which owns the
//      ephemeral sheet open/close + invite-create state.
// Does NOT: Do auth (parent server component), fetch members itself
//           (MembersSection does), or render the Account section (still
//           in server page).

'use client';

import { useCallback, useMemo, useState } from 'react';
import { Divider } from '@lalista/ui';
import { createInvite, type CreatedInvite } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { HouseholdSection } from '@/components/HouseholdSection';
import { MembersSection } from '@/components/MembersSection';
import { HouseholdAuditSection } from '@/components/HouseholdAuditSection';
import { InviteLinkSheet } from '@/components/InviteLinkSheet';
import { MyStoresSection } from '@/components/MyStoresSection';

export interface SettingsClientProps {
  household: {
    id: string;
    name: string;
    createdAt: string;
    myRole: 'owner' | 'member';
  };
  currentUserId: string;
}

/**
 * Hosts the three new Settings sections + the InviteLinkSheet. The
 * "invite someone" CTA in MembersSection calls back into this component,
 * which mints the invite via the wrapper and opens the sheet.
 */
export function SettingsClient({
  household,
  currentUserId,
}: SettingsClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const viewerIsOwner = household.myRole === 'owner';
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInvite = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createInvite(supabase);
      setInvite(created);
    } catch {
      setError("Couldn't create invite. Try again.");
    } finally {
      setCreating(false);
    }
  }, [supabase, creating]);

  return (
    <>
      <Divider className="my-lg" />
      <HouseholdSection household={household} viewerIsOwner={viewerIsOwner} />
      <Divider className="my-lg" />
      <MembersSection
        currentUserId={currentUserId}
        viewerIsOwner={viewerIsOwner}
        onInviteCtaClick={() => void handleInvite()}
      />
      {error && <p className="font-body text-[13px] text-error">{error}</p>}
      <Divider className="my-lg" />
      <HouseholdAuditSection />
      <Divider className="my-lg" />
      <MyStoresSection householdId={household.id} />
      {invite && (
        <InviteLinkSheet
          url={invite.url}
          expiresAt={invite.expiresAt}
          onClose={() => setInvite(null)}
        />
      )}
    </>
  );
}
