# Move lalista to devshop v4.2, with the fonts served from the app

**Go:** "Can you upgrade to DevShop 4.0?" … "Can you manage all of that? Answer anything that has to be done in there and get it done on a new session or multiple new sessions. Just go and open them. Don't come to me." (owner, 2026-11-10); on the reviewer's local run, "B" (fix the devshop, keep `scripts/local-run.sh`) and "done with devshop release! 4.2" (owner, 2026-11-10 and 2026-11-11); on the fonts, "yes, do the local fonts PR first" (owner, 2026-11-11)

## Intent

The owner asked to upgrade lalista from devshop v3.0.0 to v4, in one PR, with Claude deciding
what the upgrade asks. Since #15 added `scripts/local-run.sh`, every `ship.sh` review is
could-not-run: the reviewer's fresh clone has no Worker build and no per-package `node_modules`.
The owner chose to keep the script and fix the devshop; v4.2.0 does (the reviewer installs offline
in its clone and runs a project's `scripts/build.sh` before its local run). So this PR pins
v4.2.0, not v4.0.0, and makes the moves v4.2.0's reviewer README lists for a site that must be
built first. No change to what the app renders.

What v4.0.0 → v4.2.0 brings beyond that: the devshop plugin is renamed `ak` (skills `ak:intent`,
`ak:build`, `ak:pr`, …); leaks stop before a push (lockfiles from a non-public registry, Claude
session links, hook-skipping git commands); pinned tools are repaired after a failed download; CI
runs once per PR head; parallel branches stop conflicting on shared lists.

## Decisions

- Pin `v4.2.0`, the release with the reviewer fix (owner, 2026-11-11). It reached this session by
  fetching the tag into the session's devshop copy and re-running the session-start dispatcher, as
  v4.2.0's README says; the `DEVSHOP:` line names v4.2.0 (Claude, 2026-11-11).
- The major release's migration is the skill rename. Nothing in lalista outside the v1-era records
  (`BUILD-LOG.md`, `PLAN.md`, `PRODUCT-ROADMAP.md`, old `specs/` folders) names a `devshop:` skill,
  and those records stay as history (Claude, 2026-11-10).
- The `devshop` files that changed (`scripts/secret-scan.sh`, `scripts/project-contract.txt`) are
  taken whole, as the upgrade requires (Claude, 2026-11-10 and 2026-11-11).
- Seed `CLAUDE.md`: apply both of the template's new lines, the ban on Claude session links (the
  owner's standing rule) and "shared changes and flaky-test fixes go first; a failing test is never
  re-run" (v4.2.0). The second replaces the habit of re-running a job once for known noise: a
  failure is reproduced and its cause fixed first (Claude, 2026-11-11).
- Seed `ci.yml`: apply the template's `concurrency` block, so a newer run for a PR cancels the
  older one and `main`'s runs never cancel. It matches the owner's ask to stop wasted parallel runs
  (owner, 2026-11-10: "let's go serially").
- Seed `check-fast.sh`: skip the template's `COLLECTIONS` count check. lalista has no collection
  that parallel branches each add an item to, so it would only print "no COLLECTIONS"; rejected:
  adding it for parity (Claude, 2026-11-11).
- The build moves to `scripts/build.sh` (`pnpm --filter @lalista/web build:worker`, telemetry
  off). `scripts/local-run.sh` already served only an existing build; its comments now point at
  `scripts/build.sh`. `scripts/check-slow.sh` builds through it, so CI, the reviewer and the design
  review build the same way (v4.2.0's move note).
- Given no Supabase values (the reviewer has no local stack), `scripts/build.sh` defaults to the
  local stack's URL and a placeholder key, so the public pages render (200) and signed-in ones
  redirect to `/sign-in`; without it every page answered 500 ("URL and Key are required"). Real
  values, as `check-slow.sh` and local development give, win (Claude, 2026-11-11).
- Playwright moves to 1.63.0, exact, in two places: `playwright` as a new root dev dependency (the
  reviewer's browser loads it from the root `node_modules`) and `@playwright/test` in `apps/web`
  (from 1.59.1), so the repo has one Playwright. 1.63.0 is the version whose Chromium the cloud
  environment carries in `/opt/pw-browsers`; with 1.59.1 the reviewer's browser couldn't start
  (`chromium_headless_shell-1217` missing). CI installs the browsers for whichever version is pinned.
  Rejected: a root 1.63.0 beside `apps/web`'s 1.59.1, two Playwrights in one lockfile (Claude,
  2026-11-11).
- **Local fonts, folded in after the go.** `next/font/google` downloaded Fraunces and Plus Jakarta
  Sans from Google at every build: it broke `scripts/build.sh`'s "reaches no other host" and caused
  Turbopack's intermittent "next/font/google queries have exactly one entry", which failed this PR's
  `fast` job twice (and #10's once). The owner asked for that fix to go first, but the reviewer can
  only check it with this PR's `scripts/build.sh`, so after the second failure it joined this PR
  (owner, 2026-11-11: "yes, do the local fonts PR first"; Claude, 2026-11-11, on folding it in).
  What users see doesn't change: next/font already served the fonts from lalista's own domain.
- The files are the ones Google serves for the weights the app uses (Fraunces 300/400/600 normal
  and italic, Plus Jakarta Sans 400/500/600): three variable WOFF2 files, Latin subset, fetched
  from Google Fonts' CSS API on 2026-11-11, with each family's SIL Open Font License 1.1 text beside
  them in `apps/web/app/fonts/`. The variable weight ranges (Fraunces 100–900, Plus Jakarta Sans
  200–800) are declared as the files' `fvar` axes give them (Claude, 2026-11-11).
- Only the Latin subset ships, as before: the old setup asked for `subsets: ['latin']`, and Latin
  holds every Spanish letter (á, é, í, ó, ú, ñ, ü, ¿, ¡). The old build also emitted latin-ext and
  Vietnamese faces that load only for characters outside Latin; such characters now use the
  fallback (Georgia / system-ui). Rejected: committing those subsets too, for text lalista doesn't
  show (Claude, 2026-11-11).
- The CSS variables (`--font-lalista-display`, `--font-lalista-body`) and `display: 'swap'` stay,
  so every style that uses the fonts is unchanged.
- `FINDINGS.md` F-18, which this PR logs, is fixed by it and its row removed; `scripts/build.sh` loses its "known exception"
  note; `CLAUDE.md`'s Next-version gotcha says the font error came from `next/font/google` and is
  gone with local fonts; `DESIGN.md`'s loading line says the fonts are served from the app's
  files.
- The v4 lockfile check doesn't read `pnpm-lock.yaml`; logged as `FINDINGS.md` F-17 (Claude,
  2026-11-10).

## Acceptance items

- **AC-1** `.devshop-version` holds `v4.2.0`, and every `devshop` file of v4.2.0's
  `project-files.txt` that the project has is identical to v4.2.0's — verified by review:
  `project-files-at.sh check --version v4.2.0 --project .` exits 0.
- **AC-2** `CLAUDE.md`'s Rules ban Claude session links and say a failing test is never re-run,
  and it names no `devshop:` skill — verified by review: `grep` for both lines and for
  `devshop:[a-z]`.
- **AC-3** `scripts/build.sh` is executable and builds `apps/web/.open-next`, which
  `scripts/local-run.sh` serves without building; `scripts/check-slow.sh` builds through
  `scripts/build.sh` — verified by review: in a fresh clone with an offline install and no Supabase
  values, the build took 57 s and `/`, `/sign-in` and `/sign-up` answered 200 and `/list` 307 to
  `/sign-in`; and `slow` green in CI.
- **AC-4** `ship.sh`'s review of this PR runs its local run (install, build, serve) instead of
  could-not-run — verified by review: the verdict comment on this PR.
- **AC-5** `scripts/check-fast.sh origin/main` passes on this branch — verified by review: run on
  this branch, and `fast` green in CI.

- **AC-6** `apps/web/app/layout.tsx` imports no `next/font/google`, and loads Fraunces (normal and
  italic) and Plus Jakarta Sans with `next/font/local` from files in `apps/web/app/fonts/`, each
  with its OFL text — verified by review: the diff, and `grep -rn next/font/google apps packages`
  finds nothing.
- **AC-7** The Worker build fetches nothing from Google: built three times from a clean `.next`
  with fonts.googleapis.com and fonts.gstatic.com unreachable, each build passes and serves the
  pages with the same font families — verified by review: the build log of the three runs.
- **AC-8** The pages look the same: the landing and sign-in pages, light and dark, before and after
  — verified by review: the screenshots in the PR.

## Out of scope

- Rewriting `devshop:` or `/ak-*` names in the v1-era records.
- The devshop's pnpm lockfile check (F-17).
- Any change to which fonts, weights or styles the app uses.
