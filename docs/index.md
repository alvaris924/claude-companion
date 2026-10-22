# Companion documentation

Companion is a mod for Claude Code that adds small, useful features where the person works, and is built to take more. Its first features keep their last prompt in view, suggest their next message as choices they click, and fit the model and effort to each task. This page describes how it behaves and where things live; the decisions behind it are recorded under [adr/](adr/).

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
- [ADR-0009: Fit the model and effort to each task, by rules, under 100,000 tokens](adr/0009-model-and-effort-per-task.md) (superseded by ADR-0011)
- [ADR-0010: A quiet look: theme keys, the type scale, and quiet buttons for the choices](adr/0010-a-quiet-look.md)
- [ADR-0011: Easy, mid and hard tasks, graded by a model, at any length](adr/0011-easy-mid-hard-graded-by-a-model.md)
- [ADR-0012: The terminal works from the keys: numbered choices and a settings menu](adr/0012-the-terminal-works-from-the-keys.md)
- [ADR-0013: Suggest mode: the grade suggests, the person switches](adr/0013-suggest-mode-the-grade-suggests-the-person-switches.md)
- [ADR-0014: Each model keeps its own mode, and a switch to an Automatic one moves the session](adr/0014-each-model-keeps-its-own-mode.md)
- [ADR-0015: A reply must lean on the answer, not merely be short (experimental)](adr/0015-a-reply-must-lean-on-the-answer.md)

## The band

The band directly above the prompt box shows the last prompt as a quote, a dim ⋯ at its end that opens the settings and, once an answer is in, a small "Suggested" label over the choices. While task fitting is on, a quiet line under the last prompt says the task's grade and what the turn ran on, with a link that asks again as usual when that was something other than the session's own model and effort. VS Code, the desktop app and the mobile app draw each choice as a quiet button, a ↳ before the choice: the surface's secondary button, dark in VS Code like the ⋯, rather than its filled one. They lay text out in their own fonts, where the columns they report undercount the room, so there the texts are handed over whole and wrap, a choice wrapping inside its button. The terminal reports no pointer outside fullscreen, so there the choices are numbered as Claude Code numbers a survey's answers (`1: …   2: …`), and a number typed into the empty prompt box picks one; a dim line under them says so ("type 1–3 to send · /companion for settings"), and the redo is 0. The terminal cuts the prompt and each choice to its measured width. With "Number keys" off, a number is typed as usual and the choices are buttons the band's focus reaches: ctrl+x tab, then the arrows and Enter ([ADR-0012](adr/0012-the-terminal-works-from-the-keys.md)). The band steps aside while Claude Code shows a survey in the same place.

## The look

Quiet, after Apple's developer pages and calm note apps: hierarchy from the type scale rather than from boxes and labels, secondary text dimmed, and as little chrome as the surface allows. VS Code and the desktop app draw every button in their own button chrome, so outside the terminal the choices ask for the secondary button rather than the filled one, and the last prompt and the redo are markdown the plugin writes: a quote, and a link whose press the plugin answers itself. The link points at the part of this page it stands for, so a modified click that opens it lands somewhere useful, and everything the person or a model wrote is escaped, so nothing in it formats or links. Every colour is a theme key (`suggestion` for the accent, `promptBorder` for the terminal's quote bar and the settings cards), so each theme, dark or light, draws it in its own colours; no colour is written as a hex value. Small labels are `caption` in semibold and notes are `footnote`; the terminal has one size and draws semibold as bold. Outside the terminal the settings group their pickers in rounded cards, each with a heading over it and a short note under it ([ADR-0010](adr/0010-a-quiet-look.md)).

## Suggested next messages

After each answer of the main conversation, the plugin asks one model for the messages the person might send next; a subagent's report, an interrupted turn and an empty answer ask nothing. The request carries the last prompt, cut to 1,500 characters, and the end of the answer, cut to 6,000, because the questions, offers and open items an answer ends with decide what comes next. It runs a tick after the turn ends, so the end of a turn never waits on the model, and its reply is dropped if the person has sent another prompt in the meantime; a prompt sent while the answer was still running is the next message already, so nothing is asked for that answer. When the chosen model gives no answer (a refusal, an API error, the 45-second timeout), Haiku 5.5 is asked once instead.

The reply is cut into clean choices. List markers, quotes and "Next:" lead-ins are stripped; lines that talk about the exchange instead of being a message ("The reply asks…") and repeats are dropped; at most the chosen number of choices is kept, the likeliest first. In the terminal the likeliest is also offered dim in the prompt box, where Tab takes it, and Claude Code's own guess there is replaced by it, so the two agree.

Picking a choice, with a click or in the terminal its number, sends it as the person's message or, when the settings say so, puts it in the prompt box: over an empty box or an earlier choice, otherwise at the cursor, so what the person typed stays. Where no box takes it, the choice goes to the clipboard.

## The model and effort for each task

Each new task of the person's is graded easy, mid or hard by a model, and what the grade does is a setting with three modes:

| Mode | What it does |
|---|---|
| Suggest (the default) | Changes nothing. The turn runs on the session's own model and effort, with no wait for the grade, which is asked in the background. When the grade names another model than the one running, up for a hard task or down for an easy one, the band offers one button to switch to it. |
| Automatic | The task's requests go with what the grade's picker names, so the person never has to press anything. |
| Off | Nothing is graded. |

Each family of models keeps its own mode. A pick in the settings is saved for the family the session runs on (Haiku, Sonnet, Opus or Fable), and every turn runs under the mode kept for the session's model, read as the turn starts, so Automatic can be on for Opus while Sonnet keeps Suggest. A family nobody picked a mode for keeps the mode for every model: Suggest on a new install ([ADR-0014](adr/0014-each-model-keeps-its-own-mode.md)).

The grade picks one of three routes, set in the settings, which Automatic runs the task on and Suggest offers:

| Grade | What the grader counts as one | Runs on by default |
|---|---|---|
| Easy | Only a question, a lookup, a status check or a short explanation, with nothing to change or run | Haiku 5.5 at low effort |
| Mid | Everyday work, and any request to change or run something: editing files, tweaking a value, running commands, committing, merging, deploying, checking the state of a repository or machine, a bug with a clear cause, a small feature, a change across a few files, tests for existing code, a doc page, a focused review | Sonnet 5.5 at medium effort |
| Hard | Work that needs planning or deep reasoning: a feature across many files, a refactor or a migration, a bug with an unclear cause, performance, concurrency or security work, an architecture or design decision | Opus 5.5 at max effort |

The grader is Sonnet 5.5 at low effort by default, and a "Grader" picker changes the model (a stronger one grades borderline tasks better and costs more per call; Haiku is cheapest and least reliable between two grades), asked once per task at the task's first request (twice, with the harder grade kept, when "Grading" is set to two calls), so a new task's answer starts a second or two later. It reads the new request, cut to 1,500 characters, the request before it, cut to 500, and the end of the last answer, cut to 1,500, so a "yes, do it" is graded as the work it takes up. It leans hard: a wrong easy or mid grade gets a weaker model and a worse result, while a wrong hard grade only costs more, so when a request could reasonably need hard-level reasoning, or it is unsure between mid and hard, it answers hard, and between easy and mid it answers mid. When it gives no grade within eight seconds, or no answer at all, rules grade the task: hard when it asks to implement, refactor, migrate, redesign, rewrite, overhaul or scaffold, to start from scratch or to take on the whole codebase, or runs past 250 words or names four paths or more; easy when it is a question, or a request to explain or list, of at most 25 words, with nothing broken in it, nothing pasted, at most one path and no change proposed ("how about ...", "what if ...", "should we ..."); mid otherwise.

The grader is not steady: asked twice with the same instructions it differs on about one prompt in eight, mostly hard against mid. Two calls start together and the harder grade wins, which removes most of that noise for twice the grading cost and the same wait: a hard grade ends the wait, and once one call has answered the other has 2.5 seconds more, so a call that hangs never holds a task up for the whole eight-second timeout. One call that gives no grade leaves the other's; neither leaves the rules.

Under Suggest the grade is asked off the turn, at the first request of a new task, with the grader and grading settings Automatic uses. When it names another model than the one running, or the same model at another effort the session's request named, the band says what the turn runs on and offers one button, "Switch to Opus 5.5 at max effort" for a hard task or "Switch to Haiku 5.5 at low effort" for an easy one (`0` in the terminal, a link elsewhere), while the answer is still being written. Pressing it cancels the running turn and asks the prompt again on the pick, a new task there whose follow-ups stay. Once the answer is in, a stronger pick still asks again, since a better answer is the point, while a cheaper one would only repeat it: the button then reads "Continue on Haiku 5.5 at low effort", and pressing it sends the task's follow-ups there, with "Easy task · follow-ups on Haiku 5.5 at low effort" in the band and nothing asked again. The limit on switching does not apply to a press, and afterwards the band shows what the task runs on with the way back, as under Automatic ([ADR-0013](adr/0013-suggest-mode-the-grade-suggests-the-person-switches.md)). When the pick is of another family whose mode is Automatic, the button says so, "Switch to Opus 5.5 with Automatic on" or "Continue on Haiku 5.5 with Automatic on", and pressing it runs `/model` with that model first: the session moves there, and Automatic fits the tasks after. In the terminal Claude Code then also keeps that model as the default for new sessions, as `/model` does there; through VS Code it is for that session only. Where `/model` cannot run, the press switches the task alone. When the pick is what already runs, it says nothing. No call is made at all when no grade could name anything but the session's own model and effort, as when every grade's picker says "My model and effort"; where no surface could show the button; or for a prompt with an image, which asking again would lose, since only its words are sent again. A grade that arrives after the person has sent another prompt is dropped.

The grade belongs to the task, not to each prompt, and a reply is not graded: a clicked choice, a typed one, or up to three words that lean on the last answer rather than stand on their own — an acknowledgement ("ok thanks"), a short continuation ("why?", "and the tests?", "go on"), or, outside an easy task, a short order ("push the change"). Being short is not, by itself, enough: a short message that stands on its own, a greeting or a fresh short question among them, starts a task and is graded like any other **(experimental since 0.12.0: narrower than the plain word count it replaces, which read any short message, "how are you" among them, as a reply and never graded it — see [ADR-0015](adr/0015-a-reply-must-lean-on-the-answer.md))**. After an easy question an order is still work of its own, so it never stays on the easy model: a bare yes, or a reply, typed or clicked, that leads with a verb such as add, fix, run, push or merge, or with "do it" or "go ahead", past any "ok", "yes" or "please". Anything else starts a task, which is graded, a follow-up to hard work included: the grader reads the request before it and the end of the answer, so a follow-up that is hard work stays hard. Turns nobody typed, such as a background task's notification, continue the running task.

Under Automatic a task switches at any length of conversation unless a limit is set. Caches belong to one model, and a change of effort makes the API read the conversation uncached too, so each switch reads the conversation once without its cache, at the new model's price; in a long conversation that read can cost more than the turn it saves. "Easy and mid tasks switch up to" caps that: past 100,000, 200,000 or 400,000 tokens only hard tasks switch, since they are the ones worth the read, and easy and mid tasks run on the session's own model and effort with "kept: long conversation" in the band ([ADR-0011](adr/0011-easy-mid-hard-graded-by-a-model.md)). The default is no limit. A session on a model with a 1M context window ("[1m]") switches to the same window of the other model.

Left as they are: subagents, slash commands and skills, prompts a program sends where nothing is drawn (`claude -p`, the Agent SDK), models the plugin cannot read, such as a provider's own spelling of an id (no grading is asked there), and a request the engine sends on another model in the middle of a turn, such as a fallback. A fitted request that fails before it answers, as when an organization blocks the model, goes again as the engine made it; fitting then stops for the rest of the session, and a notice says so.

Under Automatic every fitted turn shows its grade and what it runs on under the last prompt ("Mid task · Sonnet 5.5 at medium effort") until the next prompt. When that is something other than the session's own model and effort, once the turn has ended, a link beside it ("Ask again on Opus 5.5") asks the last prompt again on the session's own model and effort, and that task's follow-ups stay there. Where no surface attaches, the same words lead the line beneath the answer.

## Settings

`/companion`, or the ⋯ in the band, opens the settings in two groups, the suggested next messages and the model and effort for each task. VS Code and the desktop app draw a pane of pickers, each group a rounded card with a short note under it. The terminal draws a menu that takes the keys as it opens: a row per setting with its value, ↑↓ to move, Enter to flip a switch or to list a setting's options, numbered so that Enter or the number picks one, and Esc to close. A line atop the menu says what the row under the ring does. It asks the terminal for the rows it needs; where the terminal is shorter, ↑↓ still move a row at a time and the window follows. Its rows carry shorter names: "Picking a choice", "Fit to each task", "Switch limit". Every surface shows the mode kept for the model the session runs on, under the setting's own name, and a pick changes that model's; a note under the setting says each model keeps its own.

| Setting | Options | Default |
|---|---|---|
| Suggest next messages | On, off | On |
| Model | Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 | Sonnet 5.5 |
| Thinking effort | Low, medium, high | Low |
| Number of choices | 1 to 5 | 3 |
| Clicking a choice | Sends it as my message, puts it in the box to edit | Sends it |
| Number keys (the terminal) | On, off | On |
| Fit model and effort to each task, kept for each family of models | Suggest, Automatic, Off | Suggest |
| Easy tasks | Haiku 5.5 at low or medium effort; Sonnet 5.5 at low, medium or high; Opus 5.5 at medium, high or max; Fable 5.1 at high or max; my model and effort | Haiku 5.5 at low effort |
| Mid tasks | The same | Sonnet 5.5 at medium effort |
| Hard tasks | The same | Opus 5.5 at max effort |
| Automatic: easy and mid tasks switch up to | No limit, 100,000, 200,000 or 400,000 tokens | No limit |
| Grader | Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, at low effort | Sonnet 5.5 |
| Grading | One call, two calls and keep the harder grade | One call |

The model and effort of the suggestions and of the grading are their own: fitting the person's turns to their tasks leaves them alone. While a grade's picker says "My model and effort", a line under the pickers says what that is in the session ("“My model and effort” is Opus 5.5 at max effort in this session."); the mobile pane and the line `/companion` answers with where no pane draws say it too. The session's own model and effort are those its last turn's first request named. A pick is saved at once for every session, and other open sessions take it at their next turn. The store keeps the mode picked on each family as `fitByModel`, the mode for every other family as `fit`, and `route`, the earlier on/off switch, as true when `fit` is Automatic, for sessions still on an earlier version; a store from before holding only `route` reads true as Automatic and false as Off, and one holding neither is Suggest. The mobile app draws no pickers, so its pane lists the settings as text; where no pane can be drawn at all, `/companion` answers with the settings on one line.

## Commands

| Command | What it does |
|---|---|
| `/companion` | Opens the settings: a pane of pickers, or in the terminal a menu of the arrow keys and Enter. |
| `/last-prompt` | Opens the pane with the last prompt and the choices again; where nothing draws a pane, answers with both lines. |
| `/copy-next [1-5]` | Copies the first choice, or the numbered one, through the surface's clipboard; where no surface attaches, through the machine's clipboard on Windows. |

## Surfaces

| Where | What shows |
|---|---|
| Terminal | The band, cut to the terminal's width, its choices numbered for the number keys, the likeliest choice dim in the prompt box, and the settings as a menu |
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
| What the last turn ran on when it was fitted to its task, or the switch a suggestion offers | Session state `companion.routed` | Until the next prompt |
| The session's own model and effort, as its last turn's first request named them | Session state `companion.own` | The session |
| The session's model as `/model` shows it, read as each turn starts and as the settings open | Session state `companion.sessionModel` | The session |
| The terminal's settings menu: the list or the setting open, and the row the ring is on | Session state `companion.menu`, `companion.menuFocus` | Until `/companion` opens it again |
| The settings | The plugin's store, key `settings`, mirrored in session state `companion.settings` | Across sessions |

Nothing is written anywhere else, and the plugin makes no network requests of its own: its calls out are model requests, the suggestions and, while task fitting is on, the grading, made through Claude Code on the person's account. It cancels a running turn only when the person presses a suggestion's switch, and runs `/model` only when that switch is to a model whose mode is Automatic.

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
- **The terminal ignores clicks on the choices and the settings.** Outside fullscreen the terminal reports no pointer to Claude Code. Type a choice's number into the empty prompt box, and work `/companion` with the arrow keys, Enter and Esc.
- **A number at the start of a message picked a choice.** With "Number keys" on, a number typed into the empty prompt box picks that choice, as Claude Code's own surveys take their answers. Type a space first, or turn "Number keys" off in `/companion`.
- **No suggestions at all.** Check that suggestions are on in `/companion`, and that the session is not a headless run. `claude --debug` logs a line for every hook that failed.
- **Fitting seems to do nothing.** Check the mode in `/companion`. Suggest shows a line only when the grade names another model or effort than the one running, and a reply of up to three words is not graded at all; Automatic shows each task's grade under the last prompt. A grade whose pick is "My model and effort", or names what the session already runs on, runs as usual.
- **The mode changed when I changed models.** Each family keeps the mode you picked while the session ran on it, and `/companion` shows the one for the model you are on. Pick the mode again while the session runs on that model.
- **I turned fitting off before, and Suggest is not on.** A store that held the old switch off keeps it off: pick Suggest in `/companion`.
- **A task got a grade too low for it.** Under Suggest nothing changed on its own; under Automatic, press "Ask again on …" beside the task in the band, which asks again on your own model and effort. If it happens often, raise that grade's pick in `/companion`, set it to "My model and effort", or switch to Suggest or Off.
- **A short message I expected to continue the task got graded instead.** Experimental since 0.12.0: a short message is a reply only when it matches a known pattern of leaning on the last answer, not merely for being short ([ADR-0015](adr/0015-a-reply-must-lean-on-the-answer.md)). A new grading call is the cost; it should never cost a wrong answer. Tell the maintainers the phrasing if it keeps happening.
- **A notice says a task could not be sent to a model.** That model is not available to the session, for instance because an organization blocks it. Fitting is off for the rest of that session; pick models for the grades that avoid it.
- **A tool Claude Code serves on `127.0.0.1` never appears**, such as the plugin-authoring skill's secret scan. Some antivirus web filters rewrite the responses of local HTTP servers. Seen with Norton's web protection on Windows: responses to requests that look like MCP traffic came back marked as chunked without being chunked, so every `tools/list` failed with `InvalidHTTPResponse` in the debug log. An exception for `127.0.0.1` in the antivirus's web protection fixed it.
