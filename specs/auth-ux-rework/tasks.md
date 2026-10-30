# Tasks — auth-ux-rework

## Decisions (judgment calls made during implementation)

- **D5/D6 verification — `sender_name` and reply-to require custom SMTP, not set in this PR.** The Supabase `config.toml` schema as of CLI v2.84.2 only exposes `sender_name` under `[auth.email.smtp]` (the custom-SMTP block); the top-level `[auth.email]` does not accept a sender field. Per the spec's "leave default and add a PR-body operator note pointing the reader at the v1 custom-domain entry" path, we leave defaults and add a PR-body note. The branded subject + body still ships via `[auth.email.template.confirmation]` and `[auth.email.template.recovery]`. Commit: Task 12.
- **Removed the `auth-edge-cases.spec.ts` skipped password-reset stub instead of activating it.** Spec Task 15 said "activate `test.skip(true, ...)` at line 220 (or remove — covered by `forgot-password.spec.ts`)". Activating it would duplicate coverage of `forgot-password.spec.ts` (Task 16), so we removed it. The `password-reset-e2e` line item in TODOS.md will be cleared by Task 14's CLAUDE.md cleanup pass. Commit: 3cf6592 (Task 11).
- **Sign-in test for `?reset-error=expired` and `?confirm-error=expired` query params landed in Task 5 instead of being deferred.** The `/auth/callback` handler was committed two tasks later (Task 8) but the sign-in screen needs to surface the friendly copy when bounced — testing the sign-in side first kept the spec pin without waiting for the callback. The two are coupled but each side tested independently. Commit: 586e162 (Task 5).
- **`AwaitingConfirmationCard` analytics constants + emitter helpers landed early in Task 4** instead of waiting for Task 13. The card needs `trackEmailConfirmationResent` to function; gating the helper on a later task would have left a typecheck-broken intermediate commit. Task 13 now wires `auth_signed_up`/`auth_signed_in` distinguishing in `providers.tsx` and the METRICS.md table grew with the Task 4 commit. Commit: 95107bb (Task 4).
- **`AuthSubmitButton` accepts `disabled` pass-through.** Spec said "instant `disabled={true}` on submit" but the countdown-driven resend buttons (`AwaitingConfirmationCard`, `/forgot-password`) need to disable based on a timer, not on `isPending`. Added a `disabled` prop that ORs with the internal `isPending || isSuccess`. Tests cover both paths. Commit: 95107bb (Task 4).
- **Bulk-updated 14 existing E2E specs to drive the new sign-up flow.** Spec scoped Task 16 to "new sign-up + forgot-password specs," but the existing fresh-signup E2Es (auth.spec.ts, settings.spec.ts, etc.) all relied on the now-removed `/sign-in` signup-fallback. Updating them inside Task 11 (PublicLanding CTAs, the trigger for the change) avoided a flurry of broken tests landing across multiple commits. Commit: 3cf6592 (Task 11).

## Task list

- [x] Task 1: Auth layout client component + email-context hook (0623b78)
- [x] Task 2: AuthSubmitButton + unit tests (c6f32a3)
- [x] Task 3: AuthErrorDisplay + unit tests (573a43e)
- [x] Task 4: AwaitingConfirmationCard (60s resend) (95107bb)
- [x] Task 5: Refactor /sign-in (586e162)
- [x] Task 6: New /sign-up screen (980a48b)
- [x] Task 7: New /forgot-password screen (cfffa13)
- [x] Task 8: /reset-password + /auth/callback (9e9e8a5)
- [x] Task 9: OnboardingForm picks up name field (abe3d91)
- [x] Task 10: middleware allow-list new unauth routes (4296257)
- [x] Task 11: PublicLanding CTAs (3cf6592)
- [x] Task 12: Branded email templates + logo asset (a2459e4)
- [x] Task 13: METRICS.md + analytics wrappers (6a6bf8a)
- [x] Task 14: CLAUDE.md cleanup (76d1ea0)
- [x] Task 15: Adapt sign-in unit tests + activate skipped E2E (a93f92f)
- [x] Task 16: New E2E specs (sign-up + forgot-password) (10b861e)
