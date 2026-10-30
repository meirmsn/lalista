<!-- generated-by: /ak-build Phase 0 (skeleton — /ak-spec will expand) -->
<!-- feature: auth-ux-rework -->
<!-- date: 2026-05-02 -->

# Spec: auth-ux-rework (chapter 1l)

**Sources:**

- `PRODUCT-ROADMAP.md § v0 § 1l: Auth UX rework` — primary scope
- `PLAN.md § Planned § 2: auth-ux-rework` — scope summary + supersedes pointer
- `DESIGN.md` — token map, motion, aesthetic, voice (terracotta, warm cream, Fraunces, Plus Jakarta Sans)
- Prior spec `specs/auth/spec.md` — style + structure reference (PR 2)
- Existing `apps/web/app/(auth)/sign-in/page.tsx` — current "magic form" implementation being replaced
- Existing `apps/web/middleware.ts` — current allow-list (`/`, `/sign-in`); to be extended
- Existing `supabase/config.toml` — current `[auth.email.template.*]` blocks (currently default)

PR reworks the v0 sign-in "magic form" into a launch-quality auth flow: split sign-in / sign-up screens with email persistence across screens via React context, branded EN-only HTML Supabase email templates, hard-gated email-confirmation card with 60s resend, full no-enumeration `/forgot-password` + `/reset-password` flow, snappy submit buttons (instant disable + 250ms threshold spinner), unified client+server error rendering, and onboarding picks up the name field.

---

## Decisions (resolved at spec time)

12 `/ak-spec`-time decisions resolved in Phase 0 with the user. Recorded below
so Phase 1 preserves them verbatim and a crashed Phase 1 resumes without
re-asking.

### D1: Sign-up primary button copy

**Decision:** "Create account"

**Rationale:** "Sign up" reads as marketer/SaaS framing; "Create account" is what the user is actually doing. Matches DESIGN.md voice ("make claims, not impressions").

### D2: Resend countdown UX (confirmation + forgot-password screens)

**Decision:** Visible countdown ("Resend in 0:54"), button disabled until 0.

**Rationale:** Silent disabled state reads as broken; visible counter is honest about the wait. Same pattern across both screens for consistency.

### D3: Email-template footer wording (the "Supabase is the messenger" note)

**Decision:** "Sent through Supabase, our hosting provider — they're just the messenger, feel free to ignore the noreply address."

**Rationale:** Lowercase voice, plain claim, names the discomfort honestly. Drafted to match DESIGN.md "make claims, not impressions" + "name things like a person, not a system."

### D4: `AuthSubmitButton` placement

**Decision:** Local to `apps/web/components/`.

**Rationale:** Chapter 1l roadmap explicitly recommends local for v0; chapter 1m lifts to `packages/ui`. Saves a cross-package edit now and lets the API stabilize before extraction.

### D5: Supabase sender display name (`lalista` in `config.toml`) without custom SMTP

**Decision:** Set `[auth.email]` `sender_name = "lalista"` if the field is honored on Supabase's default SMTP. Verify in Phase 1 by reading the current Supabase `config.toml` reference; if verification shows the field requires custom SMTP, leave default sender and add a note to the PR body pointing the operator at the v1 custom-domain entry.

**Rationale:** Free perception lift if available — one knob, no DNS work.

### D6: Reply-to header without custom SMTP

**Decision:** Set if available without SMTP (verify in Phase 1 same as D5). Document in PR body if not.

**Rationale:** Same trade-off as D5; verify, set if free.

### D7: Onboarding name-field copy

**Decision:** Label "Your name". Helper text: "Shared lists show who added each item. You can edit this anytime in Settings."

**Rationale:** Roadmap says "short note explaining why" — this is the shortest version that names the actual reason without padding.

### D8: Add 4 new PostHog events to `METRICS.md`

**Decision:** Yes — add `auth_signed_up`, `auth_password_reset_requested`, `auth_password_reset_completed`, `auth_email_confirmation_resent`. Keep existing `auth_signed_in` and `auth_signed_out` unchanged.

**Rationale:** Pre-approved by chapter 1l scope item 11; user explicitly confirmed in Phase 0 per CLAUDE.md "ask before adding new metric events" convention.

### D9: Ship `app/(auth)/loading.tsx` (or any route-level `loading.tsx`) in this PR?

**Decision:** No — defer to chapter 1m.

**Rationale:** Chapter 1m owns the route-level loading-affordance pattern (`LoadingArea`); shipping a one-off here would either stub something 1m replaces or create drift.

### D10: `/auth/callback` token-exchange path: signed-in users on `?type=recovery` link

**Decision:** Always force-redirect to `/reset-password`, even if a session already exists.

**Rationale:** Recovery flow assumes the user wants to set a new password; bouncing to `/list` strands them. Other callback types (signup confirmation) follow the standard "session present → /onboarding or /list" branching.

### D11: Sign-up screen fields

**Decision:** Email + password only — no confirm-password, no name.

**Rationale:** Spec moves name to onboarding; confirm-password adds friction without security gain (Supabase sign-up is single-shot, Supabase's password validator returns errors atomically). If autocomplete-friendly password managers handle the round-trip, double-entry is redundant.

### D12: Email templates — light-mode-only or include dark-mode media query?

**Decision:** Light-mode-only.

**Rationale:** Most email clients ignore `prefers-color-scheme`; supporting it doubles template surface for one-screen polish. The lalista cream background reads fine in both client themes.

---

## In scope

- Split sign-in / sign-up screens — drop the v0 magic-form "signup-as-fallback"
  pattern. New `/sign-up` screen (email + password only per **D11**); `/sign-in`
  drops the optional name field and the fallback branch.
- React-context email persistence across the auth flow via a new
  `app/(auth)/layout.tsx` client component. Survives intra-flow navigation
  (sign-in ↔ sign-up ↔ forgot-password); lost on full reload (acceptable,
  scope item 2 of chapter 1l).
- New `/forgot-password` + `/reset-password` screens, plus a `/auth/callback`
  route handler that exchanges the Supabase recovery / signup-confirmation
  token for a session and routes the user to the right next screen.
- Lifted `AwaitingConfirmationCard` from the inline `awaitingConfirmation`
  state in `sign-in/page.tsx` into its own component. Mounted after sign-up,
  hard-gates the user until the session lands a confirmed user (via
  `onAuthStateChange`). Includes a 60s visible-countdown resend per **D2**.
- New `AuthSubmitButton` (local to `apps/web/components/` per **D4**): instant
  `disabled={true}` on submit + 250ms-threshold spinner + post-success label
  swap. Used on every auth + resend button.
- New `AuthErrorDisplay` — single component renders both client-side and
  server-side errors with identical visual treatment + DOM location, so there's
  no flash from one to the other.
- Onboarding picks up the name field with helper copy per **D7**. Sign-up no
  longer collects name.
- Branded EN-only HTML Supabase email templates (confirmation + recovery) in
  `supabase/config.toml`, with the lalista terracotta accent (light-mode-only
  per **D12**), inline logo, and the "Supabase is the messenger" footer per
  **D3**.
- New PostHog events per **D8**: `auth_signed_up`,
  `auth_password_reset_requested`, `auth_password_reset_completed`,
  `auth_email_confirmation_resent`. Existing `auth_signed_in` and
  `auth_signed_out` unchanged.
- `middleware.ts` allow-list extended to include `/sign-up`,
  `/forgot-password`, `/reset-password`, and `/auth/callback`.
- Unified submit-time validation (no as-you-type validation) across all auth
  forms.
- Form-attribute hygiene: `type="email" inputmode="email" autocomplete="email"`
  on every email input; `autocomplete="current-password"` on `/sign-in`,
  `autocomplete="new-password"` on `/sign-up` + `/reset-password`.
- CLAUDE.md cleanup: drop the "expected 400 in DevTools" gotcha (no longer
  applicable post-split); update the IA gotcha to list the new public paths.

---

## Screens

### `/sign-in` — refactored

`apps/web/app/(auth)/sign-in/page.tsx`

- Email + password form. Drops the optional `displayName` field (moved to
  onboarding) and the signup-as-fallback branch.
- Submit calls `signInWithPassword(client, email, password)` once. On success,
  `router.push('/onboarding')` (middleware + the onboarding RSC handle further
  routing). On error, render via `AuthErrorDisplay`.
- Email format + non-empty password are validated at submit time only.
- Below the primary submit: a small "Don't have an account? <Link>Create
  one</Link>" affordance routing to `/sign-up`. Plus a "<Link>Forgot
  password?</Link>" affordance routing to `/forgot-password`. Both links
  preserve the email via the layout context (no URL params).
- Primary submit uses `AuthSubmitButton` with copy "Sign in" → "Signing in…"
  (post-250ms threshold).
- The legacy in-page `awaitingConfirmation` branch is removed (the case is
  unreachable now that signup happens on `/sign-up`).
- Inputs: `id="email" type="email" inputmode="email" autocomplete="email"`,
  `id="password" type="password" autocomplete="current-password"`.

### `/sign-up` — new

`apps/web/app/(auth)/sign-up/page.tsx`

- Email + password form. **D11**: no confirm-password, no name field.
- Submit calls `signUpWithPassword(client, email, password)`. On success:
  - If the response carries a session (project has `enable_confirmations =
false` or auto-confirm path), `router.push('/onboarding')`.
  - Otherwise (the default Supabase path with confirmation required),
    swap the form for `<AwaitingConfirmationCard email={email} />`. The card
    stays mounted until `onAuthStateChange` fires `SIGNED_IN`.
- Identity-stuffing detection: if `signUp.data.user?.identities?.length === 0`
  (Supabase's user-enumeration prevention shape for an already-registered
  email), surface "That email is already registered. <Link>Sign in</Link>?"
  via `AuthErrorDisplay`.
- Primary submit: `AuthSubmitButton` with copy "Create account" per **D1** →
  "Creating account…" (post-250ms threshold).
- "Already have an account? <Link>Sign in</Link>" affordance under the form
  routing to `/sign-in` (preserves email via layout context).
- Inputs: email same as `/sign-in`; password is `id="password"
type="password" autocomplete="new-password"`.
- Fires `auth_signed_up` (with `{ method: 'email' }`) on confirmed sign-in
  (i.e., when the eventual `SIGNED_IN` event fires after this signup, not on
  the signup HTTP response itself — that's how Supabase confirmation works).

### `/forgot-password` — new

`apps/web/app/(auth)/forgot-password/page.tsx`

- Single email input + "Send reset link" submit.
- Submit calls `supabase.auth.resetPasswordForEmail(email, { redirectTo:
${origin}/auth/callback?type=recovery })`. Always shows success state on
  resolve regardless of whether the email belongs to a registered user
  (no-enumeration — gotcha (c)).
- Success view replaces the form with: "If an account exists with that
  email, we just sent a reset link." + the email back as confirmation +
  "Resend (0:60)" `AuthSubmitButton` (60s visible countdown per **D2**) +
  an "Edit email" affordance that pops back to the form (preserves email
  via layout context).
- Resend countdown lives in component state — restarts on every successful
  resend; click is no-op while > 0.
- Fires `auth_password_reset_requested` on submit success (no PII
  properties — no email).
- Fires `auth_email_confirmation_resent` with `{ source: 'sign-in-fallback'
}` — wait, scratch that, this is the password-reset surface, not the
  confirmation-card surface. The confirmation-card resend fires
  `auth_email_confirmation_resent`; the forgot-password resend fires
  `auth_password_reset_requested` again. (Each event is per-button, not
  per-screen.)

### `/reset-password` — new

`apps/web/app/(auth)/reset-password/page.tsx`

- New password + confirm-password form. Reached only via the
  `/auth/callback?type=recovery` flow (which lands a session, then redirects
  here per **D10**).
- Submit calls `supabase.auth.updateUser({ password })`. On success: fire
  `auth_password_reset_completed`, then `router.push('/list')`.
- Confirm-password field is required for parity with the standard reset
  pattern — there's no email round-trip safety net like sign-up has, so a
  typo would lock the user out of their own account.
- On error (e.g., password too weak per Supabase's server-side validator),
  render via `AuthErrorDisplay`.
- Inputs: `id="password" type="password" autocomplete="new-password"`,
  `id="password-confirm" type="password" autocomplete="new-password"`.
- Primary submit: `AuthSubmitButton` with copy "Set new password" →
  "Saving…".

### `/auth/callback` — new

`apps/web/app/auth/callback/route.ts` — **route handler**, not a page. Lives
outside the `(auth)` group because route handlers can't share a page-shape
layout.

- Reads `code` query param (the Supabase token-exchange code) and `type`
  (`recovery` for password reset; `signup` or absent for confirmation).
- Calls `supabase.auth.exchangeCodeForSession(code)` server-side using the
  `@supabase/ssr` server client (cookies adapter).
- Routing on success:
  - `?type=recovery` → **always** `redirect('/reset-password')`, even if a
    session already existed before the link click (per **D10**: assume the
    user wants to set a new password; bouncing to `/list` strands them).
  - Otherwise (signup confirmation) → `redirect('/onboarding')` (the
    onboarding RSC will further redirect to `/list` if a household exists).
- On error (expired/invalid code): `redirect('/sign-in?reset-error=expired')`
  for recovery flows; `redirect('/sign-in?confirm-error=expired')` for
  signup. `/sign-in` reads these and surfaces an `AuthErrorDisplay`-rendered
  message ("That link expired. Sign in or request a fresh one.").
- **Must allow tokenized requests through unauthed** — the handler itself is
  what creates the session. Listed in `PUBLIC_PATHS` (gotcha (a)).

### `/onboarding` — modified

`apps/web/app/(auth)/onboarding/OnboardingForm.tsx`

- Adds a "Your name" field above the existing household-name field.
- Helper text per **D7**: "Shared lists show who added each item. You can
  edit this anytime in Settings."
- Submit handler order: (1) call `updateMyProfile(client, { display_name })`
  if name is non-empty + trimmed; (2) call `createHousehold(client, name)` as
  today; (3) `router.push('/list')`. If the profile update fails, surface
  the error and **don't** advance — household creation is the irreversible
  step, so wedge the user on a fixable failure rather than orphan their name
  edit.
- The name field is **optional** (matches the `displayName` semantics in
  migration 012 — empty falls back to `split_part(email, '@', 1)`).
- Primary submit becomes `AuthSubmitButton` ("Create" → "Creating…").

---

## New components

All three live under `apps/web/components/` per **D4** (chapter 1m lifts to
`packages/ui`).

### `AuthSubmitButton`

`apps/web/components/AuthSubmitButton.tsx`

- Props: `{ children: ReactNode, isPending: boolean, pendingLabel?: string,
successLabel?: string, isSuccess?: boolean, ...rest }`.
- Behavior:
  - `disabled={true}` instantly when `isPending` flips true (no waiting on
    the spinner threshold to communicate "I heard you").
  - Spinner fades in 250ms after `isPending` flips true, swaps the label to
    `pendingLabel`. If the request resolves before 250ms, the spinner never
    renders — submit feels instant.
  - When `isSuccess` flips true (caller-controlled), label swaps to
    `successLabel` and the button stays disabled.
- Uses `useEffect` + `setTimeout` for the threshold; cleans up on unmount /
  state-change.
- Wraps the existing `<Button>` from `@lalista/ui` for visual parity with
  every other primary action in the app.

### `AuthErrorDisplay`

`apps/web/components/AuthErrorDisplay.tsx`

- Props: `{ error: string | null, role?: 'alert' }`.
- Renders nothing when `error` is null. Renders a `<Text variant="caption"
className="text-error" role="alert">` when set.
- Same DOM location + same visual treatment for both client-side validation
  errors ("Enter a valid email address.") and server-side errors ("Too many
  attempts…"). No flash between the two states.
- Friendly-error mapping (the existing `friendlyAuthError` helper inlined in
  `sign-in/page.tsx`) moves to a colocated `apps/web/components/auth/
friendlyAuthError.ts` — call it from each page's submit handler before
  passing the result to `AuthErrorDisplay`.

### `AwaitingConfirmationCard`

`apps/web/components/AwaitingConfirmationCard.tsx`

- Props: `{ email: string }`.
- Body copy: "We sent a confirmation link to **{email}**. Click it to finish
  creating your account — we'll bring you in automatically."
- Resend button: `AuthSubmitButton` with the 60s countdown (per **D2**) —
  label "Resend (0:NN)" → "Resend confirmation email" when 0. Click calls
  `supabase.auth.resend({ type: 'signup', email })` and fires
  `auth_email_confirmation_resent` with `{ source: 'sign-up' }`.
- Mounts an `onAuthStateChange` listener on mount; on `SIGNED_IN`,
  `router.replace('/onboarding')` (gotcha (d)).
- Listener cleanup on unmount.

---

## Layout / cross-cutting

`apps/web/app/(auth)/layout.tsx` becomes a **client component** holding
`{ email, setEmail }` in React context. Today it's a server-rendered layout
shell — the rewrite preserves the centered-card chrome and adds the context.

- Export `useAuthEmail()` hook from the same file (or a sibling
  `apps/web/app/(auth)/_email-context.ts` so the layout itself can stay close
  to chrome-only). Hook returns `{ email, setEmail }`.
- Sign-in / sign-up / forgot-password pages call `useAuthEmail()` instead of
  managing email in local component state.
- Scoped to `/(auth)` — pages outside the group don't see the context. Lost
  on full reload (acceptable per chapter 1l scope item 2).
- No URL query params — keeps the URL clean and avoids the email leaking
  into browser history / referer headers.

---

## Middleware

`apps/web/middleware.ts`

- Extend `PUBLIC_PATHS` from `['/', '/sign-in']` to:
  ```
  ['/', '/sign-in', '/sign-up', '/forgot-password', '/reset-password',
   '/auth/callback']
  ```
- The "authed user on a public path" branch (currently `if (user && isSignIn)
→ redirect to /onboarding`) extends to `/sign-up`, `/forgot-password`, and
  `/reset-password`. **Exception**: `/reset-password` does NOT redirect
  authed users away — recovery flows arrive with a session already, and the
  whole point is to set a new password. Same for `/auth/callback` (the
  handler creates the session).
- `/auth/callback` must allow **tokenized unauthed** requests through (see
  gotcha (a)) — listed in `PUBLIC_PATHS`. The handler itself does the
  exchange + redirect.
- Matcher unchanged.

---

## Out of scope

Verbatim from chapter 1l "Explicit non-scope (by design)":

- **Custom-domain transactional emails (own SMTP).** Continue using
  Supabase's default sender for v0; branded subject + body suffices.
  Custom-domain emails (own DNS, Resend or similar) lift the "from" address
  out of `*.mail.app.supabase.io` — see v1 entry.
- **Social auth.** Google + Apple sign-in deferred to v1.
- **Bilingual auth screens / emails.** EN-only. Bilingual UI is a v+
  chapter.
- **App-wide nav snappiness.** Skeleton-loading for non-auth routes
  (Settings, item detail) is chapter 1m. The 250ms button-feedback pattern
  stays scoped to auth submit/resend buttons here.
- **Devshop extraction.** Lifting the new components to
  `@devshop-template/*` is v1 work — see `§ v1 § Devshop extraction of
validated UX patterns`. The "ship inline → soak in production → extract"
  sequencing protects against extracting half-baked patterns.
- **Password complexity rules beyond Supabase defaults.** Inherit Supabase's
  min-length. No app-side complexity meter.

Plus, deferred per **D9**:

- **Route-level `loading.tsx` for auth screens.** Chapter 1m owns the
  `LoadingArea` pattern; shipping a one-off here would either stub something
  1m replaces or create drift.

---

## Data model changes

**None.** Sign-up + sign-in + reset all flow through Supabase Auth's existing
`auth.users` table; the `handle_new_user` trigger from migration 012 keeps
`profiles` in sync. No new migrations.

---

## API contracts

No new HTTP endpoints. All interactions go through the Supabase JS client
using the anon key + user JWT.

- Sign-in: `signInWithPassword(client, email, password)` (existing wrapper
  in `@lalista/core`).
- Sign-up: `signUpWithPassword(client, email, password)` (existing wrapper).
- Forgot password: `supabase.auth.resetPasswordForEmail(email,
{ redirectTo })` — used directly via the Supabase JS client. No `@lalista/
core` wrapper needed (one-shot call, no error-shape branching beyond the
  generic `{ error }`).
- Reset password: `supabase.auth.updateUser({ password })`.
- Token exchange: `supabase.auth.exchangeCodeForSession(code)` — server-side
  in the `/auth/callback` route handler.
- Resend confirmation: `supabase.auth.resend({ type: 'signup', email })`.
- Auth state stream: `supabase.auth.onAuthStateChange(callback)` — used by
  `AwaitingConfirmationCard` to detect the session landing.

If a wrapper feels worth adding to `@lalista/core` during implementation
(e.g., a `requestPasswordReset(client, email, redirectTo)` to keep call
sites symmetrical with `signInWithPassword`), `/ak-implement` may add it.
The spec is explicit only that no **new external HTTP** surface is added.

---

## Offline behavior

**Online-only with error state via `AuthErrorDisplay`.** Matches v0 strategy
documented in PRODUCT-ROADMAP.md. If Supabase is unreachable during any auth
action, surface "Can't reach the server. Check your connection and try
again." through `AuthErrorDisplay`. No queuing, no local cache, no service
worker auth fallback.

---

## Metrics

Four **new** events per **D8**. Add to `apps/web/lib/analytics.ts` event
constants + emitter functions, and to `METRICS.md` taxonomy.

| Event                            | Fires on                                                                                                                                                  | Properties                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth_signed_up`                 | Successful sign-up — fires on the eventual `SIGNED_IN` `onAuthStateChange` event after sign-up (post-confirmation), wired in `apps/web/app/providers.tsx` | `{ method: 'email' }`                                                                                                                       |
| `auth_password_reset_requested`  | `/forgot-password` form submit resolves successfully (regardless of whether the email exists — no-enumeration). No PII properties — **no email**.         | `{}`                                                                                                                                        |
| `auth_password_reset_completed`  | `/reset-password` form submit resolves successfully (post-`updateUser`).                                                                                  | `{}`                                                                                                                                        |
| `auth_email_confirmation_resent` | Resend click in `AwaitingConfirmationCard` (or any future legacy path).                                                                                   | `{ source: 'sign-up' \| 'sign-in-fallback' }` (primary is `'sign-up'`; `sign-in-fallback` covers any legacy path that hangs on after split) |

Existing `auth_signed_in` and `auth_signed_out` unchanged.

Constants added to `apps/web/lib/analytics.ts`:

- `AUTH_SIGNED_UP = 'auth_signed_up'`
- `AUTH_PASSWORD_RESET_REQUESTED = 'auth_password_reset_requested'`
- `AUTH_PASSWORD_RESET_COMPLETED = 'auth_password_reset_completed'`
- `AUTH_EMAIL_CONFIRMATION_RESENT = 'auth_email_confirmation_resent'`

Plus emitter helpers (`trackSignedUp`, `trackPasswordResetRequested`,
`trackPasswordResetCompleted`, `trackEmailConfirmationResent`) following the
existing `trackSignedIn` / `trackSignedOut` shape.

`apps/web/app/providers.tsx` extends the existing `onAuthStateChange` →
`auth_signed_in` capture: distinguish first-ever sign-in (sign-up) from
subsequent sign-ins by checking the user's `created_at` against `now`
(within ~10s window) — fire `auth_signed_up` for new accounts,
`auth_signed_in` for returning ones.

---

## Files to create

- `apps/web/app/(auth)/sign-up/page.tsx`
- `apps/web/app/(auth)/sign-up/page.test.tsx`
- `apps/web/app/(auth)/forgot-password/page.tsx`
- `apps/web/app/(auth)/forgot-password/page.test.tsx`
- `apps/web/app/(auth)/reset-password/page.tsx`
- `apps/web/app/(auth)/reset-password/page.test.tsx`
- `apps/web/app/auth/callback/route.ts`
- `apps/web/app/auth/callback/route.test.ts`
- `apps/web/app/(auth)/_email-context.ts` (or co-located in `layout.tsx`)
- `apps/web/components/AuthSubmitButton.tsx`
- `apps/web/components/AuthSubmitButton.test.tsx`
- `apps/web/components/AuthErrorDisplay.tsx`
- `apps/web/components/AuthErrorDisplay.test.tsx`
- `apps/web/components/AwaitingConfirmationCard.tsx`
- `apps/web/components/AwaitingConfirmationCard.test.tsx`
- `apps/web/components/auth/friendlyAuthError.ts` (lifted from `sign-in/page.tsx`)
- `apps/web/components/auth/friendlyAuthError.test.ts`
- `apps/web/public/lalista-email-logo.png` (logo asset — see § Logo asset)
- `apps/web/e2e/sign-up.spec.ts`
- `apps/web/e2e/forgot-password.spec.ts`

## Files to modify

- `apps/web/app/(auth)/layout.tsx` — convert to client component holding
  email context
- `apps/web/app/(auth)/sign-in/page.tsx` — drop displayName + signup
  fallback + inline awaiting-confirmation; adopt new components; consume
  email context
- `apps/web/app/(auth)/sign-in/page.test.tsx` — adapt 12 existing tests
  (split per § Tests)
- `apps/web/app/(auth)/onboarding/OnboardingForm.tsx` — add Your name field
  - helper copy + profile update before household create
- `apps/web/app/(auth)/onboarding/OnboardingForm.test.tsx` — extend
- `apps/web/components/PublicLanding.tsx` — primary CTA to `/sign-up`,
  secondary to `/sign-in`
- `apps/web/components/PublicLanding.test.tsx` — extend
- `apps/web/middleware.ts` — extend `PUBLIC_PATHS`; adjust authed-on-public
  branch
- `apps/web/middleware.test.ts` — cover new public paths and the
  recovery-callback bypass
- `apps/web/app/providers.tsx` — distinguish sign-up vs sign-in in
  `auth_signed_in` listener
- `apps/web/lib/analytics.ts` — new event constants + emitter helpers
- `apps/web/lib/analytics.test.ts` — extend
- `apps/web/e2e/auth-edge-cases.spec.ts` — activate the
  `test.skip(true, ...)` block at line 289 (the password-reset stub) into
  a live test
- `supabase/config.toml` — uncomment + populate
  `[auth.email.template.confirmation]` and `[auth.email.template.recovery]`;
  attempt `[auth.email]` `sender_name = "lalista"` per **D5** + reply-to per
  **D6**, verifying schema availability during implementation
- `METRICS.md` — append the four new events
- `CLAUDE.md` — drop the "Sign-in form's 400 in DevTools" gotcha; update the
  IA gotcha to list the new public paths; update "Where Things Happen §
  Auth" to reference new files

---

## Tests

### Unit tests (Vitest)

**Sign-in tests — split + adapt the 12 existing pinned tests:**

- `apps/web/app/(auth)/sign-in/page.test.tsx` keeps the sign-in-only
  assertions:
  - Renders email + password inputs and a "Sign in" button.
  - Submit with valid creds calls `signInWithPassword` once.
  - Email-format validation blocks submit with inline error.
  - Empty-password validation blocks submit.
  - Server error ("Too many attempts…") renders via `AuthErrorDisplay`.
  - "Email not confirmed" surfaces friendly copy.
  - Button disabled while in-flight (isPending true).
  - **Drop**: every assertion that exercises the signup-fallback branch
    (`Invalid login credentials` triggering `signUpWithPassword`),
    `awaitingConfirmation` state, and the optional displayName field. Those
    move to the sign-up tests below.

- `apps/web/app/(auth)/sign-up/page.test.tsx` (new):
  - Renders email + password inputs and "Create account" button (per **D1**).
  - Submit with valid input calls `signUpWithPassword`.
  - On `data.session` present → router pushed to `/onboarding`.
  - On no session + identities populated →
    `<AwaitingConfirmationCard email={email} />` rendered.
  - On no session + `identities=[]` → "already registered" friendly error
    rendered via `AuthErrorDisplay`.
  - Email format + non-empty password validated at submit time.

- `apps/web/app/(auth)/forgot-password/page.test.tsx` (new):
  - Submit calls `resetPasswordForEmail` with the email + the absolute
    `${origin}/auth/callback?type=recovery` redirectTo.
  - Resolves to success state regardless of whether the email exists —
    component never inspects the response shape (no-enumeration, gotcha
    (c)).
  - Success state shows the email back, "Edit email" affordance, and
    "Resend (0:60)" with countdown.
  - Resend click while countdown > 0 is no-op.
  - Resend click at 0 calls `resetPasswordForEmail` again.

- `apps/web/app/(auth)/reset-password/page.test.tsx` (new):
  - Submit calls `updateUser({ password })` with the entered password.
  - Confirm-password mismatch blocks submit with inline error.
  - On success → router pushed to `/list` and
    `auth_password_reset_completed` fires.
  - Server error surfaces via `AuthErrorDisplay`.

- `apps/web/app/auth/callback/route.test.ts` (new):
  - `?code=...&type=recovery` calls `exchangeCodeForSession` then redirects
    to `/reset-password`.
  - `?code=...&type=signup` redirects to `/onboarding`.
  - Missing code → redirect to `/sign-in?confirm-error=expired` (or
    equivalent reset variant).
  - Recovery type **always** redirects to `/reset-password`, even if a
    pre-existing session was already present (per **D10**).

- `apps/web/components/AuthSubmitButton.test.tsx` (new):
  - `isPending=true` instantly disables the button.
  - Spinner does NOT render before 250ms (use `vi.useFakeTimers()` +
    `vi.advanceTimersByTime(249)`).
  - Spinner renders after 250ms (`vi.advanceTimersByTime(1)`).
  - `isPending` flipping back to false before 250ms cancels the spinner —
    submit feels instant for fast responses.
  - `isSuccess=true` swaps the label to `successLabel` and keeps the button
    disabled.

- `apps/web/components/AuthErrorDisplay.test.tsx` (new):
  - `error=null` renders nothing.
  - `error="..."` renders inside a `[role="alert"]` `<Text>` with
    `text-error` class.
  - Server vs client error: same DOM shape, same class — render two cases
    and snapshot-compare DOM nodes (not visual snapshot — a structural
    parity check).

- `apps/web/components/AwaitingConfirmationCard.test.tsx` (new):
  - Renders the email back as `<strong>{email}</strong>`.
  - Resend button starts disabled with "Resend (0:60)".
  - Countdown decrements once per second (fake timers).
  - At 0, click calls `supabase.auth.resend({ type: 'signup', email })` and
    `trackEmailConfirmationResent({ source: 'sign-up' })`.
  - `onAuthStateChange` receiving `SIGNED_IN` triggers
    `router.replace('/onboarding')`.

- `apps/web/components/auth/friendlyAuthError.test.ts` (new): cover each
  regex branch already living inline at `sign-in/page.tsx:39-52`.

- `apps/web/middleware.test.ts` extension: assert each of the 6 public
  paths passes through unauthed; assert authed user on `/sign-up`,
  `/forgot-password` is redirected to `/onboarding`; assert authed user on
  `/reset-password` and `/auth/callback` is **not** redirected (the
  recovery-callback bypass).

### E2E (Playwright — mobile 375 + desktop 1440)

- `apps/web/e2e/sign-up.spec.ts` (new):
  1. `/` → tap "Get started" (or new "Create account" CTA) → land on
     `/sign-up`.
  2. Fill fresh `e2e-${Date.now()}@example.com` + `password123` → click
     "Create account".
  3. Awaiting-confirmation card visible with the email back.
  4. Open inbucket (`http://host.docker.internal:54324`) via the existing
     test helpers, fetch the latest message for the email, follow the
     confirmation link.
  5. Land on `/onboarding`, fill name + household name, submit → land on
     `/list`.

- `apps/web/e2e/forgot-password.spec.ts` (new):
  1. Pre-create a confirmed user via admin client (per
     `auth-edge-cases.spec.ts` boilerplate).
  2. `/sign-in` → "Forgot password?" → land on `/forgot-password`.
  3. Submit email → success copy visible + email shown back + "Resend
     (0:60)" countdown.
  4. Wait or fast-forward (real wallclock — 60s in CI is acceptable for
     this single spec; mark with `test.slow()`).
  5. Pull recovery email from inbucket, follow link → land on
     `/reset-password`.
  6. Set new password, submit → land on `/list`.
  7. Sign out → sign in with the new password → success.

- `apps/web/e2e/auth-edge-cases.spec.ts` line 289: replace
  `test.skip(true, ...)` body with a live password-reset happy-path
  exercising the same flow as the spec above (or remove — covered by
  `forgot-password.spec.ts`). Choose at implementation time; if removed,
  drop the `password-reset-e2e` line item from the
  Cross-references / supersedes block.

### Integration tests

None new for this feature — `forgot-password.spec.ts`'s inbucket assertion
is an E2E concern, not an integration-test boundary.

---

## Email templates

`supabase/config.toml` — uncomment `[auth.email.template.confirmation]` and
add `[auth.email.template.recovery]`.

### Subject lines

- Confirmation: `subject = "Confirm your lalista account"`
- Recovery: `subject = "Reset your lalista password"`

(Lalista voice, EN-only, mention lalista in both. Optional subject-line
emoji rejected at spec time — quieter without it.)

### HTML body

Both templates share a single visual layout, differ only in the hero copy +
CTA.

- Outer background: `#FDFAF6` (cream — light-mode-only per **D12**).
- Single centered card, max-width 480px, white background, 24px padding, 8px
  border-radius.
- Inline logo at the top — `<img
src="https://lalista-ten.vercel.app/lalista-email-logo.png" width="120"
height="40" alt="lalista">` (fixed pixel width per email-client-compat
  best practice).
- Hero block: `<h1>` in display serif (Fraunces fallback to system serif),
  e.g. "Confirm your lalista account" / "Reset your lalista password".
- Body: 1-2 sentences in lalista voice. For confirmation: "Tap the button
  below to finish creating your account. The list is waiting." For
  recovery: "Tap the button to set a new password. If you didn't ask for
  this, you can ignore this email."
- CTA button: `#D4603A` background (terracotta accent), white text, 12px
  border-radius, 14px vertical padding, 24px horizontal, full-width on
  mobile breakpoints (`@media (max-width: 480px)` inline). Confirmation CTA:
  "Confirm account". Recovery CTA: "Set new password".
- CTA links to `{{ .ConfirmationURL }}` (Supabase template var — same for
  both flows).
- Footer: small (12px), `#888` text, centered, two paragraphs:
  - Para 1: "Sent through Supabase, our hosting provider — they're just the
    messenger, feel free to ignore the noreply address." (Per **D3**,
    verbatim.)
  - Para 2: "lalista — your bilingual grocery list."

### Sender name + reply-to (D5/D6)

- During implementation, verify the current Supabase `config.toml` schema
  whether `sender_name` (and any reply-to header field) is honored on the
  default SMTP. Today's `[auth.email.smtp]` block in the config has
  `sender_name = "Admin"` only when `[auth.email.smtp]` is enabled (custom
  SMTP) — confirm whether `[auth.email]` itself accepts a top-level sender
  field.
- If yes: set `sender_name = "lalista"` and reply-to to a no-reply address
  the operator chooses.
- If no: leave default and add a PR-body operator note pointing the reader
  at the v1 custom-domain entry. The PR body **must** include this note
  whenever the verification falls to "no" — it's the audit trail for why
  the polish was held.

---

## Logo asset

- Path: `apps/web/public/lalista-email-logo.png`.
- Dimensions: 240×80 source (rendered at 120×40 in email — 2x for retina).
- Format: PNG with a transparent background (works on cream + white card +
  most email clients without ICC-profile drama).
- Referenced in templates by **absolute prod URL**:
  `https://lalista-ten.vercel.app/lalista-email-logo.png`. The logo lives
  in the Vercel-served `apps/web/public/` so the URL resolves immediately
  on first deploy of this PR.
- Local-dev rendering note: Supabase email templates render at send-time on
  Supabase's mail relay, not in the browser, so they need a
  publicly-resolvable URL even when testing locally with inbucket — the prod
  URL is correct for both environments (gotcha (e)).

---

## Task order

Dependency-ordered — matches the 16 Phase 2 tasks in the live tracker and
in the user-approved Phase 0 preview.

1. **Auth layout client component + email-context hook.** Foundation for
   every screen below. `apps/web/app/(auth)/layout.tsx` becomes a client
   component; export `useAuthEmail()`. Tests: minimal render check that the
   provider mounts without error.
2. **`AuthSubmitButton` + unit tests.** Base UI primitive used by every
   form below. Implement the 250ms threshold + isSuccess label swap; ship
   with the full unit test suite.
3. **`AuthErrorDisplay` + unit tests.** Same DOM + class for client +
   server errors.
4. **`AwaitingConfirmationCard` (60s resend).** Lift from inline state in
   `sign-in/page.tsx`. Adopt `AuthSubmitButton` for the resend button. Wire
   `onAuthStateChange` listener.
5. **Refactor `/sign-in`.** Drop displayName + signup fallback + inline
   awaiting-confirmation state. Adopt `useAuthEmail()`,
   `AuthSubmitButton`, `AuthErrorDisplay`. Move `friendlyAuthError` to
   `apps/web/components/auth/friendlyAuthError.ts`.
6. **New `/sign-up` screen.** Email + password only (per **D11**). "Create
   account" button (per **D1**). On no-session response, mount
   `AwaitingConfirmationCard`.
7. **New `/forgot-password` screen.** No-enumeration success copy. 60s
   resend countdown. Edit-email affordance preserves email via context.
8. **`/reset-password` + `/auth/callback`.** Implement together — callback
   redirects to reset-password. Honour **D10** (recovery type always
   redirects, even if session pre-exists).
9. **`OnboardingForm` picks up name field** with helper copy per **D7**.
   Adopt `AuthSubmitButton`.
10. **`middleware.ts` allow-list new unauth routes.** Extend
    `PUBLIC_PATHS`; handle the recovery-callback bypass; cover with tests.
11. **`PublicLanding` CTAs.** Primary "Create account" → `/sign-up`,
    secondary "Sign in" → `/sign-in`.
12. **Branded email templates + logo asset.** Author the HTML in
    `supabase/config.toml`; commit
    `apps/web/public/lalista-email-logo.png`. Verify
    `sender_name` / reply-to availability per **D5**/**D6**.
13. **`METRICS.md` + analytics wrappers.** Add the four new events; new
    constants and emitter helpers in `apps/web/lib/analytics.ts`; extend
    `apps/web/app/providers.tsx` to distinguish sign-up vs sign-in.
14. **`CLAUDE.md` cleanup.** Drop the "expected 400" gotcha, update IA
    public paths, update Where Things Happen § Auth.
15. **Adapt sign-in unit tests + activate skipped E2E.** Split sign-in
    tests; activate `auth-edge-cases.spec.ts:289`.
16. **New E2E specs.** `sign-up.spec.ts` + `forgot-password.spec.ts`.

---

## Dependencies

**No new packages required.** The Supabase JS SDK already exposes
`signInWithPassword`, `signUpWithPassword`, `resetPasswordForEmail`,
`updateUser`, `exchangeCodeForSession`, and `resend`. Confirm during
`/ak-implement` Phase 2 by reading `node_modules/@supabase/supabase-js/dist/
module/index.d.ts`. If a method turns out to be gated behind a newer SDK
release than the workspace pins, the implementation step bumps the pin and
notes it in the PR body.

---

## Gotchas

(a) **`/auth/callback` must NOT require auth.** The handler itself creates
the session via `exchangeCodeForSession`. Listed in `PUBLIC_PATHS`. If
middleware bounces tokenized requests to `/sign-in`, the user gets stuck in
a loop because the link they clicked never completes the exchange.

(b) **Submit-time validation only — no as-you-type.** Validating on every
keystroke is the v0 pattern for "this form feels overengineered." Run
client checks (email format, password min length, confirm-password match)
**inside** the form's submit handler. Render results via
`AuthErrorDisplay`.

(c) **`/forgot-password` no-enumeration.** Always render the success copy,
regardless of whether the email belongs to a registered user. Don't
inspect `resetPasswordForEmail`'s response shape for "user found"
information — Supabase intentionally returns success either way, and the
front-end must not undo that.

(d) **`AwaitingConfirmationCard` stays mounted until session lands a
confirmed user.** Use `onAuthStateChange` — when `SIGNED_IN` fires (after
the user follows the confirmation link in another tab + returns to the
app), `router.replace('/onboarding')`. Don't poll, don't time out, don't
auto-dismiss.

(e) **Email templates' inline logo URL is the prod domain even in local
dev.** Supabase email templates render at send-time on Supabase's mail
relay, not in the browser, so they need a publicly-resolvable URL. Local
dev (with `supabase functions serve` + inbucket) will fetch the same prod
URL when rendering the email — that's correct, not a bug. If the prod URL
ever 404s, every dev's local inbucket gets a broken-image email.

---

## Acceptance / rollout / rollback

### Happy paths (one per new surface)

- **Sign-in.** `/sign-in` → email + password → submit → land on
  `/onboarding` (or `/list` if user already has a household).
- **Sign-up.** `/sign-up` → email + password → submit → awaiting-
  confirmation card → click email link → land on `/onboarding`.
- **Forgot password.** `/sign-in` → "Forgot password?" → fill email →
  success copy → click email link → `/reset-password` → set new password
  → land on `/list`.
- **Resend confirmation.** `/sign-up` → submit → awaiting-confirmation card
  → wait 60s → click "Resend confirmation email" → second email arrives.
- **Resend forgot-password.** `/forgot-password` → submit → success state
  → wait 60s → click "Resend (0:00)" → second reset email arrives.
- **Recovery while signed in.** Already-signed-in user clicks a recovery
  email link → `/auth/callback?type=recovery` → handler redirects to
  `/reset-password` (per **D10**), even though session already exists.
- **Onboarding name.** First-time user fills "Your name" + household name
  → `updateMyProfile` runs first, then `createHousehold`, then
  `router.push('/list')`.

### Rollout

- Deploy via the standard Vercel push-to-main pipeline. No schema migration,
  no edge-function deploy. The branded email templates ship via Supabase's
  `config.toml` push, which happens through `supabase db push` (or, in
  practice, Supabase Studio — `config.toml` is currently authored locally
  but the prod project's Auth settings are the runtime source of truth).
  **Implementation step**: confirm whether `config.toml` is auto-applied to
  prod or whether the operator must paste the templates into the Supabase
  dashboard. If the latter, add a PR-body operator step.
- Logo asset must be present at the prod URL on first email send — Vercel
  deploys `apps/web/public/lalista-email-logo.png` automatically on merge.

### Rollback

- Revert the PR. No schema, no edge-function, no data-migrating action.
  Pre-revert email links stay valid (Supabase tokens encode their own
  expiry; reverting the front-end doesn't invalidate them).
- Open issue if the email templates were applied via dashboard paste —
  re-paste the prior default templates to undo branding.
