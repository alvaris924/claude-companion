## Summary

<!-- What changes and why, in one short paragraph. Link the design section or ADR if one applies. -->

Closes #

## Type of change

- [ ] `feat` new capability
- [ ] `fix` bug fix
- [ ] `docs` documentation only
- [ ] `chore` / `ci` tooling, workflow, dependencies
- [ ] `refactor` / `perf` no behaviour change intended
- [ ] `test` tests only

## Test plan

<!-- How you verified it: the claude plugin validate and claude plugin test results, the Claude Code version, and the surfaces you watched it on (terminal, VS Code, desktop). Screenshots must show nothing private. -->

## Checklist

- [ ] PR title is a Conventional Commit: `type(scope): subject`
- [ ] Tests added or updated in `tests/` for behaviour in `hooks/`
- [ ] `claude plugin validate .` and `claude plugin test .` pass locally
- [ ] `CHANGELOG.md` updated under `[Unreleased]`, or the `skip-changelog` label applied
- [ ] Docs updated (`README.md`, `docs/`) if behaviour, a command or a setting changed
- [ ] No new dependencies; only the plugin API Claude Code publishes
- [ ] Nothing private in the diff, fixtures or screenshots: no keys, tokens, personal paths or text from real sessions
- [ ] Checked on Claude Code 2.1.300 or newer on every surface the change draws on, or the reason it was not is noted above
