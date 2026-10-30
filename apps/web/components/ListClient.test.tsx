// What: Behavior tests for ListClient — load/ready/error, realtime merge, buy handler
// Why: The list view's container owns reconciliation; the five acceptance
//      criteria in the spec all hinge on this component behaving correctly
// Does NOT: Hit real Supabase — all core API calls are mocked

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HydratedListEntry, ListEntryChange } from '@lalista/core';

const {
  fetchListEntriesMock,
  markItemBoughtMock,
  deleteListEntryMock,
  subscribeToListMock,
  createClientMock,
  captureMock,
} = vi.hoisted(() => ({
  fetchListEntriesMock: vi.fn(),
  markItemBoughtMock: vi.fn(),
  deleteListEntryMock: vi.fn(),
  subscribeToListMock: vi.fn(),
  // The auth surface only needs onAuthStateChange — ListClient's
  // TOKEN_REFRESHED useEffect (D8 of sync-banner-pwa-recovery) calls
  // supabase.auth.onAuthStateChange(cb) at mount and reads .data.subscription
  // for cleanup. Return a no-op subscription so mount doesn't throw.
  createClientMock: vi.fn(() => ({
    __kind: 'client-stub',
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  })),
  captureMock: vi.fn(),
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return {
    ...actual,
    fetchListEntries: fetchListEntriesMock,
    markItemBought: markItemBoughtMock,
    deleteListEntry: deleteListEntryMock,
    subscribeToList: subscribeToListMock,
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: createClientMock,
}));

vi.mock('posthog-js', () => ({
  default: { capture: captureMock },
}));

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

const routerPushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import { ListClient } from './ListClient';

const TEST_USER = { id: 'user-1', displayName: 'Test User' };

/**
 *
 */
function entry(overrides: Partial<HydratedListEntry> = {}): HydratedListEntry {
  return {
    id: 'e-1',
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

describe('<ListClient>', () => {
  let emitRealtime: (change: ListEntryChange) => void = () => {};

  beforeEach(() => {
    fetchListEntriesMock.mockReset();
    markItemBoughtMock.mockReset();
    deleteListEntryMock.mockReset();
    subscribeToListMock.mockReset();
    captureMock.mockReset();
    createClientMock.mockReturnValue({
      __kind: 'client-stub',
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
      },
    });
    subscribeToListMock.mockImplementation((_c, _h, cb) => {
      emitRealtime = cb;
      return () => {};
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders skeleton rows during initial load', async () => {
    // Never-resolving promise to hold loading state.
    fetchListEntriesMock.mockReturnValue(new Promise(() => {}));
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );
    expect(
      screen.getAllByRole('status', { name: /loading your list/i })
    ).toHaveLength(3);
  });

  it('groups entries by store with store headers + omits empty stores', async () => {
    fetchListEntriesMock.mockResolvedValue({
      entries: [
        entry({
          id: 'e-1',
          storeId: 'store-1',
          storeName: 'Whole Foods',
          itemName: 'milk',
        }),
        entry({
          id: 'e-2',
          storeId: 'store-2',
          storeName: 'Costco',
          itemName: 'eggs',
        }),
        entry({
          id: 'e-3',
          storeId: 'store-1',
          storeName: 'Whole Foods',
          itemName: 'bread',
        }),
      ],
      currentHouseholdId: 'house-1',
    });
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );

    // 3 rows across 2 stores.
    await waitFor(() => expect(screen.getByText('milk')).toBeInTheDocument());
    expect(screen.getByText('eggs')).toBeInTheDocument();
    expect(screen.getByText('bread')).toBeInTheDocument();
    // Each store renders an uppercased name somewhere.
    expect(screen.getAllByText(/Whole Foods/i).length).toBeGreaterThanOrEqual(
      1
    );
    expect(screen.getAllByText(/Costco/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state when there are zero entries', async () => {
    fetchListEntriesMock.mockResolvedValue({
      entries: [],
      currentHouseholdId: 'house-1',
    });
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('empty-list-state')).toBeInTheDocument()
    );
  });

  it('merges a realtime INSERT into the list', async () => {
    fetchListEntriesMock.mockResolvedValue({
      entries: [],
      currentHouseholdId: 'house-1',
    });
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('empty-list-state')).toBeInTheDocument()
    );

    // Emit INSERT from realtime.
    emitRealtime({
      eventType: 'INSERT',
      new: {
        id: 'e-live',
        household_id: 'house-1',
        item_id: 'item-1',
        store_id: 'store-1',
        brand: null,
        quantity: 1,
        unit: null,
        status: 'pending',
        added_at: '2026-04-17T10:00:00Z',
        added_by: 'user-1',
      },
    } as unknown as ListEntryChange);

    await waitFor(() =>
      expect(screen.getByTestId('list-row-e-live')).toBeInTheDocument()
    );
  });

  it('removes a row on realtime DELETE', async () => {
    fetchListEntriesMock.mockResolvedValue({
      entries: [entry()],
      currentHouseholdId: 'house-1',
    });
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('list-row-e-1')).toBeInTheDocument()
    );

    emitRealtime({
      eventType: 'DELETE',
      old: { id: 'e-1' },
    } as unknown as ListEntryChange);

    await waitFor(() =>
      expect(screen.queryByTestId('list-row-e-1')).not.toBeInTheDocument()
    );
  });

  it('renders the sync error banner + fires error_displayed when the initial fetch fails', async () => {
    fetchListEntriesMock.mockRejectedValue(new Error('network'));
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );
    // The banner's retry button carries the copy.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /sync paused/i })
      ).toBeInTheDocument()
    );
    // SyncErrorBanner fires `error_displayed` from a useEffect that flushes
    // after the banner first renders. The waitFor above resolves on the DOM
    // insertion; the analytics call lands one microtask later. Local runs
    // see them as ~simultaneous, but CI runs are slower and can race —
    // wrap the assertion so it waits for the effect to flush.
    await waitFor(() =>
      expect(captureMock).toHaveBeenCalledWith(
        'error_displayed',
        expect.objectContaining({ error_type: 'query', screen: 'list' })
      )
    );
  });

  it('calls markItemBought + removes the row on buy-button tap', async () => {
    fetchListEntriesMock.mockResolvedValue({
      entries: [entry()],
      currentHouseholdId: 'house-1',
    });
    markItemBoughtMock.mockResolvedValue(undefined);
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('list-row-e-1')).toBeInTheDocument()
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /mark milk as bought/i })
    );

    await waitFor(() =>
      expect(markItemBoughtMock).toHaveBeenCalledWith(expect.anything(), 'e-1')
    );
    await waitFor(() =>
      expect(screen.queryByTestId('list-row-e-1')).not.toBeInTheDocument()
    );
    expect(captureMock).toHaveBeenCalledWith(
      'item_bought',
      expect.objectContaining({ time_on_list_seconds: expect.any(Number) })
    );
  });

  it('opens the add-item sheet when the FAB is tapped', async () => {
    fetchListEntriesMock.mockResolvedValue({
      entries: [],
      currentHouseholdId: 'house-1',
    });
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('empty-list-state')).toBeInTheDocument()
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /add item to lalista/i })
    );
    expect(
      screen.getByRole('dialog', { name: /add to lalista/i })
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------
  // household-collaborators (chapter 1m)
  // -------------------------------------------------------------------
  it('renders the household-name caption header (D12) with tap-target to /settings#household', async () => {
    fetchListEntriesMock.mockResolvedValue({
      entries: [],
      currentHouseholdId: 'house-1',
    });
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Bonita"
        currentUser={TEST_USER}
      />
    );
    await waitFor(() =>
      expect(screen.getByText('Casa Bonita')).toBeInTheDocument()
    );
    const tapTarget = screen
      .getByText('Casa Bonita')
      .closest('a') as HTMLAnchorElement;
    expect(tapTarget.getAttribute('href')).toBe('/settings#household');
    expect(tapTarget.getAttribute('aria-label')).toContain('Casa Bonita');
  });

  it('redirects to /onboarding?removed=1 when fetchListEntries throws RemovedFromHouseholdError (D6/A4)', async () => {
    const { RemovedFromHouseholdError } =
      await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
    fetchListEntriesMock.mockRejectedValue(new RemovedFromHouseholdError());
    routerPushMock.mockReset();
    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );
    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/onboarding?removed=1')
    );
  });

  it('refetches the list on TOKEN_REFRESHED (D8 of sync-banner-pwa-recovery)', async () => {
    // Capture the callback registered with supabase.auth.onAuthStateChange so
    // the test can invoke it as if supabase-js emitted the event. Replace the
    // beforeEach default mock client with one that exposes the captured cb.
    let capturedAuthHandler: ((event: string) => void) | null = null;
    const onAuthStateChangeMock = vi.fn((cb: (event: string) => void) => {
      capturedAuthHandler = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    // Type-cast: the hoisted factory's `onAuthStateChange` mock is `() => …`
    // (no args, for tests that don't care). Here we need a one-arg shape; the
    // ListClient code path that consumes the cb does the runtime contract.
    createClientMock.mockReturnValue({
      __kind: 'client-stub',
      auth: { onAuthStateChange: onAuthStateChangeMock },
    } as unknown as ReturnType<typeof createClientMock>);

    fetchListEntriesMock.mockResolvedValue({
      entries: [],
      currentHouseholdId: 'house-1',
    });

    render(
      <ListClient
        householdId="house-1"
        householdName="Casa Test"
        currentUser={TEST_USER}
      />
    );

    // Wait for the initial mount fetch(es) to settle before triggering
    // TOKEN_REFRESHED. We use a relaxed waitFor (≥1) because the mount path
    // can refetch via multiple useEffects (load + realtime + wake) and we
    // care about the DELTA caused by TOKEN_REFRESHED, not the absolute count.
    await waitFor(() =>
      expect(fetchListEntriesMock.mock.calls.length).toBeGreaterThanOrEqual(1)
    );
    expect(onAuthStateChangeMock).toHaveBeenCalled();
    expect(capturedAuthHandler).not.toBeNull();
    // Let any latent post-mount fetches settle.
    await new Promise((r) => setTimeout(r, 20));
    const baseline = fetchListEntriesMock.mock.calls.length;

    // Fire TOKEN_REFRESHED — the D8 useEffect must call runFetch once more.
    capturedAuthHandler!('TOKEN_REFRESHED');
    await waitFor(() =>
      expect(fetchListEntriesMock.mock.calls.length).toBe(baseline + 1)
    );

    // Other auth events MUST NOT trigger a refetch.
    capturedAuthHandler!('SIGNED_IN');
    capturedAuthHandler!('USER_UPDATED');
    capturedAuthHandler!('SIGNED_OUT');
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchListEntriesMock.mock.calls.length).toBe(baseline + 1);
  });
});
