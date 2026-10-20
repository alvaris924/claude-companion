# ADR-0010: Skills and web searches among the choices, found by Claude's own tools

- Status: accepted
- Date: 2026-10-19

## Context

The suggested next messages only ever asked Claude in plain words. The session often has a skill or a slash command that fits the next step better, such as a review before committing, and people forget it exists. Nor did the choices offer to look something up when the answer guessed at something that changes over time, like a library's current API.

The plugin API lists the session's slash commands, skills included, with `$.command.list()`, runs one with `$.command.run()`, and lets a model request mark its leading text for the prompt cache. The README promises that the plugin makes no network requests of its own, and Claude Code gives Claude its own tools for finding skills and searching the web.

## Decision

- With the setting on, the default, and more than one choice, the suggestion request opens with the session's commands, one line each (`/name: description`, the description cut to 100 characters), skills and the person's own commands before the built-ins, at most 80 commands and 8,000 characters. The block is the same on every call and marked for the cache.
- Only the lines after the first may be a command with a short argument, a "Find a skill for ..." message, or a "Search the web for ..." message. The first line keeps the rules of [ADR-0004](0004-tuned-suggestion-prompt.md).
- A command choice stays only when the session lists the command. Commands that end the session, sign out or throw the conversation away (clear, reset, new, exit, quit, logout, login, rewind, resume, upgrade) are never offered, and are dropped whatever the model writes, with the setting on or off. The list names what to drop, so a command the plugin has not met can still be offered.
- Clicking a command choice runs it with `$.command.run`, as typing it would, and its turns are not fitted to a task ([ADR-0009](0009-model-and-effort-per-task.md)). Set to put choices in the box, it goes there instead.
- Finding a skill and searching the web stay with Claude: the choice is a message, and Claude's own tools do the work on the person's account.
- With the setting off, or with one choice, the request is the one of ADR-0004, with no commands.

## Consequences

- Each suggestion request carries up to about 2,000 more tokens; after the first answer the cache serves them, where the block and the system prompt pass the model's minimum for caching.
- The names and descriptions of the session's skills and commands reach the suggestion model, and the README says so.
- The lines after the first were never scored against recorded turns, and the new rule is not scored either; a change to it should be checked against fresh recorded turns.

## Alternatives considered

- Searching plugin marketplaces or the web from the plugin: network requests of its own, which the README rules out, plus a search provider and its key.
- Letting the first line be a command: it would change the first line's rules, which were tuned against recorded turns.
- Listing skills only, no built-in commands: some built-ins are good next steps, such as compacting a long conversation, and the list of commands never offered keeps out the ones that are not.
