// What: Sentry-capture helper for AddItemValidationError — the LLM-boundary
//       Zod failure thrown by `invokeAddItem`.
// Why: The error class lives in @lalista/core (framework-neutral), so the
//       Sentry capture has to happen on the apps/web side. Centralizing here
//       keeps the call sites small and ensures every capture scrubs and
//       truncates the raw payload identically.
// Does NOT: Render UI, decide what toast to show — call sites do that.

import * as Sentry from '@sentry/nextjs';
import { AddItemValidationError } from '@lalista/core';

/** Cap the raw-payload excerpt sent to Sentry so a runaway server response
 *  doesn't blow the event size limit or leak unbounded user content. */
const RAW_EXCERPT_MAX = 500;

/**
 * Convert the raw payload to a length-capped string. The payload originates
 * from an LLM-shaped JSON response, so user-typed `utterance` could echo back
 * inside (e.g. as `canonical_item.name`). The truncation cap is the primary
 * containment; field-specific scrubbing isn't worth the maintenance against a
 * passthrough schema where the surface keeps growing.
 */
function scrubExcerpt(raw: unknown): string {
  let text: string;
  try {
    text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  } catch {
    text = '[unserializable]';
  }
  return text.length > RAW_EXCERPT_MAX
    ? text.slice(0, RAW_EXCERPT_MAX) +
        `…(truncated ${text.length - RAW_EXCERPT_MAX} chars)`
    : text;
}

/**
 * Send an `AddItemValidationError` to Sentry with the parse issues and a
 * scrubbed excerpt of the raw payload as extras. Call sites should still
 * surface a user-facing toast — this is the observability arm only.
 */
export function reportAddItemValidationError(
  err: AddItemValidationError
): void {
  Sentry.captureException(err, {
    tags: { boundary: 'add-item', failure: 'zod-validation' },
    extra: {
      issues: err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
      raw_excerpt: scrubExcerpt(err.raw),
    },
  });
}
