// What: Behavior tests for ListRow — rendering + buy + remove + nav
// Why: The row is where users spend the most time; small regressions (missing
//      labels, broken tap targets) compound
// Does NOT: Exercise the Next Link router — assertions are on rendered href

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HydratedListEntry } from '@lalista/core';
import { ListRow } from './ListRow';

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

/**
 *
 */
function entryFixture(
  overrides: Partial<HydratedListEntry> = {}
): HydratedListEntry {
  return {
    id: 'entry-1',
    householdId: 'house-1',
    itemId: 'item-1',
    itemName: 'milk',
    storeId: 'store-1',
    storeName: 'Whole Foods',
    brand: null,
    quantity: 1,
    unit: null,
    status: 'pending',
    addedAt: '2026-04-17T10:00:00Z',
    addedBy: 'user-1',
    addedByName: null,
    ...overrides,
  };
}

describe('<ListRow>', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders item name, secondary line, and added-by fallback', () => {
    render(
      <ListRow
        entry={entryFixture({ brand: 'Horizon', quantity: 2, unit: 'gal' })}
        onBuy={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText('milk')).toBeInTheDocument();
    expect(screen.getByText(/Horizon · 2 gal/)).toBeInTheDocument();
    expect(screen.getByText(/added by someone/i)).toBeInTheDocument();
  });

  it('renders "1 unit" when no brand and quantity=1', () => {
    render(
      <ListRow
        entry={entryFixture({ brand: null, quantity: 1, unit: null })}
        onBuy={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText(/1 unit/)).toBeInTheDocument();
  });

  it('renders "added by someone" when addedBy is null (post-migration-009 fallback)', () => {
    render(
      <ListRow
        entry={entryFixture({ addedBy: null, addedByName: null })}
        onBuy={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText(/added by someone/i)).toBeInTheDocument();
  });

  it('renders the real display name when addedByName is populated', () => {
    render(
      <ListRow
        entry={entryFixture({ addedBy: 'user-1', addedByName: 'Meir' })}
        onBuy={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText('added by Meir')).toBeInTheDocument();
    // The aria-label on the body link must also surface the real name.
    expect(
      screen.getByRole('link', { name: /added by Meir/i })
    ).toBeInTheDocument();
  });

  it('renders "added by someone" when addedBy is present but addedByName is null (RLS-filtered author)', () => {
    // Ex: author is in a different household — `fetchDisplayNamesByUserId`
    // returns no row, addedByName lands null, UI renders "someone".
    render(
      <ListRow
        entry={entryFixture({ addedBy: 'user-other', addedByName: null })}
        onBuy={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText(/added by someone/i)).toBeInTheDocument();
  });

  it('calls onBuy with the entry when the buy button is clicked', async () => {
    const onBuy = vi.fn();
    const entry = entryFixture();
    render(<ListRow entry={entry} onBuy={onBuy} onRemove={() => {}} />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /mark milk as bought/i })
    );
    expect(onBuy).toHaveBeenCalledWith(entry);
  });

  it('calls onRemove with the entry when the overflow button is clicked', async () => {
    const onRemove = vi.fn();
    const entry = entryFixture();
    render(<ListRow entry={entry} onBuy={() => {}} onRemove={onRemove} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /remove milk/i }));
    expect(onRemove).toHaveBeenCalledWith(entry);
  });

  it('renders a link to /item/[id] on the body', () => {
    render(
      <ListRow entry={entryFixture()} onBuy={() => {}} onRemove={() => {}} />
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/item/entry-1');
  });

  it('disables buy button when isBuying', () => {
    render(
      <ListRow
        entry={entryFixture()}
        onBuy={() => {}}
        onRemove={() => {}}
        isBuying
      />
    );
    expect(
      screen.getByRole('button', { name: /mark milk as bought/i })
    ).toBeDisabled();
  });
});
