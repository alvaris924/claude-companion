/** The person's most recent prompt; `isFromProgram` when a program sent it (`claude -p`, the Agent SDK). */
export type LastPrompt = { text: string; at: number; isFromProgram: boolean }

/** The suggested next messages, one to five, the likeliest first: one model call after each main-thread turn. */
export type Suggestion = { choices: string[]; at: number }

/**
 * The settings as the settings pane saves them in the plugin's store: each picker's value. `route` fits each task's
 * model and effort to its grade; `easy`, `mid` and `hard` name each grade's as "model:effort", or "own".
 */
export type StoredSettings = {
  suggest: boolean
  model: string
  effort: string
  choices: string
  onPress: string
  route: boolean
  easy: string
  mid: string
  hard: string
  limit: string
}

/**
 * A turn fitted to its task: the task's grade, the model and effort its requests went with, and the session's own
 * model and effort they would have gone with, the same where the grade keeps them. An effort is null where the request
 * named none.
 */
export type RoutedTurn = {
  level: 'easy' | 'mid' | 'hard'
  model: string
  effort: string | null
  ownModel: string
  ownEffort: string | null
  isKept: boolean
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
    }
  }
}
