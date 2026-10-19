# ADR-0003: One suggestion call per answer, off the turn, with a Haiku fallback

- Status: accepted
- Date: 2026-10-16

## Context

Suggestions are a bonus. They must never slow a turn down, break it, or arrive after the person has moved on. A model call can be refused, fail or time out, and each one draws on the person's plan or API budget.

## Decision

- After each answer of the main conversation, the plugin makes one `$.model.complete` call, scheduled a tick after the turn ends, so the end of the turn never waits on it. Subagent reports, interrupted turns, empty answers and headless runs ask nothing.
- The request carries the last prompt, up to 1,500 characters, and the end of the answer, up to 6,000. Its 2,048-token cap leaves room for the model's thinking, and it times out after 45 seconds.
- When the chosen model gives no answer, Haiku 5.5 is asked once, unless Haiku was the model asked.
- A reply that arrives after the person sent another prompt is dropped, and every failure is swallowed: the turn never hears of it.

## Consequences

- The choices appear a moment after the answer, not with it.
- An answer costs at most two calls, usually one.
- Where no surface attaches, the call runs as the turn ends, because its result is the line shown beneath the answer.

## Alternatives considered

- Claude Code's own prompt suggestion: one guess, shown only in the terminal's prompt box. The plugin keeps that guess in step with its own likeliest choice instead.
- Calling the model as the turn ends everywhere: simpler, but the person would wait for it after every answer.
