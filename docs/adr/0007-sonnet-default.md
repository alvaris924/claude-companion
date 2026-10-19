# ADR-0007: Sonnet 5.5 is the default model

- Status: accepted
- Date: 2026-10-19

## Context

Fable 5.1 was the default from 2026-10-16. It writes the best choices and, at low effort, answers as quickly as Haiku, but it costs about 100 times Haiku per token. With the plugin public, the default is what a new install spends on every answer, on the installer's own account.

## Decision

Sonnet 5.5 is the default for anyone who has not picked a model. Fable 5.1, Opus 5.5 and Haiku 5.5 stay in the settings, a model already picked there is kept, and the Haiku fallback ([ADR-0003](0003-one-suggestion-call-per-answer.md)) is unchanged.

## Consequences

- A new install spends far less per answer than it would with Fable.
- In the tuning run of [ADR-0004](0004-tuned-suggestion-prompt.md), Sonnet scored no better than Haiku and sometimes explained itself instead of writing the message; the filter for lines about the exchange drops such lines.

## Alternatives considered

- Haiku 5.5: the cheapest and fastest, and no worse in the tuning run. Sonnet was chosen as the middle ground between cost and quality.
- Keeping Fable 5.1: the best choices, at the highest cost per answer.
