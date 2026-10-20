# Companion documentation

Companion is a Claude Code plugin that keeps the person's last prompt in view and suggests their next message as choices they click. This page describes how it behaves and where things live; the decisions behind it are recorded under [adr/](adr/).

## Layout

| Path | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | The manifest: name, version, description, and the state contract it declares (`types`). |
| `.claude-plugin/marketplace.json` | Makes this repository a marketplace with one entry: the plugin at the root. |
| `hooks/hooks.json` | Names the hooks module. |
| `hooks/register.tsx` | The hooks module: every hook, drawing and command. |
| `types/index.d.ts` | The values the plugin keeps in session state; `claude plugin validate` holds the module to it. |
| `tests/companion.test.tsx` | The tests `claude plugin test` runs against Claude Code's test kit. |
| `tsconfig.json` | Extends the `tsconfig.json` Claude Code writes into `.claude-plugin/types/` when it loads the plugin. That folder is generated and never committed. |

## Decision records

- [ADR-0001: Draw in the band above the prompt](adr/0001-band-above-the-prompt.md)
- [ADR-0002: Claude Code 2.1.300 is the floor](adr/0002-claude-code-floor.md)
- [ADR-0003: One suggestion call per answer, off the turn, with a Haiku fallback](adr/0003-one-suggestion-call-per-answer.md)
- [ADR-0004: The suggestion prompt is tuned against recorded turns](adr/0004-tuned-suggestion-prompt.md)
- [ADR-0005: Machine-made prompts are filtered out by origin](adr/0005-machine-origins-filtered-out.md)
- [ADR-0006: Settings live in the plugin store](adr/0006-settings-in-the-plugin-store.md)
- [ADR-0007: Sonnet 5.5 is the default model](adr/0007-sonnet-default.md)
- [ADR-0008: GitHub flow with tags, no development branch](adr/0008-branching-model.md)
- [ADR-0009: Fit the model and effort to each task, by rules, under 100,000 tokens](adr/0009-model-and-effort-per-task.md)
- [ADR-0010: Skills and web searches among the choices, found by Claude's own tools](adr/0010-skills-and-searches-among-the-choices.md)

## The band

The band directly above the prompt box shows `Last:` and the last prompt, a dim ⚙ that opens the settings and, once an answer is in, `Next:` and the choices. When the last turn ran on something other than the session's own model and effort, a dim row under the last prompt says what, with a redo button for a light task. The terminal cuts the prompt and each choice to its measured width. VS Code, the desktop app and the mobile app lay text out in their own fonts, where the columns they report undercount the room, so there the texts are handed over whole and wrap, a choice wrapping inside its button. The band steps aside while Claude Code shows a survey in the same place.

## Suggested next messages

After each answer of the main conversation, the plugin asks one model for the messages the person might send next; a subagent's report, an interrupted turn and an empty answer ask nothing. The request carries the last prompt, cut to 1,500 characters, and the end of the answer, cut to 6,000, because the questions, offers and open items an answer ends with decide what comes next. It runs a tick after the turn ends, so the end of a turn never waits on the model, and its reply is dropped if the person has sent another prompt in the meantime. When the chosen model gives no answer (a refusal, an API error, the 45-second timeout), Haiku 5.5 is asked once instead.

The reply is cut into clean choices. List markers, quotes and "Next:" lead-ins are stripped; lines that talk about the exchange instead of being a message ("The reply asks…") and repeats are dropped; at most the chosen number of choices is kept, the likeliest first. In the terminal the likeliest is also offered dim in the prompt box, where Tab takes it, and Claude Code's own guess there is replaced by it, so the two agree.

Clicking a choice sends it as the person's message or, when the settings say so, puts it in the prompt box: over an empty box or an earlier choice, otherwise at the cursor, so what the person typed stays. Where no box takes it, the choice goes to the clipboard.

## Skills and web searches among the choices

With the setting on, the default, and more than one choice, the request for suggestions opens with the session's slash commands, skills included, as `$.command.list()` gives them: one line each with its description, skills and the person's own commands before the built-ins, at most 80 commands and 8,000 characters. The block is the same on every call and marked for the prompt cache, so after the first answer the cache serves it. The lines after the first may then be one of those commands with a short argument, "Find a skill for ..." when the work needs something none of them covers, or "Search the web for ..." when the answer guesses at something that changes over time. The first line keeps the rules of [ADR-0004](adr/0004-tuned-suggestion-prompt.md).

A command choice is kept only when the session lists the command. Commands that end the session, sign out or throw the conversation away (`/clear`, `/exit`, `/logout`, `/rewind`, `/resume` and a few more) are never offered, whatever the model writes. Clicking a command choice runs it as typing it would; set to put choices in the box, it goes there instead. Finding a skill and searching the web are Claude's work, done with its own tools on the person's account: the plugin makes no network requests. With the setting off, the request is the one without commands.

## The model and effort for each task

Off by default. Turned on in the settings, each prompt of the person's is graded by rules, with no model call:

| Grade | When | Its turns run on |
|---|---|---|
| Heavy | It asks to implement, refactor, migrate, redesign, rewrite, overhaul or scaffold, to start from scratch or to take on the whole codebase; or it runs past 250 words or names four paths or more | The session's model one effort level up, `max` at most; or, as a separate pick, one model up as well, on the ladder Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.1 |
| Light | A question, or a request to explain or list, of at most 25 words, with nothing broken in it, nothing pasted and at most one path | Haiku 5.5 at low effort, when the session runs on a Sonnet, Opus or Fable model; or, as a separate pick, as usual |
| Standard | Everything else | As usual |

The grade belongs to the task, not to each prompt. A reply continues the running task: a clicked choice, a typed one, or up to six words that ask for no new work. A follow-up of up to 40 words to heavy work stays heavy. Anything else starts a task of its own grade. Turns nobody typed, such as a background task's notification, continue the running task.

A task changes model or effort only while the conversation is under 100,000 tokens, decided at its first request and kept for the task. Caches belong to one model, so a switch makes the API read the conversation once without its cache. Below 100,000 tokens, Haiku 5.5's uncached read costs no more than a cached read on Sonnet 5.5, Opus 5.5 or Fable 5.1; above it, Haiku's price rises fivefold. A change of effort also makes the API read the conversation uncached, at the session model's price, which is why a light task switches model instead of lowering the effort ([ADR-0009](adr/0009-model-and-effort-per-task.md)).

Left as they are: standard tasks, subagents, slash commands and skills, prompts a program sends where nothing is drawn (`claude -p`, the Agent SDK), models the plugin cannot read, such as a provider's own spelling of an id, and a request the engine sends on another model in the middle of a turn, such as a fallback. A fitted request that fails before it answers, as when an organization blocks the model, goes again as the engine made it; fitting then stops for the rest of the session, and a notice says so.

When a turn ran on something other than the session's own model and effort, the band says what under the last prompt ("Light task: Haiku 5.5 at low effort") until the next prompt. For a light task, once the turn has ended, a button beside it asks the last prompt again on the session's own model and effort, and that task's follow-ups stay there. Where no surface attaches, the same words lead the line beneath the answer.

## Settings

`/companion`, or the ⚙ in the band, opens a pane of pickers in two groups, the suggested next messages and the model and effort for each task:

| Setting | Options | Default |
|---|---|---|
| Suggest next messages | On, off | On |
| Offer skills and web searches | On, off | On |
| Model | Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 | Sonnet 5.5 |
| Thinking effort | Low, medium, high | Low |
| Number of choices | 1 to 5 | 3 |
| Clicking a choice | Sends it as my message, puts it in the box to edit | Sends it |
| Fit model and effort to each task | On, off | Off |
| Light tasks | Haiku 5.5 at low effort, my model and effort | Haiku 5.5 at low effort |
| Heavy tasks | My model one effort level up, one model and one effort level up, my model and effort | My model, one effort level up |

The model and effort of the suggestions are their own: fitting the person's turns to their tasks leaves them alone. A pick is saved at once for every session, and other open sessions take it at their next turn. The mobile app draws no pickers, so its pane lists the settings as text; where no pane can be drawn at all, `/companion` answers with the settings on one line.

## Commands

| Command | What it does |
|---|---|
| `/companion` | Opens the settings pane. |
| `/last-prompt` | Opens the pane with the last prompt and the choices again; where nothing draws a pane, answers with both lines. |
| `/copy-next [1-5]` | Copies the first choice, or the numbered one, through the surface's clipboard; where no surface attaches, through the machine's clipboard on Windows. |

## Surfaces

| Where | What shows |
|---|---|
| Terminal | The band, cut to the terminal's width, and the likeliest choice dim in the prompt box |
| VS Code extension, 2.1.300 or newer | The band, its texts whole and wrapping; the prompt box shows no dim suggestion there |
| Desktop app | The band |
| Mobile app | A pane with the last prompt and the choices, opened at the first prompt; `/last-prompt` brings it back after it was closed |
| A host that draws no plugin UI, such as VS Code before 2.1.300 | The choices, and what a fitted turn ran on, as a line beneath the answer |
| Headless runs (`claude -p`, the Agent SDK) | Nothing, and no model call |

## Where things are stored

| Data | Location | Lives |
|---|---|---|
| The last prompt | Session state `companion.last` | The session |
| The current choices | Session state `companion.next` | Until the next prompt |
| Whether the person closed the mobile pane | Session state `companion.paneClosed` | The session |
| What the last turn ran on, when it was fitted to its task | Session state `companion.routed` | Until the next prompt |
| The settings | The plugin's store, key `settings`, mirrored in session state `companion.settings` | Across sessions |

Nothing is written anywhere else, and the plugin makes no network requests of its own: its one call out is the model request, made through Claude Code on the person's account.

## Working on the plugin

```
claude --plugin-dir .                        # a session with this checkout loaded as the plugin
claude plugin validate .                     # manifest, marketplace file and hooks module
claude plugin test .                         # the tests in tests/
npx -y -p typescript@5.6 tsc -p .            # type-check, once Claude Code has written .claude-plugin/types/
```

The contribution workflow is in [CONTRIBUTING.md](../CONTRIBUTING.md); rules for AI assistants are in [AGENTS.md](../AGENTS.md).

## Troubleshooting

- **No band in VS Code.** The extension draws plugin UI from 2.1.300; older builds show the choices as a line beneath the answer.
- **No suggestions at all.** Check that suggestions are on in `/companion`, and that the session is not a headless run. `claude --debug` logs a line for every hook that failed.
- **A light task needed more than Haiku.** Press the redo button beside the task in the band, which asks again on your own model and effort. If it happens often, set Light tasks to "My model and effort" in `/companion`, or turn fitting off.
- **A notice says a task could not be sent to a model.** That model is not available to the session, for instance because an organization blocks it. Fitting is off for the rest of that session; pick Light and Heavy tasks that avoid that model.
- **A tool Claude Code serves on `127.0.0.1` never appears**, such as the plugin-authoring skill's secret scan. Some antivirus web filters rewrite the responses of local HTTP servers. Seen with Norton's web protection on Windows: responses to requests that look like MCP traffic came back marked as chunked without being chunked, so every `tools/list` failed with `InvalidHTTPResponse` in the debug log. An exception for `127.0.0.1` in the antivirus's web protection fixed it.
