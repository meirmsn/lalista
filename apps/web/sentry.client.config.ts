// What: Sentry client-side initialization
// Why: Error tracking in the browser — captures unhandled errors and performance
// Does NOT: Run on the server — see sentry.server.config.ts for that

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
});
