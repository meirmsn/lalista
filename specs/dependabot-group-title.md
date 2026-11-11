# Dependabot's group PRs pass the title check, and leave Playwright alone

**Go:** "To merge all the open PRs of the Pendabot. Can you manage all of that? Answer anything that has to be done in there and get it done on a new session or multiple new sessions. Just go and open them. Don't come to me." (owner, 2026-11-10)

## Intent

The owner asked for every open Dependabot PR to be merged without coming back to them. The
minor-and-patch group PR can't pass: its title, "chore(deps): Bump the minor-and-patch group across
1 directory with 21 updates" (79 characters), fails the PR-title check's 72, and Dependabot resets
the title on every rebase (#8, then #19). #19 also moves Playwright from 1.63.0 to 1.65.0, and the
devshop reviewer's browser can't start on a Playwright whose Chromium the cloud environment doesn't
carry (the reason #17 pinned 1.63.0). This changes `.github/dependabot.yml` so the group's title
fits and Playwright stays where it is; Dependabot then replaces #19 with a group PR it can land.

## Decisions

- The group is renamed `minor`: "chore(deps): Bump the minor group across 1 directory with N
  updates" is 68 characters at N < 100 and 69 up to 999. Rejected: renaming the PR by hand on each
  rebase (Dependabot puts the title back; owner's renaming of #8 was undone this way), and loosening
  the title check (a devshop rule) (Claude, 2026-11-11).
- `playwright` and `@playwright/test` are ignored by Dependabot: they move by hand, together, with
  the Chromium in the cloud environment's `/opt/pw-browsers`, as #17 did (1.59.1 → 1.63.0).
  Rejected: letting the group move them and pinning back each time (Claude, 2026-11-11).
- `scripts/repo-shape.test.sh` checks both, so a later edit to `dependabot.yml` can't bring either
  failure back.
- The group's other moves in #19 (Next 16.4.2 → 16.4.5 with `@opennextjs/cloudflare` 1.20.12 →
  1.20.16, whose peer range needs Next ≥ 16.4.5; `wrangler` 4.149.0 → 4.158.0; React 19.3; Supabase
  clients) are judged on the PR Dependabot opens after this one, not here.

## Acceptance items

- **AC-1** Every group in `.github/dependabot.yml` gives a PR title that `scripts/pr-title-check.py`
  accepts, even at 999 updates.
- **AC-2** `.github/dependabot.yml` ignores `playwright` and `@playwright/test`.

## Out of scope

- Judging or landing the group's dependency moves (the next group PR).
- When to move Playwright with the cloud environment's Chromium.
