# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.0] - 2026-10-21

### Added

- A "Grader" setting for the model that grades new tasks, Sonnet 5.5 by default, at low effort (#26).
- A "Grading" setting: one call by default, or two calls at once keeping the harder grade, which removes most of the grader's run-to-run noise (about one prompt in eight changed grade between identical runs). A hard grade ends the wait, and once one call has answered the other has 2.5 seconds, so a call that hangs does not hold the task up (#26).

## [0.10.1] - 2026-10-21

### Changed

- The grader leans hard and treats action requests as mid: easy is only a question, a lookup, a status check or a short explanation with nothing to change or run, anything that edits, runs, commits, merges or deploys is at least mid, and a request that could need hard-level reasoning is graded hard. Checked on 120 prompts typed in real sessions, easy grades that took 10 or more tool calls fell from 4 to 1 or 0 (#21).

## [0.10.0] - 2026-10-21

### Changed

- The settings keys `light` and `heavy` give way to `easy`, `mid` and `hard`, each naming a model and effort. Fitting is off by default, so nothing a person has chosen is lost, and a stored value outside the new options takes its default (#16).
- A quieter look, after Apple's developer pages: the last prompt as a quote with a ⋯ for the settings, and the choices as quiet buttons with a ↳, the surface's secondary button rather than its filled one, under a small "Suggested" label (the terminal keeps its row of buttons). A type scale and theme colours, so a dark theme and a light one each draw it their own way, and the settings in rounded cards with a note under each group.

### Added

- A limit on switching in long conversations: "Easy and mid tasks switch up to" 100,000, 200,000 or 400,000 tokens, default no limit. Past it only hard tasks switch, easy and mid ones keep the session's own model and effort, and the band says "kept: long conversation" (#18).
- Easy, mid and hard tasks, each on its own model and effort, off by default. Turned on in `/companion`, Sonnet 5.5 grades each new task from the request, the one before it and the end of the last answer; an easy task runs on Haiku 5.5 at low effort, a mid one on Sonnet 5.5 at medium and a hard one on Opus 5.5 at max, each grade's pick changeable, at any length of conversation. Short replies and clicked choices keep their task's grade with no new grading, an order after an easy question is graded as work of its own, and rules grade a task when the model gives no grade. The band shows every fitted turn's grade and what it ran on, with a link to ask again on the session's own model and effort (#9, #16).

## [0.9.0] - 2026-10-19

### Added

- Companion v0.9.0, the plugin itself: the last prompt in a band above the prompt box; suggested next messages after each answer, three by default, sent or put in the prompt box with a click and offered dim in the terminal's prompt box; a settings pane (`/companion` or the ⚙) for suggestions on or off, the model, its effort, the number of choices and what a click does; `/last-prompt` and `/copy-next`. The band draws in the terminal, the VS Code extension and the desktop app, the mobile app gets a pane, and a host that draws no plugin UI shows the choices as a line beneath the answer.
- Install from this repository: a marketplace file, and the install steps in the README.
- CI: every pull request and push to `main` validates the plugin and runs its tests on a pinned Claude Code.
- Repository workflow: contribution guide, `AGENTS.md` rules for AI assistants, local git hooks, pull request and issue templates, Conventional Commit title check, Dependabot for GitHub Actions.

### Changed

- Suggestions are written by Sonnet 5.5 by default, in place of Fable 5.1, so a new install does not spend the most expensive model on every answer. Fable 5.1, Opus 5.5 and Haiku 5.5 stay one pick away in `/companion`, and a model already picked there is kept.

[Unreleased]: https://github.com/alvaris924/claude-companion/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/alvaris924/claude-companion/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/alvaris924/claude-companion/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/alvaris924/claude-companion/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/alvaris924/claude-companion/releases/tag/v0.9.0
