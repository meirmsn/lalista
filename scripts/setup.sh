#!/usr/bin/env bash
# Installs what the checks need: the workspace's packages at the locked versions. Idempotent; reaches
# only the npm registry. CI runs it in each job after pnpm and Node are set up (.github/workflows/ci.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
