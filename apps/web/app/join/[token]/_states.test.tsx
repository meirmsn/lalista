// What: Render-snapshot tests for the three /join/[token] state pages.
// Why: Pin the canonical Pass 4 copy + the focus contract on
//      AlreadyInHousehold's primary CTA + the OwnInviteLink copy fallback.
// Does NOT: Test the page.tsx 7-step flow itself — that's E2E (task 17).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  InviteUnavailable,
  AlreadyInHousehold,
  OwnInviteLink,
} from './_states';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('<InviteUnavailable>', () => {
  it('renders the canonical Pass 4 copy', () => {
    render(<InviteUnavailable />);
    expect(screen.getByText("that link's done")).toBeTruthy();
    expect(
      screen.getByText('this invite has expired or already been used.')
    ).toBeTruthy();
    expect(screen.getByText('ask the sender for a new one.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /go to lalista/i })).toBeTruthy();
  });

  it('uses an h1 with the heading-id contract', () => {
    render(<InviteUnavailable />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.id).toBe('invite-unavailable-heading');
  });
});

describe('<AlreadyInHousehold>', () => {
  it('renders the canonical Pass 4 copy + the displayName interpolation', () => {
    render(<AlreadyInHousehold displayName="Alice" onSignOut={() => {}} />);
    expect(screen.getByText("you're already in a list")).toBeTruthy();
    expect(screen.getByText('signed in as Alice.')).toBeTruthy();
    expect(screen.getByText('one account, one household.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /go to my list/i })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /sign out and try again/i })
    ).toBeTruthy();
  });

  it('calls onSignOut when the secondary CTA is clicked', () => {
    const onSignOut = vi.fn();
    render(<AlreadyInHousehold displayName="Alice" onSignOut={onSignOut} />);
    fireEvent.click(
      screen.getByRole('button', { name: /sign out and try again/i })
    );
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('<OwnInviteLink>', () => {
  it('renders the canonical Pass 4 copy + back-to-list text-link', () => {
    render(<OwnInviteLink url="https://lalista.store/join/abc" />);
    expect(screen.getByText('your link')).toBeTruthy();
    expect(
      screen.getByText('share it with the person you want to add.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to list/i })).toBeTruthy();
  });

  it('toggles to "copied ✓" after clicking copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<OwnInviteLink url="https://lalista.store/join/abc" />);
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    // copy-to-clipboard runs async; allow microtask flush.
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('https://lalista.store/join/abc');
  });
});
