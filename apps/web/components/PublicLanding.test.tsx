// What: Smoke tests for PublicLanding — wordmark, tagline, CTA link target
// Why: First-impression screen for every unauth visitor; copy + route are
//      load-bearing for marketing conversion
// Does NOT: Assert font choices — that's a visual concern

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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

import { PublicLanding } from './PublicLanding';

describe('<PublicLanding>', () => {
  it('renders the lalista wordmark', () => {
    render(<PublicLanding />);
    expect(
      screen.getByRole('heading', { name: /lalista/i, level: 1 })
    ).toBeInTheDocument();
  });

  it('renders the canonical byline from DESIGN.md § Voice', () => {
    // DESIGN.md § Copy & Voice § Canonical voice examples prescribes
    // "groceries on a word." as the brag-register canonical example. This
    // test pins that copy so silent edits away from it fail CI (copy is a
    // product surface, not implementation detail).
    render(<PublicLanding />);
    expect(screen.getByText(/groceries on a word\./i)).toBeInTheDocument();
  });

  it('renders a primary "Create account" CTA linking to /sign-up', () => {
    render(<PublicLanding />);
    const primary = screen.getByRole('link', { name: /create account/i });
    expect(primary).toHaveAttribute('href', '/sign-up');
  });

  it('renders a secondary "Sign in" link routing to /sign-in', () => {
    render(<PublicLanding />);
    const secondary = screen.getByRole('link', { name: /^sign in$/i });
    expect(secondary).toHaveAttribute('href', '/sign-in');
  });

  it('contains no form, button, or interactive element beyond the two CTA links', () => {
    render(<PublicLanding />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
