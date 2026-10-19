# ADR-0004: The suggestion prompt is tuned against recorded turns

- Status: accepted
- Date: 2026-10-09

## Context

A suggestion only helps when it is what the person would actually send. The first wording of the prompt wrote as Claude about a third of the time ("Should I commit?") instead of as the developer.

## Decision

The prompt casts the model as the developer writing to Claude, and decides the first line in a fixed order:

1. The reply asks a question or offers a choice: answer it, taking Claude's recommendation when it gave one.
2. The reply says what Claude will do next or waits for the word: give the go-ahead.
3. The reply says the work is done but uncommitted, unverified or has open follow-ups: ask for the most important one.
4. Otherwise: the most useful next step.

It forbids writing as Claude, thanking, claiming results the developer has not seen, and naming any branch, file, number or tool the reply did not name, and it shows four examples of the form. Lines after the first are alternatives: the other option Claude offered, a check before going ahead, or the step after this one. The rules of the first line were tuned on 2026-10-09 against 34 recorded turns, 12 of them held out, each scored against what the developer actually sent next. Lines of the reply that talk about the exchange ("The reply asks…") and list markers are filtered out.

## Consequences

- The recorded turns come from the maintainer's own sessions and are not in the repository, so the evaluation cannot be rerun from here. A change to the rules should be checked against fresh recorded turns before it lands.
- The lines after the first, added on 2026-10-16, reuse the tuned rules; they were not scored on their own.

## Alternatives considered

- An open question ("what will the developer say next?"): it wrote as Claude too often.
- Sonnet for the same prompt: it scored no better than Haiku and sometimes leaked its reasoning into the reply. The default model has changed since; see [ADR-0007](0007-sonnet-default.md).
