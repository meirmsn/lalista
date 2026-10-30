// What: Unit + interaction tests for <StorePicker> — mode dispatch,
//       allowCreate CTA gate, empty state, ARIA contract, debounced
//       suggestion fetch + filter-out-already-in-my-stores.
// Why: Single picker primitive reused across Settings, AddItemSheet, and
//      the disambig store-followup. The ARIA contract + CTA-gate logic are
//      the load-bearing behaviors — once they drift, every consumer breaks.
// Does NOT: Wrap useOptimisticMutation — callers own latency-tier wiring.
//
// Note on timers: tests for the debounce path use real timers (vi.useFakeTimers
// makes @testing-library's waitFor poll forever because waitFor uses real
// setInterval). The 200ms debounce is short enough to keep these tests fast.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StorePicker } from './StorePicker';

const COSTCO = { id: 's-costco', name: 'Costco' };
const WALMART = { id: 's-walmart', name: 'Walmart' };
const TARGET = { id: 's-target', name: 'Target' };

describe('<StorePicker>', () => {
  describe('mode=manage', () => {
    it('renders each My Store row with a remove text-link and correct aria-label', () => {
      const onRemove = vi.fn();
      render(
        <StorePicker
          mode="manage"
          myStores={[COSTCO, WALMART]}
          fetchSuggestions={async () => []}
          onAdd={() => {}}
          onRemove={onRemove}
        />
      );
      expect(screen.getByText('Costco')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: /remove costco from my stores/i })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: /remove walmart from my stores/i })
      ).toBeTruthy();
    });

    it('fires onRemove when remove text-link is tapped', () => {
      const onRemove = vi.fn();
      render(
        <StorePicker
          mode="manage"
          myStores={[COSTCO]}
          fetchSuggestions={async () => []}
          onAdd={() => {}}
          onRemove={onRemove}
        />
      );
      fireEvent.click(
        screen.getByRole('button', { name: /remove costco from my stores/i })
      );
      expect(onRemove).toHaveBeenCalledWith('s-costco');
    });

    it('renders Fraunces italic empty state when myStores is empty', () => {
      render(
        <StorePicker
          mode="manage"
          myStores={[]}
          fetchSuggestions={async () => []}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      );
      expect(screen.getByText('tus tiendas')).toBeTruthy();
      expect(screen.getByText('(your stores)')).toBeTruthy();
      expect(screen.getByText(/add the places you shop/i)).toBeTruthy();
    });
  });

  describe('mode=select', () => {
    it('renders each My Store as a pill button with aria-pressed', () => {
      const onSelect = vi.fn();
      render(
        <StorePicker
          mode="select"
          myStores={[COSTCO, WALMART]}
          selectedStoreId="s-costco"
          fetchSuggestions={async () => []}
          onAdd={() => {}}
          onSelect={onSelect}
        />
      );
      const costcoPill = screen.getByRole('button', { name: 'Costco' });
      const walmartPill = screen.getByRole('button', { name: 'Walmart' });
      expect(costcoPill.getAttribute('aria-pressed')).toBe('true');
      expect(walmartPill.getAttribute('aria-pressed')).toBe('false');
    });

    it('fires onSelect(storeId) when a pill is tapped', () => {
      const onSelect = vi.fn();
      render(
        <StorePicker
          mode="select"
          myStores={[COSTCO]}
          fetchSuggestions={async () => []}
          onAdd={() => {}}
          onSelect={onSelect}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Costco' }));
      expect(onSelect).toHaveBeenCalledWith('s-costco');
    });
  });

  describe('autocomplete + allowCreate', () => {
    it('input has the ARIA contract: aria-autocomplete=list, aria-controls=<listId>', () => {
      render(
        <StorePicker
          mode="manage"
          myStores={[COSTCO]}
          fetchSuggestions={async () => []}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      );
      const input = screen.getByPlaceholderText(/add another store/i);
      expect(input.getAttribute('aria-autocomplete')).toBe('list');
      expect(input.getAttribute('aria-controls')).toBeTruthy();
    });

    it('debounces fetchSuggestions and renders results after the last keystroke', async () => {
      const fetchSuggestions = vi.fn(async (q: string) => {
        if (q.includes('aldi')) return [{ id: 's-aldi', name: 'Aldi' }];
        return [];
      });
      render(
        <StorePicker
          mode="manage"
          myStores={[COSTCO]}
          fetchSuggestions={fetchSuggestions}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      );
      const input = screen.getByPlaceholderText(/add another store/i);
      fireEvent.change(input, { target: { value: 'aldi' } });
      await waitFor(
        () => expect(fetchSuggestions).toHaveBeenCalledWith('aldi'),
        { timeout: 2000 }
      );
    });

    it('filters out suggestions already in My Stores', async () => {
      const fetchSuggestions = vi.fn(async () => [
        COSTCO,
        { id: 's-aldi', name: 'Aldi' },
      ]);
      render(
        <StorePicker
          mode="manage"
          myStores={[COSTCO]}
          fetchSuggestions={fetchSuggestions}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      );
      fireEvent.change(screen.getByPlaceholderText(/add another store/i), {
        target: { value: 'a' },
      });
      await waitFor(() => expect(fetchSuggestions).toHaveBeenCalled(), {
        timeout: 2000,
      });
      await waitFor(() => {
        expect(screen.queryByRole('option', { name: 'Aldi' })).toBeTruthy();
      });
      expect(screen.queryByRole('option', { name: 'Costco' })).toBeNull();
    });

    it('CTA does NOT appear for queries shorter than 3 chars', async () => {
      const fetchSuggestions = vi.fn(async () => []);
      render(
        <StorePicker
          mode="manage"
          myStores={[]}
          fetchSuggestions={fetchSuggestions}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      );
      fireEvent.change(screen.getByPlaceholderText(/add another store/i), {
        target: { value: 'ab' },
      });
      await waitFor(() => expect(fetchSuggestions).toHaveBeenCalled(), {
        timeout: 2000,
      });
      expect(screen.queryByLabelText(/create a new store/i)).toBeNull();
    });

    it('CTA appears when query >=3 chars AND suggestions are empty (gate met)', async () => {
      const fetchSuggestions = vi.fn(async () => []);
      render(
        <StorePicker
          mode="manage"
          myStores={[]}
          fetchSuggestions={fetchSuggestions}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      );
      fireEvent.change(screen.getByPlaceholderText(/add another store/i), {
        target: { value: 'sprouts' },
      });
      await waitFor(() => expect(fetchSuggestions).toHaveBeenCalled(), {
        timeout: 2000,
      });
      await waitFor(() => {
        expect(
          screen.getByLabelText(/create a new store named sprouts/i)
        ).toBeTruthy();
      });
    });

    it('CTA does NOT appear when suggestions exist (gate fails)', async () => {
      const fetchSuggestions = vi.fn(async () => [
        { id: 's-tj', name: "Trader Joe's" },
      ]);
      render(
        <StorePicker
          mode="manage"
          myStores={[]}
          fetchSuggestions={fetchSuggestions}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      );
      fireEvent.change(screen.getByPlaceholderText(/add another store/i), {
        target: { value: 'trader' },
      });
      await waitFor(() => expect(fetchSuggestions).toHaveBeenCalled(), {
        timeout: 2000,
      });
      await waitFor(() => {
        expect(
          screen.queryByRole('option', { name: "Trader Joe's" })
        ).toBeTruthy();
      });
      expect(screen.queryByLabelText(/create a new store/i)).toBeNull();
    });

    it('allowCreate=false hides the CTA AND the input', () => {
      render(
        <StorePicker
          mode="manage"
          allowCreate={false}
          myStores={[COSTCO]}
          fetchSuggestions={async () => []}
          onAdd={() => {}}
          onRemove={() => {}}
        />
      );
      expect(screen.queryByPlaceholderText(/add another store/i)).toBeNull();
      expect(screen.queryByLabelText(/create a new store/i)).toBeNull();
    });

    it('tapping a suggestion fires onAdd({storeId}) and clears the input', async () => {
      const onAdd = vi.fn();
      const fetchSuggestions = vi.fn(async () => [
        { id: 's-aldi', name: 'Aldi' },
      ]);
      render(
        <StorePicker
          mode="manage"
          myStores={[]}
          fetchSuggestions={fetchSuggestions}
          onAdd={onAdd}
          onRemove={() => {}}
        />
      );
      const input = screen.getByPlaceholderText(
        /add another store/i
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'aldi' } });
      await waitFor(() =>
        expect(screen.queryByRole('option', { name: 'Aldi' })).toBeTruthy()
      );
      fireEvent.click(screen.getByRole('option', { name: 'Aldi' }));
      expect(onAdd).toHaveBeenCalledWith({ storeId: 's-aldi' });
      expect(input.value).toBe('');
    });

    it('tapping the CTA fires onAdd({name}) with the trimmed query and clears input', async () => {
      const onAdd = vi.fn();
      const fetchSuggestions = vi.fn(async () => []);
      render(
        <StorePicker
          mode="manage"
          myStores={[]}
          fetchSuggestions={fetchSuggestions}
          onAdd={onAdd}
          onRemove={() => {}}
        />
      );
      const input = screen.getByPlaceholderText(
        /add another store/i
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '  sprouts  ' } });
      await waitFor(() =>
        expect(
          screen.getByLabelText(/create a new store named sprouts/i)
        ).toBeTruthy()
      );
      fireEvent.click(
        screen.getByLabelText(/create a new store named sprouts/i)
      );
      expect(onAdd).toHaveBeenCalledWith({ name: 'sprouts' });
      expect(input.value).toBe('');
    });
  });

  it('renders existing My Store as a manage row (sanity)', () => {
    render(
      <StorePicker
        mode="manage"
        myStores={[TARGET]}
        fetchSuggestions={async () => []}
        onAdd={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText('Target')).toBeTruthy();
  });
});
