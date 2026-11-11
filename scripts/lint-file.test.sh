#!/usr/bin/env bash
# Tests scripts/lint-file.sh (specs/lint-file.md). Run by scripts/check-fast.sh; needs node_modules.
# Fixtures go under apps/web/ (for its ESLint config) and the repo root, in directories neither
# .gitignore nor .prettierignore covers, and are removed on exit.
# Exit 0 = every check holds; 1 = one or more failed (each named); 2 = couldn't run.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
[ -d node_modules ] || { echo "lint-file.test: no node_modules (run scripts/setup.sh)"; exit 2; }
fails=0
fail() { echo "FAIL: $*"; fails=1; }
web=$(mktemp -d apps/web/lint-file-test.XXXXXX) || exit 2
root=$(mktemp -d lint-file-test.XXXXXX) || exit 2
bare=$(mktemp -d) || exit 2
trap 'rm -r -- "$web" "$root" "$bare"' EXIT

# expect <exit> <label> <args...>: runs lint-file.sh and checks its exit; the output is kept in $out.
expect() {
  local want=$1 label=$2 rc
  shift 2
  out=$(scripts/lint-file.sh "$@" 2>&1)
  rc=$?
  [ "$rc" = "$want" ] || fail "$label: exit $rc, want $want: $out"
}

# lint-file AC-1: clean, ESLint-ignored and Prettier-ignored files pass.
printf "export const greeting = 'hola';\n" >"$web/clean.ts"
printf '# Hola\n\nUna lista.\n' >"$root/clean.md"
expect 0 "clean TS under apps/web" "$web/clean.ts"
expect 0 "clean Markdown at the root" "$root/clean.md"
expect 0 "ESLint-ignored file" apps/web/next-env.d.ts
expect 0 "Prettier-ignored devshop copy" scripts/project-contract.txt

# lint-file AC-2: an ESLint error is a finding, printed.
printf "// @ts-ignore\nexport const n: number = 1;\n" >"$web/eslint-error.ts"
expect 1 "ESLint error" "$web/eslint-error.ts"
grep -q 'ban-ts-comment' <<<"$out" || fail "ESLint error: the rule isn't printed: $out"

# lint-file AC-3: a file Prettier would reformat, or can't parse, is a finding, printed.
printf '{"a":1,\n"b":   2}\n' >"$root/unformatted.json"
expect 1 "unformatted JSON" "$root/unformatted.json"
grep -q 'unformatted.json' <<<"$out" || fail "unformatted JSON: the file isn't printed: $out"
printf 'export const x = (\n' >"$root/broken.ts"
expect 1 "TS Prettier can't parse" "$root/broken.ts"
grep -q 'broken.ts' <<<"$out" || fail "unparseable TS: the file isn't printed: $out"

# lint-file AC-4: no path, not a file, no pnpm, no node_modules: couldn't run.
expect 2 "no path"
expect 2 "not a file" "$root/missing.ts"
expect 2 "a directory" "$root"
ln -s "$(command -v dirname)" "$bare/dirname"
rc=0
PATH=$bare "$BASH" scripts/lint-file.sh "$root/clean.md" >/dev/null 2>&1 || rc=$?
[ "$rc" = 2 ] || fail "no pnpm: exit $rc, want 2"
mkdir "$bare/repo" "$bare/repo/scripts" && cp scripts/lint-file.sh "$bare/repo/scripts/"
printf '# Hola\n' >"$bare/repo/clean.md"
rc=0
(cd "$bare/repo" && scripts/lint-file.sh clean.md >/dev/null 2>&1) || rc=$?
[ "$rc" = 2 ] || fail "no node_modules: exit $rc, want 2"

# lint-file AC-5: committed executable, run by the fast tier, and present for the contract.
[ "$(git ls-files -s scripts/lint-file.sh | cut -d' ' -f1)" = 100755 ] ||
  fail "scripts/lint-file.sh isn't committed with mode 100755"
grep -q '^part bash scripts/lint-file.test.sh$' scripts/check-fast.sh ||
  fail "scripts/check-fast.sh doesn't run scripts/lint-file.test.sh"
if scripts/contract-check.py 2>&1 | grep -q 'scripts/lint-file.sh'; then
  fail "scripts/contract-check.py still names scripts/lint-file.sh"
fi

# lint-file AC-6: CLAUDE.md's Orientation names every top-level doc and design/.
orientation=$(sed -n '/^> \*\*Orientation\*\*/,/^[^>]/p' CLAUDE.md)
for doc in *.md design/; do
  [ "$doc" = CLAUDE.md ] && continue
  grep -qF "\`$doc\`" <<<"$orientation" || fail "CLAUDE.md's Orientation doesn't name $doc"
done

exit "$fails"
