import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  transpilePackages: ['@lalista/core', '@lalista/ui'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // PostHog serves script config from us-assets.i.posthog.com — the
              // us.i.posthog.com host serves capture only, not the loader config.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // connect-src: CSP treats schemes strictly — listing https://<supabase>
              // does NOT allow wss://<supabase>. Supabase Realtime requires the
              // ws/wss entry (strip http(s):// → ws(s)://). The replace handles
              // both the prod (https → wss) and local-stack (http → ws) cases;
              // missing the http→ws case silently breaks Realtime against
              // local Supabase (caught 2026-04-26 by `realtime.spec.ts`).
              // PostHog asset loads hit us-assets.i.posthog.com; capture calls
              // hit us.i.posthog.com.
              //
              // .trim() defends against whitespace-contaminated env vars on
              // deploy env vars: a trailing newline in NEXT_PUBLIC_SUPABASE_URL
              // surfaced as `%0A` in the deployed CSP header (visible in
              // production CSP 2026-04-26) AND broke SSR `/` because the
              // unsanitized URL was passed to fetch elsewhere. Symmetric
              // .trim() across all four read sites (this file +
              // lib/supabase/{server,client}.ts + middleware.ts) makes
              // future env-var fat-fingers benign at runtime.
              ((): string => {
                const supabaseUrl = (
                  process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
                ).trim();
                const supabaseWs = supabaseUrl.replace(
                  /^http(s?):\/\//,
                  'ws$1://'
                );
                return `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://*.ingest.sentry.io https://us.i.posthog.com https://us-assets.i.posthog.com`;
              })(),
              "img-src 'self' data: blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: 'lalista',
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
