// What: Render-branch tests for HouseholdSection — owner edit field vs
//       member read-only + caption.
// Why: T14 (E2E in task 17) covers the live RPC path; this unit gate pins
//      the UI shape branches so future edits don't regress the visibility
//      of the "only owners can rename" caption.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HouseholdSection } from './HouseholdSection';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock('@lalista/core', async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    renameHousehold: vi.fn().mockResolvedValue(undefined),
  };
});

describe('HouseholdSection', () => {
  const household = {
    id: 'h1',
    name: 'Casa Bonita',
    createdAt: '2026-05-09T00:00:00Z',
  };

  it('owner view: renders the editable DisplayNameField (input visible)', () => {
    render(<HouseholdSection household={household} viewerIsOwner={true} />);
    // Spec D14: HouseholdSection labels its DisplayNameField "Household name"
    // (distinct from Account section's default "Your name").
    const input = screen.getByLabelText(/household name/i) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('Casa Bonita');
    // Member-only caption must NOT appear for owners.
    expect(screen.queryByText('only owners can rename.')).toBeNull();
  });

  it('member view: renders read-only name + "only owners can rename" caption', () => {
    render(<HouseholdSection household={household} viewerIsOwner={false} />);
    expect(screen.getByText('Casa Bonita')).toBeTruthy();
    expect(screen.getByText('only owners can rename.')).toBeTruthy();
    // No editable input in the member view.
    expect(screen.queryByLabelText(/Your name/i)).toBeNull();
  });

  it('always renders the created-on caption', () => {
    render(<HouseholdSection household={household} viewerIsOwner={true} />);
    expect(screen.getByText(/created on/i)).toBeTruthy();
  });
});
