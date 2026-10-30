// What: Unit tests for the add-item edge function wrapper
// Why: Confirm both resolved-add and disambiguation responses surface correctly,
//      and the runtime Zod gate at the LLM boundary fails closed on shape drift
//      while passing forward-compat unknown fields through.
// Does NOT: Test the edge function itself — that's a separate integration test.

import { describe, it, expect, vi } from 'vitest';
import { invokeAddItem } from './addItem';
import { AddItemValidationError } from '../errors';

/**
 *
 */
function client(result: { data: unknown; error: unknown }) {
  return {
    functions: { invoke: vi.fn().mockResolvedValue(result) },
  };
}

describe('invokeAddItem', () => {
  it('returns a resolved-add response when the server completes the add', async () => {
    const response = {
      entry_id: 'entry-1',
      canonical_item: { id: 'item-1', name: 'leche' },
      store: { id: 'store-1', name: 'Whole Foods' },
      brand: null,
      needs_followup: false,
    };
    const c = client({ data: response, error: null });

    const result = await invokeAddItem(c as never, {
      utterance: 'leche',
      householdId: 'house-1',
    });

    expect(c.functions.invoke).toHaveBeenCalledWith('add-item', {
      body: {
        utterance: 'leche',
        household_id: 'house-1',
        candidate_item_id: undefined,
        confirmed_store_id: undefined,
        confirmed_brand: undefined,
        force_create_with_label: undefined,
      },
    });
    expect(result).toEqual(response);
  });

  it('returns a disambiguation response when the server asks for a follow-up', async () => {
    const response = {
      canonical_item: { id: 'item-1', name: 'leche' },
      store: null,
      brand: null,
      needs_followup: true,
      followup_type: 'item',
      followup_question: 'Which one?',
      followup_options: [
        { id: 'item-2', label: 'leche entera' },
        { id: 'item-3', label: 'leche de almendras' },
      ],
    };
    const c = client({ data: response, error: null });

    const result = await invokeAddItem(c as never, {
      utterance: 'leche',
      householdId: 'house-1',
    });

    expect(result.needs_followup).toBe(true);
    expect(result.followup_options).toHaveLength(2);
  });

  it('forwards disambiguation follow-up params', async () => {
    const c = client({
      data: {
        canonical_item: null,
        store: null,
        brand: null,
        needs_followup: false,
      },
      error: null,
    });

    await invokeAddItem(c as never, {
      utterance: 'leche',
      householdId: 'house-1',
      candidateItemId: 'item-2',
      confirmedStoreId: 'store-1',
      confirmedBrand: 'Horizon',
    });

    expect(c.functions.invoke).toHaveBeenCalledWith('add-item', {
      body: {
        utterance: 'leche',
        household_id: 'house-1',
        candidate_item_id: 'item-2',
        confirmed_store_id: 'store-1',
        confirmed_brand: 'Horizon',
        force_create_with_label: undefined,
      },
    });
  });

  it('forwards forceCreateWithLabel as force_create_with_label', async () => {
    const c = client({
      data: {
        entry_id: 'e-9',
        canonical_item: { id: 'item-9', name: 'papas' },
        store: { id: 'store-1', name: 'Costco' },
        brand: null,
        needs_followup: false,
        added_new: true,
      },
      error: null,
    });

    await invokeAddItem(c as never, {
      utterance: 'papas',
      householdId: 'house-1',
      forceCreateWithLabel: true,
    });

    expect(c.functions.invoke).toHaveBeenCalledWith('add-item', {
      body: {
        utterance: 'papas',
        household_id: 'house-1',
        candidate_item_id: undefined,
        confirmed_store_id: undefined,
        confirmed_brand: undefined,
        force_create_with_label: true,
      },
    });
  });

  it('throws when the edge function errors', async () => {
    const c = client({
      data: null,
      error: { message: 'Unauthorized' },
    });

    await expect(
      invokeAddItem(c as never, { utterance: 'x', householdId: 'h' })
    ).rejects.toMatchObject({ message: 'Unauthorized' });
  });

  it('throws when the edge function returns no data', async () => {
    const c = client({ data: null, error: null });

    await expect(
      invokeAddItem(c as never, { utterance: 'x', householdId: 'h' })
    ).rejects.toThrow(/empty response/);
  });

  // The edge function sets store_confidence on history-routed successes so
  // the client can emit the `store_routed` PostHog event with a real score.
  it('surfaces store_confidence when the server provides it', async () => {
    const response = {
      entry_id: 'entry-1',
      canonical_item: { id: 'item-1', name: 'leche' },
      store: { id: 'store-1', name: 'Whole Foods' },
      brand: null,
      needs_followup: false,
      store_confidence: 0.82,
    };
    const c = client({ data: response, error: null });

    const result = await invokeAddItem(c as never, {
      utterance: 'leche',
      householdId: 'house-1',
    });

    expect(result.store_confidence).toBe(0.82);
  });

  // Runtime-shape boundary tests — the failure mode this wrapper now guards
  // against. Each test exercises a class of LLM-shape drift: missing required
  // field, wrong type on a required field, and forward-compat passthrough.

  it('throws AddItemValidationError when needs_followup is missing', async () => {
    // Required field gone — historically would slip through `invoke<T>` and
    // crash some downstream `if (response.needs_followup)` branch.
    const response = {
      canonical_item: { id: 'item-1', name: 'leche' },
      store: null,
      brand: null,
    };
    const c = client({ data: response, error: null });

    await expect(
      invokeAddItem(c as never, { utterance: 'leche', householdId: 'house-1' })
    ).rejects.toBeInstanceOf(AddItemValidationError);
  });

  it('attaches issues with a readable path on validation failure', async () => {
    // Wrong type on a required nested field. The path field on the issue must
    // point at the actual problem so Sentry triage can route to the right
    // server-side commit.
    const response = {
      canonical_item: { id: 42, name: 'leche' }, // id should be string
      store: null,
      brand: null,
      needs_followup: false,
    };
    const c = client({ data: response, error: null });

    try {
      await invokeAddItem(c as never, { utterance: 'leche', householdId: 'h' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AddItemValidationError);
      const err = e as AddItemValidationError;
      expect(err.issues.length).toBeGreaterThan(0);
      const first = err.issues[0]!;
      expect(first.path.join('.')).toContain('canonical_item.id');
      expect(err.raw).toEqual(response); // raw payload preserved for Sentry scrubbing at the call site
    }
  });

  it('passes through unknown forward-compat fields without throwing', async () => {
    // .passthrough() on the schema means the server can add fields ahead of
    // the client (e.g. PR 7's `entries[]`) without crashing older clients.
    // Unknown fields are NOT exposed on the typed result (TS can't see them)
    // but they don't fail the parse.
    const response = {
      entry_id: 'entry-1',
      canonical_item: { id: 'item-1', name: 'leche' },
      store: { id: 'store-1', name: 'Whole Foods' },
      brand: null,
      needs_followup: false,
      future_field_added_by_pr_7: 'compound-add-token',
      another_unknown: { nested: 'value' },
    };
    const c = client({ data: response, error: null });

    const result = await invokeAddItem(c as never, {
      utterance: 'leche',
      householdId: 'house-1',
    });

    // Existing typed fields survive intact.
    expect(result.entry_id).toBe('entry-1');
    expect(result.canonical_item).toEqual({ id: 'item-1', name: 'leche' });
    // The unknown field rides through on the result object so a later client
    // upgrade can read it without a re-parse.
    expect((result as Record<string, unknown>).future_field_added_by_pr_7).toBe(
      'compound-add-token'
    );
  });
});
