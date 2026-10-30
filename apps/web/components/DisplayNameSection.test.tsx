// What: Behavior tests for DisplayNameSection — bridges Settings RSC to
//       DisplayNameField + handles the Supabase `updateMyProfile` call
// Why: The wrapper owns the error-toast lifecycle; regressions here would
//       leave users without visible feedback on a failed save
// Does NOT: Re-test debouncing — DisplayNameField.test.tsx owns that

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { updateMyProfileMock } = vi.hoisted(() => ({
  updateMyProfileMock: vi.fn(),
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return {
    ...actual,
    updateMyProfile: updateMyProfileMock,
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ __kind: 'browser-client' }),
}));

import { DisplayNameSection } from './DisplayNameSection';

describe('<DisplayNameSection>', () => {
  afterEach(() => {
    updateMyProfileMock.mockReset();
    vi.clearAllMocks();
  });

  it('renders the DisplayNameField prefilled with initialValue', () => {
    render(<DisplayNameSection initialValue="Meir" />);
    expect(screen.getByLabelText(/your name/i)).toHaveValue('Meir');
  });

  it('invokes updateMyProfile when the field debounces-then-blurs', async () => {
    updateMyProfileMock.mockResolvedValue({
      user_id: 'u1',
      display_name: 'Dad',
      created_at: '2026-04-23T00:00:00Z',
    });
    render(<DisplayNameSection initialValue="Meir" />);

    const input = screen.getByLabelText(/your name/i);
    fireEvent.change(input, { target: { value: 'Dad' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(updateMyProfileMock).toHaveBeenCalledWith(expect.anything(), 'Dad')
    );
    // No toast surfaced on success.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('surfaces a toast on save error + keeps the field interactive', async () => {
    updateMyProfileMock.mockRejectedValue(new Error('RLS denied'));
    render(<DisplayNameSection initialValue="Meir" />);

    const input = screen.getByLabelText(/your name/i);
    fireEvent.change(input, { target: { value: 'Dad' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/couldn't save/i)
    );
    // Field rolled back to previous value via DisplayNameField's
    // optimistic-rollback (confirmed by DisplayNameField.test.tsx).
    await waitFor(() =>
      expect(screen.getByLabelText(/your name/i)).toHaveValue('Meir')
    );
  });
});
