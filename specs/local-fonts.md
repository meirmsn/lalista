# Serve the two fonts from the repo instead of downloading them at build

**Go:** "yes, do the local fonts PR first" (owner, 2026-11-11)

## Intent

The web build fails about one time in three with Turbopack's "next/font/google queries have
exactly one entry": `next/font/google` downloads Fraunces and Plus Jakarta Sans from Google during
every build. It failed #10's and #17's `fast` jobs on 2026-11-10 and 2026-11-11. The download also
breaks `scripts/build.sh`'s contract line "reaches no other host" (`FINDINGS.md` F-18). The owner
asked for the fix to go first: the same font files, committed, loaded with `next/font/local`. What
users see doesn't change: next/font already served these fonts from lalista's own domain, never
from Google at runtime.

## Decisions

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
- `FINDINGS.md` F-18 is fixed and its row removed; `scripts/build.sh` loses its "known exception"
  note; `CLAUDE.md`'s Next-version gotcha says the font error came from `next/font/google` and is
  gone with local fonts; `DESIGN.md`'s loading line says the fonts are served from the app's
  files.

## Acceptance items

- **AC-1** `apps/web/app/layout.tsx` imports no `next/font/google`, and loads Fraunces (normal and
  italic) and Plus Jakarta Sans with `next/font/local` from files in `apps/web/app/fonts/`, each
  with its OFL text — verified by review: the diff, and `grep -rn next/font/google apps packages`
  finds nothing.
- **AC-2** The Worker build fetches nothing from Google: built three times from a clean `.next`
  with fonts.googleapis.com and fonts.gstatic.com unreachable, each build passes and serves the
  pages with the same font families — verified by review: the build log of the three runs.
- **AC-3** The pages look the same: the landing and sign-in pages, light and dark, before and after
  — verified by review: the screenshots in the PR.

## Out of scope

- Any change to which fonts, weights or styles the app uses.
