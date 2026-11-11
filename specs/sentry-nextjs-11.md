# Move @sentry/nextjs to 11

**Go:** "To merge all the open PRs of the Pendabot. Can you manage all of that? Answer anything that has to be done in there and get it done on a new session or multiple new sessions. Just go and open them. Don't come to me." (owner, 2026-11-10)

## Intent

The owner asked for every open Dependabot PR to be merged, and for whatever they need to be done
without coming back to them. Dependabot's #9 bumps `@sentry/nextjs` from 10.51.0 to 11.11.0, and
its `fast` job fails: Sentry 11 no longer exports `withSentryConfig` from the package root, so
`apps/web/next.config.ts` fails typecheck and `next build` throws
`(0 , _nextjs.withSentryConfig) is not a function`. This change makes that bump with the one-line
fix and supersedes #9. Nothing the app renders or reports changes.

## Decisions

- Import `withSentryConfig` from `@sentry/nextjs/config`, the subpath Sentry 11 moved it to (its
  `package.json` exports `./config` for build-time helpers); the runtime imports
  (`import * as Sentry from '@sentry/nextjs'` in the init files, `global-error.tsx`, `instrumentation.ts`
  and `reportAddItemValidationError.ts`) still resolve and typecheck unchanged (Claude, 2026-11-10).
- Our own branch instead of pushing to Dependabot's: the bump needs a code change, and a push to
  Dependabot's branch stops it from updating the PR; #9 is closed with a link here (Claude,
  2026-11-10).
- Not adopting Sentry 11's new `@sentry/nextjs/cloudflare` entry point: moving the Worker's
  instrumentation onto it changes what is reported and is its own change; logged in `FINDINGS.md`
  (Claude, 2026-11-10).

## Acceptance items

- **AC-1** `apps/web/package.json` asks for `@sentry/nextjs` `^11.11.0` and the lockfile resolves
  it — verified by review: the diff, and `pnpm install --frozen-lockfile` in CI.
- **AC-2** `apps/web/next.config.ts` imports `withSentryConfig` from `@sentry/nextjs/config`, and
  the web app typechecks and builds, both the Next build and the Worker build — verified by review:
  `fast` (typecheck, build) and `slow` (Worker build, Playwright) green; the Worker build passed
  twice from a clean `.next` locally.

## Out of scope

- Sentry's Cloudflare-specific SDK entry (`@sentry/nextjs/cloudflare`).
- Any change to sample rates, DSNs or what is captured.
