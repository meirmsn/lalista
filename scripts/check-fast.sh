#!/usr/bin/env bash
# The fast CI tier (from the devshop's template). CI's `fast` job runs it (.github/workflows/ci.yml):
#   - the secret scan over what the change adds since <base> (scripts/secret-scan.sh, devshop copy);
#   - the spec check: every flat spec specs/*.md has the shape, and every AC-<n> not marked "verified
#     by review" is named by a test under TEST_DIRS (scripts/spec-check.py, devshop copy). The v1-era
#     spec folders under specs/ predate the shape and are read as history, not checked
#     (specs/devshop-v3.md);
#   - the project contract check (scripts/contract-check.py over scripts/project-contract.txt);
#   - lint: scripts/lint.sh (ESLint, typecheck, Prettier on the changed files);
#   - no DESIGN.md check yet: DESIGN.md has no front matter (ROADMAP.md R-7);
#   - the stack's parts: unit tests and the build, the deploy script's tests, the per-file lint's
#     tests (scripts/lint-file.test.sh, specs/lint-file.md), the repo-shape test.
# Usage: scripts/check-fast.sh [base-sha]
# Every part runs even after one fails. Exit 0 = clean; 1 = failures; 2 = a part couldn't run.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
TEST_DIRS=(scripts packages apps supabase/functions) # where the tests live (beside their source)
worst=0
part() {
  local rc
  echo "== $*"
  "$@"
  rc=$?
  case $rc in
    0) ;;
    1) echo "$1 failed"; [ "$worst" -ge 1 ] || worst=1 ;;
    *) echo "$1 couldn't run (exit $rc)"; worst=2 ;;
  esac
}
tests=()
for d in "${TEST_DIRS[@]}"; do tests+=(--tests "$d"); done
shopt -s nullglob
specs=(specs/*.md)
shopt -u nullglob

part scripts/secret-scan.sh "${1:-}"
if [ "${#specs[@]}" -gt 0 ]; then
  part scripts/spec-check.py "${tests[@]}" "${specs[@]}"
else
  echo "no flat specs in specs/ yet"
fi
part scripts/contract-check.py
part scripts/lint.sh "${1:-}"
echo "DESIGN.md check skipped: DESIGN.md has no front matter yet (ROADMAP.md R-7)"
# --- Stack parts ---
part pnpm turbo run test:unit build
part bash scripts/deploy.test.sh
part bash scripts/lint-file.test.sh
part bash scripts/repo-shape.test.sh
exit "$worst"
