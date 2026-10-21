# ADR-0001: Draw in the band above the prompt

- Status: accepted; its look refined by [ADR-0010](0010-a-quiet-look.md)
- Date: 2026-10-16

## Context

The last prompt and the suggested next messages have to be in view at the moment the person decides what to type next, wherever Claude Code runs. A plugin can draw a pane, draw the band directly above the prompt box (`AbovePrompt`), or write into the prompt box itself. In the terminal, a pane opened without the person asking waits until the window is wide enough and shows nothing below that width. Text written into the prompt box competes with whatever the person is typing.

## Decision

The band is the home of both: the last prompt with a ⚙ for the settings, and under it the choices as buttons. It is drawn in the terminal, the VS Code extension and the desktop app. The mobile app, which draws no band, gets a pane opened at the first prompt. A host that draws no plugin UI gets the choices as the turn's text, which Claude Code shows as a line beneath the answer. In the terminal, the likeliest choice is also offered dim in the prompt box, Claude Code's own place for a suggestion, which leaves the box itself empty.

## Consequences

- The band shows at any window width and needs no command to open.
- VS Code shows it from 2.1.300 ([ADR-0002](0002-claude-code-floor.md)). The column count it reports undercounts the room, so outside the terminal the texts are handed over whole and wrap.
- The band yields to a survey Claude Code shows in the same place.

## Alternatives considered

- A pane: the width floor hid it in ordinary terminal windows.
- Drafting the likeliest suggestion into VS Code's empty prompt box (v0.6.0): replaced within the hour, because choices to pick from above the box fit the job better than a draft inside it.
- A process wrapper or a patch to the VS Code extension, to show Claude Code's own suggestion there: rejected, since both reach outside the plugin API.
