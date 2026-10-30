// What: App Router error boundary — catches rendering errors
// Why: Reports errors to Sentry and shows a fallback UI
// Does NOT: Handle API route errors — those are caught by instrumentation.ts

'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            gap: '16px',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h2>Something went wrong</h2>
          <button onClick={() => reset()}>Try again</button>
        </div>
      </body>
    </html>
  );
}
