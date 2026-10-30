// What: Next.js instrumentation hook for Sentry
// Why: Initializes Sentry on server startup (App Router requirement)
// Does NOT: Initialize client-side Sentry — that's sentry.client.config.ts

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.server.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
