# ADR-0016: The band leaves the last prompt to VS Code

- Status: accepted
- Date: 2026-10-22

## Context

Companion began as a band that keeps the person's last prompt in view while a long answer scrolls by ([ADR-0001](0001-band-above-the-prompt.md)). The VS Code extension now pins the person's prompt above its answer while they scroll, with its own controls beside it, so in VS Code the prompt showed twice: pinned at the top by Claude Code, and quoted again in the band at the bottom. The terminal pins nothing.

## Decision

- A setting, "Last prompt", decides whether the band outside the terminal shows the prompt. It is off by default; the terminal always shows it.
- Without the quote, the ⋯ that opens the settings ends the band's first row: the model line when there is one, else the "Suggested" label. With neither to show, the band draws nothing; `/companion` still opens the settings.
- The redo and switch buttons still act on the last prompt, which the plugin keeps whether or not the band shows it.

## Consequences

- VS Code shows the prompt once, where Claude Code pins it, and the band holds only what Companion adds.
- A person who liked the quote in VS Code turns "Last prompt" on in `/companion`.
- In VS Code the band is empty until an answer brings choices or a model line, so the ⋯ is out of sight before the first answer.
