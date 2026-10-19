# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-10-19

### Added

- Companion v0.9.0, the plugin itself: the last prompt in a band above the prompt box; suggested next messages after each answer, three by default, sent or put in the prompt box with a click and offered dim in the terminal's prompt box; a settings pane (`/companion` or the ⚙) for suggestions on or off, the model, its effort, the number of choices and what a click does; `/last-prompt` and `/copy-next`. The band draws in the terminal, the VS Code extension and the desktop app, the mobile app gets a pane, and a host that draws no plugin UI shows the choices as a line beneath the answer.
- Install from this repository: a marketplace file, and the install steps in the README.
- CI: every pull request and push to `main` validates the plugin and runs its tests on a pinned Claude Code.
- Repository workflow: contribution guide, `AGENTS.md` rules for AI assistants, local git hooks, pull request and issue templates, Conventional Commit title check, Dependabot for GitHub Actions.

### Changed

- Suggestions are written by Sonnet 5.5 by default, in place of Fable 5.1, so a new install does not spend the most expensive model on every answer. Fable 5.1, Opus 5.5 and Haiku 5.5 stay one pick away in `/companion`, and a model already picked there is kept.

[Unreleased]: https://github.com/alvaris924/claude-companion/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/alvaris924/claude-companion/releases/tag/v0.9.0
