# ADR-0014: Each model keeps its own mode, and a switch to an Automatic one moves the session

- Status: accepted
- Date: 2026-10-22

## Context

ADR-0013 made Suggest the default mode for fitting each task, with Automatic and Off one pick away, as one mode for every session. Suggest only ever offers a stronger model, so on the strongest model a session uses, Opus at max effort, it offers nothing. There a person may want the opposite of a suggestion: easy and mid tasks moved down on their own, to save what Opus costs, while on Sonnet they still want to be asked before anything moves. Not every person wants Automatic on Opus, so the plugin cannot decide it for them.

Facts about the plugin API, checked in the type contract and then on the real engine (terminal 2.1.308, the VS Code surface 2.1.307):

- `$.session.model()` returns the main loop's model as `/model` shows it, at any time, so the settings can tell which model they are changed on before any turn runs.
- `$.command.run({ command: 'model', args })` runs `/model` as if the person typed it, its lines in the transcript. In the terminal Claude Code answers "Set model to Opus 5.5 and saved as your default for new sessions"; through VS Code it answers "for this session only".
- No plugin event fires when the model changes, but the next turn's start can read it.

## Decision

- The mode of fitting is kept for each family of models (Haiku, Sonnet, Opus, Fable). A pick in `/companion` is saved for the family the session runs on, and every turn runs under the mode kept for the session's model. A family nobody picked for keeps the mode for every model: Suggest on a new install, or what an earlier version stored.
- The setting keeps its name, "Fit model and effort to each task", and shows the mode kept for the session's model; a note under it says each model keeps its own. Naming the model in the label ("Fit on Opus") was tried and dropped as more confusing than helpful.
- Under Suggest, when the model a grade names is of another family whose mode is Automatic, the button reads "Switch to Opus 5.5 with Automatic on", or "Continue on Haiku 5.5 with Automatic on" once the answer is in. Pressing it runs `/model` with that model as well, so the session is then on that model and its Automatic fits the tasks after. Any other suggestion switches only the task, as in ADR-0013.
- Where `/model` cannot run, the press still switches the task.
- The store keeps `fitByModel` beside `fit`, which stays the mode for every model and the `route` an earlier version reads.

## Consequences

- A person sets Automatic once while on Opus and Suggest once while on Sonnet, and each comes back whenever the session runs on that model, with `/model` or with a press.
- A press on "with Automatic on" in the terminal makes that model the default for new sessions too, as `/model` does there. Only a model the person set to Automatic gets this, and Automatic moves easy and mid tasks down again.
- Changing models can now change the mode the settings show; the note under the setting and the docs say why.
- The plugin runs `/model` only on a press of its own button; AGENTS.md says so.
- On a Claude Code without `$.session.model()`, the mode for every model applies, as before.
