# Product Roadmap

Chapter-grain forward plan. Holds two kinds of work:

- **Current-version epic (v0)** — the active migration broken into chapters
  (1a, 1b, …). Chapters get sliced into PR-grain rows on `PLAN.md` as they
  become next-up, then move to `BUILD-LOG.md` when they ship.
- **Deferred (v1, v+)** — things the app will eventually want, intentionally
  skipped in the current version to avoid premature complexity.

For the near-term PR queue: `PLAN.md`. For shipped history: `BUILD-LOG.md`.
Bugs and small fixes go in `TODOS.md`.

---

## v0 (Swift → React migration)

Goal: web app is a full replacement for the core flows of the Swift app. All core flows work: sign in, add item, view list, mark bought, settings. All tests green. CI passing.

<!-- 1a-1i shipped — see BUILD-LOG.md for the rich record. Keeping forward-looking chapters only. -->

### 1j: Zod validation at the LLM boundary

**Motivation:** `packages/core/src/api/addItem.ts` invokes the `add-item` edge function and receives a typed response via `client.functions.invoke<AddItemResponse>(...)`. The generic is a compile-time assertion only — the SDK returns whatever the server sent, cast to the declared type with no runtime check. The LLM (Claude Sonnet) produces the structured JSON inside the edge function, so a future prompt tweak, model swap, or edge-function refactor that drops a field would crash the client at the use-site (`response.canonical_item.name` throws on undefined) with a cryptic error far from the source. This is the one boundary in lalista where TypeScript's compile-time guarantees give us nothing at runtime.

**Scope:**

1. **Add zod to `packages/core`**: `pnpm add zod --filter @lalista/core`.
2. **Schema mirroring `AddItemResponse`** in `packages/core/src/schemas/addItem.ts` — mirror the nested shape (`entry_id`, `canonical_item { id, name }`, `store { id, name, confidence? }`, `brand`, `needs_followup`, `disambiguation_options[]`, `added_new?`). Export `AddItemResponseSchema` alongside the existing `AddItemResponse` type; use `z.infer` to keep the two in sync so there's one source of truth.
3. **Parse at the boundary** in `invokeAddItem`: replace the generic cast with `AddItemResponseSchema.safeParse(data)`. On failure, report to Sentry with the raw payload (scrubbed of PII) and throw a typed `AddItemValidationError`. `.safeParse()` (not `.parse()`) gives us a chance to surface the failure in observability before the existing error boundary catches the throw.
4. **Permissive objects**: use `.passthrough()` on object schemas so unknown fields (forward-compat from future edge-function additions) don't throw. Strict only on required shape.
5. **Tests** in `addItem.test.ts`:
   - Valid fixture parses cleanly and returns the typed response
   - Missing required field surfaces a validation error with a readable path
   - Extra unknown field passes through without throwing

**Explicit non-scope (by design):**

- **Supabase DB queries.** Generated types in `packages/core/src/supabase.types.ts` + the CI type-drift check in `.github/workflows/ci.yml` already cover this boundary. Belt-and-suspenders without payoff until we hit an actual drift bug.
- **Form inputs.** Sign-in email/password already has HTML5 + Supabase SDK validation. Revisit only if we grow more user-input surfaces.
- **Other edge functions.** `add-item` is the only LLM-backed surface today. Extend Zod coverage only when a new LLM-backed function ships.

**Open `/ak-spec`-time decisions:**

1. **Parse in wrapper or in edge-function return?** Client-side parsing is necessary (the server output is what we distrust); adding server-side is belt-and-suspenders that only catches Claude's malformed output, which the wrapper catches anyway. Default: client-only unless review disagrees.
2. **Validation error UX:** reuse the existing "Couldn't add item" toast, or surface a distinct "Something unexpected came back — try again"? User-visible difference is zero in practice; Sentry is what actually routes the bug. Default: reuse the existing toast copy.

**Convention:** PR 6 adopts the runtime-validation pattern shipped upstream (schema in `packages/core/src/schemas/<feature>.ts`, `.safeParse()` + Sentry-scrubbed payload + typed error class, `.passthrough()` on objects for forward-compat). Lalista is the canonical first adopter — the implementation in PR 6 is the verified shape of the pattern.

Source: TODOS.md restructure 2026-04-22 — the prior `add-zod-validation` TODO noted the LLM boundary as the one genuinely unvalidated seam in the app. Cost (~2-3 hrs) is cheap insurance against a rare-but-real crash, hence scheduled before v0 GA.

### 1k: Structured intent parsing at the add-item boundary

**Motivation:** Today the `add-item` edge function uses Claude as a **translator only** — Spanish utterance → normalized canonical phrase → pg_trgm match. This works for single-item adds but ignores everything else a user might say: compound adds ("leche, huevos y mantequilla"), quantities ("2 gallons"), units ("a dozen"), brand hints ("the Daisy cottage cheese"), store hints ("the Costco size"). These all require understanding intent, not just translating words — and they're what dogfooding PR 3 revealed is missing.

**Scope:**

1. **Replace `normalizeWithClaude` in `supabase/functions/add-item/index.ts`** with a structured extraction call returning:

   ```typescript
   interface ParsedIntent {
     items: Array<{
       utterance: string; // canonical phrase for pg_trgm matching
       quantity: number | null;
       unit: string | null;
       brand: string | null;
       store_hint: string | null;
     }>;
   }
   ```

2. **Prompt with household context** — include the household's known stores + recent items — so Claude can resolve "the big one" or "same as last time" against real data.

3. **Loop over `items[]`** — each entry runs through the existing pg_trgm match + store routing pipeline independently. Compound adds become N `list_entries` inserts in one atomic transaction; partial-failure rolls the whole set back.

4. **Write quantity + unit** — `list_entries.quantity` (int) and `list_entries.unit` (text) already exist in the schema; wire them through the new path.

5. **Pass `store_hint` as `confirmed_store_id`** if it matches a known store name (case-insensitive / trigram-similar), bypassing store routing entirely.

6. **Response shape change:** `AddItemResponse` grows an `entries[]` field (array of the existing `entry_id / canonical_item / store / brand` tuple) alongside the current single-entry shape. Client renders N optimistic inserts. `needs_followup` fires per-entry — one compound item needing disambiguation opens the sheet for just that one while the others land silently.

**Edge cases:**

- Claude returns multiple items → each resolved independently, all inserted atomically. Partial resolution failure → whole transaction rolls back; client surfaces one aggregated error.
- Store hint doesn't match any known store → fall back to normal routing (not an error).
- Quantity/unit parsing fails → default to `quantity=1, unit=null` (current behavior).
- `ANTHROPIC_API_KEY` not set → fall back to pg_trgm-only flow (already handled).
- Disambiguation needed for one of N → sheet opens for that one; others land immediately with a combined toast ("Added X, Y — need info for Z").

**Dependency relaxation from v+ → v0:** The original TODO listed `per-household-items-catalog` as a hard dependency so compound cold-starts don't pollute the shared catalog. Single-household v0 can't pollute itself — contamination only matters once a 2nd household joins. The dependency re-applies at second-household onboarding, which is already on the v1 catalog chapter.

**Tests:**

- Edge function unit: fixtures for compound, quantity, brand, store extraction
- Edge function integration: compound utterance → N `list_entries` rows inserted atomically
- `packages/core`: `invokeAddItem` handles N-entry response, optimistic inserts + dedup
- E2E in `apps/web/e2e/core-flows.spec.ts`: "leche, huevos y mantequilla" creates 3 rows; "2 gallons of milk" sets `quantity=2, unit='gallon'`

**Open `/ak-spec`-time decisions:**

1. **Max compound count?** Cap at N=5 per utterance (bounds transaction cost + prompt size), or unbounded?
2. **Context window size:** include full list of recent items (~200 tokens) or stores-only? Affects per-add cost and quality of "the usual" resolution.
3. **Unit normalization:** canonicalize to a known set (`gallon`, `lb`, `oz`, `count`, `dozen`) or accept free-form? Normalized makes rendering consistent; free-form tolerates unusual inputs.
4. **Compound-add disambig UX:** sheet opens for the one needing clarification while others land silently — or stack sheets sequentially? First is less confusing; confirm at spec time.

Source: TODOS.md cleanup 2026-04-22 — promoted from v+ since PR 3 dogfood revealed the single-item limit is felt in practice, and single-household v0 doesn't need per-household-catalog as a hard dependency.

### 1l: Auth UX rework

**Motivation:** Today's `/sign-in` is a single "magic" form: type email, type password, and the page calls `signInWithPassword` first then falls back to `signUpWithPassword` on `Invalid login credentials` — meaning the same screen creates accounts for new emails. That's clever but the UX is confused: users see a "name" field on what they thought was sign-in, the form's purpose is unclear, and there's no path for "forgot password" or "resend confirmation." The Supabase-default emails arrive with no mention of lalista, making confirmation look like phishing. Buttons feel unresponsive on submit (no instant-feedback state). The result is rough first-touch UX that's the wrong front door for a launch.

This chapter reworks auth into the conventional pattern: separate `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` screens, branded EN-only Supabase email templates, hard-gate email confirmation with a resend affordance, snappy submit buttons (instant disable + 250ms threshold spinner), unified client+server error rendering, and email persistence across screens via React context. Name moves from sign-in to onboarding with copy explaining why (shared lists show who added what). Supersedes the verification-debt items `auth-ux-refactor-to-adopt` and `password-reset-e2e` — those framed lalista as adopting a future devshop helper; the right order is to ship a polished lalista flow first (validates the pattern in production with real users), then extract to devshop later.

**Scope (decisions locked here so `/ak-build` Phase 0 has minimal questions):**

1. **Split sign-in / sign-up screens.** New route: `/sign-up` (email + password). `/sign-in` keeps email + password but drops the name field and the signup fallback. Each screen has a "tap to <other>" link.
2. **Email persistence via React context.** New `apps/web/app/(auth)/layout.tsx` client component holds `{ email, setEmail }` in context; sign-in / sign-up / forgot-password pages read+write via hook. Scoped to the auth flow; lost on full reload (acceptable). No URL query params.
3. **Onboarding picks up name.** `apps/web/app/(auth)/onboarding/OnboardingForm.tsx` adds a name field above the household-creation form, with a short note ("we'll show your name when you add items to a shared list — edit anytime in Settings"). Sign-up no longer collects name.
4. **`/forgot-password` full-screen success state.** Submit triggers `supabase.auth.resetPasswordForEmail(email)`. Always shows success copy ("If an account exists with that email, we just sent a reset link") regardless of whether the user exists — never reveals account existence. Success view shows the email back + "Resend (60s)" countdown + "Edit email" affordance.
5. **`/reset-password` page.** Activated by Supabase recovery email link landing at `/auth/callback?type=recovery` → handler exchanges token for session → redirects to `/reset-password`. New-password form (with confirm) → `supabase.auth.updateUser({ password })` → redirect to `/list` on success.
6. **Hard-gate email-confirmation screen.** `AwaitingConfirmationCard` (currently inline in `sign-in/page.tsx`) becomes its own client component shown after sign-up. Lalista voice copy nudges the user to check their inbox; "Resend confirmation email (60s)" button + countdown. Stays mounted until the session lands a confirmed user.
7. **Snappy buttons.** New `AuthSubmitButton` component: instant `disabled={true}` on submit; spinner fades in at 250ms threshold; success states (e.g., "email sent") replace the button label after submission. Used on all auth + resend buttons.
8. **Submit-time validation only.** Client-side checks (email format, min password length matching Supabase config) run in the form's submit handler — never as-you-type. Both client errors and server errors render in a single `AuthErrorDisplay` component, same visual treatment, same DOM location, no flash from "client error" to "server error" UI.
9. **Form attribute hygiene.** All email inputs: `type="email" inputmode="email" autocomplete="email"`. Passwords on `/sign-in`: `autocomplete="current-password"`. On `/sign-up` and `/reset-password`: `autocomplete="new-password"`.
10. **Branded Supabase email templates.** Maximize branding inside the Supabase-default-sender constraint:
    - **Subject + body** in `supabase/config.toml` `[auth.email.template.confirmation]` and `[auth.email.template.recovery]` — lalista voice, EN-only, mention lalista in both. Optional subject-line emoji for visual scan in inbox previews.
    - **HTML format**, not plain text — inline-CSS layout matching the lalista palette (terracotta accent + neutrals from `packages/ui/src/tokens.ts`). Single hero block, single CTA button, footer.
    - **Inline logo** — host `apps/web/public/lalista-email-logo.png` (or `.svg`) and reference its absolute prod URL (`https://lalista.store/lalista-email-logo.png`) in the template. Image at fixed pixel width for email-client compat.
    - **Friendly "supabase is the messenger" footer** — small, light-gray, lalista voice (e.g., "Sent through Supabase, our hosting provider — feel free to ignore them, they're just the messenger"). Exact wording at spec time.
    - **TBD at spec time (verify in Supabase docs):** can the **sender display name** be set to `lalista` in `supabase/config.toml` without enabling custom SMTP? If yes, set it. Same question for **reply-to header** — set if available without SMTP. Both would lift inbox perception substantially with no DNS work.
    - Continue using Supabase's default sender for the email address itself; custom domain is v1 — see `§ v1 § Custom-domain transactional emails`.
    - **PR body note**: include a section pointing the operator at the v1 custom-domain entry so the future SMTP/DNS work is discoverable from the PR that ships these templates.
11. **PostHog events.** New: `auth_signed_up`, `auth_password_reset_requested`, `auth_password_reset_completed`, `auth_email_confirmation_resent`. Existing `auth_signed_in` and `auth_signed_out` unchanged. Update `METRICS.md` taxonomy.
12. **CLAUDE.md cleanup.** Delete the "Sign-in form's 400 in DevTools is expected" gotcha — no longer applicable post-split. Update the IA gotcha to list `/sign-up`, `/forgot-password`, `/reset-password` as middleware-allow-listed unauth pass-through routes. Update "Where Things Happen § Auth" to list new files.
13. **Test coverage.** Adapt the ~12 sign-in unit tests pinned to the magic-form order (split into sign-in-only vs sign-up-only files). New E2E spec for sign-up (sign-up → confirmation card → resend → email confirm → onboarding). New E2E spec for forgot-password (request → success copy → resend countdown → email link → reset → sign in with new password). Activate `apps/web/e2e/auth-edge-cases.spec.ts:220` (`test.skip(true, ...)` → live test). Unit tests for `AuthSubmitButton` (250ms threshold) and `AuthErrorDisplay` (client + server error parity).

**Files touched:**

- New: `apps/web/app/(auth)/layout.tsx`, `app/(auth)/sign-up/page.tsx`, `app/(auth)/forgot-password/page.tsx`, `app/(auth)/reset-password/page.tsx`, `app/auth/callback/route.ts`, `components/AuthSubmitButton.tsx`, `components/AuthErrorDisplay.tsx`, `components/AwaitingConfirmationCard.tsx` (lifted from inline state).
- Modified: `app/(auth)/sign-in/page.tsx` (slim down), `app/(auth)/onboarding/OnboardingForm.tsx`, `components/PublicLanding.tsx` (CTAs), `middleware.ts` (allow-list new routes), `supabase/config.toml`, `METRICS.md`, `CLAUDE.md`.
- Tests: see decision 13 above.

**Explicit non-scope (by design):**

- **Custom-domain transactional emails (own SMTP).** Continue using Supabase's default sender for v0; branded subject + body suffices. Custom-domain emails (own DNS, Resend or similar) lift the "from" address out of `*.mail.app.supabase.io` — see v1 entry.
- **Social auth.** Google + Apple sign-in deferred to v1.
- **Bilingual auth screens / emails.** EN-only. Bilingual UI is a v+ chapter.
- **App-wide nav snappiness.** Skeleton-loading for non-auth routes (Settings, item detail) is chapter 1m. The 250ms button-feedback pattern stays scoped to auth submit/resend buttons here.
- **Devshop extraction.** Lifting the new components to `@devshop-template/*` is v1 work — see `§ v1 § Devshop extraction of validated UX patterns`. The "ship inline → soak in production → extract" sequencing protects against extracting half-baked patterns.
- **Password complexity rules beyond Supabase defaults.** Inherit Supabase's min-length. No app-side complexity meter.

**Open `/ak-spec`-time decisions (small):**

1. **Sign-up button copy.** "Create account" vs "Sign up" — pick at spec time after a quick design pass.
2. **Resend countdown UX.** Visible countdown ("Resend in 0:54") or just disabled state until eligible? Recommend visible.
3. **Email-template footer wording.** Exact phrasing of the friendly Supabase note — draft 2-3 voice-aligned options at spec time.
4. **`AuthSubmitButton` placement.** Local to `apps/web/components/` or shared `packages/ui/`? Recommend local for v0 (fewer cross-package edits); chapter 1m may lift to `packages/ui`.

**Cross-references:**

- Supersedes TODOs `auth-ux-refactor-to-adopt` and `password-reset-e2e` — both deleted in the same commit that adds this chapter; audit trail in commit message.
- Pairs with chapter 1m (app-wide nav skeletons) for full snappiness story.
- Devshop-side `lalista-launch.md § v0 § Auth UX conventions` (the ⏳ item) reframes from "lalista refactors to adopt" to "lalista validates pattern, devshop extracts later" — update lalista-side BUILD-LOG entry once chapter 1l ships.

**Source:** Conversation 2026-05-02 — user requested launch-quality auth UX (branded emails, conventional sign-in/sign-up split, snappy feedback, persisted email across screens, hard-gated confirmation with resend, no-account-enumeration on forgot-password, unified validation errors). Decisions captured inline.

### 1m: App-wide snappiness

**Motivation:** Two tap-feedback gaps remain after chapter 1l ships:

1. **Buttons outside auth.** Chapter 1l ships `AuthSubmitButton` (instant disabled + 250ms threshold spinner) scoped to auth submit/resend. The same gap exists app-wide — AddItemSheet's "Add" button, ListRow's mark-bought tap, DisambiguationSheet's option buttons, force-create's "Add as new" button, Settings' sign-out, DisplayNameField's "Save" — all currently rely on the underlying button having no instant-feedback state. Tap → silence → action completes ≥1s later, feels broken.
2. **Navigations between RSC routes.** Tapping a `<Link>` to Settings (or any RSC-backed route) freezes the previous screen until the server component resolves — feels broken on slower networks / first paint.

This chapter generalizes both. The route loading affordance is **deliberately not a wireframe skeleton** — empty content container with a soft animated color shift, no content-shaped placeholder bars, no shimmer, no spinner. Quieter than skeletons; matches lalista's voice.

**Scope:**

1. **Lift `AuthSubmitButton` (chapter 1l) → `packages/ui/src/SubmitButton.tsx`.** Same pattern: instant `disabled={true}` + 250ms threshold spinner + post-success label swap. Auth screens import from `packages/ui` instead of local copy. `apps/web/components/AuthSubmitButton.tsx` deleted.
2. **Adopt `SubmitButton` across all interactive surfaces.** AddItemSheet (final "Add"), ListRow (mark-bought — adapted for icon-button shape; see decision 3), DisambiguationSheet (each option), force-create's "Add as new", Settings sign-out, DisplayNameField save. Each adoption confirms behavior unchanged + adds the snappy feedback.
3. **Route-level loading affordance.** Add `loading.tsx` to every route under `apps/web/app/**` (list, item, settings, onboarding). Each renders the page chrome (header/back/title) plus an empty content container styled with a soft animated color shift (Tailwind's `animate-pulse` on `bg-muted/40` or token-equivalent). No content-shaped placeholders. The container occupies the area where content will land so the page chrome doesn't reflow.
4. **`packages/ui/src/LoadingArea.tsx`** — thin primitive for the empty-container pattern. Used by all `loading.tsx` files.
5. **Verify `<Link>` prefetch.** Confirm no overrides set `prefetch={false}` — default prefetch is what makes the loading affordance brief in practice.
6. **Tests.** Unit: `SubmitButton` 250ms threshold timing + post-success state. E2E smoke: `LoadingArea` renders within 100ms of clicking Settings (catches regressions if a future route forgets `loading.tsx`). Per-surface E2E: visual confirmation that AddItem button shows the loading state, mark-bought feels instant.

**Files touched:**

- New: `packages/ui/src/SubmitButton.tsx`, `packages/ui/src/LoadingArea.tsx`, `app/list/loading.tsx`, `app/item/[id]/loading.tsx`, `app/settings/loading.tsx`, `app/(auth)/onboarding/loading.tsx`.
- Modified: every interactive surface listed in scope item 2; auth screens importing the new shared `SubmitButton`.
- Deleted: `apps/web/components/AuthSubmitButton.tsx` (lifted to `packages/ui`).

**Explicit non-scope:**

- Optimistic UI for client mutations beyond what already exists in `ListClient` — separate concern, not solved by button feedback.
- Per-Suspense-boundary loading inside a single route. Defer until a specific surface motivates it.
- Toast / banner for slow operations (>5s). Defer to actual user complaint.

**Open `/ak-spec`-time decisions:**

1. **Loading-area animation tuning.** `animate-pulse` opacity oscillation matches "softer shades changing"; design review can swap to a custom hue-shift if pulse feels too utilitarian. Recommend `animate-pulse` as default.
2. **`SubmitButton` shape variants.** Mark-bought is a tap on an icon row, not a button-shaped element — same hook (`useSubmitFeedback({ thresholdMs: 250 })`) with a different presentation, or two separate components? Recommend shared hook + two presentational components.
3. **Mark-bought feedback shape.** RPC is fast — does the 250ms threshold delay feel sluggish, or is optimistic-then-rollback better for tap-on-checkbox? Recommend optimistic + rollback on error to match the speed expectation.

**Source:** Conversation 2026-05-02 — extends auth-only snappiness from chapter 1l to app-wide. User explicitly preferred empty-container + soft color shift over wireframe skeletons.

### v0 checkpoint

All functional gates closed by foundation + auth + core-flows + disambig-add-new + ci-slow-job + e2e-audit-fill-gaps + zod-validation; cross-session realtime + sync-banner trigger fixed in `fix/skipped-tests-cleanup`.

- [x] Sign in → create household → add item → disambiguation sheet → see in list → mark bought
- [x] List updates in real time (second session adds item → first session sees it)
- [x] Dark mode works
- [x] Error states handled (network down, Supabase unreachable)
- [x] `pnpm turbo run test` passes (unit + component + integration + E2E)
- [x] Playwright E2E passes in CI
- [x] CI includes: gitleaks + lint + typecheck + Supabase integration + type drift + Playwright E2E + build
- [x] Sentry catches errors from web app
- [x] PostHog events match `METRICS.md` taxonomy
- [x] Broken test blocks PR merge
- [x] Edge function validates auth server-side via `getUser()`

**Remaining for v0 GA:** ship 1k (structured intent parsing).

---

## v1 (after core features are stable and in users' hands)

### Devshop extraction of validated UX patterns

After chapters 1l (auth UX) and 1m (app-wide snappiness) ship to lalista production and soak with real users, lift the validated patterns to `@devshop-template/*` so future projects inherit them. The "ship inline → soak → extract" sequencing protects against extracting half-baked patterns; soak validates that the patterns actually work in practice before they become reusable convention.

When v1: extract to a devshop helper package — likely `@devshop-template/auth-ux` for chapter 1l components, plus an extension of `packages/ui` (or a new `@devshop-template/ui`) for `SubmitButton` + `LoadingArea` + `loading.tsx` convention from 1m. Lalista refactors to import from the helper, deletes inline copies, runs the full test suite + manual QA at 375 + 1440 light + dark to confirm zero behavior change. The verification surface is the refactor-to-adopt itself — same shape as the original `auth-ux-refactor-to-adopt` TODO that chapter 1l superseded.

What gets extracted (full list):

- **Auth UX components** (chapter 1l): `AuthErrorDisplay`, `AwaitingConfirmationCard`, the email-context provider from `app/(auth)/layout.tsx`, `friendlyAuthError` helper, the `/auth/callback` route handler.
- **Auth flow conventions** (chapter 1l): no-enumeration forgot-password, hard-gate confirmation with 60s resend countdown, submit-time validation with unified client+server error rendering, supabase-config-template editing convention, middleware allow-list pattern for unauth pass-through routes.
- **Snappy primitives** (chapter 1m): `SubmitButton`, `LoadingArea`, `loading.tsx` placement convention, `useSubmitFeedback` hook, `useOptimisticMutation` hook (rollback + banner failure modes with bounded retry per `RETRY_BUDGET_MS`).
- **Latency-feedback framework doc** (chapter 1m, D11): the 4-tier framework (A1/A2/B/C/D) + canonical surface mapping + decision rule. Lift to `/devshop/template/CLAUDE.md § Gotchas` and `/devshop/kit/docs/guide/latency-feedback.md` so new devshop projects inherit the framework. Tokens (`FEEDBACK_THRESHOLD_MS = 250`, `RETRY_BUDGET_MS = 15000`, `RETRY_BACKOFF_MS = [1000, 3000, 7000]`) lift alongside the components. **First soak-finding rules** (Tier C two-skeleton handoff + sizing-primitive override) already lifted 2026-05-08 to `/devshop/kit/docs/guide/latency-feedback.md`; the rest of the framework (tier table + canonical surface mapping + tokens) joins it at full lift.
- **`SyncErrorBanner` retry/undo affordance shape** (chapter 1m, D15): the `affordance: 'tap-to-retry' | 'retry-undo'` discriminator pattern, paired with the optimistic-mutation banner state contract.
- **Maybe**: a convention check that flags new `<button onClick={async ...}>` handlers not using one of the framework's primitives — useful enforcement once the patterns are stable in template-land.

Soft prerequisite: chapters 1l + 1m have shipped + soaked in lalista production for ~2 weeks of real usage, sufficient to surface UX rough edges before they get baked into the helper. Extraction before soak risks re-doing it once dogfood reveals issues.

Source: deferred from chapter 1l (v0) per the "ship inline first → validate in production → extract" principle. Validation surface for the dual-goal-project model — devshop conventions earn their reusable status by being proven in a live project.

### Custom-domain transactional emails

Chapter 1l (v0) ships branded EN-only HTML confirmation + reset-password emails via Supabase's default sender (`noreply@mail.app.supabase.io`). Body, subject, format, logo, and footer are all lalista-branded; only the `from` address still says supabase. Acceptable for early users behind the lalista-voice footer note but won't fly past initial dogfood — users who don't read the footer will mark it as phishing.

When v1: lift the `from` address out of `*.mail.app.supabase.io`. The template content from chapter 1l carries over unchanged — only the `from` address (and the now-unnecessary "Supabase is the messenger" footer note) change.

**Operator setup checklist** (manual, blocks the code change):

1. **Provision the domain.** Purchase or repurpose a lalista domain (e.g. `lalista.app`). Register at any registrar; DNS hosting can be Cloudflare for fewer config headaches.
2. **Sign up for an SMTP provider.** Recommend **Resend** — best developer ergonomics, generous free tier (3k emails/month, 100/day), straightforward Supabase integration. Alternatives: Postmark (best deliverability, $15/mo entry), AWS SES (cheapest at scale, more setup). Keep the API key in 1Password — never on local disk.
3. **Verify the domain** in the SMTP provider's dashboard. Resend will give you 3 DNS records to add:
   - **SPF** (`TXT @` → `"v=spf1 include:_spf.resend.com ~all"`)
   - **DKIM** (`TXT resend._domainkey` → provider-supplied key)
   - **DMARC** (`TXT _dmarc` → `"v=DMARC1; p=none; rua=mailto:dmarc@lalista.<tld>"` — start with `p=none` to monitor, tighten to `quarantine` or `reject` after 2-4 weeks of clean reports)
4. **Configure Supabase Auth SMTP** at console → Project → Auth → SMTP Settings:
   - Sender email: `noreply@lalista.<tld>` (or `hi@lalista.<tld>` for friendlier reply-to)
   - Sender name: `lalista`
   - SMTP host: `smtp.resend.com`
   - Port: `465` (TLS)
   - Username: `resend`
   - Password: Resend API key
5. **Update `supabase/config.toml`** to match (sender email + name fields). Local-dev still uses Supabase's local-stack mailpit — only prod uses the configured SMTP.
6. **Drop the "Supabase is the messenger" footer note** from both templates — no longer needed.
7. **Test**: trigger a confirmation email and a password-reset email against prod from a clean address. Verify (a) `from:` shows lalista, (b) sender name shows lalista, (c) DKIM passes (Gmail "show original" → DKIM=PASS), (d) inbox placement is primary tab, not promotions/spam.
8. **Monitor DMARC reports** for 2-4 weeks via the `rua=` mailbox before tightening the policy.

Source: chapter 1l (v0) deferred this to v1 to keep the chapter scoped to code + template strings. SMTP signup + DNS is a separate manual prereq the operator has to own.

### Existing-account sign-up nudge email

When a user attempts to sign up with an email that's already registered, send them a friendly "someone tried to create an account with this email — if it was you, sign in here / reset your password / ignore if not" message. Same pattern Apple, GitHub, and Stripe use.

**Why v1, not v0:** chapter 1l ships true no-enumeration on `/sign-up` — existing-account attempts render `AwaitingConfirmationCard` and Supabase silently no-ops on the email send. The user can't tell whether the account exists, which is correct privacy-wise. But it leaves the existing-account user with no signal at all (resend countdown ticks, no email arrives, they figure it out). A nudge email closes that gap without breaking enumeration: every email that goes through `/sign-up` produces SOMETHING in their inbox — confirmation for new accounts, "you already have one" for existing accounts. Either way the same observable outcome to a third party (an email gets sent), so still no enumeration leak.

Hard dep: the v1 `Custom-domain transactional emails` entry above. Sending a custom email body that isn't one of Supabase's six built-in templates requires our own SMTP path (Resend or similar). Not implementable on Supabase's default sender.

When v1: detect existing-account in `apps/web/app/(auth)/sign-up/page.tsx`'s submit handler — Supabase's response shape (`identities=[]` for an existing confirmed account) is the signal we already have. On that branch, fire-and-forget a custom email via the SMTP path with a body referencing `/sign-in` and `/forgot-password`. Don't show anything different in the UI — the AwaitingConfirmationCard stays the same to preserve enumeration parity at the app surface.

Source: deferred from chapter 1l per the dogfood gap surfaced 2026-05-04 — existing-account user has no escape signal beyond the resend countdown. The pattern is good UX but needs custom SMTP infrastructure, which the v0 chapter explicitly scoped out.

### Social auth (Google + Apple)

Sign-in with Google + Apple as alternatives to email/password. Apple SSO is required for App Store distribution if/when the iOS-archive PWA-or-native conversation lands; Google is the bulk of users on Android + web.

When v1: use Supabase's OAuth providers (`supabase.auth.signInWithOAuth`), configure Google Cloud Console + Apple Developer credentials, add provider buttons to `/sign-in` and `/sign-up`, extend `/auth/callback` (already added in chapter 1l for email confirmation + recovery) to handle the OAuth code exchange. Drop the name field from onboarding for OAuth users — their provider supplies it.

Source: chapter 1l (v0) deferred this to v1 to keep auth UX rework scoped to email/password flow first.

### PWA service worker caching

Phase 0b scaffolds the manifest + meta tags (installability), but defers
`@serwist/next` service worker registration until the app is stable.

When adding:

- Define a cache invalidation strategy (what's cached, TTL, how realtime data
  interacts with cached state)
- Service worker versioning — how updates propagate to users
- Development mode that disables caching (or unregister SW in dev)
- Test: deploy a change, verify users see the new version within [X] seconds

### Visual regression testing

Playwright screenshot comparison for key screens.

- Store baseline screenshots in `tests/screenshots/`
- CI step: compare current vs baseline, fail if diff > threshold
- Cover: light/dark, mobile/desktop (4 combos per screen)

### Performance baselines for API

`/benchmark` checks frontend Core Web Vitals but not API performance.
Add:

- Baseline response times for key queries (list items, add item, mark bought)
- Alert when queries degrade as data grows
- Consider: load test with realistic data volume (1000+ items)

### Multi-household membership

Drop the v0 single-household invariant: a user can belong to N households simultaneously, switch between them in the UI, and have realtime + RLS scoped to the active one.

When v1: needs a separate `/office-hours` + `/plan-design-review` cycle before scoping. Surfaces touched include onboarding (post-signup household-picker if invited mid-flow), Settings (household-switcher), `/list` header (active-household indicator), realtime channels (per-active-household subscribe), and removal UX (see sub-bullet below).

Hard prereq for code work: drop migration 015's `household_members_one_per_user_v0` unique constraint via a follow-up migration. The constraint exists explicitly to make this transition loud, not to prevent it.

Known sub-items surfaced by prior chapters:

- **Removed-member UX revisit** — when N>1 households possible, removal from ONE household shouldn't redirect to `/onboarding?removed=1`. Should switch the active household to a remaining one + surface an in-app banner ("you were removed from <household>"). Codified by the household-collaborators v0 design's eng review (2026-05-10) — see `.gstack/projects/meirmsn-lalista/node-main-design-20260508-233433.md` § Eng Review Decisions § OV1 for the v0 single-household design that this revisits.
- **Per-household items catalog** — multi-household exposes the catalog-contamination risk that single-household v0 dodged. See `§ 1k § Dependency relaxation` for the explicit handoff.
- **Audit feed scoping** — household-collaborators v0 scopes the audit feed to one household via RLS subquery. Multi-household requires either a unified feed across all of user's households OR per-household feeds with a switcher.

Source: deferred from v0 to ship the lalista product as a single-household app first; multi-household adds UX complexity that benefits from real-user feedback on single-household behavior. Re-promoted to v1 (vs v+) on 2026-05-10 because the household-collaborators eng review surfaced 3 concrete design questions the constraint touches.

---

## v+ (future)

### Changesets for automated changelogs

`@changesets/cli` + `.changeset/config.json` — automated changelog entries in PRs.

### Bilingual UI (i18n)

Voice input is bilingual (edge function handles Spanish + English). The web UI itself
is English-only in v0. Decide whether the UI should be bilingual and how:

- Language selectable in settings or auto-detected from browser locale?
- If yes: add `next-intl` with JSON message files
- If deferred: keep English UI, bilingual input is the differentiator

### Offline support

**Current state (pre-offline):** `ListClient.tsx` uses raw `useState` + `subscribeToList` Realtime with bespoke optimistic reconciliation — server-response names beat Realtime FK-id rows (Realtime sends no joins), dedup-by-id guards optimistic+Realtime races, and a `realtimeTick` state bump rebuilds the channel after `CHANNEL_ERROR`. Chapter 1m added bounded-retry resilience inside `useOptimisticMutation` (15s budget, `[1s, 3s, 7s]` backoff) for AddItem + DisambiguationSheet — this is the **v0 answer for transient network blips** ("user is on flaky cellular"). It is NOT an offline mode: the budget covers seconds-of-disconnection, not minutes-in-a-basement. This was the implicit state-management choice made during PR 3 (core-flows); it works for a small shared list with one main live surface but carries costs worth flipping when offline lands:

- Reconciliation logic is bespoke and lives in `ListClient` — a second realtime-driven surface (e.g., item detail as a live view, or a future multi-list view) would have to re-implement the optimistic-insert / dedup / rehydrate dance.
- No cross-component cache — `/item/[id]` and `/settings` each re-fetch independently.
- No stale-while-revalidate on focus.
- No built-in retry/backoff — user-tap retry only.

**Options to evaluate when the time comes:**

- **React Query with `persistQueryClient`** (read + write offline) — adopting this also unlocks the cross-component cache + SWR + retry benefits above, not just offline. Highest-value option because it's multi-purpose.
- **Read-only offline** (cached list visible, adds require network) — simpler, lower value.
- **Full local cache with background sync** — most ambitious, most work; only if data show users edit offline regularly.

**Migration liability:** the bespoke reconciliation in `ListClient` needs careful porting to React Query's mutation + cache-invalidation model. Plan to port incrementally — list view first, then cascading surfaces.

**Independent trigger:** a second realtime-driven surface would motivate React Query even without offline — if that arrives first, do the migration then and offline support rides the same rails later.

Design the strategy based on actual user behavior data from PostHog.

### Offline queue / IndexedDB sync engine

Future chapter — true offline-first means a sync engine, not just a longer retry budget. Chapter 1m's `useOptimisticMutation` covers transient blips (15s window with `[1s, 3s, 7s]` backoff) but explicitly defers (D9) the full offline shape:

- **Persistent queue across browser restarts** — operations queued in IndexedDB survive tab reload + app close.
- **Idempotency keys on the add-item RPC** — so a queued operation that fires twice (network came back mid-retry) doesn't double-insert.
- **Conflict resolution against realtime** — when the offline window straddles a household-mate's edit, the merge logic needs explicit rules (LWW, OT, or manual).
- **Optimistic UUID generation client-side** — paired with the realtime dedup-by-id race; chapter 1m's `ListClient.handleAddResponse` uses the server-resolved entry_id (gotcha 2 in `specs/app-snappiness/spec.md`); a true offline path needs client UUIDs and a server-side merge.

The 15s retry budget is the v0 answer for "user is in a basement for 30 seconds." This chapter is the answer for "user is in a basement for 3 minutes." Build it after real-user PostHog data shows the shape of actual offline windows — premature offline-first design optimizes for a use case we're not sure exists at scale.
