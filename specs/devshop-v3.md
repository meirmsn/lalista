# Move lalista to devshop v3

**Go:** "agreed, and with your rec A"; devcontainer: "Delete it" (owner, 2026-11-05)

## Intent

The owner asked to move lalista from the v1-era devshop (husky hooks, the isolated devcontainer,
`/devshop/kit` references) to devshop v3.0.0, in one PR: the version pin, CI in v3's two tiers
(`fast`, `slow`) with both as required checks, the devshop's git hooks instead of `.husky/`, the
project contract's files, and `CLAUDE.md` without v1 references. A docs-only or v1 leftover that
nothing needs goes. No change to what the app renders.

## Decisions

- Pin `v3.0.0`, the newest release, straight from v1: v2 was a new layout with no step from v1, and
  v3's one breaking change (a test names `<spec> AC-<n>`) only touches v2-format specs, which
  lalista has none of (Claude's proposal, owner agreed 2026-11-05).
- `slow` runs on every PR and on `main` with no job-level `if`, and `deploy` needs it: a skipped
  required check counts as passed. Cost accepted: a docs-only PR waits for `slow`, and a deploy
  waits for it after a merge (7–8 minutes on PR #15's runs; corrected 2026-11-09 from "about 45",
  which came from v1 notes, not a measurement); rejected: keeping the docs-only `changes` filter (owner,
  2026-11-05).
- `slow` has the template's 30-minute timeout. Changed after the go: the go kept 45 because Claude
  said the suite needed it (owner agreed 2026-11-05); runs take 7–8 minutes, and asked whether to
  return to 30, the owner answered "yes" (owner, 2026-11-09).
- Stack setup stays in `ci.yml` as the template's "stack tool installs" steps (pnpm, Node, the
  Supabase CLI and local stack with its health probe and key checks, Playwright browsers); what each
  tier checks moves into `scripts/check-fast.sh` and `scripts/check-slow.sh` (template).
- Old v1 specs stay in their folders under `specs/`; the spec check reads only the flat
  `specs/*.md` files v3 writes. Rejected: moving them to `docs/specs-v1/`, which breaks 21 files
  that link to them (owner agreed 2026-11-05).
- `.devcontainer/` is deleted. The gitleaks pin moves into `ci.yml` (8.30.1, checksum-verified as in
  the template) and the Supabase CLI pin (2.98.2) lives in each workflow that installs it; `db:*`
  scripts call the Supabase CLI directly (owner, 2026-11-05).
- `.husky/`, husky and lint-staged go. The devshop's git hooks run `scripts/lint.sh` on push, and
  the fast tier runs it in CI. Formatting moves from a pre-commit hook to `prettier --check` over
  the files a change touches, so files already unformatted on `main` don't fail every PR.
- The DESIGN.md shape check is left out of the fast tier: `DESIGN.md` has no front matter. Logged
  in `FINDINGS.md`; converting it is its own change (owner, 2026-11-05). Later moved to `ROADMAP.md`
  R-7 with the render check, and F-9 to R-6, on the owner's "yees" (owner, 2026-11-09). `THEME_CSS` stays empty and
  the token check isn't added, as the Next.js home says for an existing app.
- `scripts/ui/render-check.mjs` is placed (the Cloudflare home requires it) but not run yet: wiring
  it into `slow` over the public pages is its own change, logged in `FINDINGS.md`.
- `ROADMAP.md` isn't made from `PRODUCT-ROADMAP.md`: v3's roadmap is what the owner decided, in
  their words. It starts with the owner's first entry (owner agreed 2026-11-05).
- The Supabase token stays as it is (option A): every option keeps Edge Functions read-write, which
  reaches the service-role key through a deployed function (owner, 2026-11-05).
- `TODOS.md` is sorted and deleted. Its 5 product features (Sign in with Apple, renaming an item
  in the list, a "pick your stores" onboarding step, invitees naming themselves before the list,
  correcting a wrong match) went to the owner, who answered "go to roadmap": `ROADMAP.md` R-1 to
  R-5 (owner, 2026-11-09);
  its 3 bugs and 4 data and operations items become `FINDINGS.md` rows F-6 to F-12, each naming its
  old slug so the comments that cite it still lead somewhere; its CI item (skip `slow` on docs-only
  commits) is dropped, as v3 runs `slow` always; its native-iOS notes move to
  `ios-archive/RESUME.md`. Changed after the go: the go had `TODOS.md` → `FINDINGS.md`; Claude asked
  to sort by kind and the owner answered "yes" (owner, 2026-11-09).
- `.github/CODEOWNERS` names the owner's GitHub handle, which the repo's URL already shows.
- `@playwright/test` is pinned exact (`1.59.1`, the locked version), as the render check needs.

## Acceptance items

- **AC-1** `.devshop-version` holds `v3.0.0`, and every `devshop` file of v3.0.0's
  `project-files.txt` that the project has is identical to v3.0.0's — verified by review:
  `project-files-at.sh check --version v3.0.0 --project .` exits 0.
- **AC-2** `ci.yml` has a job `fast` that runs `scripts/pr-title-check.py` and
  `scripts/check-fast.sh "$BASE"`, a job `slow` that needs `fast` and runs `scripts/check-slow.sh`,
  neither with a job-level `if` or `continue-on-error`, and a `deploy` job that needs both, with the
  template's deploy-comment jobs — verified by review: the devshop's `ci-tiers-check.py` reports
  nothing at session start.
- **AC-3** Nothing in the repo reads `.devcontainer/`, the folder is gone, `ci.yml` pins gitleaks
  with its checksum, and every workflow that installs the Supabase CLI pins the same version.
- **AC-4** `.husky/` is gone and `package.json` has no `prepare` script, husky or lint-staged.
- **AC-5** The `db:*` scripts in `package.json` call the Supabase CLI, not the old relay.
- **AC-6** `@playwright/test` is pinned to an exact version.
- **AC-7** `scripts/check-fast.sh` runs the secret scan, the spec check over `specs/*.md` with the
  tests, the contract check, `scripts/lint.sh` (ESLint, typecheck, Prettier on the changed files),
  the unit tests and `scripts/deploy.test.sh`, every part even after one fails, and exits 0, 1 or 2
  as the contract says — verified by review: run on this branch, and green in CI.
- **AC-8** `scripts/check-slow.sh` runs the integration tests, the type-drift and rollback-EXPLAIN
  checks, the Worker build and Playwright on both projects — verified by review: `slow` green on
  this PR.
- **AC-9** `scripts/contract-check.py` passes against the project with the Cloudflare home's
  `supplies` — verified by review: run on this branch.
- **AC-10** `CLAUDE.md` has v3's "How changes land" and "Rules", keeps its Where-things-happen and
  Gotchas sections, and names no `/ak-*` skill, `/devshop/kit` path or `supabase-runner` relay.
- **AC-11** `TODOS.md` is gone, and each of its seven bug, data and operations slugs is named by a
  `FINDINGS.md` row or a `ROADMAP.md` entry. Changed after the go: F-9's slug moved to R-6 on the
  owner's "yees" (owner, 2026-11-09).

## Out of scope

- Converting `DESIGN.md` to v3's front-matter shape and adding the DESIGN.md and token checks.
- Running the render check in `slow`, and the Cloudflare home's quality bar (routes, budgets,
  Lighthouse).
- Per-PR previews (`preview.yml`, the preview account and Supabase project).
- Triaging `PLAN.md`, `BUILD-LOG.md` and `PRODUCT-ROADMAP.md` into `ROADMAP.md` and
  `FINDINGS.md`, and writing `ROADMAP.md` entries before the owner answers.
- The Supabase token slim-down (option A chosen).
- The owner's settings steps: the ruleset with `fast` and `slow` required, the squash title setting.
