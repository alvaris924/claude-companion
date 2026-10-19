# ADR-0002: Claude Code 2.1.300 is the floor

- Status: accepted
- Date: 2026-10-16

## Context

A plugin with a hooks module and drawn UI depends on what each Claude Code build offers. The VS Code extension attached no plugin surface up to 2.1.296, so a plugin drew nothing there. From 2.1.300 it draws the band and panes and lets a plugin read and fill the prompt box. The plugin was built and tested on 2.1.300 to 2.1.303.

## Decision

The floor is 2.1.300, stated in the README. CI checks every change against one pinned build, 2.1.303 today, which is raised on purpose in a pull request of its own. Where a host attaches no surface, the plugin still works through the line beneath the answer and the text answers of its commands.

## Consequences

- Users of older VS Code builds get the choices as a line, not the band.
- A newer build can change the plugin API; the pinned CI build stays the reference until it is raised.

## Alternatives considered

- No stated floor, relying on the fallbacks alone: the README could then promise the band nowhere.
- Following the latest build in CI: a new build could turn the checks red on a change that did nothing wrong.
