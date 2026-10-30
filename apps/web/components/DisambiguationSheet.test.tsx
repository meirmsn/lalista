// What: Behavior tests for DisambiguationSheet — radio select, confirm param mapping, already_on_list
// Why: The slot-mapping for each followup_type variant is the most bug-prone
//      piece of the add-item flow; explicit tests catch regressions
// Does NOT: Exercise the full edge function — mocked at the wrapper

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AddItemResponse } from '@lalista/core';

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

import { DisambiguationSheet } from './DisambiguationSheet';

const clientStub = { __kind: 'supabase-stub' } as never;

/**
 *
 */
function storeResponse(): AddItemResponse {
  return {
    canonical_item: { id: 'item-1', name: 'milk' },
    store: null,
    brand: null,
    needs_followup: true,
    followup_type: 'store',
    followup_question: 'Which store?',
    followup_options: [
      { id: 'store-1', label: 'Costco' },
      { id: 'store-2', label: 'Whole Foods' },
    ],
  };
}

/**
 *
 */
function itemResponse(): AddItemResponse {
  return {
    canonical_item: { id: 'item-1', name: 'milk' },
    store: null,
    brand: null,
    needs_followup: true,
    followup_type: 'item',
    followup_question: 'Which one?',
    followup_options: [
      { id: 'item-2', label: 'Mozzarella (shredded)' },
      { id: 'item-3', label: 'Mozzarella (fresh)' },
    ],
  };
}

/**
 *
 */
function brandResponse(): AddItemResponse {
  return {
    canonical_item: { id: 'item-1', name: 'milk' },
    store: { id: 'store-1', name: 'Whole Foods' },
    brand: null,
    needs_followup: true,
    followup_type: 'brand',
    followup_question: 'Which brand?',
    followup_options: [
      { id: 'b-1', label: 'Organic Valley' },
      { id: 'b-2', label: 'Horizon' },
    ],
  };
}

/**
 *
 */
function alreadyOnListResponse(): AddItemResponse {
  return {
    entry_id: 'existing-1',
    canonical_item: { id: 'item-1', name: 'milk' },
    store: { id: 'store-1', name: 'Whole Foods' },
    brand: null,
    needs_followup: true,
    followup_type: 'quantity',
    followup_question: 'Already on your list.',
    already_on_list: true,
  };
}

/**
 *
 */
function props(
  overrides: Partial<Parameters<typeof DisambiguationSheet>[0]> = {}
) {
  return {
    open: true,
    onClose: vi.fn(),
    householdId: 'house-1',
    client: clientStub,
    // Default fixture uses ITEM disambig (radio rendering); the STORE branch
    // renders <StorePicker> (pills) and is tested explicitly below.
    response: itemResponse(),
    originalUtterance: 'milk',
    onItemAdded: vi.fn(),
    onSubmissionBanner: vi.fn(),
    ...overrides,
  } as Parameters<typeof DisambiguationSheet>[0];
}

describe('<DisambiguationSheet>', () => {
  beforeEach(() => {
    invokeAddItemMock.mockReset();
    captureMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the follow-up question + a radio per option', () => {
    render(<DisambiguationSheet {...props()} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      /which one/i
    );
    // Default fixture is itemResponse — 2 item candidates + 1 "Add as new"
    // sentinel (D1 — always shown for the item disambig).
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('Confirm is disabled until a radio is selected', async () => {
    render(<DisambiguationSheet {...props()} />);
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /fresh/i }));
    expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled();
  });

  it('store variant: renders <StorePicker> instead of radios', async () => {
    // The store-followup branch now wires the my-stores picker so the user
    // can mint a custom mid-flow (D5/D10). Pills replace radios; pills are
    // <button aria-pressed=…> rather than role=radio.
    render(<DisambiguationSheet {...props({ response: storeResponse() })} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      /which store/i
    );
    // No radios — store branch uses StorePicker.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    // The picker mounts its autocomplete input (allowCreate default true).
    expect(screen.getByPlaceholderText(/add another store/i)).toBeTruthy();
  });

  it('item variant: sends the selected id as candidateItemId', async () => {
    invokeAddItemMock.mockResolvedValue({
      entry_id: 'e-1',
      canonical_item: { id: 'item-3', name: 'Mozzarella (fresh)' },
      store: { id: 'store-1', name: 'Whole Foods' },
      brand: null,
      needs_followup: false,
    });
    render(<DisambiguationSheet {...props({ response: itemResponse() })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /fresh/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(invokeAddItemMock).toHaveBeenCalled());
    const call = invokeAddItemMock.mock.calls[0]?.[1];
    expect(call.candidateItemId).toBe('item-3');
    expect(call.confirmedStoreId).toBeUndefined();
  });

  it('brand variant: sends confirmedBrand (label) + the canonical candidate item id', async () => {
    invokeAddItemMock.mockResolvedValue({
      entry_id: 'e-1',
      canonical_item: { id: 'item-1', name: 'milk' },
      store: { id: 'store-1', name: 'Whole Foods' },
      brand: 'Horizon',
      needs_followup: false,
    });
    render(<DisambiguationSheet {...props({ response: brandResponse() })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /horizon/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(invokeAddItemMock).toHaveBeenCalled());
    const call = invokeAddItemMock.mock.calls[0]?.[1];
    expect(call.confirmedBrand).toBe('Horizon');
    expect(call.candidateItemId).toBe('item-1');
    expect(call.confirmedStoreId).toBe('store-1');
  });

  it('already_on_list + quantity: OK button acknowledges without re-calling invokeAddItem', async () => {
    const response = alreadyOnListResponse();
    const p = props({ response });
    render(<DisambiguationSheet {...p} />);
    const user = userEvent.setup();
    const ok = screen.getByRole('button', { name: /^ok$/i });
    expect(ok).toBeEnabled();
    await user.click(ok);

    expect(invokeAddItemMock).not.toHaveBeenCalled();
    expect(p.onItemAdded).toHaveBeenCalledWith(response);
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('fires trackItemAdded with was_disambiguated: true after a successful confirm', async () => {
    invokeAddItemMock.mockResolvedValue({
      entry_id: 'e-1',
      canonical_item: { id: 'item-3', name: 'Mozzarella (fresh)' },
      store: { id: 'store-1', name: 'Costco' },
      brand: null,
      needs_followup: false,
    });
    render(<DisambiguationSheet {...props()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /fresh/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() =>
      expect(captureMock).toHaveBeenCalledWith('item_added', {
        store_id: 'store-1',
        was_disambiguated: true,
        input_language: 'en',
      })
    );
  });

  it('cascading follow-up: stays open and delegates the new response to onItemAdded without closing', async () => {
    // Regression: PR 3 shipped with this path silently closing the sheet and
    // dropping the cascading round, producing "picked, nothing in list" UX.
    // The default fixture is now itemResponse() (mozzarella shredded/fresh)
    // and the cascading mock returns ANOTHER item disambig — same shape, so
    // the test exercises the "stays-open" regression without touching the
    // store-branch StorePicker rendering path.
    invokeAddItemMock.mockResolvedValue({
      entry_id: null,
      canonical_item: { id: 'item-1', name: 'mozzarella' },
      store: null,
      brand: null,
      needs_followup: true,
      followup_type: 'item',
      followup_options: [
        { id: 'item-x', label: 'Mozzarella (fresh)' },
        { id: 'item-y', label: 'Mozzarella (shredded)' },
      ],
      followup_question: 'Which one?',
    });
    const p = props();
    render(<DisambiguationSheet {...p} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /fresh/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    // Parent receives the cascading response so it can swap `response` in
    // place on the still-mounted sheet — onClose must NOT fire.
    await waitFor(() =>
      expect(p.onItemAdded).toHaveBeenCalledWith(
        expect.objectContaining({ needs_followup: true })
      )
    );
    expect(p.onClose).not.toHaveBeenCalled();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^confirm$/i })
    ).toBeInTheDocument();
  });

  it('keeps the sheet open on a network error (Tier A2 retries silently)', async () => {
    invokeAddItemMock.mockRejectedValue(new Error('boom'));
    const p = props();
    render(<DisambiguationSheet {...p} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /fresh/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    // First attempt rejected, hook scheduled a retry — sheet stays open,
    // onClose hasn't fired. Hard-failure escalation runs through the
    // upstream useOptimisticMutation tests and the add-item-banner E2E.
    await waitFor(() => expect(invokeAddItemMock).toHaveBeenCalledTimes(1));
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onItemAdded).not.toHaveBeenCalled();
  });

  describe('auto-close on banner escalation (PR #49 parity)', () => {
    // Fake timers are scoped to this nested describe block — other tests
    // in this file rely on real timers + RTL waitFor, so we must not leak
    // fake timers into them. See useOptimisticMutation.test.ts § "banner
    // mode (Tier A2)" for the canonical fake-timer + act() pattern this
    // test mirrors.
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('auto-closes the sheet when the retry budget exhausts and the banner escalates (parity with AddItemSheet PR #49)', async () => {
      // Every attempt rejects — drives the [1s, 3s, 7s] backoff to exhaustion.
      invokeAddItemMock.mockRejectedValue(new Error('boom'));
      const p = props();
      render(<DisambiguationSheet {...p} />);
      // fireEvent (not userEvent) — userEvent's async event scheduling
      // deadlocks against vi.useFakeTimers(). The canonical fake-timer
      // pattern in this repo (see AwaitingConfirmationCard.test.tsx,
      // ConfirmationToast.test.tsx) uses fireEvent for the same reason.
      // Default fixture is itemResponse() — pick the Mozzarella (fresh) radio.
      fireEvent.click(screen.getByRole('radio', { name: /fresh/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

      // First attempt fires synchronously (no setTimeout before attempt 1);
      // flush microtasks so the rejected promise settles and the hook
      // schedules retry #2.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(invokeAddItemMock).toHaveBeenCalledTimes(1);
      expect(p.onClose).not.toHaveBeenCalled();

      // Drive the [1s, 3s, 7s] backoff to exhaustion (matches RETRY_BACKOFF_MS
      // in packages/ui/src/tokens.ts; sum = 11s, well under RETRY_BUDGET_MS
      // = 15s). After the 4th attempt rejects, submission.banner becomes
      // non-null and the new auto-close effect calls onClose().
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000);
      });

      expect(invokeAddItemMock).toHaveBeenCalledTimes(4);
      // Banner-hoist effect fires before the auto-close effect (source-order
      // load-bearing — see DisambiguationSheet.tsx comment + spec § Gotchas),
      // so the parent's banner slot survives the sheet's unmount.
      expect(p.onSubmissionBanner).toHaveBeenCalled();
      const lastBannerCall = (
        p.onSubmissionBanner as ReturnType<typeof vi.fn>
      ).mock.calls.at(-1);
      expect(lastBannerCall?.[0]).not.toBeNull();
      expect(p.onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('Escape key calls onClose', async () => {
    const p = props();
    render(<DisambiguationSheet {...p} />);
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when response is null', () => {
    const { container } = render(
      <DisambiguationSheet {...props({ response: null })} />
    );
    expect(container.firstChild).toBeNull();
  });

  describe('"Add as new" escape hatch', () => {
    it('renders the add-new row at the bottom with the utterance text', () => {
      render(
        <DisambiguationSheet
          {...props({ response: itemResponse(), originalUtterance: 'papas' })}
        />
      );
      const radios = screen.getAllByRole('radio');
      // 2 server candidates + 1 add-new sentinel row.
      expect(radios).toHaveLength(3);
      const lastName = radios[radios.length - 1]?.textContent ?? '';
      expect(lastName.toLowerCase()).toContain('papas');
      expect(lastName.toLowerCase()).toContain('add');
      expect(lastName.toLowerCase()).toContain('new');
    });

    it('selecting + confirming calls invokeAddItem with forceCreateWithLabel: true and NO candidateItemId', async () => {
      invokeAddItemMock.mockResolvedValue({
        entry_id: 'e-1',
        canonical_item: { id: 'i-99', name: 'papas' },
        store: { id: 'store-1', name: 'Costco' },
        brand: null,
        needs_followup: false,
        added_new: true,
      });
      const p = props({
        response: itemResponse(),
        originalUtterance: 'papas',
      });
      render(<DisambiguationSheet {...p} />);
      const user = userEvent.setup();

      await user.click(
        screen.getByRole('radio', { name: /add .*papas.* new/i })
      );
      await user.click(screen.getByRole('button', { name: /confirm/i }));

      await waitFor(() => expect(invokeAddItemMock).toHaveBeenCalledTimes(1));
      const call = invokeAddItemMock.mock.calls[0]?.[1];
      expect(call).toEqual({
        utterance: 'papas',
        householdId: 'house-1',
        forceCreateWithLabel: true,
      });
      // Slot-mapping must be skipped — none of the existing slot params present.
      expect(call.candidateItemId).toBeUndefined();
      expect(call.confirmedStoreId).toBeUndefined();
      expect(call.confirmedBrand).toBeUndefined();
    });

    it('success response closes the sheet and fires item_added with was_force_created: true', async () => {
      invokeAddItemMock.mockResolvedValue({
        entry_id: 'e-1',
        canonical_item: { id: 'i-99', name: 'papas' },
        store: { id: 'store-1', name: 'Costco' },
        brand: null,
        needs_followup: false,
        added_new: true,
      });
      const p = props({
        response: itemResponse(),
        originalUtterance: 'papas',
      });
      render(<DisambiguationSheet {...p} />);
      const user = userEvent.setup();

      await user.click(
        screen.getByRole('radio', { name: /add .*papas.* new/i })
      );
      await user.click(screen.getByRole('button', { name: /confirm/i }));

      await waitFor(() =>
        expect(captureMock).toHaveBeenCalledWith('item_added', {
          store_id: 'store-1',
          was_disambiguated: true,
          was_force_created: true,
          input_language: 'en',
        })
      );
      expect(p.onClose).toHaveBeenCalledTimes(1);
    });

    it('the add-new row participates in radio-group keyboard nav (matches candidate-row tabIndex/role)', () => {
      // Click-only radios today — arrow-key navigation is not wired. Assert
      // the role/aria-checked shape matches the candidate radios so a future
      // keyboard wiring won't accidentally exclude this row.
      render(
        <DisambiguationSheet
          {...props({ response: itemResponse(), originalUtterance: 'papas' })}
        />
      );
      const radios = screen.getAllByRole('radio');
      const last = radios[radios.length - 1]!;
      const first = radios[0]!;
      expect(last.tagName).toBe(first.tagName);
      expect(last.getAttribute('role')).toBe(first.getAttribute('role'));
      expect(last.getAttribute('aria-checked')).toBe(
        first.getAttribute('aria-checked')
      );
    });

    it('does NOT render when one candidate matches the utterance exactly (case-insensitive)', () => {
      // The user typed "Mozzarella (shredded)" — already in candidates.
      // Force-create would just hit the name_canonical UNIQUE constraint
      // and fall through to that same row, so the add-new label misleads.
      render(
        <DisambiguationSheet
          {...props({
            response: itemResponse(),
            originalUtterance: 'Mozzarella (shredded)',
          })}
        />
      );
      // 2 server candidates, 0 add-new row.
      expect(screen.getAllByRole('radio')).toHaveLength(2);
      expect(
        screen.queryByRole('radio', { name: /add .*mozzarella.* new/i })
      ).toBeNull();

      // Case-insensitivity: lowercase utterance still suppresses.
      const { rerender } = render(
        <DisambiguationSheet
          {...props({
            response: itemResponse(),
            originalUtterance: 'mozzarella (shredded)',
          })}
        />
      );
      expect(
        screen.queryAllByRole('radio', { name: /add .*new/i })
      ).toHaveLength(0);

      // Trim handling: leading/trailing whitespace doesn't defeat suppression.
      rerender(
        <DisambiguationSheet
          {...props({
            response: itemResponse(),
            originalUtterance: '  Mozzarella (shredded)  ',
          })}
        />
      );
      expect(
        screen.queryAllByRole('radio', { name: /add .*new/i })
      ).toHaveLength(0);
    });

    it('does NOT render in cascading store / brand / quantity follow-ups (only in the item follow-up)', () => {
      // store follow-up: 2 store options, no add-new row.
      const { rerender } = render(
        <DisambiguationSheet
          {...props({ response: storeResponse(), originalUtterance: 'papas' })}
        />
      );
      expect(
        screen.queryByRole('radio', { name: /add .*papas.* new/i })
      ).toBeNull();

      // brand follow-up: same — no add-new row.
      rerender(
        <DisambiguationSheet
          {...props({ response: brandResponse(), originalUtterance: 'papas' })}
        />
      );
      expect(
        screen.queryByRole('radio', { name: /add .*papas.* new/i })
      ).toBeNull();
    });
  });
});
