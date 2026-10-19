# Contributing to Companion

This document is the workflow contract for every change, whether written by hand or with an AI assistant.

## First-time setup

```
git config core.hooksPath .githooks
```

The hooks reject commit messages that are not Conventional Commits and refuse direct pushes to `main`. They are a courtesy check; the same rules are enforced on GitHub.

To try your checkout, start Claude Code with `claude --plugin-dir <path to the clone>`. To load it in every session instead, name the clone in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. An interactive session reloads the plugin when a file in the folder is saved; other sessions read it when they start. If you also installed Companion from its marketplace, disable that copy while you work on the checkout.

## Branching model

- `main` is always releasable and is protected: pull requests only, linear history, required checks, every review conversation resolved.
- Every change lives on a short-lived branch cut from an up-to-date `main`:
  `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`, `ci/<topic>`, `refactor/<topic>`, `perf/<topic>`, `test/<topic>`.
- One branch per issue. Branches are deleted automatically on merge.

## Issues first

- Features and bugs start as an issue using the templates. Small chores may skip the issue.
- Labels: one `area: *`, one `phase: *`, one `priority: *`, plus the kind (`bug`, `enhancement`, `documentation`, `chore`, `performance`).
- Milestones map to releases: `v0.9.0`, the first public release, then `v1.0.0`.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.
  - Types: `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `perf`, `test`, `build`, `revert`.
  - Scopes: `capture` (recording the last prompt), `suggest` (the suggested next messages), `ui` (the band, panes and notices), `settings`, `commands`, `tests`, `docs`, `ci`, `release`, `deps`.
- Subject in the imperative mood, lowercase first letter, no trailing period, at most 72 characters. The body explains why, not what.
- Breaking changes: `feat(settings)!: ...` plus a `BREAKING CHANGE:` footer.
- Author commits with your GitHub no-reply address (`<id>+<user>@users.noreply.github.com`) rather than a personal email; every pushed commit shows it.

## Pull requests

- Target `main` and fill in the template. Keep it a draft while work is in progress.
- The PR title must itself be a valid Conventional Commit; the `PR title` check enforces it and the squash merge uses it as the commit subject with the PR body as the message.
- Link the issue with `Closes #123`.
- Before requesting review: self-review the diff, run `claude plugin validate .` and `claude plugin test .` locally, add a `CHANGELOG.md` line under `[Unreleased]` (or apply `skip-changelog`), and update docs if behaviour changed.
- Squash merge only. Never merge with a failing check.

## Changelog

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Every user-visible change adds a line under `[Unreleased]` in one of Added, Changed, Deprecated, Removed, Fixed, Security.

## Releases

- [Semantic Versioning](https://semver.org/). `MAJOR` for breaking changes to a slash command, a stored setting or the state contract in `types/index.d.ts`, which other plugins can depend on; `MINOR` for features; `PATCH` for fixes.
- A release PR titled `chore(release): vX.Y.Z` bumps the version in `.claude-plugin/plugin.json`, turns `[Unreleased]` into a dated section and updates the comparison links.
- After it merges, tag `vX.Y.Z` on `main`. The release workflow checks that the tag matches `plugin.json` and publishes a GitHub Release with that changelog section. Installed copies pick the version up with `claude plugin update companion`.

## Code standards

- Claude Code floor 2.1.300, the oldest build the plugin is verified on. Anything that needs a newer build checks for what it uses and degrades gracefully where it is missing.
- Zero third-party dependencies. The hooks module reaches Claude Code only through the published plugin API: `$`, the elements `$.ui.resolve(e)` returns, and the type contract Claude Code writes into `.claude-plugin/types/`.
- Behaviour in `hooks/` ships with tests in `tests/`; no test makes a real model call.
- Formatting follows `.editorconfig`: two spaces, LF, UTF-8 without BOM.

## Clean-room policy

Contributors must not read, decompile or copy code from Claude Code's bundled source, its IDE extensions or other closed-source plugins, and must not reproduce their UI text, icons or documentation. Every feature is designed from the published plugin API, its documentation and this project's own design notes. Feature parity with other tools is fine; copied expression is not.

## Keeping private things out

This repository is public. Never commit keys, tokens or credentials, personal paths, names or email addresses, or text from real sessions: prompts, answers, transcripts, or screenshots that show private work. Test fixtures are written by hand. GitHub's secret scanning and push protection are on for this repository, but they only recognise known token formats, so read your diff before you push. If something private reaches GitHub, tell the maintainer privately rather than in a public issue.

## Working with AI assistants

The same rules apply. Assistants never push to `main`, never force-push, and open pull requests like any other contributor. The binding instructions for every assistant are in `AGENTS.md`; `CLAUDE.md` and `.github/copilot-instructions.md` defer to it.
