// What: Verify the Sentry-capture helper's tag/extra shape for the LLM-boundary
//       Zod failure path.
// Why: PR 6's manual test plan asks for "Sentry event has tags { boundary:
//      'add-item', failure: 'zod-validation' } and extra.issues[0].path =
//      'needs_followup' on a deliberately stubbed bad response." Driving that
//      through a real browser is awkward (requires monkey-patching
//      client.functions.invoke at runtime). This test substitutes for that
//      manual step by verifying the helper's shape directly — pairs with the
//      core-package tests that prove invokeAddItem actually throws the typed
//      error.
// Does NOT: Boot Sentry's transport, hit the network, or test the wrapper's
//      throw path (that's @lalista/core's addItem.test.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddItemValidationError } from '@lalista/core';

// Test fixture builder — Zod's ZodIssue is a discriminated union with strict
// literal-type constraints. Synthesizing one for a shape test doesn't need
// that strictness; cast at the boundary so the rest of the test reads cleanly.
// Avoids pulling zod into apps/web's dependencies — the type lives in
// @lalista/core and we don't need it at runtime here.
type SyntheticIssue = {
  code: string;
  path: (string | number)[];
  message: string;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const issue = (i: SyntheticIssue): any => i;

const captureExceptionMock = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { reportAddItemValidationError } from './reportAddItemValidationError';

describe('reportAddItemValidationError', () => {
  beforeEach(() => {
    captureExceptionMock.mockReset();
  });

  it('captures with the expected tags and issue list', () => {
    const raw = {
      canonical_item: { id: 42, name: 'leche' },
      store: null,
      brand: null,
    };
    const issues = [
      issue({
        code: 'invalid_type',
        path: ['canonical_item', 'id'],
        message: 'Expected string, received number',
      }),
    ];
    const err = new AddItemValidationError(raw, issues);

    reportAddItemValidationError(err);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [capturedErr, ctx] = captureExceptionMock.mock.calls[0]!;
    expect(capturedErr).toBe(err);
    expect(ctx.tags).toEqual({
      boundary: 'add-item',
      failure: 'zod-validation',
    });
    expect(ctx.extra.issues).toEqual([
      {
        path: 'canonical_item.id',
        message: 'Expected string, received number',
        code: 'invalid_type',
      },
    ]);
  });

  it('truncates a long raw payload to ~500 chars', () => {
    const longString = 'x'.repeat(10_000);
    const err = new AddItemValidationError(
      { canonical_item: { id: longString, name: 'leche' } },
      [
        issue({
          code: 'invalid_type',
          path: ['canonical_item', 'id'],
          message: 'too long',
        }),
      ]
    );

    reportAddItemValidationError(err);

    const [, ctx] = captureExceptionMock.mock.calls[0]!;
    const excerpt = ctx.extra.raw_excerpt as string;
    // Cap is 500 chars + truncation suffix.
    expect(excerpt.length).toBeLessThan(600);
    expect(excerpt).toContain('truncated');
  });

  it('joins multi-segment paths with a dot for grep-friendly Sentry rows', () => {
    const err = new AddItemValidationError({ needs_followup: 'not-a-bool' }, [
      issue({
        code: 'invalid_type',
        path: ['needs_followup'],
        message: 'Expected boolean, received string',
      }),
    ]);

    reportAddItemValidationError(err);

    const [, ctx] = captureExceptionMock.mock.calls[0]!;
    expect(ctx.extra.issues[0]).toEqual({
      path: 'needs_followup',
      message: 'Expected boolean, received string',
      code: 'invalid_type',
    });
  });
});
