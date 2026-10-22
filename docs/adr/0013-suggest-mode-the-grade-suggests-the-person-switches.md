# ADR-0013: Suggest mode: the grade suggests, the person switches

- Status: accepted
- Date: 2026-10-22

## Context

ADR-0011 fits each task's model and effort to its grade on its own. The person found it too forceful: a task they wanted on their own model went to Haiku or Sonnet without being asked, and they turned the setting off. They asked for a mode that changes nothing by itself, only suggests, and lets them click to switch.

Facts about the plugin API, checked in the type contract and then in the real terminal and the VS Code surface:

- A turn's requests are sent from a `turn.step` hook. Waiting there for the grade is what delays an answer by a second or two under Automatic; a grade asked off the turn delays nothing.
- A suggestion that arrives after the answer cannot save what the answer cost. It can still fix an answer from a model too weak for the task, and the grade arrives within about two seconds, while the answer is still being written.
- A plugin can cancel the main loop's running turn with `$.turn.abort({ turnId })`, its running tools stopped and no interruption marker, and submit the prompt again.
- Asking a prompt again sends its words only: an image pasted into it, or a block a host wrapped around it, is not sent again.

The first build offered only a stronger model, on the reasoning that pointing down once the answer is in saves nothing. Before release the person asked for the other direction too: after a piece of work, the questions that follow are where a cheaper model saves, and they wanted to be offered it rather than have Automatic make the move.

## Decision

- "Fit model and effort to each task" is a three-way setting: **Suggest** (new default), **Automatic** (ADR-0011's behaviour, unchanged) and **Off**.
- Under Suggest a turn goes as the engine made it, on the session's own model and effort. The first request of a new task has the grade asked in the background, with the grader and grading settings Automatic uses; the rules' grade stands when the model gives none.
- When the grade's pick is another model than the one running (or the same model at another effort the request named), up or down, the band shows what the turn runs on and one button: "Switch to Opus 5.5 at max effort" or "Switch to Haiku 5.5 at low effort", `0` in the terminal, a link elsewhere. It shows while the answer is still running and stays once it has ended.
- Pressing it while the answer runs cancels the turn and asks the prompt again, a new task on the grade's pick, whose follow-ups stay there. Once the answer is in, a stronger pick still asks again, and a cheaper one reads "Continue on Haiku 5.5 at low effort": asking again would only repeat the answer, so the press sends the task's follow-ups there instead, with nothing asked again. The limit on switching does not apply: the person asked for it. Afterwards the band speaks as it does under Automatic, with the way back ("Ask again on Sonnet 5.5").
- It says nothing when the pick is what already runs.
- No grading call is made when no grade could name anything but the session's own model and effort (every grade's picker on "My model and effort"), where no surface could show the button, for a prompt with an image that asking again would lose, or for a model the plugin cannot read. A grade that arrives after the person has sent another prompt is dropped.
- The stored setting is `fit`. A store from before it holds `route`: `true` reads as Automatic and `false` stays Off, and a store with neither is Suggest. `route` is still written, as `fit` is Automatic, for sessions on an earlier version.

## Consequences

- A new install makes one small grading call per new task, which counts toward the person's plan; Haiku as the grader costs about a twentieth. The person chose this over skipping short questions: the grade is what catches the moment the work turns into questions. Under Automatic nothing changed.
- A press while the answer runs costs the seconds it stopped and one uncached read of the conversation on the pick, for a cheaper model still less than the answer it replaced; a "Continue on" costs that read at the next turn. Tools that already ran are not undone: the next model sees what they changed.
- Suggest makes no suggestion for a prompt with an image; Automatic still switches such a prompt on its own, since it never asks again.
- Anyone who set the old switch off stays off until they pick Suggest.
- The plugin now cancels a turn, but only on a press of its own button; AGENTS.md says so.
