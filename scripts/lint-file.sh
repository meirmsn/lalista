#!/usr/bin/env bash
# Lints one file, scripts/lint-file.sh <path> (specs/lint-file.md): what scripts/lint.sh lints, one
# file at a time, so the devshop's per-edit hook and CI agree. ESLint on a JS/TS file under apps/web/
# (inside apps/web/, with its config, as lint.sh runs it through turbo; warnings and ignored files
# pass), and Prettier --check --ignore-unknown on any file (.prettierignore and unknown types pass).
# A file Prettier can't parse is a finding. The typecheck is whole-project: lint.sh and CI run it.
# Exit 0 = clean; 1 = findings; 2 = couldn't run.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
file=${1:-}
[ -n "$file" ] || { echo "usage: scripts/lint-file.sh <path>"; exit 2; }
[ -f "$file" ] || { echo "lint-file: not a file: $file"; exit 2; }
command -v pnpm >/dev/null || { echo "lint-file: pnpm not found"; exit 2; }
[ -d node_modules ] || { echo "lint-file: no node_modules (run scripts/setup.sh)"; exit 2; }
worst=0
note() { [ "$worst" -ge "$1" ] || worst=$1; }

case $file in
  apps/web/*.js | apps/web/*.jsx | apps/web/*.mjs | apps/web/*.cjs | apps/web/*.ts | apps/web/*.tsx)
    (cd apps/web && pnpm exec eslint --no-warn-ignored -- "${file#apps/web/}")
    case $? in
      0) ;;
      1) note 1 ;;
      *) echo "lint-file: ESLint couldn't run on $file"; note 2 ;;
    esac
    ;;
esac

out=$(pnpm exec prettier --check --ignore-unknown --log-level warn -- "$file" 2>&1)
rc=$?
[ -z "$out" ] || printf '%s\n' "$out"
case $rc in
  0) ;;
  1) note 1 ;;
  *) if grep -q 'SyntaxError' <<<"$out"; then note 1; else
       echo "lint-file: Prettier couldn't run on $file"; note 2
     fi ;;
esac
exit "$worst"
