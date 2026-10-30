# DEPS-WATCH

Parked dependency upgrades waiting on upstream ecosystem readiness. Each row's
`recheck-on` date is when the session-start hook will surface it as overdue.
Push a date forward (e.g. "push eslint by 1 month") to defer.

When upstream catches up, post `@dependabot unignore this dependency` on the
relevant PR — dependabot will recreate the bump.

| recheck-on | dep                     | block                                                                                                                                     | how-to-unignore                                                  |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-06-01 | eslint 10               | `eslint-config-next@16` (Next preset) still pins `eslint ^9`; `eslint-plugin-react` (transitive) uses removed `context.getFilename()` API | `gh pr comment 21 --body "@dependabot unignore this dependency"` |
| 2026-06-01 | @vitejs/plugin-react v6 | requires `vite ^8`; `vitest@4.1.5` pulls in `vite@7` transitively. CI fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` for `vite/internal`      | `gh pr comment 22 --body "@dependabot unignore this dependency"` |
