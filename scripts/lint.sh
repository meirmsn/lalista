#!/usr/bin/env bash
# The project's lint, scripts/lint.sh [base]: ESLint and the TypeScript typecheck over the workspace,
# and Prettier over the files changed since base, so files already unformatted on main don't fail a
# change that doesn't touch them. Without a usable base, Prettier is skipped and says so.
# Exit 0 = clean; 1 = findings; 2 = couldn't run.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
command -v pnpm >/dev/null || { echo "lint: pnpm not found"; exit 2; }
[ -d node_modules ] || { echo "lint: no node_modules (run scripts/setup.sh)"; exit 2; }
worst=0
pnpm turbo run lint typecheck || worst=1

base=${1:-}
if [ -n "$base" ] && git rev-parse -q --verify "$base^{commit}" >/dev/null 2>&1; then
  mapfile -t files < <(git diff --name-only --diff-filter=ACMR "$base"...HEAD 2>/dev/null)
  if [ "${#files[@]}" -gt 0 ]; then
    pnpm exec prettier --check --ignore-unknown "${files[@]}" || worst=1
  else
    echo "lint: no changed files for Prettier"
  fi
else
  echo "lint: no usable base ('$base'): Prettier skipped"
fi
exit "$worst"
