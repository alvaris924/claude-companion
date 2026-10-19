# Companion

A Claude Code plugin that keeps your last prompt in view and suggests what you might send next, as choices you click.

> **Status: pre-release.** The repository's workflow is in place. The plugin itself, v0.9.0, lands in the next pull request together with its install steps; follow the [milestones](https://github.com/alvaris924/claude-companion/milestones).

## What it does

- Shows your most recent prompt above the prompt box, so what you asked stays in view while the answer scrolls by
- After each answer, offers suggested next messages under it, three by default; click one to send it, or set a click to put it in the prompt box for editing first
- A settings panel, opened with `/companion` or the gear at the end of the band: suggestions on or off, the model and effort that write them, how many choices, and what a click does
- `/last-prompt` and `/copy-next` for working from the keyboard
- Built only on Claude Code's plugin API: no patches, no wrappers, no dependencies. Suggestions are one small model call per answer, made through Claude Code on your own account; the plugin makes no network requests of its own

## Requirements

Claude Code 2.1.300 or newer.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. AI assistants follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE.md).
