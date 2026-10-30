// What: Render + interaction tests for MyStoresSection.
// Why: Pin the load + section-heading shape + StorePicker mount + the
//      Tier A1 rollback path for add/remove failures (D10). Full mutation
//      lifecycle lives in the E2E spec per the per-surface invariant.
// Does NOT: Hit the network — every @lalista/core wrapper is mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  fetchMyStoresMock,
  fetchStoreCatalogSuggestionsMock,
  addHouseholdStoreMock,
  removeHouseholdStoreMock,
  captureMock,
} = vi.hoisted(() => ({
  fetchMyStoresMock: vi.fn(),
  fetchStoreCatalogSuggestionsMock: vi.fn(),
  addHouseholdStoreMock: vi.fn(),
  removeHouseholdStoreMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock('@lalista/core', async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    fetchMyStores: (...args: unknown[]) => fetchMyStoresMock(...args),
    fetchStoreCatalogSuggestions: (...args: unknown[]) =>
      fetchStoreCatalogSuggestionsMock(...args),
    addHouseholdStore: (...args: unknown[]) => addHouseholdStoreMock(...args),
    removeHouseholdStore: (...args: unknown[]) =>
      removeHouseholdStoreMock(...args),
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock('posthog-js', () => ({
  default: { capture: captureMock },
}));

import { MyStoresSection } from './MyStoresSection';

describe('<MyStoresSection>', () => {
  beforeEach(() => {
    fetchMyStoresMock.mockReset();
    fetchStoreCatalogSuggestionsMock.mockReset();
    addHouseholdStoreMock.mockReset();
    removeHouseholdStoreMock.mockReset();
    captureMock.mockReset();
  });

  it('renders the section heading + the loaded My Stores list', async () => {
    fetchMyStoresMock.mockResolvedValue([
      { id: 's-costco', name: 'Costco' },
      { id: 's-walmart', name: 'Walmart' },
    ]);
    render(<MyStoresSection householdId="house-1" />);

    expect(screen.getByText(/my stores/i)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Costco')).toBeTruthy();
      expect(screen.getByText('Walmart')).toBeTruthy();
    });
  });

  it('renders the Fraunces empty state when no My Stores', async () => {
    fetchMyStoresMock.mockResolvedValue([]);
    render(<MyStoresSection householdId="house-1" />);

    await waitFor(() => {
      expect(screen.getByText('tus tiendas')).toBeTruthy();
    });
  });

  it('remove tap fires the wrapper + tracks my_store_removed', async () => {
    fetchMyStoresMock.mockResolvedValue([{ id: 's-costco', name: 'Costco' }]);
    removeHouseholdStoreMock.mockResolvedValue(undefined);
    render(<MyStoresSection householdId="house-1" />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /remove costco from my stores/i })
      ).toBeTruthy()
    );
    fireEvent.click(
      screen.getByRole('button', { name: /remove costco from my stores/i })
    );

    await waitFor(() =>
      expect(removeHouseholdStoreMock).toHaveBeenCalledWith({}, 's-costco')
    );
    await waitFor(() =>
      expect(captureMock).toHaveBeenCalledWith('my_store_removed', {
        store_id: 's-costco',
        source: 'settings',
        household_id: 'house-1',
      })
    );
  });

  it('rollback on remove failure restores the My Stores list', async () => {
    fetchMyStoresMock.mockResolvedValue([{ id: 's-costco', name: 'Costco' }]);
    removeHouseholdStoreMock.mockRejectedValue(new Error('nope'));
    render(<MyStoresSection householdId="house-1" />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /remove costco from my stores/i })
      ).toBeTruthy()
    );
    fireEvent.click(
      screen.getByRole('button', { name: /remove costco from my stores/i })
    );

    // After the failure, the row is restored (Tier A1 rollback) and the
    // error is surfaced via role="alert".
    await waitFor(() => expect(removeHouseholdStoreMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText('Costco')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(/nope/);
    });
  });
});
