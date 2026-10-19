# ADR-0005: Machine-made prompts are filtered out by origin

- Status: accepted
- Date: 2026-10-16

## Context

The band must show the person's own last prompt. Claude Code also delivers prompts nobody typed: task notifications, scheduled triggers, messages from other sessions, prompts from other plugins. New surfaces bring origins of their own; prompts from the VS Code extension arrive as the composer's. Hosts also wrap blocks around what the person typed, such as a browser extension's instructions or an editor's selection, and a pasted image arrives as a marker with a file path.

## Decision

A list names the machine origins to leave out, twelve kinds from `task-notification` to `plugin`, and every other origin counts as the person. Blocks whose tag name has a machine-style shape (snake_case or kebab-case, opened and closed) are cut out of the recorded text, and an image marker becomes `[image]`. A prompt that is nothing but such blocks is not recorded. Only the band's copy is cleaned: the prompt itself reaches Claude unchanged.

## Consequences

- A new kind of machine prompt shows in the band until it is added to the list, but a prompt from a surface the plugin has not met yet is never hidden.
- A typed prompt that contains such a tag pair loses that part in the band, though not in the conversation.

## Alternatives considered

- Listing the person's origins instead: prompts from the VS Code extension would have been dropped until someone noticed.
