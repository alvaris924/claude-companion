# Companion

A Claude Code plugin that keeps your last prompt in view and suggests what you might send next, as choices you click.

> **Status: v0.9.0, the first public release.** What comes next is in the [milestones](https://github.com/alvaris924/claude-companion/milestones).

## What it does

- **Your last prompt stays in view.** A band directly above the prompt box shows what you last asked while the answer scrolls by. Blocks a host wraps around your words, such as a browser extension's instructions, are left out, and a pasted image shows as `[image]`.
- **Suggested next messages.** After each answer, a model reads your last prompt and the end of the answer and offers the messages you are likeliest to send next: three by default, one to five if you prefer. Click one to send it as your own message, or set a click to put it in the prompt box to edit first. In the terminal the likeliest also appears dim in the prompt box, and Tab takes it.
- **Settings**, opened with `/companion` or the ⚙ at the end of the band: suggestions on or off, the model that writes them (Sonnet 5.5 by default, or Fable 5.1, Opus 5.5 or Haiku 5.5), its effort, how many choices, and what a click does. They are kept across sessions, and other open sessions take a change at their next answer.
- **Commands.** `/last-prompt` opens the pane with your last prompt and the choices again; `/copy-next [1-5]` copies a choice to the clipboard.
- **Wherever Claude Code shows plugin UI.** The band draws in the terminal, the VS Code extension and the desktop app, and the mobile app gets a pane instead. Where a host draws no plugin UI at all, the choices appear as a line beneath the answer.

## Requirements

Claude Code 2.1.300 or newer.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install companion --marketplace alvaris924/claude-companion
```

Answer `y` to add the marketplace, then choose a scope: the user scope loads it in every session. It is active at once, with no restart.

From a shell:

```
claude plugin install companion --marketplace alvaris924/claude-companion
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `alvaris924/claude-companion`, then Add plugin.

Update with `claude plugin update companion`.

## Cost and privacy

- Each suggestion is one model call made through Claude Code on your own account, so it counts toward your plan's usage or your API bill like any other request. When the chosen model gives no answer, Haiku 5.5 is asked once instead.
- Sonnet 5.5 is the default. Fable 5.1 writes the best suggestions and costs the most, about 100 times Haiku's price per token, and Haiku 5.5 is the cheapest and fastest. Pick one in `/companion`, or turn suggestions off and keep the last-prompt band.
- The model sees your last prompt, up to 1,500 characters, and the end of the answer, up to 6,000 characters. Nothing else from your session is sent, and the plugin makes no network requests of its own.
- Your settings are kept in Claude Code's plugin store; your last prompt and the choices live only in the session's state.
- Headless runs (`claude -p`, the Agent SDK), where nobody reads the choices, make no suggestion call.

## How it works

The plugin is a hooks module, [`hooks/register.tsx`](hooks/register.tsx), on Claude Code's plugin API. A `prompt.submit` hook records your prompt, a `turn.complete` hook asks for the suggestions on a timer so the end of a turn never waits on the model, and `ui.render` hooks draw the band, the pane and the settings pane with the elements each surface provides. Values shared between hooks live in session state under the contract in [`types/index.d.ts`](types/index.d.ts), and the settings live in the plugin's store. Every hook that could hold up your prompt carries a `.catch`, so a failure in the plugin never does. The tests in [`tests/`](tests/) run against Claude Code's test kit with the model, the clock and the store mocked.

## Roadmap

| Version | Scope |
|---|---|
| v0.9.0 | First public release: the plugin as it runs today, install from this repository, CI that validates and tests it |
| v1.0.0 | Commands, settings and the state contract held stable, checked on every surface, screenshots in this README |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. AI assistants follow [AGENTS.md](AGENTS.md). Design notes and decision records live in [docs/](docs/index.md).

## License

[MIT](LICENSE.md).
