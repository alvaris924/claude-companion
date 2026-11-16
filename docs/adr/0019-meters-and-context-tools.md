# ADR-0019: Meters and context tools: say what the conversation costs, act only when asked

- Status: accepted
- Date: 2026-11-16

## Context

Every message sends the whole conversation again. A long conversation therefore costs more with each turn, a switch of model reads it once without its cache ([ADR-0011](0011-easy-mid-hard-graded-by-a-model.md)), and a conversation left idle past the prompt cache's lifetime is read again at full price by the next message. None of this was on screen. Claude Code reports the context's fill, the week's rate-limit window on a subscription, each turn's usage and the session's cost to plugins, and lets a plugin ask for a compaction, a notification and a breakdown of the context window.

## Decision

- **Meters that only read.** On the terminal a line under the prompt box shows the context's fill and the week's usage, each a label, five cells and a percent in the theme's success, warning or error colour (under 60%, under 80%, from 80%). From 80% of the week used, its meter says when the week resets. Each answer's end line adds what the turn cost, the session's cost after it less the cost before it, and the share of its input the prompt cache served, or "cache written" where it read nothing and wrote the cache. "Meters" turns all of it off.
- **Say it when it matters.** Past 60% full the line under the prompt box says what each message sends again and how to cut it; past 80% a toast says it once, until the fill drops under 60% again.
- **The cold cache is a guess, said as one.** The cache's lifetime is not reported, so the plugin counts the idle time since the last answer: after an hour by default (5 minutes, the cache's default lifetime, or never), the line says the cache has likely expired and what the next message reads again. A conversation under 20,000 tokens gets no warning, since reading it again costs little.
- **Compaction on its own is opt-in.** "Auto-compact" is off by default. Picked, it compacts once an answer ends past 70%, 80% or 90% full, never while an answer runs, and once until the fill drops under that again, so a compaction that leaves the context past the mark does not repeat.
- **`/fresh` hands the task over.** A model writes four lines (the task, what is done, what is next, notes) from the end of the conversation, at most 12,000 characters of it; the files the conversation changed are named after them; the conversation is cleared; and the handoff waits in the prompt box to edit or send. Where the handoff could not be written, nothing is cleared. Where the conversation will not clear, the handoff is copied for a paste. It is one model call on the suggestion model, made only when the person runs the command.
- **`/ctx` shows what fills the window.** A pane with a bar for each category, the biggest tool outputs, the MCP servers' tool lists and the memory files, and one tip: the MCP tool lists past a tenth of the window, the memory files past a twentieth, the conversation past 40% full, else nothing to cut. It reads what the engine measured and sends nothing.
- **A done alert.** Once an answer that ran a minute or longer ends (30 seconds, 5 minutes or off), a notification says so through the channel Claude Code's own notifications use. On Windows with no channel, the system's notify sound plays. An interrupted answer raises none.

## Consequences

- The plugin acts on the conversation without a press in one case only, a compaction the person switched on. `/fresh` clears it, on the person's command, and only after the handoff is written.
- The cost on an end line includes the plugin's own calls made during the turn, such as a grading call, since it is the session's cost that is read.
- The cold cache warning can be wrong either way: a cache kept for an hour outlives the 5-minute setting, and one kept for 5 minutes expires before the default warns.
- A tool output's size in the X-ray is estimated from its characters, four to a token.
- The done alert's sound starts a process on Windows; AGENTS.md names what the plugin may start one for.

## Alternatives considered

- Compacting by default near the end of the window. Claude Code does that itself; an earlier one is the person's call.
- A warning toast for the cold cache. A line that is there when the person comes back says the same without interrupting.
- Clearing in `/fresh` before the handoff is written. Rejected: a failed call would lose the conversation.
