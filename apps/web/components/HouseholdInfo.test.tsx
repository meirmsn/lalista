// What: Smoke tests for HouseholdInfo — name displays, placeholder row present
// Why: Settings section is stable-state; test guards against accidental
//      removal of the household name field when members management lands later
// Does NOT: Snapshot classes

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HouseholdInfo } from './HouseholdInfo';

describe('<HouseholdInfo>', () => {
  it('renders the household name', () => {
    render(<HouseholdInfo householdName="Casa Roja" />);
    expect(screen.getByText('Casa Roja')).toBeInTheDocument();
  });

  it('shows the "coming soon" placeholder for members', () => {
    render(<HouseholdInfo householdName="Casa" />);
    expect(
      screen.getByText(/manage members.*coming soon/i)
    ).toBeInTheDocument();
  });
});
