# Companion

A mod for Claude Code that adds small, useful features where you work, and is built to keep taking more. It keeps your last prompt in view, suggests next messages you can click, fits the model to each task, keeps notes and a queue of next steps for each project, and shows what your conversation costs. See it in motion at [claudecompanion.vercel.app](https://claudecompanion.vercel.app).

> **Status: v0.13.0.** What comes next is in the [milestones](https://github.com/alvaris924/claude-companion/milestones).

## Features so far

Companion is a home for helpers inside Claude Code, and these are the first ones. Each release adds more, listed in the [changelog](CHANGELOG.md).

- **Your last prompt stays in view.** In the terminal, a band directly above the prompt box shows what you last asked while the answer scrolls by. Blocks a host wraps around your words, such as a browser extension's instructions, are left out, and a pasted image shows as `[image]`. VS Code already pins your prompt above its answer, so there the band leaves it out unless you turn on "Last prompt" in `/companion`.
- **Suggested next messages.** After each answer, a model reads your last prompt and the end of the answer and offers the messages you are likeliest to send next: three by default, one to five if you prefer. Click one to send it as your own message, or set a pick to put it in the prompt box to edit first. In the terminal the choices are numbered, one a line: type a choice's number into the empty prompt box to pick it, or Tab to take the likeliest, which appears dim there.
- **Easy, mid and hard tasks, each on the model that fits.** Sonnet 5.5 (or the model you pick as grader) grades each new task from your request, the one before it and the end of the last answer. By default it only suggests: your turn runs on your own model, and when another one would fit, a button appears while the answer is still being written, up to Opus for a hard task or down to Haiku for an easy question. Press it (`0` in the terminal) and the answer stops and is asked again there; once the answer is in, a cheaper pick reads "Continue on Haiku 5.5" and sends the task's follow-ups there without asking again. Set it to Automatic and an easy task runs on Haiku 5.5 at low effort, a mid one on Sonnet 5.5 at medium and a hard one on Opus 5.5 at max, and you can change each; set it to Off and nothing is graded. Each model keeps its own mode, so Automatic can be on while you are on Opus and Suggest while you are on Sonnet. A suggested switch to a model you set to Automatic says "with Automatic on", and pressing it moves the session there as `/model` does, which in the terminal also makes it the default for new sessions. A reply that leans on the answer — a clicked choice, a short continuation such as "why?" or "and the tests?", or a short order such as "push it" — stays with its task without a new grading; a short message that stands on its own, a greeting among them, is graded like anything else **(experimental: the rule for this is new, see below)**. The band shows each task's grade and what it ran on, with a link to ask again on your own model and effort; in the terminal the line that ends each answer says it, and the band keeps the button. In a long conversation each switch makes the new model re-read it uncached, so under Automatic a limit of 100,000, 200,000 or 400,000 tokens lets only hard tasks switch past it. The grader can differ between runs, so "Grading" can ask twice and keep the harder grade, for twice the grading cost.
- **Notes for each project.** `/note <text>` keeps a message for later. `/note` on its own keeps what you selected or copied from an answer, or lists the last answer's lines so you keep the ones you want; `/save-next` keeps a suggested message. `/notes` opens them: a note's number puts it in the prompt box, and the note stays until you remove it. `/notes export` writes them to `NOTES.md` in the project. Up to 50 a project, kept across sessions.
- **A queue of next steps.** When an answer lists several things to do, queue them: `/queue` on its own queues what you selected or copied from an answer, and `/queue <text>` queues the text. The next one waits as the grey text in the prompt box, where Tab takes it, and leaves the queue when you send it. Nothing is sent on its own. Up to 20 a project.
- **Three keys under the prompt box**, in the terminal: 7 copies the last answer as written, 8 opens your queue to reorder it or take one off, 9 opens your notes. The footer counts what waits. `/companion-setup` binds Alt+Q and Alt+N to `/queue` and `/note` and turns on fullscreen, where clicks work and an "Add note" sits under each answer; it changes nothing until you apply it.
- **Meters**, in the terminal: a line under the prompt box shows how full the context is and, on a subscription, how much of your week is used. Each answer's end line adds what the turn cost and how much of it came from the prompt cache. Past 60% full a line says what each message sends again, and after an idle hour it warns that the cache has likely expired, so the next message reads everything again at full price. "Auto-compact" can compact at 70%, 80% or 90% full; it is off unless you pick one.
- **`/fresh` and `/ctx`.** `/fresh` starts over without losing the thread: a model writes a short handoff of the task, the conversation is cleared, and the handoff waits in the prompt box with the files the conversation changed. `/ctx` opens the context X-ray: what fills the window, the biggest tool outputs, MCP servers and memory files, and what to cut first.
- **A done alert.** Once an answer that ran a minute or longer ends, a notification says so, through the channel Claude Code's own notifications use; on Windows with none, a sound plays. 30 seconds, 5 minutes or off in the settings.
- **Settings**, opened with `/companion` or the ⋯ at the end of the band: suggestions on or off, the model that writes them (Sonnet 5.5 by default, or Fable 5.1, Opus 5.5 or Haiku 5.5), its effort, how many choices, what a click does, whether the model and effort are fitted to each task (kept for each model), what each grade runs on, whether the band in VS Code shows your last prompt, the copy, queue and notes keys, the meters, the cold cache warning, auto-compact and the done alert. In the terminal `/companion` opens a menu: ↑↓ to move, Enter to change, Esc to close. Settings are kept across sessions, and other open sessions take a change at their next turn.
- **Commands.** `/companion` and `/companion-setup`; `/last-prompt` opens the pane with your last prompt and the choices again; `/copy-next [1-5]` copies a choice to the clipboard; `/note`, `/notes` and `/save-next` for the notes; `/queue` for the queue; `/fresh` and `/ctx`. The full list is in the [docs](docs/index.md#commands).
- **Tried in the terminal and the VS Code extension.** The band draws in both. The keys, the lines under the prompt box, the meters and the setup are the terminal's alone: notes, the queue, the keys, the quieter band and the meters were run on the real terminal, while `/fresh`, `/ctx`, the done alert and the setup's switch to fullscreen are checked against Claude Code's test kit only. The code also has drawings for the desktop app, a pane for the mobile app, and a line beneath the answer for hosts that draw no plugin UI, but those have only run against the test kit, not on the real surfaces, so nothing here promises them yet.

### Experimental

- **A reply must lean on the answer.** Deciding whether a short message is a reply (no new grading) used to be a plain word count: anything up to three words was one, whatever it said. That read unrelated short messages, "how are you" among them, as replies and never graded them, so Suggest had nothing to offer for them. Now a short message is a reply only when it is an acknowledgement, a short continuation ("why?", "and the tests?", "go on"), or, outside an easy task, a short order ("push it"); a short message that stands on its own is graded afresh ([ADR-0015](docs/adr/0015-a-reply-must-lean-on-the-answer.md)). The pattern list is new and may miss a real continuation worded unusually, costing a grading call it need not have; tell us the phrasing if you see it.

## Requirements

Claude Code 2.1.300 or newer.

## Install

Paste this into Claude Code, in the terminal, VS Code or the desktop app:

```
Clone https://github.com/alvaris924/claude-companion into my home folder, check the code for anything unsafe, then install the companion plugin from it.
```

Claude reads the code and tells you what it found, then installs the plugin from the clone:

```
claude plugin install companion --marketplace ~/claude-companion
```

Start a new session to load it. Keep the clone, since the plugin is read from it: `git pull` there updates it. Where `claude` is not on the PATH, as when only the VS Code extension is installed, the extension's own binary does the same: `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude`.

To install from GitHub yourself instead, run `/plugin install companion --marketplace alvaris924/claude-companion` in a Claude Code terminal session (answer `y`, then choose the user scope), or `claude plugin install companion --marketplace alvaris924/claude-companion` from a shell. Update that install with `claude plugin update companion`.

## Cost and privacy

- Each suggestion is one model call made through Claude Code on your own account, so it counts toward your plan's usage or your API bill like any other request. When the chosen model gives no answer, Haiku 5.5 is asked once instead.
- Sonnet 5.5 is the default. Fable 5.1 writes the best suggestions and costs the most, about 100 times Haiku's price per token, and Haiku 5.5 is the cheapest and fastest. Pick one in `/companion`, or turn suggestions off and keep the last-prompt band.
- The model sees your last prompt, up to 1,500 characters, and the end of the answer, up to 6,000 characters. Nothing else from your session goes into that call, and the plugin makes no network requests of its own.
- Fitting the model and effort to each task (Suggest, the default, or Automatic) asks Sonnet 5.5 for one short grade per new task, in the background under Suggest and a second or two before its answer starts under Automatic, with your request (up to 1,500 characters), the one before it (up to 500) and the end of the last answer (up to 1,500); a reply that leans on the answer is not graded, and a short message that stands on its own is, experimentally, since 0.12.0. Haiku 5.5 costs a twentieth of Sonnet 5.5's price per token, and Opus 5.5 twice Sonnet's. Each switch of model or effort makes the API read the conversation once without its cache, at the new model's price, so in a long conversation a switch can cost more than the turn it saves. Suggest asks nothing when no grade could name anything but your own model and effort, as when every grade is set to "My model and effort".
- `/fresh` is one model call, on the model that writes your suggestions at low effort, with the end of the conversation, up to 12,000 characters. The meters, `/ctx` and the done alert make no model call: they read what Claude Code already measured.
- The clipboard is read only when you ask to keep or queue what you copied, and the text is kept only when one of the session's last answers holds those words. Anything else on it is neither stored nor shown.
- Your settings, notes and queue are kept in Claude Code's plugin store, the notes and the queue under their project's folder; your last prompt and the choices live only in the session's state. Outside the store the plugin writes two files, each only when you ask: `NOTES.md` in the project for `/notes export`, and your keybindings file when you apply `/companion-setup` with the keys ticked.
- The plugin acts on your conversation only at your word: `/fresh` clears it once the handoff is written, and "Auto-compact" compacts it only if you picked a fill.
- Headless runs (`claude -p`, the Agent SDK), where nobody reads the choices, make no suggestion call.

## How it works

The plugin is a hooks module, [`hooks/register.tsx`](hooks/register.tsx), on Claude Code's plugin API. A `prompt.submit` hook records your prompt and the task it starts or continues, a `turn.start` hook gives each turn its task, a `turn.step` hook has a new task graded at its first request and sends a fitted turn's requests with its grade's model and effort, a `turn.complete` hook asks for the suggestions on a timer so the end of a turn never waits on the model, and `ui.render` hooks draw the band, the panes and the settings with the elements each surface provides; in the terminal they also add the lines under the prompt box, the footer's counts, each turn's end line and the "Add note" under an answer. A `session.measure` hook reads the context's fill and the week's usage for the meters. Values shared between hooks live in session state under the contract in [`types/index.d.ts`](types/index.d.ts), and the settings, the notes and the queue live in the plugin's store. Every hook that could hold up your prompt carries a `.catch`, so a failure in the plugin never does. The tests in [`tests/`](tests/) run against Claude Code's test kit with the model, the clock and the store mocked.

## Roadmap

| Version | Scope |
|---|---|
| v0.9.0 | First public release: the plugin as it runs today, install from this repository, CI that validates and tests it |
| v0.10.0 | A quieter look, easy, mid and hard tasks graded by a model, a limit on switching in long conversations, a website |
| v0.11.0 | A grader you choose, and grading twice to keep the harder grade |
| v0.12.0 | A terminal that works from the keys; Suggest (now the default) offers a switch either way and keeps a mode per model; a reply must lean on the answer, not merely be short (experimental) |
| v0.13.0 | Suggestions back after v0.12.0 showed none; the band in VS Code leaves your prompt to VS Code, with a "Last prompt" setting to bring it back |
| v1.0.0 | Commands, settings and the state contract held stable, checked on every surface, screenshots in this README |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. AI assistants follow [AGENTS.md](AGENTS.md). Design notes and decision records live in [docs/](docs/index.md).

## License

[MIT](LICENSE.md).
