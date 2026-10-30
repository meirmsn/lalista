// What: Smoke tests for EmptyListState — Fraunces copy + CTA
// Why: First-launch UX must render exact bilingual copy ("la lista está vacía")
// Does NOT: Assert the font choice (that's visual)

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyListState } from './EmptyListState';

describe('<EmptyListState>', () => {
  it('renders the bilingual empty state copy', () => {
    render(<EmptyListState onAddFirst={() => {}} />);
    expect(screen.getByText(/la lista está vacía/i)).toBeInTheDocument();
    expect(screen.getByText(/\(the list is empty\)/i)).toBeInTheDocument();
  });

  it('calls onAddFirst when the CTA is clicked', async () => {
    const onAddFirst = vi.fn();
    render(<EmptyListState onAddFirst={onAddFirst} />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /add your first item/i })
    );
    expect(onAddFirst).toHaveBeenCalledTimes(1);
  });
});
