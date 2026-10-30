// What: Sentry server-side initialization
// Why: Error tracking on the server — captures API route and SSR errors
// Does NOT: Run in the browser — see sentry.client.config.ts for that

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV,
});
