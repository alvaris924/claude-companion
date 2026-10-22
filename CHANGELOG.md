# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- In VS Code the band no longer repeats your last prompt, since VS Code pins it above its answer. A "Last prompt" setting in `/companion` brings it back; the terminal always shows it. The ⋯ for the settings moves to the end of the band's first row ([ADR-0016](docs/adr/0016-the-band-leaves-the-prompt-to-vs-code.md), #38).

### Fixed

- No suggestions appeared after any answer in 0.12.0. Its check for a message sent while an answer was still running compared timestamps, but the engine starts a prompt's turn before the plugin finishes recording that prompt, so every prompt looked like it came during its own answer. The check now notes, the moment a message is sent, whether an answer is still running (#38).

## [0.12.0] - 2026-10-22

### Added

- Suggest mode, now the default for "Fit model and effort to each task": your turn runs on your own model and effort, the grade is asked in the background with no wait, and when it names another model than the one running, the band offers one button while the answer is still being written: "Switch to Opus 5.5 at max effort" for a hard task, "Switch to Haiku 5.5 at low effort" for an easy one (`0` in the terminal). Pressing it stops the answer and asks the prompt again there, and the task's follow-ups stay. Once the answer is in, a cheaper pick reads "Continue on Haiku 5.5 at low effort" and sends the follow-ups there without asking again. It says nothing when the grade names what you already run on, and makes no grading call at all when no grade could name anything else, as when every grade is set to "My model and effort". "Automatic" is the earlier behaviour, unchanged ([ADR-0013](docs/adr/0013-suggest-mode-the-grade-suggests-the-person-switches.md), #29).
- Each model keeps its own mode: a pick in `/companion` is saved for the model the session runs on, which the setting then shows, and every turn runs under the mode kept for the session's model, so Automatic can be on for Opus while Sonnet keeps Suggest. A suggested switch to a model set to Automatic reads "Switch to Opus 5.5 with Automatic on", and pressing it moves the session there with `/model`, which in the terminal also makes it the default for new sessions. The store adds `fitByModel` ([ADR-0014](docs/adr/0014-each-model-keeps-its-own-mode.md), #29).
- In the terminal, a choice's number typed into the empty prompt box picks it, the way Claude Code's own surveys take their answers: the choices are numbered, a dim line under them says so, and "Ask again" is 0. A "Number keys" setting turns this off (#29).
- In the terminal, `/companion` opens a menu that takes the keys at once: a row per setting with its value, ↑↓ to move, Enter to flip a switch or list a setting's numbered options, Esc to close, and a line atop it on what the highlighted setting does (#29).
- **Experimental:** a short message is a reply, which continues the running task with no new grading, only when it leans on the last answer — an acknowledgement ("ok thanks"), a short continuation ("why?", "and the tests?", "go on"), or, outside an easy task, a short order ("push it") — not merely because it is short. A short message that stands on its own, such as "how are you", used to be absorbed into whatever task ran before it and never graded; it now starts a task and is graded like any other ([ADR-0015](docs/adr/0015-a-reply-must-lean-on-the-answer.md), #29).

### Changed

- The setting that fitted each task's model on or off is a three-way setting, `fit`: Suggest, Automatic and Off. A stored `route: true` reads as Automatic and `route: false` stays Off, so nobody's choice moves; a store with neither is Suggest, and `route` is still written for sessions on an earlier version (#29).

### Fixed

- The choices for an answer were written against a prompt the person had already sent while that answer ran, so they read as replies to the wrong message. Nothing is asked for an answer the person has already moved past (#29).
- The terminal's settings opened a third of the screen tall, hid most settings, and took no keys until ctrl+x tab; the choices looked like buttons that no key or click reached (#29).

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

[Unreleased]: https://github.com/alvaris924/claude-companion/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/alvaris924/claude-companion/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/alvaris924/claude-companion/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/alvaris924/claude-companion/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/alvaris924/claude-companion/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/alvaris924/claude-companion/releases/tag/v0.9.0
