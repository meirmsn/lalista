// What: Tests for the `/` RSC — auth-aware redirect to /list, else render landing
// Why: The IA flip (D7) hinges on this redirect landing before any HTML ships;
//      wrong branch = authed users see the marketing screen on every visit
// Does NOT: Render the Next routing stack — we call the server component directly

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { redirectMock, getAuthUserMock, createClientMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getAuthUserMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
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

import Home from './page';

describe('<Home> (root RSC)', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
    getAuthUserMock.mockReset();
    createClientMock.mockReset();
    createClientMock.mockResolvedValue({
      auth: { getUser: getAuthUserMock },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redirects authed users to /list', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    await expect(Home()).rejects.toThrow('NEXT_REDIRECT:/list');
    expect(redirectMock).toHaveBeenCalledWith('/list');
  });

  it('renders <PublicLanding> for unauthed visitors', async () => {
    getAuthUserMock.mockResolvedValue({ data: { user: null } });
    const element = await Home();
    expect(redirectMock).not.toHaveBeenCalled();
    render(element);
    expect(
      screen.getByRole('heading', { name: /lalista/i, level: 1 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /create account/i })
    ).toHaveAttribute('href', '/sign-up');
    expect(screen.getByRole('link', { name: /^sign in$/i })).toHaveAttribute(
      'href',
      '/sign-in'
    );
  });
});
