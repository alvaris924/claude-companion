# ADR-0018: A quiet terminal band: the keys and hints under the prompt box, a turn's words on its end line

- Status: accepted
- Date: 2026-11-16

## Context

On the terminal the band above the prompt box had grown to the last prompt, the line on what a turn ran on, the choices and a hint line ([ADR-0001](0001-band-above-the-prompt.md), [ADR-0012](0012-the-terminal-works-from-the-keys.md)). Notes, the queue and the meters ([ADR-0017](0017-notes-and-a-queue-kept-for-each-project.md), [ADR-0019](0019-meters-and-context-tools.md)) would each have added rows, and every row of the band is a row taken from the answer. Claude Code also raises drawings for the hint line under the prompt box, the footer's labels and the line that ends each turn, which the plugin had not used.

## Decision

- **The band holds the choices and the last prompt, little else.** The choices come one a line, numbered. The last prompt is the band's last row, right over the prompt box, behind a bar of its own rather than a quote border, which cost two rows. Outside the terminal nothing moves: the prompt, where shown, stays the band's first row ([ADR-0016](0016-the-band-leaves-the-prompt-to-vs-code.md)).
- **What a turn ran on goes on the line that ends it.** Once a fitted turn has ended, its end line says its grade and what it ran on, and the band keeps the row only for its button (the switch or the redo), while the answer runs, or for words no end line says. The line is told apart by the turn's length, which it carries.
- **Hints go under the prompt box, one subject a line.** The plugin adds lines of its own under Claude Code's hint line: the keys, then what the context costs where that matters, the invitation to the setup, and how to work the keys. They stay while the person types and while an answer runs, so the prompt box never jumps a row. With "Number keys" on, no line says how to pick a choice: the numbers say it.
- **Three keys.** 7 copies the last answer as written, 8 opens the queue and 9 opens the notes, shown under the prompt box once there is an answer or something waits in the queue or the notes. A digit typed into the empty prompt box presses a button of the band only, so the band holds the same three buttons hidden for the digits. With "Number keys" off they show beside the last prompt, where the band's focus reaches them.
- **The footer counts.** "2 queued" and "1 note" join the footer's labels while something waits.
- **A setup the person applies.** `/companion-setup` opens a pane with two steps, each ticked or not: fullscreen, where the terminal reports clicks and selections, and Alt+Q and Alt+N bound to `/queue` and `/note` in the person's keybindings file. Nothing is changed until they apply it. A key they already use is left alone, an action already on a key is not bound twice, every other binding is kept, and a file that is not a keybindings file's JSON is never written over. A line under the prompt box points to the setup until it was opened once.

## Consequences

- The band is as short as its choices plus one row, whatever else Companion shows.
- On a terminal too narrow for the end line's words, they are left off; the band's button still shows.
- 7, 8 and 9 are taken while "Number keys" is on. A band can offer five choices at most, and 0 is the switch, so they do not collide.
- The plugin now writes one file outside its store, the keybindings file, and runs `/tui fullscreen`, each only when the person applies the setup. AGENTS.md names both.
- The hint lines read the keybindings file to name the person's own keys ("Alt+Q") in place of the commands.

## Alternatives considered

- Leaving everything in the band, the queue's rows included. Tried first: the band grew past the answer it sat under.
- A side pane for the queue and notes. A pane opens on demand and docks only in a wide fullscreen terminal, so it could not be the everyday place.
- Binding the keys without asking. Rejected: a person's keybindings file is theirs.
