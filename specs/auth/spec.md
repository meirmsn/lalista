<!-- gstack-plan: /home/node/.claude/plans/we-decided-to-do-scalable-shore.md -->
<!-- generated-by: /ak-spec -->
<!-- date: 2026-04-17 -->

# Spec: auth (PR 2)

**Sources:**

- `/home/node/.claude/plans/we-decided-to-do-scalable-shore.md` § PR 2 (Auth)
- `/devshop/kit/notes/bootstrap/v0-web.md` § 1d (Auth — web)

Email/password sign-in + household onboarding + route protection middleware. Apple Sign-In deferred until Apple Developer account is approved (tracked in `TODOS.md`). PR 1 already shipped the `@lalista/core` auth + household API wrappers — this PR wires them into the Next.js App Router.

---

## In scope

### Screens

- `apps/web/app/(auth)/sign-in/page.tsx` — email + password form.
  - **Single "Continue" button** that calls `signInWithPassword` first; if the response is `{ error: { message: /invalid.*credentials/i } }`, fall back to `signUpWithPassword` with the same email/password. On either success, redirect client-side to `/onboarding` (middleware handles further routing). This "sign-in-then-signup fallback" keeps the form to one button per v0 simplicity. Rationale: demo users and first-time users take the same path; invalid-password errors for existing accounts still surface (message isn't "Invalid login credentials").
  - No Apple button. Leave a commented `{/* TODO(apple-sso): see TODOS.md */}` stub at the bottom of the form.
  - Disabled state while the request is in-flight.
  - Error states: inline error text below the form (red `text-error` token) for bad credentials, network error, and email-format error. No toast.
  - `<Input>` components for email + password, `<Button>` for continue, `<Card>` wrapper, `<Text>` for headings.

- `apps/web/app/(auth)/onboarding/page.tsx` — post-sign-in household gate.
  - Server component reads the session via `@supabase/ssr` `createServerClient`. Calls `fetchUserHouseholds(client, user.id)`.
  - If >= 1 household: immediately `redirect('/')` (server-side). The placeholder list at `apps/web/app/page.tsx` will be replaced in PR 3 — `/` is the correct post-onboarding destination for now.
  - If 0 households: render a client-side "Create household" form (name input + Create button) + a static "Ask a family member to add you (coming soon)" placeholder panel, separated by `<Divider>`.
  - On submit: call `createHousehold(client, user.id, name.trim())`. On success, `router.push('/')`. On error: inline error under the input.
  - Disabled state while creating. Min length 1 (trimmed); max 64.

### Middleware

- `apps/web/middleware.ts` — `@supabase/ssr` based. New dev dependency: `pnpm add @supabase/ssr --filter apps/web` (if not already in PR 1 — verify during Phase 2).
  - For every request matching the route matcher (see below):
    1. Build a server client using `createServerClient` with `request.cookies` adapter.
    2. `await supabase.auth.getUser()` — if null, and the path is NOT `/sign-in`, redirect to `/sign-in` (preserve `next` query param).
    3. If user is present and path is `/sign-in`, redirect to `/onboarding` (middleware does not itself query households; `/onboarding` does the DB check and redirects if a household exists).
    4. Otherwise, call `supabase.auth.getUser()` has already refreshed the cookie — return `NextResponse.next()` with the propagated cookies.
  - Route matcher (`config.matcher`): `['/((?!_next/static|_next/image|favicon.ico|manifest.json|icons).*)']`. This covers all app routes while excluding static assets, the manifest, and icon endpoints. `/sign-in` and `/onboarding` are included in the matcher (middleware runs, but the above rules let them through without loops).
  - **No DB query in middleware** — keeps it fast and avoids the household race. The household-gate happens on `/onboarding` as a server component. This is a deliberate split and documented in a file header comment.

### API wrapper consumption (no new wrappers)

Consume from `@lalista/core` (exports already landed in PR 1):

- `signInWithPassword(client, email, password)`
- `signUpWithPassword(client, email, password)`
- `signOut(client)`
- `getSession(client)` / `getUser(client)`
- `onAuthStateChange(client, callback)`
- `fetchUserHouseholds(client, userId)`
- `createHousehold(client, userId, name)`

The Next client wrapper is a thin helper: `apps/web/lib/supabase/client.ts` (browser) and `apps/web/lib/supabase/server.ts` (server/middleware). Both call `createClient({ url, anonKey })` from `@lalista/core` but pass the `@supabase/ssr` cookie adapter for the SSR flavors. Do NOT re-implement the API wrappers in the web app.

### Design constraints (DESIGN.md frozen)

- Use `@lalista/ui` primitives only: `Button`, `Text`, `Card`, `Input`, `Divider`.
- Token utility classes only: `bg-background`, `bg-surface`, `text-text-primary`, `text-text-secondary`, `text-error`, `border-border`, `rounded-default`, `p-md`, `p-lg`, `gap-sm`, etc. No raw hex values. No new Tailwind custom values.
- Layout: centered card on desktop (`max-w-sm` equivalent in tokens = `max-w-[400px]`), full-width with `p-md` on mobile. Vertical center via `min-h-full` + `grid place-items-center`.
- Typography: `<Text variant="heading-lg">lalista</Text>` display serif as the app mark; `<Text variant="body">` for helper text; `<Text variant="caption">` for field labels.
- Dark + light both work (verified by existing token pipeline — no new tokens).

---

## Out of scope

- Apple Sign-In (button, OAuth flow, Service ID config). Add entry to `TODOS.md`: `apple-sso: wire once Apple Developer account approved (deferred from PR 2)`.
- Password reset / "forgot password" link.
- Email confirmation flow (Supabase project is configured to auto-confirm; if that changes, revisit).
- Join-household invite flow (placeholder copy only).
- List view, add-item, item detail, settings (PR 3 scope).
- Rate-limiting sign-in attempts (Supabase handles this server-side for us in v0).
- `auth_signed_up` event (intentionally collapsed into `auth_signed_in` with `method: 'email'` — signup-then-signin fires the same event).

---

## Data model changes

**No schema changes.** Tables `households` and `household_members` exist from PR 0 migrations. Seeded users and households in `supabase/seed.sql` are reused by E2E tests.

---

## API contracts

No new HTTP endpoints. All interactions go through the Supabase JS client using the anon key + user JWT. RLS policies on `households` and `household_members` already restrict writes to `auth.uid()` (verified in existing migrations).

- Sign-in: `POST` to Supabase Auth via SDK — returns `{ user, session }` or `{ error }`.
- Sign-up: same, with optional email-confirmation-required response shape.
- Household create: two client inserts (`households` then `household_members`), both RLS-guarded.
- Route protection: middleware reads `sb-*` cookies, refreshes via `@supabase/ssr`.

---

## Offline behavior

**Online-only with error state** (option (a) from `/ak-spec` offline matrix). If Supabase is unreachable during sign-in or household creation, show the inline error: "Can't reach the server. Check your connection and try again." No queuing, no local cache. Matches the v0 offline strategy documented in PRODUCT-ROADMAP.md.

---

## Metrics

Two **new** events (defined in `METRICS.md` via this spec — appended by `/ak-spec` after confirmation):

| Event             | Fires on                                                                                                                               | Properties                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `auth_signed_in`  | Successful session create (either fresh sign-in OR signup-then-autologin). Fires inside `onAuthStateChange` when event is `SIGNED_IN`. | `{ method: 'email' }`                                                       |
| `auth_signed_out` | `signOut()` resolves successfully. Fires inside the settings page (PR 3) AND any programmatic sign-out (e.g. session expired).         | `{ session_duration_seconds: number }` (computed from `session.created_at`) |

Instrumentation in `/ak-implement`:

- `apps/web/lib/analytics.ts` — small wrapper around `posthog.capture` to centralize the event name constants.
- Hook into `onAuthStateChange` once at app boot (wire inside `apps/web/app/providers.tsx`).

No existing events touched.

---

## Tests

### Unit tests (Vitest)

All new, all in colocated `*.test.ts(x)` files:

1. `apps/web/app/(auth)/sign-in/page.test.tsx` — **asserts behavior, not markup**:
   - Renders email + password inputs and a "Continue" button.
   - Submit with valid creds calls `signInWithPassword` once with the exact email/password.
   - `Invalid login credentials` response triggers a fallback call to `signUpWithPassword`.
   - Non-credential errors (e.g. network) show the inline error and do NOT fall back.
   - Email format validation: empty or missing `@` blocks submit with inline error.
   - Button is disabled while request is in-flight.

2. `apps/web/app/(auth)/onboarding/page.test.tsx`:
   - Server-component path: if `fetchUserHouseholds` returns a non-empty array, redirect is called with `/`.
   - Client form: submit calls `createHousehold` with the trimmed name.
   - Empty-string + whitespace-only submit is blocked.
   - Error from `createHousehold` surfaces inline.

3. `apps/web/lib/supabase/server.test.ts` + `client.test.ts` — smoke tests that `createServerClient` / `createBrowserClient` are called with the correct env vars and cookie adapter (mock `@supabase/ssr`).

4. `apps/web/middleware.test.ts`:
   - Unauth request to `/` redirects to `/sign-in`.
   - Unauth request to `/sign-in` passes through.
   - Authed request to `/sign-in` redirects to `/onboarding`.
   - Authed request to `/` passes through (household gate is `/onboarding`'s job, not middleware's).
   - Static asset paths (`/_next/static/foo`) are not matched by the matcher (test the matcher regex directly).

### E2E (Playwright — mobile 375 + desktop 1440)

`apps/web/e2e/auth.spec.ts` — happy path:

- **Approach**: create a **fresh user** inside each test (timestamped email: `e2e-${Date.now()}@example.com` / `password123`). `example.com` is the RFC 2606 reserved TLD for testing; Supabase's email validator rejects `.local` TLD as invalid. Rationale for a fresh user: the seeded users (`alice@test.local`, `bob@test.local`) already have households, so they skip the onboarding flow we need to verify; `@test.local` works for seeded users because `seed.sql` inserts directly into `auth.users` and bypasses the Supabase Auth validator. A fresh user exercises sign-up → onboarding → household create in one path. Cleanup: tests run against local Supabase which is reset between CI runs via `supabase db reset`; no per-test teardown needed.
- Steps:
  1. Navigate to `/` → redirected to `/sign-in`.
  2. Type fresh email + `password123` → click Continue.
  3. Land on `/onboarding`.
  4. Type household name "Casa E2E" → click Create.
  5. Land on `/` (the PR 1 placeholder home; PR 3 replaces with list view).
  6. Assert the placeholder home renders (specific text or data-testid that already exists on `apps/web/app/page.tsx`).
- Run at both viewports (the existing `playwright.config.ts` mobile/desktop projects handle this automatically — no test changes needed per viewport).

### Integration tests

None in this PR. Integration tests with a live Supabase container are scoped to PR 4 per the PRD.

---

## Dependencies on PR 1

- `@lalista/core` exports: `createClient`, `signInWithPassword`, `signUpWithPassword`, `signOut`, `getSession`, `getUser`, `onAuthStateChange`, `fetchUserHouseholds`, `createHousehold`. **Verified present** in `/workspace/packages/core/src/index.ts`.
- `@lalista/ui` exports: `Button`, `Text`, `Card`, `Input`, `Divider`. **Verified present** in `/workspace/packages/ui/src/index.ts`.
- Tailwind v4 tokens from `apps/web/app/globals.css`. **Verified present** (light + dark CSS vars + `@theme inline` directive).
- `supabase/seed.sql` with alice@/bob@ (unused for E2E — see above — but may be reused in unit-test mocks via fixed UUIDs).

No new schema, no new edge functions, no new packages in `@lalista/core` or `@lalista/ui`. Only `apps/web` gains new files + `@supabase/ssr`.

---

## New web-app dependency

`pnpm add @supabase/ssr --filter apps/web` — required for cookie-based session handling in middleware + server components. Add to `apps/web/package.json` only.

---

## Files to create

- `apps/web/app/(auth)/sign-in/page.tsx` (client component)
- `apps/web/app/(auth)/sign-in/page.test.tsx`
- `apps/web/app/(auth)/onboarding/page.tsx` (server + nested client form)
- `apps/web/app/(auth)/onboarding/page.test.tsx`
- `apps/web/app/(auth)/layout.tsx` (thin auth-shell; centered card container)
- `apps/web/middleware.ts`
- `apps/web/middleware.test.ts`
- `apps/web/lib/supabase/client.ts`
- `apps/web/lib/supabase/server.ts`
- `apps/web/lib/supabase/client.test.ts`
- `apps/web/lib/supabase/server.test.ts`
- `apps/web/lib/analytics.ts`
- `apps/web/e2e/auth.spec.ts`

## Files to modify

- `apps/web/app/providers.tsx` — wire `onAuthStateChange` → `auth_signed_in` capture.
- `apps/web/package.json` — add `@supabase/ssr` dep.
- `METRICS.md` — append `auth_signed_in` and `auth_signed_out` rows (done by `/ak-spec` on confirmation).
- `TODOS.md` — add `apple-sso` follow-up entry. Create file if missing.

---

## Verification (maps to `/ak-pre-ship` gates)

- [ ] `pnpm turbo run lint` clean
- [ ] `pnpm turbo run typecheck` clean
- [ ] `pnpm turbo run test:unit` green (new tests above all pass)
- [ ] `pnpm --filter @lalista/web exec playwright test` green at 375 + 1440
- [ ] `pnpm turbo run build` green (Next.js production build, no middleware warnings)
- [ ] `/simplify` — no duplicated helpers; `lib/supabase/*.ts` is minimal glue, not a reimplementation of `@lalista/core`.
- [ ] `/ak-test-review` — unit tests assert behavior not markup; E2E uses fresh user not seeded; middleware tests cover all 4 matrix cells (auth × path).
- [ ] `/review` — no `SELECT *` from middleware (middleware doesn't query DB); no conditional hooks; no hard-coded Supabase URL.
- [ ] `/cso` — `@supabase/ssr` pinned to exact version; no `service_role` key touched client-side; middleware cookie handling returns `NextResponse` with propagated `set-cookie` headers; sign-up route does not allow enumerating existing emails beyond what Supabase itself exposes.
- [ ] `/design-review` — passes at 375/1440 × light/dark (4 combos). Spacing on the 8px grid. No new color.
- [ ] `/qa` — happy path works live on Vercel preview. Sign out (triggered via browser devtools `supabase.auth.signOut()` since Settings is PR 3) redirects back to `/sign-in`.
- [ ] `/benchmark` — middleware adds < 50ms p95 to page loads.
- [ ] Convention check — new files have `// What: / // Why: / // Does NOT:` headers.
- [ ] `METRICS.md` contains `auth_signed_in` and `auth_signed_out`.
- [ ] `TODOS.md` contains `apple-sso` entry.
- [ ] PR description references `we-decided-to-do-scalable-shore.md § PR 2` and `v0-web.md § 1d`.
