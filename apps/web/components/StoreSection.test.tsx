// What: Smoke tests for StoreSection — header text, singular/plural count, a11y heading
// Why: Store grouping is the anchor of the list view's visual hierarchy; bad
//      pluralization or missing labels would feel off
// Does NOT: Test colors or layout

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoreSection } from './StoreSection';

describe('<StoreSection>', () => {
  it('renders store name uppercased (via CSS class) and singular "item" for count=1', () => {
    render(
      <StoreSection storeName="Whole Foods" itemCount={1}>
        <div>row</div>
      </StoreSection>
    );
    expect(screen.getByText(/Whole Foods/i)).toBeInTheDocument();
    expect(screen.getByText(/1 item/)).toBeInTheDocument();
    expect(screen.queryByText(/1 items/)).not.toBeInTheDocument();
  });

  it('pluralizes "items" for counts != 1', () => {
    render(
      <StoreSection storeName="Costco" itemCount={3}>
        <div>rows</div>
      </StoreSection>
    );
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
  });

  it('exposes an accessible heading for screen readers', () => {
    render(
      <StoreSection storeName="Aldi" itemCount={2}>
        <div>x</div>
      </StoreSection>
    );
    const section = screen.getByRole('region', { name: /Aldi section/i });
    expect(section).toBeInTheDocument();
  });

  it('renders children inside the section', () => {
    render(
      <StoreSection storeName="Costco" itemCount={2}>
        <div data-testid="kid">kid</div>
      </StoreSection>
    );
    expect(screen.getByTestId('kid')).toBeInTheDocument();
  });
});
