// What: Tests for the onboarding server component (redirect gate) + client form
// Why: The household-gate decides whether a signed-in user sees /onboarding or the
//      list view. Wrong redirect = users get stuck. Form bugs block new-user setup.
// Does NOT: Render full Next routing — we exercise the server component's body
//           directly and assert on the redirect call + the form's behavior

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  pushMock,
  redirectMock,
  fetchUserHouseholdsMock,
  createHouseholdMock,
  getUserMock,
  getAuthUserMock,
  serverCreateClientMock,
  updateMyProfileMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  fetchUserHouseholdsMock: vi.fn(),
  createHouseholdMock: vi.fn(),
  getUserMock: vi.fn(),
  getAuthUserMock: vi.fn(),
  serverCreateClientMock: vi.fn(),
  updateMyProfileMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  redirect: redirectMock,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ __kind: 'browser-client' }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: serverCreateClientMock,
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return {
    ...actual,
    fetchUserHouseholds: fetchUserHouseholdsMock,
    createHousehold: createHouseholdMock,
    getUser: getUserMock,
    updateMyProfile: updateMyProfileMock,
  };
});

import OnboardingPage from './page';
import { OnboardingForm } from './OnboardingForm';

describe('<OnboardingPage> (server component)', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
    fetchUserHouseholdsMock.mockReset();
    getAuthUserMock.mockReset();
    serverCreateClientMock.mockReset();
    serverCreateClientMock.mockResolvedValue({
      auth: { getUser: getAuthUserMock },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /list when the user already belongs to a household', async () => {
    // Post-D7 (specs/core-flows/spec.md): authed-with-household target is /list.
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchUserHouseholdsMock.mockResolvedValue([{ id: 'h1', name: 'Existing' }]);

    await expect(
      OnboardingPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('NEXT_REDIRECT:/list');
    expect(redirectMock).toHaveBeenCalledWith('/list');
  });

  it('redirects to /sign-in when the session is missing (defense in depth)', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: null } });

    await expect(
      OnboardingPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(redirectMock).toHaveBeenCalledWith('/sign-in');
    expect(fetchUserHouseholdsMock).not.toHaveBeenCalled();
  });

  it('renders the form when the user has zero households', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchUserHouseholdsMock.mockResolvedValue([]);

    const element = await OnboardingPage({
      searchParams: Promise.resolve({}),
    });
    expect(redirectMock).not.toHaveBeenCalled();
    render(element);
    expect(
      screen.getByRole('heading', { name: /set up your household/i })
    ).toBeInTheDocument();
  });

  // household-collaborators (D15/OV1): when ?removed=1 is in the URL, render
  // the RemovedFromHouseholdNotice card above the existing OnboardingForm.
  it('?removed=1 renders RemovedFromHouseholdNotice above the form', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchUserHouseholdsMock.mockResolvedValue([]);

    const element = await OnboardingPage({
      searchParams: Promise.resolve({ removed: '1' }),
    });
    render(element);
    expect(
      screen.getByLabelText(/Removed from household/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /set up your household/i })
    ).toBeInTheDocument();
  });

  it('omits the RemovedFromHouseholdNotice when ?removed is absent (existing flow preserved)', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchUserHouseholdsMock.mockResolvedValue([]);

    const element = await OnboardingPage({
      searchParams: Promise.resolve({}),
    });
    render(element);
    expect(
      screen.queryByLabelText(/Removed from household/i)
    ).not.toBeInTheDocument();
  });
});

describe('<OnboardingForm>', () => {
  beforeEach(() => {
    pushMock.mockReset();
    createHouseholdMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ id: 'u1' });
    updateMyProfileMock.mockReset();
    updateMyProfileMock.mockResolvedValue({
      user_id: 'u1',
      display_name: 'Meir',
      created_at: '',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the new "Your name" field with helper copy from spec D7', () => {
    render(<OnboardingForm />);
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(
      screen.getByText(/shared lists show who added each item/i)
    ).toBeInTheDocument();
  });

  it('submit with name + household calls updateMyProfile FIRST, then createHousehold, then /list', async () => {
    createHouseholdMock.mockResolvedValue({ id: 'h1', name: 'Casa Roja' });
    const callOrder: string[] = [];
    updateMyProfileMock.mockImplementation(async () => {
      callOrder.push('profile');
      return { user_id: 'u1', display_name: 'Meir', created_at: '' };
    });
    createHouseholdMock.mockImplementation(async () => {
      callOrder.push('household');
      return { id: 'h1', name: 'Casa Roja' };
    });
    render(<OnboardingForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/your name/i), '  Meir  ');
    await user.type(screen.getByLabelText(/household name/i), '  Casa Roja  ');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(createHouseholdMock).toHaveBeenCalledTimes(1));
    expect(updateMyProfileMock).toHaveBeenCalledWith(expect.anything(), 'Meir');
    expect(createHouseholdMock).toHaveBeenCalledWith(
      expect.anything(),
      'Casa Roja'
    );
    // Profile update must precede household create.
    expect(callOrder).toEqual(['profile', 'household']);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/list'));
  });

  it('skips updateMyProfile when name is empty (trigger fallback handles it)', async () => {
    createHouseholdMock.mockResolvedValue({ id: 'h1' });
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/household name/i), 'Casa');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(createHouseholdMock).toHaveBeenCalled());
    expect(updateMyProfileMock).not.toHaveBeenCalled();
  });

  it('profile update failure wedges the user — does NOT call createHousehold', async () => {
    updateMyProfileMock.mockRejectedValue(new Error('display_name too long'));
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/your name/i), 'Meir');
    await user.type(screen.getByLabelText(/household name/i), 'Casa');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /display_name too long/
    );
    expect(createHouseholdMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('blocks empty household submission with an inline error', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /give your household/i
    );
    expect(createHouseholdMock).not.toHaveBeenCalled();
  });

  it('blocks whitespace-only household submission', async () => {
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/household name/i), '   ');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /give your household/i
    );
    expect(createHouseholdMock).not.toHaveBeenCalled();
  });

  it('surfaces a createHousehold error inline', async () => {
    createHouseholdMock.mockRejectedValue(new Error('RLS violation'));
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/household name/i), 'Casa');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/RLS violation/);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('disables the button while submitting', async () => {
    let resolve: ((v: unknown) => void) | undefined;
    createHouseholdMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/household name/i), 'Casa');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
    resolve?.({ id: 'h1' });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/list'));
  });

  // household-collaborators (D7/C2): two-tab race auto-recovery.
  it('auto-recovers to /list when 23505 household_members_one_per_user_v0 fires (two-tab race)', async () => {
    // Simulate the race where another tab already created/joined a household
    // between this tab's check and insert. Postgres surfaces 23505 with the
    // constraint name; OnboardingForm should silently route to /list rather
    // than show an inline error.
    createHouseholdMock.mockRejectedValue({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "household_members_one_per_user_v0"',
    });
    render(<OnboardingForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/household name/i), 'Casa');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/list'));
    // No inline error shown — the race resolved silently.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
