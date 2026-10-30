# Design System — lalista

## Product Context

- **What this is:** A voice-first grocery list iOS app that captures items via Siri, routes them to the right store from purchase history, and (v1) auto-populates your cart.
- **Who it's for:** Bilingual (Spanglish) families — parents and kids — who want zero-friction grocery management.
- **Space/industry:** Consumer mobile, grocery/household management. Peers: AnyList, OurGroceries, Instacart. Differentiated by: voice-first, Spanglish-native, household multi-user, AI store routing.
- **Project type:** Native iOS app (Swift/SwiftUI), iOS-first. No web app in v0.

## Aesthetic Direction

- **Direction:** Warm Minimal — functional clarity with genuine warmth. The best apps in this space are fast and legible. lalista needs that, plus the feel of something that belongs in a family's kitchen, not a startup's dashboard.
- **Decoration level:** Intentional — subtle warm-cream background (not pure white), like paper or a corkboard. Color carries the warmth; no gratuitous illustrations or gradients.
- **Mood:** Warm, quick, and a little magic. The app should feel like a trusted household object. Bilingual, personal, smart — not corporate, not clinical.
- **Reference sites:** AnyList (functional baseline to beat visually), Duolingo (warm + playful mobile utility done right), Linear (how minimal can have personality)

## Typography

- **Display/Brand:** [Fraunces](https://fonts.google.com/specimen/Fraunces) — an optical serif with genuine warmth and a subtle "wonk" that gives it character. Used for the "lalista" wordmark, empty states, onboarding moments, and large italic confirmations. Sets the brand apart from every geometric-sans grocery app in the category.
- **Body:** [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) — clean, slightly rounded, excellent Latin character support (critical for Spanglish content). Used for all UI copy, list items, alerts, and metadata.
- **UI/Labels:** Plus Jakarta Sans — same as body, weight 500–600 for labels and headers.
- **Data/Tables:** Plus Jakarta Sans with `font-variant-numeric: tabular-nums` — keeps quantities and counts scannable in list rows.
- **Code:** Not applicable for v0 (iOS app).
- **Loading:** Google Fonts CDN for web preview/marketing. On iOS: system fallback (SF Pro) while custom fonts load; Fraunces used only for brand moments (wordmark, empty states) where loading delay is acceptable.
- **Scale:**
  | Token | Size | Weight | Use |
  |-------|------|--------|-----|
  | display | 56–72px | 400 | Wordmark, hero moments |
  | display-italic | 36–48px | 300 italic | Empty states, onboarding |
  | heading-lg | 28px | 600 | Screen titles |
  | heading-md | 22px | 600 | Section headers |
  | body-lg | 17px | 400 | Primary copy (iOS standard) |
  | body | 15px | 400–500 | List item names |
  | caption | 13px | 400 | Metadata, timestamps, store |
  | micro | 11px | 600 | Section label caps |

## Color

- **Approach:** Restrained — one strong accent (terracotta) against warm neutrals. Color is rare and meaningful; it marks actions, not decoration.
- **Primary:** `#D4603A` — terracotta/burnt sienna. Warm, kitchen-y, distinctly different from every green-accented competitor. Represents action: add, confirm, CTA.
- **Primary pressed/dark:** `#A8471E` — burnt clay. Used on press states and dark-mode accents.
- **Primary soft:** `#FBE8E0` — for soft accent backgrounds (badges, tinted surfaces).
- **Background:** `#FDFAF6` — warm off-white cream. Not pure white — the slight warmth sets the tone immediately. This app lives in your home.
- **Surface (cards/sheets):** `#FFFFFF`
- **Surface 2 (secondary areas):** `#F5F0E8`
- **Border:** `#E8E0D4`
- **Text primary:** `#1A1208` — near-black with a warm undertone.
- **Text secondary:** `#7A6A56` — warm mid-gray for metadata, captions, store names.
- **Text tertiary:** `#A8998A` — placeholder text, disabled states.
- **Semantic — Success:** `#5A8A5E` / bg `#EBF4EC` — muted sage green. "Bought" state. Deliberately subdued so it doesn't compete with the terracotta accent.
- **Semantic — Warning:** `#E8A228` / bg `#FDF4E3` — warm amber. Disambiguation prompts, needs-review states.
- **Semantic — Error:** `#C0392B` / bg `#FAEAE8`
- **Semantic — Info:** `#3B82B4` / bg `#EBF3FA` — for neutral informational alerts (Siri confirmations, sync status).
- **Dark mode strategy:** Warm darks, not cold grays.
  - Background: `#1A1208` (warm dark chocolate — same hue family as the brand, not slate/charcoal)
  - Surface: `#2A2018`
  - Surface elevated: `#38301F`
  - Text: `#F5EFE6` (warm white)
  - Text secondary: `#A8998A`
  - Border: `#3A3020`
  - Accent stays `#D4603A` — terracotta reads well on dark warm backgrounds.
  - Reduce semantic color saturation 10–15% in dark mode.

## Spacing

- **Base unit:** 8px
- **Density:** Comfortable — this is a family's daily-use utility, not a data terminal. Give items room to breathe; tapping accuracy matters more than information density.
- **Scale:**
  | Token | Value | Use |
  |-------|-------|-----|
  | 2xs | 2px | Internal micro gaps |
  | xs | 4px | Icon-label gap, badge padding |
  | sm | 8px | Internal card padding, row gaps |
  | md | 16px | Card padding, section gaps |
  | lg | 24px | Between sections |
  | xl | 32px | Screen padding, large gaps |
  | 2xl | 48px | Hero vertical spacing |
  | 3xl | 64px | Top-of-screen breathing room |

## Layout

- **Approach:** Grid-disciplined, iOS HIG-compliant. The list view is predictable and fast — users shouldn't hunt. Brand personality lives in empty states, onboarding, Siri confirmation toasts, and notifications, not in breaking the list layout.
- **Grid:** Single column on iPhone. 16–20px horizontal margins. List rows full-width with 12–14px horizontal card padding.
- **Max content width:** Not applicable (iOS native, adapts to screen width via SwiftUI).
- **Border radius hierarchy:**
  - Micro (badges, chips): `100px` (pill)
  - Small (inputs, secondary buttons): `10px`
  - Default (list items, cards): `12px`
  - Large (sheets, modals): `20px`
  - Screen (phone frame, full sheets): `36px`
- **List grouping:** Items always grouped by store. Store name as uppercase 13px label with 4px separator. This is the core UX differentiation — never flatten or merge store sections.

## Motion

- **Approach:** Intentional — every animation serves comprehension or satisfaction. Nothing gratuitous.
- **Easing:** enter `ease-out` / exit `ease-in` / move `ease-in-out`
- **iOS spring:** Use `UISpringTimingParameters` with damping ~0.7 for list item interactions (add, remove, check off). This is the most important motion in the app.
- **Duration:**
  | Token | Range | Use |
  |-------|-------|-----|
  | micro | 50–100ms | Tap feedback, badge updates |
  | short | 150–250ms | List item add/remove, check-off spring |
  | medium | 250–400ms | Screen transitions, modal present/dismiss |
  | long | 400–700ms | Onboarding entrance, empty state reveal |
- **The "mark as bought" animation:** Spring the checkmark in with a slight bounce, then cross-strike the item name with a 150ms ease-out. This is the gesture users will make hundreds of times — it must feel satisfying and conclusive.
- **Siri confirmation toast:** Slides in from bottom with `short` duration spring. Auto-dismisses after 3s. Does not block the list.

## Motion + feedback (latency-feedback framework)

Tap-feedback isn't only about animation curves — it's about matching the affordance to the operation's actual latency. lalista uses a **4-tier latency-feedback framework** so users always get the right "I heard you" signal for the speed of the operation, and never see a spinner-flicker on a fast resolve.

### Framework

| Tier                                  | When                                                                                            | Affordance                                                     | Failure                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **A1 — Benign optimistic**            | Mutation usually succeeds; rollback is self-explanatory; user stays on the same screen          | Visual change instant; no spinner, no disable                  | Silent rollback (reverted state IS the message)                          |
| **A2 — Banner-on-failure optimistic** | Mutation usually succeeds, but failure could be missed if user navigates; loss matters          | Visual change instant; retry ~15s in background                | `SyncErrorBanner` cross-screen ("Couldn't save '<item>' — retry / undo") |
| **B — Threshold spinner (250ms)**     | User waiting on network round-trip with no local state to commit; action gates further progress | Instant disable + spinner-after-`FEEDBACK_THRESHOLD_MS`        | Inline error                                                             |
| **C — Route loading**                 | Tapping a link to a different page                                                              | Page chrome paints; content area soft-pulses (`<LoadingArea>`) | `error.tsx`                                                              |
| **D — CSS press only**                | <100ms ops, or no observable result                                                             | OS / `:active`                                                 | n/a                                                                      |

### Tokens

The timing constants live in `packages/ui/src/tokens.ts` so every Tier B/A2 surface uses the same numbers:

| Token                   | Value                | Use                                                                                                        |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `FEEDBACK_THRESHOLD_MS` | `250`                | Tier B spinner threshold — submit buttons disable instantly, spinner only after this many ms still pending |
| `RETRY_BUDGET_MS`       | `15000`              | Tier A2 total retry window before escalating to `SyncErrorBanner`                                          |
| `RETRY_BACKOFF_MS`      | `[1000, 3000, 7000]` | Tier A2 retry delays (sum 11s + per-attempt RTT fits inside the budget)                                    |

`LOADING_PULSE_OPACITY` for Tier C uses Tailwind's `animate-pulse` default unless design review tunes it.

### Why this shape

The roadmap's earlier "adopt SubmitButton everywhere" framing was uniform but wrong — spinners on actions completing in <300ms add visual noise without information. For in-app mutations the user has the rest of the list to look at, so committing the change visually says "heard you" better than a spinner does. The framework also handles the "I navigated away and the rollback fired silently" failure mode by splitting Tier A into A1 (benign) and A2 (banner-on-failure).

For the canonical surface mapping (every interactive surface in the app and the tier it uses), the decision rule, and implementation primitives, see `CLAUDE.md § Gotchas § Latency feedback tiers` and the spec at `specs/app-snappiness/spec.md`.

## Copy & Voice

### The reader

Write to one specific person: a parent, slightly skeptical, informed enough to smell nonsense, tired of apps that talk down to them. They know how to shop. They don't need a grocery assistant — they need something that holds their list and gets out of the way.

### The category sin

Every grocery app talks about being "smart," "seamless," or "your assistant." The condescension is baked in: they imply you need help beyond remembering milk. lalista's voice lives in the gap between that fog and plain honesty.

### Principles

**Start with what's actually true.** Don't ask "how should we sound?" — ask "what's true here, and what's the most alive way to say it?" Voice is a byproduct of conviction, not a style choice.

**Make claims, not impressions.** Weak copy creates a feeling without saying anything. Strong copy makes a statement someone could argue with. If no one could disagree with your sentence, it's probably not saying anything. Test every line: could a competitor use it? If yes, rewrite it.

**Notice more than you say.** The best lines come from catching something small — an irony, a contradiction, a universal human experience hiding inside a mundane detail — and trusting the reader to meet you there. You're not constructing cleverness. You're pointing at something real that most people would have walked past.

**Name things like a person, not a system.** What would a sharp, fond friend actually call this? Not cute for cute's sake — accurate in a way that also happens to be memorable.

**Earn the lightness with the substance.** Wit without depth reads as spin. You can be funny, irreverent, even a little absurd — but only because the underlying knowledge is solid. The playfulness only works when it's sitting on top of something real. The absurd move lands when it's also the most accurate description available.

**Let surprise be inevitable in hindsight.** The magical moments are the ones you didn't see coming but, once they arrive, feel completely right. That's not inspiration — it's the result of thinking long enough that you can finally relax.

**Know when to stop.** A single perfectly placed gesture lands because it arrives once and leaves. The instinct to repeat it is what kills it. Restraint is what separates a wink from a costume.

### What lalista is not

Not a smart assistant. Not a meal planner. Not trying to optimize your life. It's a list — and that restraint is the feature. Every word that implies otherwise is a broken promise.

### Canonical voice examples

Three teaching beats — the original byline annotated for what works _and_ what slips, plus one example each in the **claim** and **brag** registers the doctrine asks for.

> "say leche. it handles the rest."

The original public-landing byline. **What works (front half):** lowercase + period; bilingual without making a thing of it; voice-first without saying "voice"; implies store routing without explaining it. **What slips (back half):** "handles" is the assistant-verb the category sin warns against — every other grocery app reaches for it. "The rest" is impressionistic where the line should make a claim. Preserved here as a teaching example, not as the live byline; the failure is itself useful copy-craft material.

> "skip the list-making session."

**Claim register.** Names the specific nonsense competitors leave in: not the list itself but the planning _session_ — pulling up a phone, scrolling a notes app, typing items while a kid hangs off your hip. Restraint as feature. Makes a statement someone could disagree with — "no, list-making is the fun part" is a valid pushback, which is exactly what the doctrine asks of a claim.

> "groceries on a word."

**Brag register.** Tesla-mode future-state outcome via the established "on a [tiny resource]" idiom ("on a dime / on a budget / on a whim" — sustained with the minimum resource possible). States the future-state without describing the mechanism. Could a competitor use it? No: every other grocery app needs more than a word.

---

## Decisions Log

| Date       | Decision                                                                                                                                                      | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-19 | Initial design system created                                                                                                                                 | Created by /design-consultation. Based on lalista product doc + grocery app competitive research (AnyList, OurGroceries, Instacart).                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-03-19 | Terracotta accent (#D4603A) over green                                                                                                                        | Every competitor uses green. Terracotta is warm, kitchen-y, and has a subtle Latin American palette resonance that matches the Spanglish brand. Distinctive and memorable.                                                                                                                                                                                                                                                                                                                                                  |
| 2026-03-19 | Fraunces for display/brand                                                                                                                                    | An optical serif is unusual for a utility app. Chosen because "lalista" in Fraunces becomes an iconic mark — warm, human, not generic — while Plus Jakarta Sans handles all functional UI text.                                                                                                                                                                                                                                                                                                                             |
| 2026-03-19 | Warm cream background (#FDFAF6)                                                                                                                               | Small departure from pure white. Sets tone immediately — this app lives in a family's home, not a corporate dashboard.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-03-19 | Warm dark (#1A1208) for dark mode                                                                                                                             | Avoids the cold blue-gray dark mode that every other app uses. Stays in the same warm hue family as the brand across both modes.                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-05-06 | Hero byline `say leche. it handles the rest.` → `groceries on a word.`; § Canonical voice example → § Canonical voice examples (plural, three teaching beats) | Opportunity-first / Tesla-mode framing per `PRODUCT-ROADMAP.md § v0 § 1o`: the brag is "your kitchen runs on almost nothing," not "we make grocery lists less bad." The "on a [tiny resource]" idiom ("on a dime / on a budget") folds input cost + ongoing-continuity outcome into four words. The doctrine restructure is part of the same decision — the plural block exists _because_ the byline changed, and preserving the original as a "what slips" example keeps the historical voice example doing teaching work. |
