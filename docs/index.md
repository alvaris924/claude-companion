# Companion documentation

Companion is a mod for Claude Code that adds small, useful features where the person works, and is built to take more. Its features keep their last prompt in view, suggest their next message as choices they click, fit the model and effort to each task, keep notes and a queue of next actions for each project, and show what the conversation costs. This page describes how it behaves and where things live; the decisions behind it are recorded under [adr/](adr/).

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
- [ADR-0016: The band leaves the last prompt to VS Code](adr/0016-the-band-leaves-the-prompt-to-vs-code.md)
- [ADR-0017: Notes and a queue, kept for each project, filled from what an answer says](adr/0017-notes-and-a-queue-kept-for-each-project.md)
- [ADR-0018: A quiet terminal band: the keys and hints under the prompt box, a turn's words on its end line](adr/0018-a-quiet-terminal-band.md)
- [ADR-0019: Meters and context tools: say what the conversation costs, act only when asked](adr/0019-meters-and-context-tools.md)

## The band

The band directly above the prompt box shows the last prompt, a dim ⋯ at its end that opens the settings and, once an answer is in, the choices. While task fitting is on, a quiet line says the task's grade and what the turn ran on, with a link or button that asks again as usual when that was something other than the session's own model and effort. The band steps aside while Claude Code shows a survey in the same place.

Outside the terminal the last prompt is a quote on the band's first row, and a small "Suggested" label sits over the choices. VS Code pins the person's prompt above its answer itself, so there the band leaves the quote out unless the "Last prompt" setting is on; the ⋯ then ends the band's first row, the model line or the "Suggested" label, and with neither to show the band draws nothing ([ADR-0016](adr/0016-the-band-leaves-the-prompt-to-vs-code.md)). VS Code, the desktop app and the mobile app draw each choice as a quiet button, a ↳ before the choice: the surface's secondary button, dark in VS Code like the ⋯, rather than its filled one. They lay text out in their own fonts, where the columns they report undercount the room, so there the texts are handed over whole and wrap, a choice wrapping inside its button.

The terminal's band is kept to the choices and the last prompt ([ADR-0018](adr/0018-a-quiet-terminal-band.md)). The terminal reports no pointer outside fullscreen, so the choices are numbered as Claude Code numbers a survey's answers, one a line (`1: …`), and a number typed into the empty prompt box picks one; the switch or the redo is 0. The last prompt is the band's last row, right over the prompt box, behind a bar in the prompt box's border colour. The line on what a turn runs on shows while the answer runs and wherever it has a button; once a fitted turn has ended, the line that ends its answer says what it ran on. The terminal cuts the prompt and each choice to its measured width. With "Number keys" off, a number is typed as usual and the choices and the keys are buttons the band's focus reaches: ctrl+x tab, then the arrows and Enter, which a line under the prompt box then says ([ADR-0012](adr/0012-the-terminal-works-from-the-keys.md)).

## Under the prompt box

On the terminal the plugin adds lines of its own under Claude Code's hint line, so the band stays short ([ADR-0018](adr/0018-a-quiet-terminal-band.md)). They stay while the person types and while an answer runs, so the prompt box never moves a row.

| Line | What it shows |
|---|---|
| The keys | `7: Copy answer`, `8: View queue` and `9: View notes`, once an answer is in or something waits in the queue or the notes. A digit typed into the empty prompt box presses one, and in fullscreen a click does. 7 copies the last answer as written, Markdown and all. |
| Tips, one subject a line | What the context costs, past 60% full or once the prompt cache has likely expired; "new here? /companion-setup" until the setup was opened once; with "Number keys" off, how to reach the choices; and how to queue or keep what was copied, naming the keys the person bound ("Alt+Q") or else the commands. |
| The meters | `ctx` and `week`, each five cells and a percent. |

With "Number keys" off the three keys show in the band instead, beside the last prompt, where the band's focus reaches them. The footer's labels gain "2 queued" and "1 note" while something waits in the project's queue or notes. "Copy, queue, notes keys" in the settings turns off the keys, the footer's counts and the "Add note" under an answer.

## The look

Quiet, after Apple's developer pages and calm note apps: hierarchy from the type scale rather than from boxes and labels, secondary text dimmed, and as little chrome as the surface allows. VS Code and the desktop app draw every button in their own button chrome, so outside the terminal the choices ask for the secondary button rather than the filled one, and the last prompt and the redo are markdown the plugin writes: a quote, and a link whose press the plugin answers itself. The link points at the part of this page it stands for, so a modified click that opens it lands somewhere useful, and everything the person or a model wrote is escaped, so nothing in it formats or links. Every colour is a theme key (`suggestion` for the accent, `promptBorder` for the terminal's quote bar and the settings cards), so each theme, dark or light, draws it in its own colours; no colour is written as a hex value. Small labels are `caption` in semibold and notes are `footnote`; the terminal has one size and draws semibold as bold. Outside the terminal the settings group their pickers in rounded cards, each with a heading over it and a short note under it ([ADR-0010](adr/0010-a-quiet-look.md)).

## Suggested next messages

After each answer of the main conversation, the plugin asks one model for the messages the person might send next; a subagent's report, an interrupted turn and an empty answer ask nothing. The request carries the last prompt, cut to 1,500 characters, and the end of the answer, cut to 6,000, because the questions, offers and open items an answer ends with decide what comes next. It runs a tick after the turn ends, so the end of a turn never waits on the model, and its reply is dropped if the person has sent another prompt in the meantime; a message sent while the answer was still running is the next message already, so nothing is asked for that answer. Whether an answer was still running is read the moment the message is sent, before the engine starts that message's own turn, which it does while the submit is still under way. When the chosen model gives no answer (a refusal, an API error, the 45-second timeout), Haiku 5.5 is asked once instead.

The reply is cut into clean choices. List markers, quotes and "Next:" lead-ins are stripped; lines that talk about the exchange instead of being a message ("The reply asks…") and repeats are dropped; at most the chosen number of choices is kept, the likeliest first. In the terminal the likeliest is also offered dim in the prompt box, where Tab takes it, and Claude Code's own guess there is replaced by it, so the two agree. While actions wait in the queue, the next of them is offered there instead ([the queue](#the-queue)).

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

Under Automatic every fitted turn shows its grade and what it runs on in the band ("Mid task · Sonnet 5.5 at medium effort") until the next prompt. On the terminal the band says it while the answer runs; once the turn has ended, the line that ends its answer says it, where the terminal is wide enough for the words, and the band keeps only the button. When what it ran on is something other than the session's own model and effort, once the turn has ended, a link beside it, on the terminal a button on 0, ("Ask again on Opus 5.5") asks the last prompt again on the session's own model and effort, and that task's follow-ups stay there. Where no surface attaches, the same words lead the line beneath the answer.

## Notes

Notes are messages kept for later, for each project folder, across sessions: 50 at most, each cut to 500 characters, and the same words kept once ([ADR-0017](adr/0017-notes-and-a-queue-kept-for-each-project.md)).

- `/note <text>` keeps the text. `/note` on its own keeps what the person selected, which the fullscreen terminal reports, else what they copied from one of the session's answers; with neither it lists the last answer's lines to keep one by one, and with no answer yet it opens the notes.
- `/save-next [1-5]` keeps a suggested message, the first or the one numbered.
- In the fullscreen terminal an "Add note" under each completed answer does what `/note` does, for that answer.
- `/notes` opens them, newest first. On the terminal a note's number puts it in the prompt box and the note stays; x lists them to remove one by its number, and 0 asks before clearing them all. Elsewhere each note is a quiet button with a ✕ beside it, and "Clear all notes" asks first. Where no pane draws, `/notes` answers with the notes as numbered lines.
- `/notes clear` asks in the pane; where none draws, it clears at once.
- `/notes export [file]` writes the notes, newest first with the day each was kept, to `NOTES.md` at the project's root, or to the file named. The export marks the file as its own on its first line and writes it again next time; a file of that name it did not write is left alone, and a path outside the project is refused.

The list of an answer's lines offers its sentences and list items, nine a page, m turning the page: code, tables, headings and fragments under 12 characters are left out. A number keeps a line and, pressed again, drops it.

What was copied is read from the machine's clipboard only when the person asks: through `Get-Clipboard` on Windows (PowerShell 7 where it is installed, else Windows PowerShell), `pbpaste` on macOS, and `wl-paste`, `xclip` or `xsel` on Linux. Text that is in none of the session's last 20 answers is neither kept nor shown, and words kept once are not kept again while the clipboard still holds them.

## The queue

The queue holds the person's next actions for the project, in order: 20 at most, each cut to 1,000 characters ([ADR-0017](adr/0017-notes-and-a-queue-kept-for-each-project.md)).

- `/queue` on its own queues what the person selected or copied from an answer, as `/note` keeps it. `/queue <text>` queues the text, `/queue list` prints the queue and `/queue clear` empties it.
- Once Claude waits, the next action is the prompt box's grey text, where Tab takes it. It stands in for the likeliest suggestion there, and Claude Code's own guess gives way to it; the choices stay in the band.
- A prompt sent that starts with a queued action takes that action off the queue.
- 8 on the terminal opens the queue as a list that takes the keys: ↑↓ to pick, Enter takes an action into the prompt box, unsent, t moves it to the top, x takes it off, Esc closes. With nothing queued it says how to queue.

Nothing sends the queue on its own, and nothing sends it whole.

## Meters

With "Meters" on, the default, the terminal shows what the conversation costs ([ADR-0019](adr/0019-meters-and-context-tools.md)):

- **A line under the prompt box**: `ctx ▰▰▱▱▱ 42%`, the context window's fill, and on a subscription `week ▰▱▱▱▱ 12%`, the weekly limit's use, each in the theme's success colour under 60%, its warning colour under 80% and its error colour from there. From 80% the week's meter says when it resets ("resets in 2 d").
- **What each message sends again.** Past 60% full a line says it ("context 64%: each message sends 128k tokens again · /compact keeps the gist, /clear starts fresh"), and past 80% a toast says it once, until the fill drops under 60%.
- **Each answer's end line** adds what the turn cost and the share of its input read from the prompt cache ("$0.04 · 96% cached"), the share in colour: good from 80%, fair from 50%. "cache written" stands where the turn read nothing from the cache and wrote it, as a first message does. The cost is what the turn added to the session's total, so the plugin's own calls during it are in it.

Three settings stand beside the meters and do not depend on them:

- **Cold cache warning.** A prompt cache left idle expires, and the next message then reads the whole conversation at full price. The cache's lifetime is not reported, so the plugin counts the time since the last answer: after 1 hour by default (5 minutes, or off), the line under the prompt box says "idle 1 h: the cache has likely expired, so your next message reads 128k tokens again at full price". A conversation under 20,000 tokens gets none. The warning is the terminal's.
- **Auto-compact**, off by default. Once an answer ends past 70%, 80% or 90% full, the plugin compacts the conversation and a toast says so: never while an answer runs, and once until the fill drops under the mark again.
- **Done alert.** Once an answer that ran 1 minute or longer ends (30 seconds, 5 minutes or off), a notification titled "Claude is done" says how long it ran and how the answer starts, through the channel Claude Code's own notifications use. On Windows with no channel, the system's notify sound plays. An interrupted answer raises none.

## A fresh start and the context X-ray

`/fresh` hands the task over to a cleared conversation. The model that writes the suggestions, at low effort, reads the end of the conversation, up to 12,000 characters and 1,200 of each message, and writes four lines: the task, what is done, what is next, and notes. The files the conversation edited are named after them, ten at most. The conversation is then cleared as `/clear` does, and the handoff waits in the prompt box to edit or send. While an answer runs, `/fresh` says to try once it ends; an empty conversation has nothing to hand over; where the handoff could not be written, nothing is cleared; and where the prompt box does not take the handoff, or the conversation will not clear, the handoff is copied for a paste.

`/ctx` opens the context X-ray: the window's fill, a bar for each category in the colour Claude Code's `/context` gives it, then the three biggest tool outputs still in the conversation, the MCP servers by the size of their tool lists, and the memory files. One tip closes it, on what to cut first: the MCP servers once their tool lists take a tenth of the window, the biggest memory file once memory takes a twentieth, `/compact` or `/fresh` once the conversation is past 40% full. A tool output's size is estimated from its characters. Where no pane draws, `/ctx` answers as text, and before the first message there is no measure yet.

## Setup

`/companion-setup`, in the terminal, opens a pane with two steps, each ticked unless it is done already. One switches to fullscreen (`/tui fullscreen`), where the terminal reports clicks and selections. The other binds Alt+Q to `/queue` and Alt+N to `/note` in the person's keybindings file, `keybindings.json` in Claude Code's config folder. Enter ticks or unticks a step and `a` applies the ticked ones; nothing changes before that. Binding keeps every other binding, leaves a key the person already uses alone and says so, never binds an action that already has a key, and leaves a file that is not a keybindings file's JSON untouched. Fullscreen goes last, since it starts the terminal's interface again. Until the setup was opened once, a line under the prompt box reads "new here? /companion-setup"; it also goes once both keys are bound and fullscreen is on. Outside the terminal the command says the setup belongs to the CLI ([ADR-0018](adr/0018-a-quiet-terminal-band.md)).

## Settings

`/companion`, or the ⋯ in the band, opens the settings in five groups: the suggested next messages, the model and effort for each task, the last prompt, the keys, and the meters. VS Code and the desktop app draw a pane of pickers, each group a rounded card with a short note under it. The terminal draws a menu that takes the keys as it opens: a row per setting with its value, ↑↓ to move, Enter to flip a switch or to list a setting's options, numbered so that Enter or the number picks one, and Esc to close. A line atop the menu says what the row under the ring does. It asks the terminal for the rows it needs; where the terminal is shorter, ↑↓ still move a row at a time and the window follows. Its rows carry shorter names: "Picking a choice", "Fit to each task", "Switch limit". Every surface shows the mode kept for the model the session runs on, under the setting's own name, and a pick changes that model's; a note under the setting says each model keeps its own.

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
| Last prompt: show it in the band in VS Code (the terminal always does) | On, off | Off |
| Copy, queue, notes keys (the terminal), with "Add note" under each answer in fullscreen | On, off | On |
| Meters (the terminal) | On, off | On |
| Cold cache warning (the terminal) | Off, 5 minutes, 1 hour | 1 hour |
| Auto-compact | Off, at 70%, 80% or 90% full | Off |
| Done alert | Off, answers over 30 seconds, 1 minute or 5 minutes | 1 minute |

The model and effort of the suggestions and of the grading are their own: fitting the person's turns to their tasks leaves them alone. While a grade's picker says "My model and effort", a line under the pickers says what that is in the session ("“My model and effort” is Opus 5.5 at max effort in this session."); the mobile pane and the line `/companion` answers with where no pane draws say it too. The session's own model and effort are those its last turn's first request named. A pick is saved at once for every session, and other open sessions take it at their next turn. The store keeps the mode picked on each family as `fitByModel`, the mode for every other family as `fit`, and `route`, the earlier on/off switch, as true when `fit` is Automatic, for sessions still on an earlier version; a store from before holding only `route` reads true as Automatic and false as Off, and one holding neither is Suggest. The mobile app draws no pickers, so its pane lists the settings as text; where no pane can be drawn at all, `/companion` answers with the settings on one line.

## Commands

| Command | What it does |
|---|---|
| `/companion` | Opens the settings: a pane of pickers, or in the terminal a menu of the arrow keys and Enter. |
| `/last-prompt` | Opens the pane with the last prompt and the choices again; where nothing draws a pane, answers with both lines. |
| `/copy-next [1-5]` | Copies the first choice, or the numbered one, through the surface's clipboard; where no surface attaches, through the machine's clipboard on Windows. |
| `/note [text]` | Keeps the text as a note. On its own: keeps what was selected or copied from an answer, else lists the last answer's lines to keep, else opens the notes. |
| `/notes [clear \| export [file]]` | Opens the project's notes; `clear` clears them after asking; `export` writes them to `NOTES.md` or the file named, inside the project. |
| `/save-next [1-5]` | Keeps the first choice, or the numbered one, as a note. |
| `/queue [text \| list \| clear]` | Queues the text. On its own: queues what was selected or copied from an answer. `list` prints the queue, `clear` empties it. |
| `/fresh` | Writes a handoff of the task, clears the conversation and puts the handoff in the prompt box. |
| `/ctx` | Opens the context X-ray: what fills the context window, and what to cut first. |
| `/companion-setup` | In the terminal, opens the setup: fullscreen, and Alt+Q and Alt+N for `/queue` and `/note`. |

## Surfaces

Companion has been run on the real terminal and the real VS Code extension. The other rows below describe what the code does for a surface, checked against Claude Code's test kit only; they have not been tried on the real desktop app, mobile app or a headless run. Of what came after 0.13.0, the notes, the queue, the keys, the quieter band and the meters were run on the real terminal; `/fresh`, `/ctx`, the done alert and the setup's switch to fullscreen are checked against the test kit only.

The keys, the lines under the prompt box, the footer's counts, the end lines and the setup are the terminal's alone. `/note`, `/notes`, `/save-next`, `/queue`, `/fresh` and `/ctx` answer on every surface, in a pane where one draws and as text where none does.

| Where | What shows |
|---|---|
| Terminal | The band, cut to the terminal's width, its choices numbered for the number keys; the likeliest choice, or the next queued action, dim in the prompt box; the keys, the tips and the meters under the prompt box; the queue's and the notes' counts in the footer; what a turn ran on and cost on its end line; "Add note" under each answer in fullscreen; and the settings as a menu |
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
| Every project's notes, each under its project's folder | The plugin's store, key `notes`; this project's mirrored in session state `companion.notes` | Across sessions |
| Every project's queued actions, each under its project's folder | The plugin's store, key `queue`; this project's mirrored in session state `companion.queue` | Across sessions |
| Whether the setup was opened once | The plugin's store, key `setup`, mirrored in session state `companion.setupDone` | Across sessions |
| What the notes pane shows, the row the queue list's ring is on, and the words last queued from a copy | Session state `companion.notesView`, `companion.queueFocus`, `companion.queueCopied` | The session |
| The main conversation's last 20 answers, which copied words are checked against and "Add note" goes under | Session state `companion.answers` | The session |
| The keys the keybindings file binds to `/queue` and `/note`, and the setup's pane | Session state `companion.keys`, `companion.setup` | The session |
| The last 20 turns' end lines: what each ran on and what it cost | Session state `companion.ends` | The session |
| The meters' last reading, and whether the prompt cache has likely expired | Session state `companion.meter`, `companion.isCold` | The session |
| What the context X-ray shows | Session state `companion.xray` | Until `/ctx` runs again |

Outside the store the plugin writes two files, each only when the person asks: their keybindings file, when they apply `/companion-setup` with the keys ticked, and `NOTES.md`, or the file named, in the project, for `/notes export`. It makes no network requests of its own: its calls out are model requests, the suggestions, the grading while task fitting is on, and the handoff `/fresh` writes, made through Claude Code on the person's account. It reads the machine's clipboard only when the person asks to keep or queue what they copied, and keeps the text only when one of the session's answers holds it. It cancels a running turn only when the person presses a suggestion's switch. It runs `/model` only when that switch is to a model whose mode is Automatic, `/tui fullscreen` only when the person applies the setup with that step ticked, and `/clear` only for `/fresh`; and it compacts the conversation on its own only where "Auto-compact" is picked.

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
- **A number at the start of a message picked a choice, copied the answer or opened a list.** With "Number keys" on, a number typed into the empty prompt box picks that choice, as Claude Code's own surveys take their answers, and 7, 8 and 9 copy the last answer, open the queue and open the notes. Type a space first, or turn "Number keys" off in `/companion`; "Copy, queue, notes keys" turns off 7, 8 and 9 alone.
- **`/queue`, `/note` or the key bound to one says nothing was copied.** On the terminal's main screen Claude Code sees no selection, so copy the words out of the answer first, then press the key. In fullscreen (`/tui fullscreen`, or `/companion-setup`) selecting them is enough. Only words from one of the session's last 20 answers are taken, and words taken once are not taken again while the clipboard still holds them.
- **No "Add note" under the answers, and clicks do nothing.** Both need the fullscreen terminal: `/companion-setup`, or `/tui fullscreen`.
- **The cold cache warning came while the cache was still warm, or never came.** The cache's lifetime is not reported, so the warning counts idle time: pick the time that matches your cache in `/companion`, 5 minutes or 1 hour, or turn it off.
- **`/fresh` cleared nothing.** It clears only once the handoff is written: while an answer runs, in an empty conversation, or when the model gave no handoff, the conversation stays as it is, and a toast says which.
- **No suggestions at all.** Check that suggestions are on in `/companion`, and that the session is not a headless run. `claude --debug` logs a line for every hook that failed.
- **Fitting seems to do nothing.** Check the mode in `/companion`. Suggest shows a line only when the grade names another model or effort than the one running, and a reply of up to three words is not graded at all; Automatic shows each task's grade in the band, and in the terminal on the line that ends its answer. A grade whose pick is "My model and effort", or names what the session already runs on, runs as usual.
- **The mode changed when I changed models.** Each family keeps the mode you picked while the session ran on it, and `/companion` shows the one for the model you are on. Pick the mode again while the session runs on that model.
- **I turned fitting off before, and Suggest is not on.** A store that held the old switch off keeps it off: pick Suggest in `/companion`.
- **A task got a grade too low for it.** Under Suggest nothing changed on its own; under Automatic, press "Ask again on …" beside the task in the band, which asks again on your own model and effort. If it happens often, raise that grade's pick in `/companion`, set it to "My model and effort", or switch to Suggest or Off.
- **A short message I expected to continue the task got graded instead.** Experimental since 0.12.0: a short message is a reply only when it matches a known pattern of leaning on the last answer, not merely for being short ([ADR-0015](adr/0015-a-reply-must-lean-on-the-answer.md)). A new grading call is the cost; it should never cost a wrong answer. Tell the maintainers the phrasing if it keeps happening.
- **A notice says a task could not be sent to a model.** That model is not available to the session, for instance because an organization blocks it. Fitting is off for the rest of that session; pick models for the grades that avoid it.
- **A tool Claude Code serves on `127.0.0.1` never appears**, such as the plugin-authoring skill's secret scan. Some antivirus web filters rewrite the responses of local HTTP servers. Seen with Norton's web protection on Windows: responses to requests that look like MCP traffic came back marked as chunked without being chunked, so every `tools/list` failed with `InvalidHTTPResponse` in the debug log. An exception for `127.0.0.1` in the antivirus's web protection fixed it.
