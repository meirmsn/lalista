// What: Unit tests for LoadingArea — pulse class + ARIA + className passthrough.
// Why: Tier C is the route-loading affordance. Asserting the pulse class +
//      role="status" / aria-busy="true" guards against accidental
//      regressions if a future change collapses the pulse animation or
//      drops the assistive-tech hook (which the route-loading E2E spec
//      relies on for its visibility query).
// Does NOT: Visual snapshot — class names beyond animate-pulse + role
//           are an implementation detail.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingArea } from './LoadingArea';

describe('<LoadingArea>', () => {
  it('renders with role="status" and aria-busy="true"', () => {
    render(<LoadingArea />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('paints the animate-pulse class (Tier C affordance per D3)', () => {
    render(<LoadingArea />);
    const region = screen.getByRole('status');
    expect(region.className).toContain('animate-pulse');
  });

  it('uses the default ARIA label "Loading"', () => {
    render(<LoadingArea />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('respects a custom label', () => {
    render(<LoadingArea label="Loading list" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading list'
    );
  });

  it('appends caller className to the pulse block', () => {
    render(<LoadingArea className="h-[400px]" />);
    const region = screen.getByRole('status');
    expect(region.className).toContain('h-[400px]');
    // Default classes still present
    expect(region.className).toContain('animate-pulse');
  });

  it('passes children through inside the pulse region', () => {
    render(
      <LoadingArea>
        <div data-testid="layout-shape">shape</div>
      </LoadingArea>
    );
    expect(screen.getByTestId('layout-shape')).toBeInTheDocument();
  });

  it('has no spinner, no skeleton bars (Tier C is a quiet empty container per D3)', () => {
    render(<LoadingArea />);
    // Sanity: no generic "spinner" testids and no svg children.
    expect(screen.queryByTestId('spinner')).toBeNull();
    expect(screen.getByRole('status').querySelector('svg')).toBeNull();
  });
});
