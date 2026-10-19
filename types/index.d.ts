/** The person's most recent prompt; `isFromProgram` when a program sent it (`claude -p`, the Agent SDK). */
export type LastPrompt = { text: string; at: number; isFromProgram: boolean }

/** The suggested next messages, one to five, the likeliest first: one model call after each main-thread turn. */
export type Suggestion = { choices: string[]; at: number }

/** The settings as the settings pane saves them in the plugin's store: each picker's value. */
export type StoredSettings = { suggest: boolean; model: string; effort: string; choices: string; onPress: string }

declare module 'claude-code' {
  interface PluginState {
    companion: {
      last: LastPrompt | null
      next: Suggestion | null
      paneClosed: boolean
      /** The settings as last read from the store or picked, for the settings pane to draw; null until read. */
      settings: StoredSettings | null
    }
  }
}
