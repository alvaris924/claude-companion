# ADR-0011: Easy, mid and hard tasks, graded by a model, at any length

- Status: accepted
- Date: 2026-10-21
- Supersedes: [ADR-0009](0009-model-and-effort-per-task.md)

## Context

[ADR-0009](0009-model-and-effort-per-task.md) fitted the model and effort to each task by rules, with no model call, and only while the conversation was under 100,000 tokens. In use it did nothing anyone could see. The person who turned it on works in sessions that start near 55,000 tokens, pass 100,000 within the first turn and run at max effort, so standard tasks ran as usual by design, heavy ones had no effort level left to climb, light ones fell past the 100,000-token line, and the band showed a line only when a turn moved. A working feature looked like a broken one: every turn sent after it was turned on went out at about 432,000 tokens. The person asked for three grades, easy, mid and hard, decided by a model, with the model switched to fit each.

The cache facts of ADR-0009 still hold. Caches belong to one model, a change of effort makes the API read the conversation uncached once, and at the prices of October 2026 an uncached read on Sonnet 5.5 costs ten times a cached read on Opus 5.5.

## Decision

- Three grades, easy, mid and hard, each with a picker of what its task runs on: a model at an effort, or the session's own. By default easy runs on Haiku 5.5 at low effort, mid on Sonnet 5.5 at medium and hard on Opus 5.5 at max, the defaults the person picked.
- Sonnet 5.5 at low effort grades each new task, picked over Haiku 5.5 for its judgment on the tasks between two grades. It is asked at the task's first request, inside the `turn.step` hook, whose time budget a `$.model.complete` call does not draw on, and that request waits for it: a second or two before a new task's answer starts. It reads the new request (up to 1,500 characters), the request before it (up to 500) and the end of the last answer (up to 1,500), so a "yes, do it" is graded as the work it takes up, and it is told to pick the harder of two grades.
- The rules of ADR-0009 stay, renamed (heavy is hard, light is easy, standard is mid). They grade a task when the grader gives no answer within eight seconds, or none at all, and they still decide which prompts only answer the last turn, so replies and clicked choices keep their task's grade with no grading call. A reply is now at most three words ("why?", "go on", "and the tests?"), not six, and the rule that a follow-up of up to 40 words to heavy work stays heavy goes: on the real engine the six-word rule kept "What does Time.deltaTime measure? One sentence." on Opus 5.5 after a hard task, and the grader, which reads the request before and the end of the answer, can tell a follow-up that is hard work from one that is not.
- A task switches at any length of conversation: the 100,000-token line goes. A session on a model with a 1M context window ("[1m]") switches to the same window of the other model.
- Every fitted turn shows its grade and what it runs on in the band ("Mid task · Sonnet 5.5 at medium effort"), whether it moved or not, and a turn that moved offers a link that asks the prompt again on the session's own model and effort.
- Left alone as before: subagents, slash commands and skills, a program's prompts where nothing is drawn, model ids the plugin cannot read (no grading is asked there), and a request the engine moves in the middle of a turn. A fitted request that fails before it answers still turns fitting off for the rest of the session, with a notice.
- [AGENTS.md](../../AGENTS.md) allows the grading call: while fitting is on, one per new task, besides the suggestion call after each finished turn.

## Consequences

- Fitting does something in every session it is on in, and the band says what on every turn.
- A new task's answer starts a second or two later, the grading's time, and each grading is one short Sonnet 5.5 call on the person's plan.
- Switches cost more in long conversations. Each one reads the conversation once without the new model's cache: a task that moves to Sonnet 5.5 at 400,000 tokens pays $0.80 or more for that one read, where a cached turn on Opus 5.5 reads the same for about $0.08. A model's cache lasts while that model keeps being used within the cache's lifetime, so tasks that alternate between grades pay the uncached read mostly once per model.
- A grade can be wrong both ways. A hard task graded easy runs on Haiku, which the band shows and its link undoes; an easy one graded hard runs on Opus 5.5 at max effort and only costs more. The grader's prompt was written by hand and has not been scored against recorded turns, as [ADR-0004](0004-tuned-suggestion-prompt.md) asks of the suggestion prompt; that check is owed.
- The suggestions keep their own model and effort.

## Alternatives considered

- Keep the rules and show the grade on every turn: visible, but it keeps the rules' misgrades, and the person asked for a model to decide.
- Haiku 5.5 as the grader: half a second rather than one or two, and cheaper, with weaker judgment between two grades. The person picked Sonnet 5.5.
- Grade at `prompt.submit` to start earlier: the `turn.step` hook that waits on the answer would then spend its own time budget on a call it did not make, for a head start of a fraction of a second.
- `$.model.classify` with the labels easy, mid and hard: its fixed classifier prompt cannot say what each grade means.
- Keep the 100,000-token line: the cheapest, and the reason the feature did nothing in long sessions.
