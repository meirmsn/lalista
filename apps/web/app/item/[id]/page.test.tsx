// What: Tests for the item detail RSC + Remove button
// Why: The detail view is read-only but Remove is the only destructive action
//      that bypasses a confirm; null-addedBy + 404 paths are also important
// Does NOT: Hit real Supabase — mocks `fetchListEntryById` + supabase client

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HydratedListEntry } from '@lalista/core';

const {
  notFoundMock,
  fetchListEntryByIdMock,
  deleteListEntryMock,
  createServerClientMock,
  pushMock,
} = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  fetchListEntryByIdMock: vi.fn(),
  deleteListEntryMock: vi.fn(),
  createServerClientMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  useRouter: () => ({ push: pushMock }),
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

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return {
    ...actual,
    fetchListEntryById: fetchListEntryByIdMock,
    deleteListEntry: deleteListEntryMock,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: createServerClientMock,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ __kind: 'browser-client' }),
}));

import ItemDetailPage from './page';
import { RemoveEntryButton } from './RemoveEntryButton';

/**
 *
 */
function entryFixture(
  overrides: Partial<HydratedListEntry> = {}
): HydratedListEntry {
  return {
    id: 'e-1',
    householdId: 'house-1',
    itemId: 'item-1',
    itemName: 'milk',
    storeId: 'store-1',
    storeName: 'Whole Foods',
    brand: 'Horizon',
    quantity: 2,
    unit: 'gal',
    status: 'pending',
    addedAt: '2026-04-17T10:00:00Z',
    addedBy: 'user-1',
    addedByName: null,
    ...overrides,
  };
}

describe('<ItemDetailPage>', () => {
  beforeEach(() => {
    fetchListEntryByIdMock.mockReset();
    createServerClientMock.mockReset();
    createServerClientMock.mockResolvedValue({ __kind: 'server-client' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls notFound() when the entry does not exist', async () => {
    fetchListEntryByIdMock.mockResolvedValue(null);
    await expect(
      ItemDetailPage({ params: Promise.resolve({ id: 'missing' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it('renders the entry name, brand, quantity, store, and added-by values', async () => {
    fetchListEntryByIdMock.mockResolvedValue(entryFixture());
    const element = await ItemDetailPage({
      params: Promise.resolve({ id: 'e-1' }),
    });
    render(element);

    expect(
      screen.getByRole('heading', { name: /^milk$/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/Whole Foods/)).toBeInTheDocument();
    expect(screen.getByText(/Horizon/)).toBeInTheDocument();
    expect(screen.getByText(/2 gal/)).toBeInTheDocument();
    expect(screen.getByText(/someone/i)).toBeInTheDocument();
  });

  it('renders "—" for a null brand and still layouts correctly', async () => {
    fetchListEntryByIdMock.mockResolvedValue(entryFixture({ brand: null }));
    const element = await ItemDetailPage({
      params: Promise.resolve({ id: 'e-1' }),
    });
    render(element);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders "someone" when addedBy is null (post-migration-009 fallback)', async () => {
    fetchListEntryByIdMock.mockResolvedValue(
      entryFixture({ addedBy: null, addedByName: null })
    );
    const element = await ItemDetailPage({
      params: Promise.resolve({ id: 'e-1' }),
    });
    render(element);
    expect(screen.getByText(/someone/i)).toBeInTheDocument();
  });

  it('renders the display name when addedByName is populated', async () => {
    fetchListEntryByIdMock.mockResolvedValue(
      entryFixture({ addedBy: 'user-1', addedByName: 'Meir' })
    );
    const element = await ItemDetailPage({
      params: Promise.resolve({ id: 'e-1' }),
    });
    render(element);
    // The "Added by" row value should show the real name, not "someone".
    expect(screen.getByText('Meir')).toBeInTheDocument();
  });

  it('renders "someone" when addedBy is present but addedByName is null (RLS-filtered)', async () => {
    fetchListEntryByIdMock.mockResolvedValue(
      entryFixture({ addedBy: 'user-other', addedByName: null })
    );
    const element = await ItemDetailPage({
      params: Promise.resolve({ id: 'e-1' }),
    });
    render(element);
    expect(screen.getByText(/someone/i)).toBeInTheDocument();
  });

  it('exposes a back link to /list', async () => {
    fetchListEntryByIdMock.mockResolvedValue(entryFixture());
    const element = await ItemDetailPage({
      params: Promise.resolve({ id: 'e-1' }),
    });
    render(element);
    expect(screen.getByRole('link', { name: /back to list/i })).toHaveAttribute(
      'href',
      '/list'
    );
  });
});

describe('<RemoveEntryButton>', () => {
  beforeEach(() => {
    deleteListEntryMock.mockReset();
    pushMock.mockReset();
  });

  it('calls deleteListEntry(entryId) and pushes /list on success', async () => {
    deleteListEntryMock.mockResolvedValue(undefined);
    render(<RemoveEntryButton entryId="e-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /remove from list/i }));

    await waitFor(() =>
      expect(deleteListEntryMock).toHaveBeenCalledWith(expect.anything(), 'e-1')
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/list'));
  });

  it('surfaces an error inline and keeps the button tappable on failure', async () => {
    deleteListEntryMock.mockRejectedValue(new Error('rls'));
    render(<RemoveEntryButton entryId="e-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /remove from list/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't remove/i
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
