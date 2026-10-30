# Auth-UX Polish — Follow-up Test Review

Fresh-eyes audit of the polish commits added to PR #43 since the original
pre-ship `/ak-test-review` ran on `80485cb`. Range: `80485cb..e707a0f`
(branch `feat/auth-ux-rework`).

The original audit was clean on `80485cb`. The user flagged that the
`AwaitingConfirmationCard` back-link shipped without a paired test in commit
`79b0a9c` and the test landed two commits later in `e707a0f`. This audit
re-reads every changed test file alongside the source it covers, with no
implementation context.

## Source-to-test pairing (audited in this pass)

| Source                                              | Tests                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/web/app/(auth)/layout.tsx`                    | (none — pure layout chrome)                                                                  |
| `apps/web/app/(auth)/sign-in/page.tsx`              | `sign-in/page.test.tsx`; E2E `auth-edge-cases.spec.ts`                                       |
| `apps/web/app/(auth)/sign-up/page.tsx`              | `sign-up/page.test.tsx`; E2E `sign-up.spec.ts`, `auth.spec.ts`, `auth-edge-cases.spec.ts`    |
| `apps/web/app/(auth)/forgot-password/page.tsx`      | `forgot-password/page.test.tsx`; E2E `forgot-password.spec.ts`                               |
| `apps/web/app/(auth)/reset-password/page.tsx`       | `reset-password/page.test.tsx`; E2E `forgot-password.spec.ts`                                |
| `apps/web/app/(auth)/onboarding/OnboardingForm.tsx` | `onboarding/page.test.tsx`; E2E `auth.spec.ts`, `sign-up.spec.ts`                            |
| `apps/web/app/auth/callback/route.ts`               | `auth/callback/route.test.ts`; E2E `forgot-password.spec.ts`                                 |
| `apps/web/components/AwaitingConfirmationCard.tsx`  | `AwaitingConfirmationCard.test.tsx`; flow-level `sign-up/page.test.tsx`                      |
| `apps/web/components/AuthSubmitButton.tsx`          | `AuthSubmitButton.test.tsx`                                                                  |
| `apps/web/components/AuthErrorDisplay.tsx`          | `AuthErrorDisplay.test.tsx`                                                                  |
| `apps/web/components/auth/friendlyAuthError.ts`     | `friendlyAuthError.test.ts` (note: `isInvalidCredentialsError` predicate covered indirectly) |
| `apps/web/components/auth/useResendCountdown.ts`    | `useResendCountdown.test.ts`                                                                 |
| `apps/web/app/(auth)/_email-context.tsx`            | `_email-context.test.tsx`                                                                    |

## Findings

### High-severity

**None.**

The user-flagged gap that triggered this review (`AwaitingConfirmationCard`
back-link shipped in `79b0a9c` without a paired test) was closed by `e707a0f`
adding the "Edit and try again" flow test at `sign-up/page.test.tsx:188–220`,
which clicks the back-link and asserts (a) form re-renders, (b) heading
swaps, (c) email persists across the round-trip via context. That is the
load-bearing assertion — pinning user-observable behavior rather than just
"renders without crashing."

### Medium-severity

- **`AwaitingConfirmationCard.test.tsx` does not cover the new `onEdit` prop**
  _file:_ `apps/web/components/AwaitingConfirmationCard.test.tsx`
  _severity:_ medium
  _what's missing:_ The component-level test file has zero tests for the
  `onEdit?` callback that was added in commit `79b0a9c` + `c6e6fc3`. There
  is no assertion that (a) the "Edit and try again" UI is hidden when
  `onEdit` is omitted, (b) the click fires the callback when present, (c)
  the rendered button has the right copy. Coverage exists at the parent
  level (`sign-up/page.test.tsx:188–220`) but the component test file is
  the natural home for "this prop's contract works." If a future caller
  imports this card with no `onEdit`, the conditional silently changes
  shape and only the parent flow test catches drift.

  _what to do:_ Add two tests to `AwaitingConfirmationCard.test.tsx`:
  (1) renders without the back-link when `onEdit` is undefined;
  (2) renders the "Edit and try again" button when `onEdit` is provided
  and clicking it invokes the callback exactly once. ~10 lines of test
  code; mirrors the existing `replaceMock` callback pattern at lines
  117–128.

### Low-severity

- **`isInvalidCredentialsError` predicate has no direct unit test**
  _file:_ `apps/web/components/auth/friendlyAuthError.test.ts`
  _severity:_ low
  _what's missing:_ The predicate exported alongside `friendlyAuthError`
  has no own assertion in the file. It's covered indirectly by sign-in
  page tests (`sign-in/page.test.tsx:150–184` exercise the
  hint-shown-on-invalid-credentials and hint-not-shown-on-other-errors
  branches). Both tests pass through the `isInvalidCredentialsError` regex,
  so a regex-shape regression would be caught — but the contract pin lives
  at the page level, not the helper level.

- **`AwaitingConfirmationCard` unsubscribe-on-unmount contract not pinned**
  _file:_ `apps/web/components/AwaitingConfirmationCard.test.tsx`
  _severity:_ low
  _what's missing:_ The `useEffect` at `AwaitingConfirmationCard.tsx:50–58`
  returns a cleanup that calls `subscription.unsubscribe()`. The test
  setup mocks `onAuthStateChange` to return `{ unsubscribe: vi.fn() }`
  but never asserts the unsubscribe call after `unmount()`. A regression
  that drops the cleanup would leak listeners across mount/unmount cycles
  with no test signal. Low severity because the behavior is structural
  (the `return () => subscription.unsubscribe()` is hard to typo
  silently), but worth pinning given the resend-countdown hook does have
  a similar lifecycle test.

- **`/(auth)/layout.tsx` home-link wordmark has no test**
  _file:_ `apps/web/app/(auth)/layout.tsx` (no test file)
  _severity:_ low
  _what's missing:_ The wordmark `<Link href="/" aria-label="Back to
lalista landing">` was added/iterated three times across commits
  `41ebe3a`, `529c4d0`, `e707a0f`. No unit test renders the layout (page
  tests bypass the layout by wrapping the page directly in
  `<AuthEmailProvider>`), and no E2E clicks the wordmark to verify it
  navigates to `/`. Low severity because a `<Link href="/">` is hard to
  break. But three iterations is enough churn that a click-and-assert
  smoke is cheap insurance.

- **Reset-password / sign-up password-length boundary not pinned at 7-vs-8 chars**
  _files:_ `apps/web/app/(auth)/sign-up/page.test.tsx:244–254`,
  `apps/web/app/(auth)/reset-password/page.test.tsx:96–106`
  _severity:_ low
  _what's missing:_ Both tests use `'short'` (5 chars) for the
  blocked-input case and a longer string for the success case. The
  boundary (exactly 7 chars blocked, exactly 8 chars allowed) is not
  asserted. A drift to `> 8` or `>= 7` would not flip either test. Low
  because the constant `MIN_PASSWORD_LENGTH = 8` is shared with the
  friendly-error copy "at least 8 characters" — a single source of truth
  reduces drift risk.

- **No E2E click on the `/sign-in` "create an account" hint link**
  _file:_ `apps/web/e2e/auth-edge-cases.spec.ts` (or a new spec)
  _severity:_ low
  _what's missing:_ The hint link ("Trying to create an account
  instead?") added in commit `41ebe3a` is asserted in unit tests at
  `sign-in/page.test.tsx:150–168` (href value pinned). No E2E follows
  the click. Low because the unit test pins the href and the
  `/sign-up` destination is exercised independently.

- **No E2E click on the `AwaitingConfirmationCard` "Edit and try again" back-link**
  _file:_ `apps/web/e2e/sign-up.spec.ts`
  _severity:_ low
  _what's missing:_ The unit test pinning the back-link flow is solid
  (`sign-up/page.test.tsx:188–220`). No E2E exercises this on a real
  browser. The `AwaitingConfirmationCard` is only reachable in
  `sign-up.spec.ts`'s path (b) (confirmations enabled) — local default
  config takes path (a), so this is hard to exercise without explicitly
  flipping `enable_confirmations`. Acceptable to lean on unit coverage
  here.

### Confirmed clean (no action)

- **Mocks are appropriately seamed.** No tests stub the formatter +
  click handler + the network call simultaneously; mocks live at
  `signInWithPassword` / `signUpWithPassword` / `resetPasswordForEmail` /
  `auth.updateUser` / `auth.resend` / `onAuthStateChange` — i.e., at the
  Supabase SDK boundary. Internal helpers (`friendlyAuthError`,
  `formatCountdown`, `isInvalidCredentialsError`) run for real in every
  consumer test.
- **Password fixtures.** All E2E `password = 'password123'` and
  `password = 'old-password-123'` / `'new-password-456'` /
  `'different-password-9'` strings are 11+ characters — comfortably
  above the new 8-char minimum. The two `'short'` (5 chars) fixtures
  in unit tests are the intentional "blocks submit" cases.
- **No `.skip` calls hide flakes.** All `test.skip(!isLocalSupabase(),
...)` invocations are environment gates, the documented pattern in
  `apps/web/e2e/helpers/admin-client.ts:39`. Slow-job CI sets
  `SUPABASE_URL=http://127.0.0.1:54321` so all of them run.
- **E2E-per-surface invariant holds.** Every (auth) page has at least
  one E2E driving the primary verb through the UI:
  - `/sign-up` → `sign-up.spec.ts`, `auth.spec.ts`, plus duplicate-email
    - rate-limit branches in `auth-edge-cases.spec.ts`.
  - `/sign-in` → existing-user + sign-out + email-not-confirmed in
    `auth-edge-cases.spec.ts`.
  - `/forgot-password` + `/reset-password` + `/auth/callback` →
    `forgot-password.spec.ts` (admin-client pre-create + magic-link
    round-trip + post-recovery sign-in proof).
  - `/onboarding` → leg in `auth.spec.ts` and `sign-up.spec.ts`.
- **`AuthSubmitButton` 250ms threshold + post-success label swap.**
  Existing seven tests pin the threshold (249ms = no spinner;
  250ms = spinner), the cancellation race, the success-disabled +
  successLabel branch, the children fallback, and the `aria-busy` flag.
  Solid coverage.
- **`AuthErrorDisplay` null-vs-rendered branch.** Two tests pin
  "renders nothing" + "role=alert with text-error class" + the
  identical-DOM-shape contract.
- **`useResendCountdown` cleanup + `active` gate.** Five tests cover
  starts-at-duration, doesn't-tick-when-inactive, resumes-on-flip,
  reset-rearms, custom-duration-honored. The cleanup contract on
  unmount is implicit but not separately asserted (could mirror the
  `AwaitingConfirmationCard` finding above; lower priority since
  fake-timer use-and-return is more visible).

## Summary

Polish iterations introduced one **medium** gap (the
`AwaitingConfirmationCard.test.tsx` file has no direct coverage of the new
`onEdit` prop, even though the parent flow test covers the wiring) and a
handful of **low** gaps that are nice-to-have polish on already-passing
coverage. No high-severity issues. Zero flake-hiding skips. The user's
skepticism that triggered this audit was well-placed for `79b0a9c` (back-link
shipped without a test) but the gap was closed by `e707a0f` before the audit;
what remains is a thinner-than-ideal component-level test file for the same
component.

`findings: high=0, medium=1, low=6`
