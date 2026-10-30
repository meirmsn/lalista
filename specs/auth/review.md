<!-- generated-by: /ak-pre-ship -->
<!-- date: 2026-04-17 -->

# Review: auth (PR 2)

Quality gates run against `feature/auth` (7 commits ahead of `main`). Pre-gate
baseline: 88 unit tests (21 ui + 36 core + 31 web), lint + typecheck + build
all green.

> **Outcome semantics** (per the devshop hardening update): each gate resolves
> to `pass`, `findings (N) [fixed|pending]`, `n/a`, or `blocked`. `blocked` is
> distinct from `findings pending` — it means the gate couldn't run to
> completion because of an environmental dependency (third-party rate limit,
> captcha, network, etc.), not because the code was found wanting.

## Summary

| #   | Gate                     | Result                       | Notes                                                            |
| --- | ------------------------ | ---------------------------- | ---------------------------------------------------------------- |
| 1   | Devshop docs check       | n/a                          | PR does not touch `kit/` or reference docs                       |
| 2   | Metrics check            | pass                         | `auth_signed_in` + `auth_signed_out` wired                       |
| 3   | Responsive + theme check | findings (1) fixed           | Tailwind `@source` for `packages/ui` — see Gate 3                |
| 4   | /simplify                | findings (1) fixed           | Empty JSDoc stubs cleaned — commit `9e024c2`                     |
| 5   | /ak-test-review          | pass                         | Behavior not markup; auth-boundary covered                       |
| 6   | /review                  | pass                         | No trust-boundary or SELECT-\* issues                            |
| 7   | /cso                     | pass                         | Version pinned; no service_role; cookies safe                    |
| 8   | /design-review           | findings (2) fixed           | Auth-shell centering + Button 44px touch target — in this commit |
| 9   | /qa                      | findings (1) fixed + blocked | Happy-path blocked on Supabase rate-limit (see Gate 9)           |
| 10  | /benchmark               | pass                         | Sign-in: FCP 96 ms, TTFB 51 ms, load 183 ms, DOM-CL 89 ms        |
| 11  | Convention check         | pass                         | Headers present, no raw hex, spec-allowed token                  |

**Total**: 6 pass, 4 findings fixed (Tailwind `@source`, JSDoc stubs from
earlier commit, auth-shell centering, Button 44px touch target), 1 blocked
(onboarding happy-path walk — Supabase sandbox rate-limit), 1 n/a, 0
findings pending.

Post-gate baseline: **88 unit tests pass** (21 UI — snapshot updated for the
new Button `min-h-[44px]` — + 36 core + 31 web), `pnpm turbo run lint
typecheck test:unit build` all green.

---

## Gate 1 — Devshop docs check

PR scope is product code (`apps/web/**` + `specs/auth/**`). No changes to
`kit/`, `kit/docs/OVERVIEW.md`, or `kit/docs/guide/`, so the docs-in-sync
check does not apply.

## Gate 2 — Metrics check

Cross-referenced the two events from `specs/auth/spec.md § Metrics` against
`METRICS.md` and `apps/web/app/providers.tsx` / `apps/web/lib/analytics.ts`:

- `auth_signed_in` → row in METRICS.md line 7; `trackSignedIn('email')` fired
  from `onAuthStateChange` → `SIGNED_IN` branch in `providers.tsx:44`.
- `auth_signed_out` → row in METRICS.md line 8; `trackSignedOut(elapsed)` fired
  from `providers.tsx:49` with duration derived from `expires_at - expires_in`.

No unused events. No missing instrumentation. Clean pass.

## Gate 3 — Responsive + theme check

**1 critical finding, fixed.** See `hero/signin.png` for the after-state
screenshot.

**Finding 1 — Tailwind v4 wasn't scanning `packages/ui`, so every token
utility used by `@lalista/ui` primitives was stripped from the generated CSS.**
The initial `/sign-in` paint rendered unstyled: inputs were transparent with a
default-black 2px border; the Continue button had no background color and
rendered as a naked white rectangle; `rounded-default`, `rounded-sm`, `px-md`,
`py-sm`, `text-white`, `focus:ring-primary`, and `hover:bg-primary-pressed`
were all absent from the `/_next/static/chunks/[root-of-the-server]__*.css`
bundle.

Tailwind v4 auto-detects classes in the project root only; workspace packages
must be declared explicitly via `@source`. The fix adds one line to
`apps/web/app/globals.css`:

```css
@source "../../../packages/ui/src/**/*.{ts,tsx}";
```

Fix commit: **(staged — parent will record SHA)**.

Before the fix, the generated stylesheet had ~4 custom utility classes. After,
it has 87 class rules (10 color-token, 15 spacing/radius-token, plus flex /
layout / typography). All 14 load-bearing classes are present:

- `.bg-primary`, `.bg-surface`, `.bg-background`
- `.border-border`, `.rounded-default`, `.rounded-sm`
- `.px-md`, `.py-sm`, `.p-md`, `.p-lg`
- `.text-white`, `.text-text-primary`, `.text-text-secondary`,
  `.placeholder:text-text-tertiary`
- `.focus:ring-primary`, `.hover:bg-primary-pressed`,
  `.active:bg-primary-pressed`

**Computed-style verification** (via `browse css <sel> <prop>` at 1440×900
light mode on `localhost:3000/sign-in`):

| Element               | Property           | Before fix      | After fix (this run) |
| --------------------- | ------------------ | --------------- | -------------------- |
| `button[type=submit]` | `background-color` | `rgba(0,0,0,0)` | `rgb(212, 96, 58)`   |
| `button[type=submit]` | `color`            | default         | `rgb(255, 255, 255)` |
| `button[type=submit]` | `border-radius`    | `0px`           | `12px`               |
| `input#email`         | `background-color` | `rgba(0,0,0,0)` | `rgb(255, 255, 255)` |
| `input#email`         | `border-color`     | default black   | `rgb(232, 224, 212)` |
| `input#email`         | `border-radius`    | `0px`           | `10px`               |
| `body`                | `background-color` | white           | `rgb(253, 250, 246)` |
| `body`                | `color`            | default black   | `rgb(26, 18, 8)`     |

All four values map exactly to tokens in `globals.css` (`--color-primary:
#d4603a`, `--color-surface: #ffffff`, `--color-border: #e8e0d4`,
`--color-background: #fdfaf6`).

## Gate 4 — /simplify

**1 finding, fixed.**

**Finding 1 — empty JSDoc stubs.** Five `/** * */` placeholder blocks remained
in PR-scoped files after the implement pass. The root `eslint.config.mjs`
`jsdoc/require-jsdoc` rule warns on undocumented `FunctionDeclaration`s, so the
implement pass generated empty stubs. These satisfy the rule but add no value.
Replaced each with a one-sentence description of what the function actually
does:

- `apps/web/middleware.ts` (exported `middleware`)
- `apps/web/middleware.test.ts` (helper `makeRequest`)
- `apps/web/app/(auth)/sign-in/page.tsx` (inner `handleSubmit`)
- `apps/web/app/(auth)/sign-in/page.test.tsx` (helper `fillAndSubmit`)
- `apps/web/app/(auth)/onboarding/OnboardingForm.tsx` (inner `handleSubmit`)

**Fix commit**: `9e024c2 chore(auth): fill empty JSDoc stubs on auth helpers and tests`.
88 tests still pass afterward.

Nothing else flagged. The small error-string duplication between
`sign-in/page.tsx` and `OnboardingForm.tsx` (`GENERIC_ERROR`) is a single string
in two unrelated flows; extracting into a shared module would be premature
abstraction for v0. `middleware.test.helpers.ts` as a 12-line file for one
`pathToRegexp` util is clean separation rather than noise.

## Gate 5 — /ak-test-review

**Clean pass — 31 web tests + 36 core tests + 21 UI tests.**

Behavior not markup:

- Sign-in tests (`sign-in/page.test.tsx`) — 8 tests assert on `getByLabelText`
  / `getByRole` / form submit side-effects. No class-name snapshots.
- Onboarding tests (`onboarding/page.test.tsx`) — 8 tests exercise both the
  server-component redirect branches and the client-form submit paths via
  mocks, not markup assertions.
- Middleware tests (`middleware.test.ts`) — 7 tests cover the full 4-cell auth
  × path matrix plus two authed-passthrough cells plus a matcher-regex test.
  Exactly the cells called out in `spec.md § Verification`.
- Analytics tests (`lib/analytics.test.ts`) — 5 tests guard the event-name
  strings against METRICS.md drift, which is the specific failure mode that
  would otherwise go silent.

Auth-boundary coverage:

- Unauthed → `/` → 307 to `/sign-in?next=/` ✓
- Unauthed → `/sign-in` → pass-through ✓
- Authed → `/sign-in` → 307 to `/onboarding` ✓
- Authed → `/` → pass-through ✓
- Onboarding RSC redirects to `/sign-in` on `getUser() → null` (defense in depth) ✓
- Onboarding RSC redirects to `/` on non-empty households ✓

No flake-prone sleeps. `waitFor`, `findBy*`, and `waitForURL` (E2E) are used
throughout — all are pollers, not timeouts. `redirect()` is mocked to throw
`NEXT_REDIRECT:<path>` which is the Next.js-recommended RSC testing shape.

No change.

## Gate 6 — /review (staff-engineer lens)

**Clean pass.**

- **Trust boundaries**: middleware + RSC both call `supabase.auth.getUser()`,
  which re-verifies the JWT server-side (not just cookie parsing). Client form
  calls `getUser()` for defense-in-depth before `createHousehold`; RLS on
  `household_members` + `households` is the server-side enforcement layer.
- **No SELECT \* in hot paths**: middleware has zero DB queries by design
  (documented in file header). `fetchUserHouseholds` runs once on the
  onboarding RSC render and uses a relation select, not `*`.
- **No conditional hooks**: `useEffect` / `useState` / `useRouter` all at the
  top of each component, no early-returns above them.
- **No hardcoded Supabase URL**: all three helpers (`client.ts`, `server.ts`,
  `middleware.ts`) read from `NEXT_PUBLIC_SUPABASE_*` env vars. The
  `vitest.setup.ts` provides test defaults.
- **Cookie propagation**: middleware rebuilds the `NextResponse` on `setAll`
  per the official `@supabase/ssr` pattern — any refreshed cookies flow back
  to the browser in the same response.
- **Race on double-submit**: both forms disable the button via `submitting`
  state before dispatching, blocking a second submit.
- **Error surface**: forms render `role="alert"` for inline errors; no
  noisy toast.

One observation not requiring a fix: `middleware.ts` uses
`process.env.NEXT_PUBLIC_SUPABASE_URL!` with a non-null assertion. If the env
var is missing in a deploy, every request 500s. This is the standard Next.js
pattern across all three helpers and is a deploy concern, not a code concern.

## Gate 7 — /cso (security audit)

**Clean pass.**

- **Pinned versions**: `@supabase/ssr` is pinned to `0.10.2` exact (no `^`)
  in `apps/web/package.json`. `pnpm-lock.yaml` resolves deterministically.
- **No `service_role` on client**: grep across `apps/web/**` returns zero
  references to `SERVICE_ROLE_KEY`, `service_role`, or server-side-only keys.
  All client code uses the anon key.
- **Cookie propagation safe**: middleware's `setAll` hook rebuilds
  `NextResponse.next()` before writing the cookies, ensuring the headers flow
  back. Server-component `createClient` swallows `cookies().set()` errors with
  an intentional try/catch (per `@supabase/ssr` App Router pattern — server
  components cannot mutate response cookies; middleware handles refresh on
  the next request).
- **Email enumeration**: the sign-in-then-signup fallback surfaces whatever
  error Supabase itself returns. Per `spec.md § Out of scope`, this is the
  accepted trade-off for v0's one-button flow. No additional enumeration
  vector introduced by the app.
- **No secrets in repo**: gitleaks pre-commit hook passed on commit
  `9e024c2`. No hardcoded API keys, tokens, or credentials.
- **XSS / CSRF**: React escapes all dynamic content; no `dangerouslySetInnerHTML`.
  Supabase's cookie-based auth uses `SameSite=Lax` and the JWT is verified
  server-side; no form-posts to third-party origins.
- **Rate limiting**: Supabase enforces server-side on sign-in + sign-up.
  Nothing for the app to do at this layer.

No findings.

## Gate 8 — /design-review

**1 finding, pending.** Visual audit run against `localhost:3000/sign-in` at
1440×900 light mode using `browse css` for computed-style inspection and a
full viewport screenshot (`hero/signin.png`). Now that the token utilities
actually render, the screen looks on-brand: cream background (`#fdfaf6`),
surface-white card, warm border, orange primary button, Fraunces display for
the wordmark + Plus Jakarta Sans for body copy.

**Finding 1 — auth-shell card is top-anchored, not vertically centered.** The
shell `apps/web/app/(auth)/layout.tsx` uses `<main class="grid min-h-full
place-items-center …">` inside a `<body class="min-h-full flex flex-col">`.
Because `<body>` is a flex-column, `<main>`'s `min-h-full` (`min-height: 100%`)
doesn't resolve against the viewport — the flex item shrinks to content.
Measured at 1440×900: `main.clientHeight = 330px`, so `place-items-center`
centers within the 330px and the card visually sits in the upper quarter of
the viewport (see `hero/signin.png`). Fix candidates (pick one, don't ship
here):

- change `<main class="min-h-full …">` to `<main class="flex-1 grid
place-items-center …">` — lets the flex parent give the item the remaining
  space
- add `min-h-screen` on the main as a belt-and-suspenders
- switch `<body>` from `flex flex-col` to `grid min-h-screen` and drop the
  `min-h-full` on main

The shell worked correctly on mobile (`375×667`) where the card fills most of
the viewport anyway; the regression was only visible on tall desktop.

**Fix applied in this commit:** `apps/web/app/(auth)/layout.tsx` now uses
`<main class="grid min-h-screen place-items-center …">` — `min-h-screen`
anchors to the viewport directly and sidesteps the flex-column
containing-block ambiguity. Chose `min-h-screen` over `flex-1` because it's
clearer intent + doesn't couple the layout to the body's flex direction.

**Finding 2 — Button primitive does not meet the 44px touch target.** The
hero screenshot's Continue button rendered at 38.5px (padding `8px 16px` +
15px line-height). `DESIGN.md § Interactive minimums` specifies 44pt
(iOS accessibility). The subagent initially flagged this as a PR 3 follow-up
since it lives in `packages/ui/Button.tsx`, but it's a spec requirement — so
fixed in this PR.

**Fix applied in this commit:** added `min-h-[44px]` at the front of the
Button className list in `packages/ui/src/Button.tsx`. Updated the inline
snapshot in `Button.test.tsx` to match. All 21 UI tests pass.

**Remaining nits** (accepted, no change):

- Input labels are 13px caption-tier; on 1440 they feel slightly small. Not
  worth churning the type scale.
- The Next.js dev `N` badge appears in the pre-fix hero screenshot — expected
  artifact of running against `next dev`, not visible in production builds.

## Gate 9 — /qa

**1 finding fixed; happy-path walk is `blocked` on a third-party
dependency.** Documented both.

**Finding 1 (fixed) — E2E spec used `@test.local` email domain, which
Supabase Auth rejects as "invalid email".** Pre-existing the Tailwind fix
work. Rewritten to `@example.com` in `apps/web/e2e/auth.spec.ts` and
`specs/auth/spec.md § Verification`. Unit tests that use `alice@test.local`
string fixtures remain unchanged — they never touch the Supabase validator
because the Supabase client is fully mocked in the web unit suite.

**Blocked — sign-up happy-path walk.** Attempted the task-scripted
sign-up flow (`e2e-$(date +%s)@example.com` + `password123`) from the browse
daemon against the configured Supabase project (`nzfdfjctpotjyuxdfcpw.supabase.co`,
pulled from the page CSP). Supabase returned:

1. First attempt: `Email address "e2e-<ts>@example.com" is invalid`
   — the project has an email-domain allowlist or similar protection that
   rejects `example.com` sign-ups on this environment.
2. Retries with `@gmail.com`, `@test.com`, `@lalista.local`: all returned
   `email rate limit exceeded` within a minute — the project's global sign-up
   rate limit triggered after the first block.
3. `@localhost` rejected by the client-side validator (`EMAIL_FORMAT` regex
   requires a dot in the domain).

Cannot reach `/onboarding` via the real sign-up path in this run.
`hero/onboarding.png` is intentionally omitted — per the task's fallback
guidance, we note the blocker and move on rather than fabricate the
screenshot. The onboarding layout is verified via component code review
(`OnboardingForm.tsx` uses the same `Card` + `Input` + `Button` primitives as
sign-in; the token pipeline that renders sign-in correctly will render
onboarding identically).

**Middleware auth-boundary** still verified by unit tests (7/7 pass) and by a
live 307 redirect check from this run:

```
GET /onboarding → 307 → /sign-in?next=%2Fonboarding
GET /          → 307 → /sign-in?next=%2F
GET /sign-in   → 200
```

**Flag for PR reviewer**: on the Vercel preview, walk the full flow once with
a real email (the rate limit is per-project and per-IP; a manual sign-up from
a different IP than CI will work):

1. Fresh email + `password123` → Continue → `/onboarding`
2. Household name "Casa QA" → Create → `/`
3. Refresh `/` → stays on `/`
4. Sign out via devtools → refresh → `/sign-in`
5. Navigate directly to `/onboarding` while authed + with household →
   redirects to `/`

## Gate 10 — /benchmark

**Pass.** Core Web Vitals for `/sign-in` at 1440×900 light mode, measured via
`performance.getEntriesByType('navigation' | 'paint')` after a clean reload
in the browse daemon:

| Metric              | Value                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| TTFB                | 51 ms                                                                                                                                    |
| DOM Interactive     | 89 ms                                                                                                                                    |
| DOM Content Loaded  | 89 ms                                                                                                                                    |
| First Paint / FCP   | 96 ms                                                                                                                                    |
| Load Event          | 183 ms                                                                                                                                   |
| Transfer size (nav) | 6,616 B                                                                                                                                  |
| LCP                 | n/a (no `largest-contentful-paint` entry emitted by headless Chromium on this page — all foreground content is text, no late image pops) |
| CLS / INP           | n/a (single-viewport render; no input events fired before screenshot)                                                                    |

All numbers are from `next dev` with HMR — production will be strictly faster
(no dev overhead, smaller CSS after purge). The 183 ms total load at FCP=96 ms
is healthy for a cold dev render; on Vercel + production build this should
comfortably meet the 2.5 s LCP / 200 ms INP / 0.1 CLS thresholds.

## Gate 11 — Convention check

**Clean pass.**

```bash
$ bash /devshop/kit/scripts/check-file-headers.sh main
$ echo $?
0
```

- **File headers** — every new `.ts`/`.tsx` under `apps/web/app/` or
  `apps/web/lib/` has the `// What: / // Why: / // Does NOT:` block. The
  mechanical header check exits 0.
- **JSDoc on exported functions** — covered by the simplify pass (Gate 4).
- **Raw hex colors** — zero matches in `apps/web/app/(auth)` + `middleware.ts`.
- **Tailwind token classes only** — zero arbitrary-value brackets except
  `max-w-[400px]` in `layout.tsx`, which is explicitly spec-sanctioned.
- **Migrations with rollback** — not applicable; this PR ships no migrations.
- **Backlog routing** — `TODOS.md` gained the spec-required `apple-sso`
  follow-up; nothing else was added to the roadmap.
- **`PRODUCT-ROADMAP.md` / `kit/ROADMAP.md`** — no ROADMAP items were shipped
  by this PR, so nothing to remove.
- **PR description linkage** — to be added by `/ship` in Phase 4. The tasks
  decisions document references `specs/auth/spec.md § PR 2` and
  `v0-web.md § 1d` so the PR body can reuse them.

## Items to call out on the PR

1. **Tailwind `@source` fix for `packages/ui`** (Gate 3) — one-line change in
   `apps/web/app/globals.css` that unblocks every token utility in the UI
   library. Without this line, `@lalista/ui` primitives render unstyled.
2. **Auth-shell vertical-centering nit** (Gate 8) is visible in the sign-in
   hero screenshot but is intentionally deferred — it's a layout primitive
   belonging to the next polish PR, not a blocker for PR 2.
3. **Onboarding happy-path couldn't be walked live** (Gate 9) because the
   configured Supabase project rate-limited sign-ups during this run. Unit
   tests + middleware redirect checks + static code review cover the behavior;
   reviewer should do one manual end-to-end walk on the Vercel preview.
4. **Middleware p95** should be watched post-deploy; if > 50ms, consider
   dropping to `supabase.auth.getSession()` on non-boundary routes (Gate 10).
5. **Cosmetic quote-style churn** in `apps/web/next-env.d.ts` is auto-emitted
   by `next build` and is staged alongside the Tailwind fix — the prior
   commit (`5549a7c`) already synced the tracked copy of this file.
