# devcontainer-option3-followups

Post-merge verification + cleanup for lalista PR 34 (`devcontainer-compose-isolated`, Option 3 compose isolation). All work is operator-driven from the macOS host or from inside the **new** compose-stack workspace; it specifically does NOT need to happen from inside the OLD single-container devcontainer that PR 34 supersedes.

## Context

PR 34 shipped the two-container compose architecture (workspace + supabase-runner sibling) but the operator's verification was done from the OLD container that survived the rebuild for session-continuity reasons (per the architecture commit-arc in PR 34's body). After merge, the operator needs to:

1. Port their VS Code session into the NEW compose stack.
2. Confirm that all the devshop / gstack skills (\`/ak-build\`, \`/qa\`, \`/design-review\`, \`/benchmark\`, \`/canary\`, etc.) work correctly in the new workspace-1 — they're general-purpose skills that depend on the workspace's tooling, network, and Supabase reachability.
3. Confirm integration tests still pass in the post-port workspace.
4. Clean up the OLD container + the fallback branch.

This spec captures the concrete steps so a fresh \`/ak-status\` in the new compose-stack workspace can pick up where the PR left off without having to re-derive context.

## Sources

- PR 34 (\`devcontainer-compose-isolated\`, 2026-04-28): https://github.com/meirmsn/lalista-old/pull/34
- Architecture guide: \`/devshop/kit/docs/guide/local-supabase-compose-isolation.md\`
- Threat model + decision matrix: \`/devshop/kit/notes/security/local-supabase-isolation-options.md\`
- Devshop template-port followup: \`/devshop/kit/notes/roadmap/lalista-option3-template-port.md\` (separate focused-session work)

## Decisions (locked)

- **The OLD container (\`a1d926ba7bac\`) gets deleted** after the port. It was a fallback bridge during PR 34's verification arc; serves no purpose post-merge.
- **The fallback branch (\`devcontainer-host-docker-socket\`) gets deleted** locally + on origin. It was a fallback if Option 3 failed; Option 3 shipped and the branch is no longer needed.
- **This conversation does NOT migrate** to the new compose-stack workspace. \`${devcontainerId}\` includes the dev-container schema (single-container vs compose), so the named volume for \`/home/node/.claude\` is keyed differently between the OLD and NEW containers. \`claude --resume\` in the new workspace would NOT find the prior session. Plan to start fresh; reference PR 34 + this spec as briefing material.

## Task order

### 1. Pre-merge: confirm CI green

\`\`\`bash
gh pr view 34 --json statusCheckRollup,mergeable --jq '{mergeable, state: .statusCheckRollup[0].state}'
\`\`\`

Expected: \`mergeable: MERGEABLE\`, status check state \`SUCCESS\`. If CI is still in progress, wait. If CI failed for some new reason, diagnose before merging.

### 2. Merge PR 34 (operator's choice on review)

\`\`\`bash

# Optional: independent second opinion on the architecture

/codex review

# Squash-merge per lalista convention (the (#NN) format on main)

gh pr merge 34 --squash --auto
\`\`\`

### 3. Port VS Code session to the new compose stack

The OLD VS Code window is attached to \`a1d926ba7bac\` (the OLD single container). Switch to the new \`lalista_devcontainer-workspace-1\`:

\`\`\`

- Close the OLD VS Code window.
- Open the project fresh in VS Code.
- "Reopen in Container" → VS Code attaches to lalista_devcontainer-workspace-1.
- Open integrated terminal — confirm hostname is NOT a1d926ba7bac.
- Run `claude` → fresh session.
  \`\`\`

### 4. Fresh-session orientation

In the new \`claude\` session in workspace-1:

\`\`\`
/ak-status
\`\`\`

This reads PLAN.md, BUILD-LOG.md, current branch, and this spec via \`specs/devcontainer-option3-followups/spec.md\`. Should produce a one-paragraph briefing covering "PR 34 just merged, post-merge verification pending."

### 5. Smoke-test the new workspace (skip if /ak-status surfaces issues)

Same checks from the architecture guide's "Smoke-test commands" section. Each should pass:

\`\`\`bash

# Identity / security checkpoint

hostname # NOT a1d926ba7bac
which docker # not found
ls /var/run/docker.sock 2>&1 | head # No such file

# Relay reachable + supabase stack alive

curl -fsS http://supabase-runner:9000/status | head -3 # 🔧 Development Tools box

# Data plane reachable

curl -sS -o /dev/null -w "kong=%{http_code}\n" http://host.docker.internal:54321/ # kong=404
curl -sS http://host.docker.internal:54321/rest/v1/ | head -3 # PostgREST OpenAPI

# Auto-set env vars

echo "SUPABASE_URL=$SUPABASE_URL" # http://host.docker.internal:54321
echo "ANON_KEY first 30: ${SUPABASE_ANON_KEY:0:30}" # eyJhbGciOiJIUzI1NiIsInR5cCI6Ik...
\`\`\`

If anything fails, jump to the architecture guide's "Debugging tree" section.

### 6. Confirm devshop / gstack skills work in workspace-1

The skills depend on workspace tooling + network. After the schema change, validate they still operate correctly. Pick the ones the operator actually uses; minimum bar is \`/ak-build\`'s gates and \`/qa\`'s browse daemon (those exercise the broadest surface).

\`\`\`bash

# Re-run integration tests as a baseline (should still be 7/7 pass)

cd /workspace
pnpm test:integration | tail -5

# /ak-build pipeline preflight check (lightweight — doesn't actually build a feature)

# Look at /ak-build's Phase 0 to see if it can read the project state cleanly.

# /qa-only preflight — confirm the browse daemon spins up against pnpm dev

# In one terminal:

pnpm dev

# In another:

/qa-only

# (Or the manual "pnpm dev" + sign-in flow check that's the still-pending PR 34 checkbox.)

# /design-review against a running pnpm dev

# Confirms Chromium binary + Playwright + browse daemon stack works

\`\`\`

If any skill fails, file specific failures here and update PR 34's open checkbox accordingly.

### 7. Cleanup

\`\`\`bash

# Delete the OLD container (running in parallel since the PR 34 verification arc)

docker rm -f a1d926ba7bac

# Delete the fallback branch — local + origin

git branch -D devcontainer-host-docker-socket
git push origin --delete devcontainer-host-docker-socket

# Delete the operator's local .env.local backups (if not already deleted)

# (.env.local has the URL-history comment header from the cleanup we did during PR 34)

rm -f apps/web/.env.local.bak.option3 apps/web/.env.local.bak.option3-fix

# Verify branches state

git branch -a | grep devcontainer
\`\`\`

### 8. Optional: Docker Desktop hardening Step 2

Independent of the above. Per architecture guide § "Host-side touchpoints":

- Docker Desktop → Settings → Docker Engine (JSON):
  \`\`\`jsonc
  {
  "no-new-privileges": true,
  "userland-proxy": false,
  "icc": false
  }
  \`\`\`
- \`icc: false\` only restricts the default bridge — our compose stack uses a named network and is unaffected. Other ad-hoc \`docker run\` containers without explicit networks lose default-bridge container-to-container reach. Verify after applying.

### 9. Update PR 34's "Manual: pnpm dev + sign-in flow" checkbox

Per the test-plan checklist remaining in PR 34's body. Comment on the PR with the result, or just check the box in the merged PR's description.

## Out of scope

- **Devshop template port.** That work is captured separately at \`/devshop/kit/notes/roadmap/lalista-option3-template-port.md\` and \`/devshop/kit/TODOS.md § lalista-option3-template-variant\`. It's a separate focused session because the changes touch the template that propagates to ALL future projects, needs adversarial docs review with inlined conventions, and wants full architectural memory.
- **README sync deeper than what PR 34 already did.** \`.devcontainer/README.md\` was updated comprehensively in commit \`97eec6b\`; further drift can be a separate session.
- **Investigating gitleaks's behavior in detail.** PR 34 commit \`2d6666f\` reverted the unnecessary allowlist regex with an honest commit message; if gitleaks behavior changes (e.g., supabase format changes), revisit then.
- **Migration cycle test** (per the original PR 34 plan: trivial migration → reset → gen-types → revert). Lower priority — \`pnpm test:integration\` already exercises the migration apply path.

## Verification

This spec is "done" when:

- [ ] PR 34 merged
- [ ] VS Code session ported to workspace-1 (hostname differs from a1d926ba7bac)
- [ ] Smoke tests in workspace-1 pass
- [ ] At least one devshop/gstack skill validated end-to-end (/ak-build, /qa, or /design-review)
- [ ] Integration tests pass in workspace-1
- [ ] OLD container + fallback branch deleted
- [ ] Manual sign-in flow checkbox on PR 34 marked

The devshop template port is tracked separately and is NOT part of this spec's done-criteria.
