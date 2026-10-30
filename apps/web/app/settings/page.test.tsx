// What: Smoke tests for the Settings page — redirects + render
// Why: Wrong redirect on an empty-household user would bounce them out of the
//      app; minimal coverage catches that case + confirms the four sections
//      render (Account, Household, Members, Activity). Household fetch flips
//      from fetchUserHouseholds (legacy) to fetchMyHousehold (the
//      household-collaborators wrapper that returns role too).
// Does NOT: Exercise sign-out — that's covered in SignOutButton.test.tsx;
//           or the live RPC/membership behaviors — those are E2E.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const {
  redirectMock,
  fetchMyHouseholdMock,
  fetchMyProfileMock,
  fetchMembersMock,
  fetchPendingInvitesMock,
  fetchHouseholdAuditMock,
  updateMyProfileMock,
  getAuthUserMock,
  serverCreateClientMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  fetchMyHouseholdMock: vi.fn(),
  fetchMyProfileMock: vi.fn(),
  fetchMembersMock: vi.fn(),
  fetchPendingInvitesMock: vi.fn(),
  fetchHouseholdAuditMock: vi.fn(),
  updateMyProfileMock: vi.fn(),
  getAuthUserMock: vi.fn(),
  serverCreateClientMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: serverCreateClientMock,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ __kind: 'browser-client' }),
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return {
    ...actual,
    fetchMyHousehold: fetchMyHouseholdMock,
    fetchMyProfile: fetchMyProfileMock,
    fetchMembers: fetchMembersMock,
    fetchPendingInvites: fetchPendingInvitesMock,
    fetchHouseholdAudit: fetchHouseholdAuditMock,
    updateMyProfile: updateMyProfileMock,
    signOut: vi.fn().mockResolvedValue(undefined),
  };
});

import SettingsPage from './page';

describe('<SettingsPage>', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
    fetchMyHouseholdMock.mockReset();
    fetchMyProfileMock.mockReset();
    fetchMembersMock.mockReset();
    fetchPendingInvitesMock.mockReset();
    fetchHouseholdAuditMock.mockReset();
    updateMyProfileMock.mockReset();
    getAuthUserMock.mockReset();
    serverCreateClientMock.mockReset();
    serverCreateClientMock.mockResolvedValue({
      auth: { getUser: getAuthUserMock },
    });
    fetchMyProfileMock.mockResolvedValue({
      user_id: 'u1',
      display_name: 'Meir',
      created_at: '2026-04-23T00:00:00Z',
    });
    // Default sub-section behaviors so SettingsClient subtree mounts cleanly.
    fetchMembersMock.mockResolvedValue([]);
    fetchPendingInvitesMock.mockResolvedValue([]);
    fetchHouseholdAuditMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /sign-in when the user is unauthed (defense in depth)', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: null } });
    await expect(SettingsPage()).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in?next=/settings'
    );
  });

  it('redirects to /onboarding when the user has no household', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchMyHouseholdMock.mockResolvedValue(null);
    await expect(SettingsPage()).rejects.toThrow('NEXT_REDIRECT:/onboarding');
  });

  it('renders ACCOUNT + HOUSEHOLD sections with the household name and sign-out button', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchMyHouseholdMock.mockResolvedValue({
      id: 'h1',
      name: 'Casa Roja',
      createdAt: '2026-05-01T00:00:00Z',
      myRole: 'owner',
    });
    const element = await SettingsPage();
    render(element);

    expect(
      screen.getByRole('heading', { name: /^settings$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /account/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /household/i })
    ).toBeInTheDocument();
    // The household name appears in the editable input value (owner view).
    expect(
      (screen.getByLabelText(/household name/i) as HTMLInputElement).value
    ).toBe('Casa Roja');
    expect(
      screen.getByRole('button', { name: /sign out/i })
    ).toBeInTheDocument();
  });

  it('renders the display-name field prefilled with profiles.display_name', async () => {
    getAuthUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'meirmsn@example.com' } },
    });
    fetchMyHouseholdMock.mockResolvedValue({
      id: 'h1',
      name: 'Casa Roja',
      createdAt: '2026-05-01T00:00:00Z',
      myRole: 'owner',
    });
    fetchMyProfileMock.mockResolvedValue({
      user_id: 'u1',
      display_name: 'Meir',
      created_at: '2026-04-23T00:00:00Z',
    });
    const element = await SettingsPage();
    render(element);

    // Spec D14: Account section labels its DisplayNameField "Your name"
    // (display_name); HouseholdSection labels its DisplayNameField "Household
    // name". Distinct labels disambiguate the two fields for screen readers
    // and tests.
    expect(
      (screen.getByLabelText(/your name/i) as HTMLInputElement).value
    ).toBe('Meir');
  });

  it('falls back to email local-part when profiles row is missing (defensive)', async () => {
    getAuthUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'meirmsn@example.com' } },
    });
    fetchMyHouseholdMock.mockResolvedValue({
      id: 'h1',
      name: 'Casa Roja',
      createdAt: '2026-05-01T00:00:00Z',
      myRole: 'owner',
    });
    fetchMyProfileMock.mockResolvedValue(null);
    const element = await SettingsPage();
    render(element);

    expect(
      (screen.getByLabelText(/your name/i) as HTMLInputElement).value
    ).toBe('meirmsn');
  });

  it('falls back to "someone" when user has no email AND no profile', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchMyHouseholdMock.mockResolvedValue({
      id: 'h1',
      name: 'Casa Roja',
      createdAt: '2026-05-01T00:00:00Z',
      myRole: 'owner',
    });
    fetchMyProfileMock.mockResolvedValue(null);
    const element = await SettingsPage();
    render(element);

    expect(
      (screen.getByLabelText(/your name/i) as HTMLInputElement).value
    ).toBe('someone');
  });

  it('renders the Members + Activity sections (household-collaborators)', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    fetchMyHouseholdMock.mockResolvedValue({
      id: 'h1',
      name: 'Casa Roja',
      createdAt: '2026-05-01T00:00:00Z',
      myRole: 'owner',
    });
    fetchMembersMock.mockResolvedValue([
      {
        userId: 'u1',
        displayName: 'Alice',
        role: 'owner',
        joinedAt: '2026-05-09T00:00:00Z',
      },
    ]);
    fetchHouseholdAuditMock.mockResolvedValue([]);
    const element = await SettingsPage();
    render(element);

    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: /members/i })
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole('region', { name: /activity/i })
    ).toBeInTheDocument();
  });
});
