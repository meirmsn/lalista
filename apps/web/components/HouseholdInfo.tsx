// What: Read-only household summary block for Settings
// Why: v0 shows the household name + a "manage members coming soon" teaser;
//      keeps the section stable while invites are deferred
// Does NOT: Allow renaming the household or managing members

import { Text } from '@lalista/ui';

export interface HouseholdInfoProps {
  householdName: string;
}

/** Compact household summary: name + muted "coming soon" row. */
export function HouseholdInfo({ householdName }: HouseholdInfoProps) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center justify-between">
        <Text as="span" variant="caption" className="text-text-secondary">
          Name
        </Text>
        <Text as="span" variant="body">
          {householdName}
        </Text>
      </div>
      <div
        aria-disabled="true"
        className="flex items-center justify-between opacity-60"
      >
        <Text as="span" variant="caption" className="text-text-tertiary">
          Members
        </Text>
        <Text as="span" variant="body" className="text-text-tertiary">
          Manage members — coming soon
        </Text>
      </div>
    </div>
  );
}
