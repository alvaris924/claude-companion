# ADR-0009: Fit the model and effort to each task, by rules, under 100,000 tokens

- Status: accepted
- Date: 2026-10-19

## Context

Every turn of a session runs on the model and effort the person set, whatever the task asks. A quick question about the code costs as much as a real change, and a multi-file refactor gets no more thinking than a typo fix. Changing the model or the effort by hand before each prompt is tedious, so nobody does it.

The plugin API lets a `turn.step` hook send a request of the main loop with another model or effort, and the `prompt.submit` and `turn.start` hooks see the prompt that starts a turn. Two facts of the API's prompt cache shape what is worth doing, at the prices of its reference in October 2026:

- Caches belong to one model. A switch sends the whole conversation to a model that has not cached it. Haiku 5.5 costs $0.10 per million input tokens for prompts up to 100,000 tokens and $0.50 above; Sonnet 5.5 costs $2, Opus 5.5 $4 and Fable 5.1 $10, with cached reads at $0.20 to $0.25 on those three. The request that reads the conversation uncached also writes it to the cache, billed at 1.25 times the input price, or twice it for an hour-long cache.
- A change of effort invalidates the conversation's cache on the same model, so the next request reads it uncached at that model's price.

## Decision

- Off by default, behind one switch in the settings, with two more pickers for what light and heavy tasks get.
- Each prompt of the person's is graded by rules, with no model call. Heavy: a verb of substantial work (implement, refactor, migrate, redesign, rewrite, overhaul, scaffold), "from scratch" or the whole codebase, more than 250 words, or four paths or more. Light: a question, or a request to explain or list, of at most 25 words, with no sign of something broken, nothing pasted and at most one path. Standard: the rest.
- The grade belongs to the task. A reply continues the running task: a choice, clicked or typed, or up to six words without a verb of work. A follow-up of up to 40 words to heavy work stays heavy. Turns nobody typed continue the running task.
- A light task goes to Haiku 5.5 at low effort when the session's model is a first-party Sonnet, Opus or Fable model. A heavy task runs one effort level up, `max` at most, or, as a separate pick, one model up the ladder Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.1 as well.
- A task changes model or effort only while the conversation is under 100,000 tokens, decided at its first request and kept for the whole task, since going back costs an uncached read too.
- Left alone: standard tasks, subagents, slash commands and skills (a skill may set its own model), prompts a program sends where nothing is drawn, such as `claude -p`, model ids the plugin cannot read, and a request the engine sends on another model mid-turn, such as a fallback.
- A fitted request that fails before it answers goes again as the engine made it, and fitting stops for the rest of the session with a notice, so a blocked model never breaks a turn twice.
- The band shows what a fitted turn ran on, and a light one gets a button that asks the last prompt again on the session's own model and effort.

## Consequences

- With fitting on, a quick question early in a session costs about a twentieth of what it costs on Sonnet 5.5, and less still against Opus 5.5 or Fable 5.1.
- Heavy tasks cost more: the higher effort thinks longer, its first request reads the conversation uncached, and one model up costs that model's price.
- Past 100,000 tokens nothing changes, so long sessions keep the person's own model and effort.
- The rules misjudge some prompts. A question that hides real work goes to Haiku, which the band shows and the redo undoes; "rewrite this sentence" counts as heavy and only costs more. The rules were written by hand and are not scored against recorded turns; a change to them should be checked against fresh recorded turns, as [ADR-0004](0004-tuned-suggestion-prompt.md) asks of the suggestion prompt.
- The choices, the band and the suggestion model are untouched by fitting: suggestions keep their own model and effort.

## Alternatives considered

- A classifier call per prompt (`$.model.classify`): better at reading intent, but a round trip before every answer and a second model call per turn, where [AGENTS.md](../../AGENTS.md) allows one.
- Lowering the effort of the session's own model for light tasks: the effort change makes the next request read the conversation uncached at that model's price, which costs more than the thinking it saves. Below 100,000 tokens, an uncached read on Haiku 5.5 costs no more than a cached read on Sonnet 5.5, Opus 5.5 or Fable 5.1.
- Grading every prompt on its own: a "yes" after a hard refactor would drop to Haiku, and each switch back and forth would read the conversation uncached again.
- A marker the person types to pick the level: manual, which is the work the feature exists to save.
