# ADR-0010: A quiet look: theme keys, the type scale, and quiet buttons for the choices

- Status: accepted
- Date: 2026-10-20

## Context

The band and the panes drew everything at one weight: `Last:` and `Next:` labels, a ⚙, and the choices as a column of identical buttons, which read as a form more than as suggestions. The person asked for a look closer to Apple's developer pages and calm note apps, dark theme first, and then for the choices to read like the options of Claude Code's own question card: rows with a circle, no button chrome. The plugin API offers theme keys for colours, a type scale (`caption`, `footnote`, `body`, `heading`, `title`) and weights for text, border styles, spacing steps and hover styles for boxes. VS Code and the desktop app draw every `Button` in their own button chrome, `plain` or not: VS Code fills it blue, or draws its dark secondary button for one with `dimColor`. They draw a box's border as a full frame whatever its style. A `Markdown` draws as a reply's text does, and its links can be answered by the plugin (`onLinkPress`), when they are `https` links. The terminal has one type size and draws semibold as bold.

## Decision

- Colours are theme keys only: `suggestion` marks what can be pressed on the terminal, `promptBorder` draws its quote bar and the cards. A theme, dark or light, draws them in its own colours.
- Hierarchy comes from the type scale and from dimming: small labels in `caption` semibold, notes in `footnote`, everything else `body`.
- Outside the terminal, the choices are quiet buttons under a small "Suggested" label: `dimColor` asks for the surface's secondary button (dark in VS Code, as its ⋯ is), each holding a ↳, down then right like a reply, and the choice. The last prompt is a markdown quote, and the redo is a link at the end of the dim line that says what a fitted turn ran on, answered by the plugin itself; the link points at the part of the documentation it stands for, so a modified click that opens it lands somewhere useful. Everything a person or a model wrote is escaped, so nothing in it formats or links.
- A dim ⋯ at the end of the last prompt opens the settings: a text glyph, where ⚙ turns into a colour emoji on some systems.
- The terminal keeps the last prompt beside a quote bar and a row of `[ choice ]` buttons after `Next:`, the likeliest in the accent colour; its lines are cut to its measured width.
- The settings group their pickers in rounded cards, each with a heading over it and a short note under it.

## Consequences

- The look follows each person's theme; nothing is tuned to one background. The secondary button and the link take the surface's own colours.
- How a surface draws a quote, a rounded card or a type size is its own; the terminal draws box characters at one size.
- Wording in the band changed: "Light task · Haiku 5.5 at low effort", "Ask again on Opus 5.5". The line a host without plugin UI shows under the answer keeps `Next:`.
- The redo's link address names the public repository's documentation, so a fork that moves its docs changes `DOCS_URL`.

## Alternatives considered

- Plain buttons with the choice as accent text: VS Code and the desktop app still draw them in their own filled button chrome.
- The choices as markdown rows of links, as the question card lists options: tried first; links read as web links, which choices are not.
- A `Select`: a picker that draws a label and the current value, not a list of rows.
- A `Client` drawing the rows itself with pointer input: the terminal and the desktop app have `Client`, VS Code and the mobile app do not.
- Hex colours tuned for dark themes: nothing in the API says whether the person's theme is dark, so a fixed palette would be wrong on a light one.
- An `Svg` header or icons: drawn as images, they take no theme colour and press nothing, and the terminal has no `Svg`.
