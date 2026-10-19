# ADR-0006: Settings live in the plugin store

- Status: accepted
- Date: 2026-10-16

## Context

The settings (suggestions on or off, the model, its effort, the number of choices, what a click does) must survive restarts, apply to every open session and be changeable in VS Code as well as in the terminal. A plugin can declare `userConfig` options in its manifest, keep values in its store (`$.store`, kept across sessions), or keep them in session state (`$.state`, which redraws whatever reads it).

## Decision

A settings pane of pickers writes to the store under one key, `settings`, and mirrors the value into the session-state value `companion.settings`, so the pane redraws. Wherever a setting is used (at the end of each answer, on a click, when the pane opens) it is read afresh from the store, so a pick in one session reaches the others at their next answer. A stored value outside a picker's options counts as that setting's default.

## Consequences

- Changing a setting needs no restart and no settings file.
- The mobile app draws no pickers; its pane lists the settings as text, to be changed from a computer.

## Alternatives considered

- `userConfig` options: an SDK host such as the VS Code extension lists no `/config` row for them, so they could not be changed there.
