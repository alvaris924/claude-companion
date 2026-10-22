/** The person's most recent prompt; `isFromProgram` when a program sent it (`claude -p`, the Agent SDK). */
export type LastPrompt = { text: string; at: number; isFromProgram: boolean }

/** The suggested next messages, one to five, the likeliest first: one model call after each main-thread turn. */
export type Suggestion = { choices: string[]; at: number }

/**
 * The settings as the settings pane saves them in the plugin's store: each picker's value. `fit` is how each task's
 * model and effort follow its grade: "suggest" (offers a switch, changes nothing), "auto" or "off"; `route` is the same
 * as a switch, "auto" or not, kept for sessions still on a version before 0.12.0; `fitByModel` is the mode picked
 * while the session ran on each family of models, which `fit` stands in for where none was picked; `easy`, `mid` and
 * `hard` name each grade's as "model:effort", or "own".
 */
export type StoredSettings = {
  suggest: boolean
  model: string
  effort: string
  choices: string
  onPress: string
  numberKeys: boolean
  lastPrompt: boolean
  fit: string
  fitByModel: Partial<Record<'haiku' | 'sonnet' | 'opus' | 'fable', string>>
  route: boolean
  easy: string
  mid: string
  hard: string
  limit: string
  grading: string
  grader: string
}

/**
 * A turn fitted to its task: the task's grade, the model and effort its requests went with, and the session's own
 * model and effort they would have gone with, the same where the grade keeps them. An effort is null where the request
 * named none. A suggestion (`isSuggestion`) is the other way round: the turn ran on the session's own model and effort,
 * and `model` and `effort` are what the grade names, which a press switches the task to; with `switchesSession`, that
 * model's mode is Automatic and a press switches the session to it, as /model does. A task sent on (`isOnward`) ran on
 * its own model and effort, and its follow-ups go to `model` and `effort`.
 */
export type RoutedTurn = {
  level: 'easy' | 'mid' | 'hard'
  model: string
  effort: string | null
  ownModel: string
  ownEffort: string | null
  isKept: boolean
  isSuggestion: boolean
  switchesSession?: boolean
  isOnward?: boolean
  at: number
}

/** The session's own model and effort, as its main-loop requests name them. An effort is null where they name none. */
export type OwnRequest = { model: string; effort: string | null }

declare module 'claude-code' {
  interface PluginState {
    companion: {
      last: LastPrompt | null
      next: Suggestion | null
      paneClosed: boolean
      /** The settings as last read from the store or picked, for the settings pane to draw; null until read. */
      settings: StoredSettings | null
      /** The last turn, while it ran on another model or effort than the session's own to fit its task; else null. */
      routed: RoutedTurn | null
      /** The session's own model and effort as its last main-loop turn began; null until the first request. */
      own: OwnRequest | null
      /** The session's model as /model shows it, read at each turn and as the settings open; null until read. */
      sessionModel: string | null
      /** The terminal's settings menu: "list", or the setting whose options it shows. */
      menu: string
      /** The key of what the terminal settings menu's ring is on: a row, or an option of the setting open; null at first. */
      menuFocus: string | null
    }
  }
}
