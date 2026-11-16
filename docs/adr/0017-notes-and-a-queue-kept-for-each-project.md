# ADR-0017: Notes and a queue, kept for each project, filled from what an answer says

- Status: accepted
- Date: 2026-11-16

## Context

An answer often holds words worth coming back to, or lists several next steps. Sending one step loses the others, and keeping them meant copying into another app. The suggested next messages ([ADR-0003](0003-one-suggestion-call-per-answer.md)) are a model's guess at the next step; they do not hold the steps the person picked out themselves.

The plugin API gives no context menu, so "select, right-click, add to notes" cannot be built. It does give the selection in the fullscreen terminal, a process the plugin can start to read the clipboard, and a store that outlasts the session ([ADR-0006](0006-settings-in-the-plugin-store.md)).

## Decision

- **Two lists, kept for each project.** Notes are messages kept for later; the queue is the next actions, in order. Both live in the plugin's store (`notes`, `queue`), each entry carrying the folder of the project it was kept in, so a session sees its own project's and they come back with the next session. A project holds 50 notes of up to 500 characters and 20 queued actions of up to 1,000.
- **One way in for both.** `/note` and `/queue` on their own take what the person selected, else what they copied; with text after them they take the text. A key bound to either command does the same, which `/companion-setup` offers as Alt+N and Alt+Q ([ADR-0018](0018-a-quiet-terminal-band.md)).
- **Copied text counts only when an answer holds it.** The clipboard is read only when the person asks to keep or queue what they copied, never as the band draws. What it holds is kept or queued only when its words, in their order, are inside one of the session's last answers; anything else, such as a password or a link from another app, is neither stored nor shown. Words already kept or queued once count as nothing new, so a clipboard that still holds them does not add them twice.
- **A note stays when taken.** A note's number puts it in the prompt box, and the note stays until it is removed. Clearing every note asks first.
- **The queue is sent one at a time, by the person.** The next action is the prompt box's grey text, where Tab takes it, in place of the likeliest suggestion. A prompt sent that starts with a queued action takes it off the queue. Nothing sends the queue on its own, and there is no "send all".
- **An export the person asks for.** `/notes export` writes the project's notes to `NOTES.md` at the project's root, or to the file named. It marks the file as its own on the first line and writes it again next time; a file of that name it did not write is left alone, and so is a path outside the project.

## Consequences

- Without a selection, keeping or queueing reads the clipboard through a process, which takes about a second on Windows. A key's press is answered with a toast meanwhile.
- On the terminal's main screen Claude Code sees no selection, so the words have to be copied first; in fullscreen a selection is enough.
- The lists are per project folder, not per conversation: two sessions in one project share them, and each reads the store afresh before it writes.
- The store grows by two keys. A store that holds anything else under them is read as empty.

## Alternatives considered

- A notes file the person edits by hand. Nothing to build, but every note takes leaving the session.
- Running the queue on its own, with a countdown, or sending it whole as one prompt. Rejected: each answer may change what should come next.
- Numbering the queued actions under the choices. Tried, and it left too many numbers on screen; the queue is a list opened with one key instead.
- Keeping whatever the clipboard holds. Rejected: it would store text the person never meant for the plugin.
