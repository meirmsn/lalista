#!/usr/bin/env bash
# The repo's shape after the move to devshop v3 (specs/devshop-v3.md). Run by scripts/check-fast.sh.
# Exit 0 = every check holds; 1 = one or more failed (each named).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
fails=0
fail() { echo "FAIL: $*"; fails=1; }

# devshop-v3 AC-3: nothing reads .devcontainer/, gitleaks is pinned with its checksum in ci.yml,
# and every workflow that installs the Supabase CLI pins the same version.
[ ! -e .devcontainer ] || fail ".devcontainer/ still exists"
# The records (specs/, BUILD-LOG.md, PLAN.md, PRODUCT-ROADMAP.md, ios-archive/) keep their
# history; everything else is current and must not point at the deleted folder.
skip=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=specs --exclude-dir=ios-archive
  --exclude=BUILD-LOG.md --exclude=PLAN.md --exclude=PRODUCT-ROADMAP.md
  --exclude=repo-shape.test.sh)
named=$(grep -rl '\.devcontainer/' "${skip[@]}" . 2>/dev/null | tr '\n' ' ')
[ -z "$named" ] || fail "a current file still names .devcontainer/: $named"
grep -qE '^  GITLEAKS_VERSION: [0-9]+\.[0-9]+\.[0-9]+$' .github/workflows/ci.yml || fail "ci.yml doesn't pin GITLEAKS_VERSION"
grep -qE '^  GITLEAKS_SHA256: [0-9a-f]{64}$' .github/workflows/ci.yml || fail "ci.yml doesn't pin GITLEAKS_SHA256"
versions=$(grep -h -A2 'supabase/setup-cli@' .github/workflows/*.yml | grep -oE 'version: [0-9][0-9.]*' | sort -u)
[ "$(printf '%s\n' "$versions" | grep -c .)" = 1 ] || fail "workflows pin different Supabase CLI versions: $versions"

# devshop-v3 AC-4: no husky, no lint-staged, no prepare script.
[ ! -e .husky ] || fail ".husky/ still exists"
node -e '
  const p = require("./package.json");
  const bad = [];
  if (p.scripts && p.scripts.prepare) bad.push("scripts.prepare");
  for (const d of ["husky", "lint-staged"]) if ((p.devDependencies || {})[d] || (p.dependencies || {})[d]) bad.push(d);
  if (p["lint-staged"]) bad.push("the lint-staged key");
  if (bad.length) { console.log(bad.join(", ")); process.exit(1); }
' >/dev/null || fail "package.json still has husky or lint-staged parts"

# devshop-v3 AC-5: the db:* scripts call the Supabase CLI, not the devcontainer's relay.
node -e '
  const s = require("./package.json").scripts || {};
  const db = Object.entries(s).filter(([k]) => k.startsWith("db:"));
  if (!db.length || db.some(([, v]) => !/^supabase /.test(v))) process.exit(1);
' || fail "a db:* script doesn't call the Supabase CLI"

# devshop-v3 AC-6: @playwright/test is pinned exact.
node -e '
  const v = (require("./apps/web/package.json").devDependencies || {})["@playwright/test"] || "";
  if (!/^\d+\.\d+\.\d+$/.test(v)) process.exit(1);
' || fail "@playwright/test isn't pinned to an exact version"

# devshop-v3 AC-10: CLAUDE.md has v3's sections, keeps lalista's own, and no v1 references.
for h in '## How changes land' '## Rules' '### Where Things Happen' '### Gotchas'; do
  grep -qxF "$h" CLAUDE.md || fail "CLAUDE.md has no '$h' section"
done
if grep -nE '/ak-|/devshop/kit|supabase-runner|devcontainer' CLAUDE.md; then
  fail "CLAUDE.md still names a v1 skill, path or relay (above)"
fi

# devshop-v3 AC-11: TODOS.md is sorted: gone, and each bug, data and operations item is a finding
# or a roadmap entry.
[ ! -e TODOS.md ] || fail "TODOS.md still exists"
for slug in disambig-sheet-auto-close-on-banner-symmetry loading-skeleton-a11y-single-status-region \
  controlled-input-hydration-race per-household-items-catalog admin-promote-custom-store-to-global \
  bootstrap-purchase-history-prod threshold-tuning-post-dogfood; do
  grep -qE "^\| F-[0-9]+ .*\`$slug\`" FINDINGS.md || grep -qF "\`$slug\`" ROADMAP.md \
    || fail "neither FINDINGS.md nor ROADMAP.md names $slug"
done

[ "$fails" = 0 ] && echo "repo-shape: ok"
exit "$fails"
