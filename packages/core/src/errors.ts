// What: Typed error classes for boundaries that need runtime guards beyond
//       what TypeScript can prove.
// Why: When `invokeAddItem`'s response fails Zod validation, throwing a typed
//      error class lets the calling app distinguish "the LLM-shape boundary
//      drifted" from a network error or auth error and route observability +
//      user-facing copy accordingly.
// Does NOT: Wrap every API failure mode — generic Supabase / network errors
//      stay as the SDK's own error shape.

import type { ZodIssue } from 'zod';

/**
 * Thrown when the add-item edge function's response fails the runtime Zod
 * schema in `schemas/addItem.ts`. The raw payload is attached for the app's
 * Sentry handler to scrub and report; `issues` lists the zod parse errors.
 */
export class AddItemValidationError extends Error {
  readonly issues: ZodIssue[];
  readonly raw: unknown;

  constructor(raw: unknown, issues: ZodIssue[]) {
    super(
      `add-item response failed runtime validation (${issues.length} issue${issues.length === 1 ? '' : 's'})`
    );
    this.name = 'AddItemValidationError';
    this.issues = issues;
    this.raw = raw;
  }
}
