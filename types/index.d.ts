/** The person's most recent prompt; `isFromProgram` when a program sent it (`claude -p`, the Agent SDK). */
export type LastPrompt = { text: string; at: number; isFromProgram: boolean }

/** The suggested next messages, one to five, the likeliest first: one model call after each main-thread turn. */
export type Suggestion = { choices: string[]; at: number }

/** A message kept for later, under the project folder it was kept in; the plugin's store holds them all, `notes`. */
export type Note = { id: string; text: string; at: number; root: string }

/**
 * An action queued to send later, under the project folder it was queued in; the plugin's store holds every project's
 * in one list, `queue`, in queue order.
 */
export type QueuedAction = { id: string; text: string; at: number; root: string }

/** The keys bound to /queue and /note in the person's keybindings file, as Claude Code names them; null where none. */
export type BoundKeys = { queue: string | null; note: string | null }

/**
 * The setup's pane: whether each step is ticked (fullscreen, the Alt keys), and whether the session was in fullscreen
 * already as it opened.
 */
export type SetupView = { fullscreen: boolean; keys: boolean; isFullscreen: boolean }

/**
 * What a turn spent: its dollars, null where the engine gave no figure; and the share of its input the prompt cache
 * served, in percent, "written" where it read nothing and wrote the cache, null where it reported no input.
 */
export type Spend = { usd: number | null; cache: number | 'written' | null }

/**
 * A main-loop turn's end, as the terminal's line closing it is told apart: its length in milliseconds, which that line
 * carries too; what the turn ran on in words, where it was fitted; and what it spent, with the meters on.
 */
export type EndLine = { durationMs: number; words?: string; spend?: Spend }

/** One row of the context X-ray: a category of the window as the engine breaks it down, its tokens and its colour. */
export type XrayRow = { name: string; tokens: number; color: string; isUsed: boolean }

/** One named part of the window, for the X-ray's lines under its rows: "Read parser.ts", "github", "CLAUDE.md". */
export type XrayPart = { label: string; tokens: number }

/**
 * What the context X-ray shows, as /ctx measured it: the window's fill, a row per category, the biggest tool outputs,
 * the MCP servers' tool lists and the memory files, the biggest first, and one tip on what to cut.
 */
export type XrayView = {
  tokens: number
  window: number
  percent: number
  rows: XrayRow[]
  outputs: XrayPart[]
  servers: XrayPart[]
  memory: XrayPart[]
  tip: string
}

/**
 * What the meters read, as the engine last measured the session: the context window's fill in percent and in tokens,
 * and the week's rate-limit window (on a subscription), each null until a reading has one.
 */
export type MeterReading = { percent: number | null; tokens: number | null; week: { percent: number; resetsAt: string | null } | null }

/**
 * What the notes pane shows: the notes; an answer's lines to pick from, a page at a time; the notes to remove one (the
 * terminal's); or the question before every note of the project is cleared.
 */
export type NotesView = { kind: 'list' } | { kind: 'pick'; lines: string[]; page: number } | { kind: 'remove' } | { kind: 'clear' }

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
  noteButton: boolean
  fit: string
  fitByModel: Partial<Record<'haiku' | 'sonnet' | 'opus' | 'fable', string>>
  route: boolean
  easy: string
  mid: string
  hard: string
  limit: string
  grading: string
  grader: string
  meters: boolean
  coldAfter: string
  compactAt: string
  doneAfter: string
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
      /** This project's notes, newest first, as last read from the store, for the notes pane to draw. */
      notes: Note[]
      /** What the notes pane shows: the notes, or the lines of an answer to keep. */
      notesView: NotesView
      /** The main loop's completed answers this session, oldest first, the last few: a "+ note" goes under each. */
      answers: string[]
      /** This project's queued actions, the next one first, as last read from the store, for the band to draw. */
      queue: QueuedAction[]
      /** The row of the queue list the ring is on ("queued-2"), which t and x act on; null for the next one. */
      queueFocus: string | null
      /**
       * The words 8 queued last. Still on the clipboard, or still selected, they count as nothing new, so 8 opens the
       * list instead of queueing them again once sent or taken off.
       */
      queueCopied: string | null
      /** The keys the person's keybindings file binds to /queue and /note, as they read ("Alt+Q"); null where none. */
      keys: BoundKeys
      /** The setup's pane, as /companion-setup opened it and the person ticked it since. */
      setup: SetupView
      /** Whether the setup was opened once, which hides the band's line inviting to it. */
      setupDone: boolean
      /** The last turns' ends, the latest last, for each turn's end line to say what it ran on and what it cost. */
      ends: EndLine[]
      /** The context's fill and the week's usage as the engine last measured them, for the footer and the tips. */
      meter: MeterReading
      /** Whether the prompt cache has likely gone cold: idle past the time the settings name since the last answer. */
      isCold: boolean
      /** What the context X-ray shows, as /ctx last measured it; null before. */
      xray: XrayView | null
      /** The terminal's settings menu: "list", or the setting whose options it shows. */
      menu: string
      /** The key of what the terminal settings menu's ring is on: a row, or an option of the setting open; null at first. */
      menuFocus: string | null
    }
  }
}
