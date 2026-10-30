// What: Behavior tests for AddItemSheet — disabled state, happy path, disambig branch, errors
// Why: AddItemSheet is the primary entry point for the user's core action; a
//      regression here silently breaks list growth
// Does NOT: Render the list or actually hit the edge function — mocked at the wrapper

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { invokeAddItemMock, captureMock } = vi.hoisted(() => ({
  invokeAddItemMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock('@lalista/core', async () => {
  const actual =
    await vi.importActual<typeof import('@lalista/core')>('@lalista/core');
  return {
    ...actual,
    invokeAddItem: invokeAddItemMock,
  };
});

vi.mock('posthog-js', () => ({
  default: { capture: captureMock },
}));

import { AddItemSheet } from './AddItemSheet';

const clientStub = { __kind: 'supabase-stub' } as never;

/** Default props — harness tests override what they need. */
function props(overrides: Partial<Parameters<typeof AddItemSheet>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    householdId: 'house-1',
    client: clientStub,
    onDisambiguationNeeded: vi.fn(),
    onItemAdded: vi.fn(),
    onSubmissionBanner: vi.fn(),
    ...overrides,
  } as Parameters<typeof AddItemSheet>[0];
}

describe('<AddItemSheet>', () => {
  beforeEach(() => {
    invokeAddItemMock.mockReset();
    captureMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<AddItemSheet {...props({ open: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a dialog with the Add button disabled when the input is empty', () => {
    render(<AddItemSheet {...props()} />);
    const dialog = screen.getByRole('dialog', { name: /add to lalista/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
  });

  it('enables the Add button when the input has content', async () => {
    render(<AddItemSheet {...props()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/item to add/i), 'milk');
    expect(screen.getByRole('button', { name: /^add$/i })).toBeEnabled();
  });

  it('happy path: calls onItemAdded + trackItemAdded + trackStoreRouted + closes', async () => {
    invokeAddItemMock.mockResolvedValue({
      entry_id: 'entry-1',
      canonical_item: { id: 'item-1', name: 'milk' },
      store: { id: 'store-1', name: 'Whole Foods' },
      brand: null,
      needs_followup: false,
      store_confidence: 0.82,
    });
    const p = props();
    render(<AddItemSheet {...p} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/item to add/i), 'milk');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(invokeAddItemMock).toHaveBeenCalledTimes(1));
    expect(invokeAddItemMock).toHaveBeenCalledWith(clientStub, {
      utterance: 'milk',
      householdId: 'house-1',
    });

    expect(captureMock).toHaveBeenCalledWith('store_routed', {
      store_name: 'Whole Foods',
      confidence_score: 0.82,
    });
    expect(captureMock).toHaveBeenCalledWith('item_added', {
      store_id: 'store-1',
      was_disambiguated: false,
      input_language: 'en',
    });

    expect(p.onItemAdded).toHaveBeenCalledTimes(1);
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('Spanish input fires item_added with input_language="es"', async () => {
    invokeAddItemMock.mockResolvedValue({
      entry_id: 'entry-1',
      canonical_item: { id: 'item-1', name: 'leche' },
      store: { id: 'store-1', name: 'H-E-B' },
      brand: null,
      needs_followup: false,
    });
    render(<AddItemSheet {...props()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/item to add/i), 'leche');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(invokeAddItemMock).toHaveBeenCalled());
    expect(captureMock).toHaveBeenCalledWith('item_added', {
      store_id: 'store-1',
      was_disambiguated: false,
      input_language: 'es',
    });
  });

  it('disambiguation branch: calls onDisambiguationNeeded + tracks disambiguation_shown + closes', async () => {
    const response = {
      canonical_item: { id: 'item-1', name: 'leche' },
      store: null,
      brand: null,
      needs_followup: true,
      followup_type: 'item' as const,
      followup_question: 'Which one?',
      followup_options: [
        { id: 'a', label: 'Leche entera' },
        { id: 'b', label: 'Leche descremada' },
      ],
    };
    invokeAddItemMock.mockResolvedValue(response);
    const p = props();
    render(<AddItemSheet {...p} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/item to add/i), 'leche');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(p.onDisambiguationNeeded).toHaveBeenCalledWith(response, 'leche')
    );
    expect(captureMock).toHaveBeenCalledWith('disambiguation_shown', {
      candidate_count: 2,
      followup_type: 'item',
    });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onItemAdded).not.toHaveBeenCalled();
  });

  it('network error keeps the sheet open through the first attempt (Tier A2 retries silently before banner)', async () => {
    invokeAddItemMock.mockRejectedValue(new Error('fetch failed'));
    const p = props();
    render(<AddItemSheet {...p} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/item to add/i), 'milk');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    // First attempt rejected; the hook scheduled retries against the
    // [1s, 3s, 7s] backoff. Sheet is still open at this checkpoint —
    // banner hasn't appeared yet. After the retry budget exhausts the
    // sheet auto-closes (so the banner's Retry / Undo aren't blocked by
    // the sheet's backdrop overlay) — that escalation path is covered
    // by useOptimisticMutation tests + the add-item-banner E2E spec.
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onItemAdded).not.toHaveBeenCalled();
    // First attempt fired
    await waitFor(() => expect(invokeAddItemMock).toHaveBeenCalledTimes(1));
  });

  it('Escape key calls onClose', async () => {
    const p = props();
    render(<AddItemSheet {...p} />);
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('submits empty-string add as a no-op (disabled button)', async () => {
    render(<AddItemSheet {...props()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(invokeAddItemMock).not.toHaveBeenCalled();
  });
});
