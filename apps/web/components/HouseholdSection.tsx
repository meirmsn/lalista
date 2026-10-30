// What: Settings → Household section — editable name field for owners,
//       read-only summary + "only owners can rename." caption for members.
// Why: Owner-vs-member view mirrors D12 + Pass 5 — the input field uses
//      the existing DisplayNameField shape (debounced save + Tier A1
//      rollback) and a fresh `renameHousehold` save callback per save.
// Does NOT: Refetch the household after save — the saved name is returned
//           by the wrapper-resolved value; parent's next route mount picks
//           it up. Realtime on `households` is intentionally not subscribed.

'use client';

import { useMemo } from 'react';
import { Text } from '@lalista/ui';
import { renameHousehold, InviteRpcError } from '@lalista/core';
import { createClient } from '@/lib/supabase/client';
import { DisplayNameField } from './DisplayNameField';

export interface HouseholdSectionProps {
  household: { id: string; name: string; createdAt: string };
  viewerIsOwner: boolean;
}

/**
 * Settings → Household. Owner sees an editable input; member sees a
 * read-only `<Text variant="body">{name}</Text>` + "only owners can rename"
 * caption per Pass 4.
 */
export function HouseholdSection({
  household,
  viewerIsOwner,
}: HouseholdSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const createdLabel = new Date(household.createdAt).toLocaleDateString();

  return (
    <section
      aria-label="Household"
      className="flex flex-col gap-sm"
      id="household"
    >
      <Text
        as="h2"
        variant="caption"
        className="text-text-secondary uppercase tracking-[0.08em]"
      >
        Household
      </Text>

      {viewerIsOwner ? (
        <DisplayNameField
          // Two DisplayNameFields render in /settings (Account + Household).
          // Without distinct ids, both <label htmlFor="display-name">s point
          // to the SAME (first) input — Playwright `getByLabel` then can't
          // resolve the second input by label, AND Chromium's a11y tree
          // attributes both labels' text to the first input. CI ack:
          // household-rename + settings.spec.ts read-only flake (fix-loop 2).
          inputId="household-name"
          // Spec D14: HouseholdSection input label is "Household name", not
          // "Your name" (the Account-section default). Without this override,
          // both labels are identical and accessible-name selectors collide.
          label="Household name"
          initialValue={household.name}
          onSave={async (name) => {
            await renameHousehold(supabase, name);
            return name.trim();
          }}
          onError={(err) => {
            // Surface name-invalid friendly error if it happens. Toast/banner
            // belongs in a future polish pass — for now log to console so
            // dev sees it on the inline-feedback path.
            if (err instanceof InviteRpcError && err.kind === 'name_invalid') {
              console.warn('Household name must be 1-60 chars.');
            }
          }}
        />
      ) : (
        <>
          <Text variant="body">{household.name}</Text>
          <Text variant="caption" className="text-text-tertiary">
            only owners can rename.
          </Text>
        </>
      )}
      <Text variant="caption" className="text-text-tertiary">
        created on {createdLabel}.
      </Text>
    </section>
  );
}
