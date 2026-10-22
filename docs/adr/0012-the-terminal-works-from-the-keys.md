# ADR-0012: The terminal works from the keys: numbered choices and a settings menu

- Status: accepted
- Date: 2026-10-22

## Context

The person found the terminal hard to use: the settings pane showed a third of the settings, they did not know how to change one, and the choices looked like buttons that nothing pressed. Run in a pseudo-terminal and read back, the terminal showed why. Outside fullscreen Claude Code turns on no mouse reporting, so a click reaches nothing. A pane opens a third of the terminal tall unless `$.ui.open` asks for `rows`, and takes no keys until the person presses ctrl+x tab. There a `Select` opens its list under Enter or an arrow, so the arrows never move from one setting to the next. A pane whose tree is taller than its window scrolls under the arrows and leaves the focus ring behind.

What the API offers and the terminal honours, each tried there with a throwaway plugin: a band `Button` with a digit `hotkey` is pressed by that digit typed into the empty prompt box, as Claude Code's own surveys are answered, and `plain` draws it `1: label`. A pane opened with `focus` takes the keys when the prompt box is empty, as it is after `/companion`; `closeOnEscape` closes it with Esc. In a focused pane that fits, ↑↓ and Tab move the ring between `plain` buttons, Enter presses one and a digit `hotkey` presses its own. `$.ui.focus` moves the ring onto an element the next drawing brings, and `$.ui.scroll` moves the window as little as shows one. A `ui.scroll` hook can keep the window still. A `Client` module takes keys only after a click has given it the focus, so it is no way in for a keyboard.

## Decision

- In the terminal the choices are `plain` buttons numbered 1 to 5 with digit hotkeys, laid out in a wrapping row, and a dim line under them says how to pick one and where the settings are: "type 1–3 to send · /companion for settings". The redo is 0.
- A "Number keys" setting, on by default, turns the numbers off, since a number typed at the start of a new message picks a choice instead. Off, the choices are `[ choice ]` buttons the band's focus reaches, and the line says so.
- `/companion` opens the settings pane with `focus`, `closeOnEscape`, `holdToasts` and `rows: 22`. In the terminal it draws a menu rather than pickers: a row per setting, its label and its value, as `plain` buttons. Enter flips a switch where it stands; on any other setting it lists that setting's options, numbered 1 to 9 and 0 as Claude Code numbers a menu's, its own marked ✓ and under the ring. Enter or a number picks and goes back to the list with the ring on the row. The keys and a line on what the row under the ring does head the menu, where a short terminal still shows them; the line follows a `ui.focus` hook.
- Where the menu is taller than its window, a `ui.scroll` hook keeps the window still under ↑ or ↓ and moves the ring a row instead, then scrolls as little as shows it. The wheel, the page keys and the plugin's own scrolls pass.
- VS Code, the desktop app and the mobile app keep their look: unnumbered choices and pickers in cards.
- `/next` and `/companion show|set`, typed stand-ins tried the day before, are dropped: the keys are the way in.

## Consequences

- The terminal is driven the way its own dialogs are, and nothing there needs ctrl+x tab or a pointer.
- A message that starts with a number, typed while choices show, needs a space first or "Number keys" off.
- The test kit draws no focus ring and implements no `$.ui.focus` or `$.ui.scroll` call, so the tests check what the menu draws and what its hooks decide; where the ring lands was checked in a real terminal.
- The menu's rows carry shorter names than the pickers elsewhere: "Picking a choice", "Fit to each task", "Switch limit".
