import { atom, read, update } from 'claude-code'
import type {
  ElementTable,
  EngineInterface,
  ModelUsage,
  PromptOrigin,
  Register,
  RenderElement,
  RenderSurface,
  SelectOption,
  SessionContextBreakdown,
  SessionMessage,
  Timer,
  ToolUseSummary,
  TurnStepChunk,
  TurnStepInput,
  TurnStepResult,
} from 'claude-code'

import type {
  BoundKeys,
  EndLine,
  LastPrompt,
  MeterReading,
  Note,
  NotesView,
  OwnRequest,
  QueuedAction,
  RoutedTurn,
  SetupView,
  Spend,
  StoredSettings,
  Suggestion,
  XrayPart,
  XrayView,
} from '../types'

// The companion: the person's one Claude Code mod, the home of every small helper around the prompt.
//
// Last prompt: the person's most recent prompt above the chat box, in the band directly above the prompt
// (AbovePrompt) on the terminal, the desktop app and VS Code. A surface that attaches without the band (the mobile
// app) gets a small pane instead, opened at the first prompt; /last-prompt opens it again after the person closed it.
//
// Next message: one model call after each main-thread turn that answered (Sonnet 5.5 by default, Haiku when it gives
// no answer) reads the person's last prompt and the end of the reply, and offers the messages the person might send
// next, the likeliest first. The band shows them as choices under the last prompt; clicking one sends it as the
// person's own words, or puts it in the prompt box to edit. The likeliest is also offered dim in the prompt box where
// the box shows suggestions (the terminal), Tab to take; VS Code 2.1.300 shows none there.
//
// Task routing, in three modes: Sonnet 5.5 grades each new task of the person's easy, mid or hard. Suggest, the default
// since 0.12.0, changes nothing: the turn runs on the session's own model and effort, the grade is asked in the
// background, and when the grade names another model than the one running, up for a hard task or down for an easy one,
// the band offers one button that stops the answer and asks the prompt again there, or once the answer is in and the
// pick is cheaper, sends the task's follow-ups there. Automatic sends the task's requests with that grade's model and effort (Haiku
// 5.5 low, Sonnet 5.5 medium and Opus 5.5 max unless picked otherwise), at any length of conversation, and the band
// says what each turn runs on, with a link that asks the prompt again as usual where it ran on something else. Off does
// neither. A reply or a short follow-up keeps the running task's grade with no call, and rules grade a task the model
// gives no answer for.
//
// The look, after Apple's developer pages and quiet note apps: the last prompt as a quote, secondary text dimmed, the
// choices as quiet buttons with a ↳, and a type scale for the rest. VS Code and the desktop app draw every Button in
// their own chrome, so the choices ask for the secondary one (dark in VS Code) rather than the filled one. Colours are
// theme keys, so a dark theme and a light one each draw it in their own.
//
// The terminal reports no pointer outside fullscreen, so everything there works from the keys, the way Claude Code's
// own surveys and menus do: the choices are numbered and a number typed into the empty prompt box picks one (0 asks
// again as usual), and the settings are a menu that takes the keys as it opens, a row per setting.
//
// Settings: suggestions on or off, the model, its effort, how many choices, what a pick does. /companion, or the ⋯ in
// the band, opens a settings pane; each pick goes to this mod's own store ($.store), kept across sessions and read
// afresh wherever a setting is used, so other open sessions take it at their next answer. (plugin.json userConfig
// was tried: an SDK host such as VS Code lists no /config row for it, so $.config.set cannot write it there.)
//
// A host that attaches no surface (VS Code up to 2.1.296, another SDK host) draws no mod UI at all. There the choices
// are the text a turn.complete hook answers, which the engine shows as a notice line beneath the answer,
// /last-prompt answers in the transcript, and /copy-next copies one through the machine's clipboard.

const PANE = 'last-prompt'
const PANE_TITLE = 'Last & next prompt'
const SETTINGS_PANE = 'companion-settings'
const SETTINGS_TITLE = 'Companion settings'
const SETTINGS_KEY = 'settings' // in $.store
const NOTES_PANE = 'companion-notes'
const NOTES_TITLE = 'Notes'
const NOTES_KEY = 'notes' // in $.store: every project's notes, each carrying the folder it was kept in
const NOTES_MAX = 50 // per project
const NOTE_MAX_CHARS = 500
const NOTES_ROWS = 15 // the terminal pane's least rows: the title, nine one-row notes, the remove and clear rows, a line each side
const NOTES_SHOWN = 9 // one digit key each
const PANE_SIDES = 4 // what an inline pane's sides take of the terminal's width
const GUESS_COLUMNS = 100 // the terminal's width before it has drawn the line under the prompt box
const NOTES_KEYS = 'a number puts a note in the prompt box · x removes one · 0 clears all · Esc closes'
const NOTES_LIST: NotesView = { kind: 'list' }
const REMOVE_VIEW: NotesView = { kind: 'remove' }
const CLEAR_VIEW: NotesView = { kind: 'clear' }
const REMOVE_KEYS = 'a number removes that note · n back to your notes · Esc closes'
// The band's "Notes" key on the terminal, which opens them: past the five choices a band can offer and the 0 of a
// model switch. What was copied is kept by /note, or a key the person binds to it.
const NOTE_KEY = '9'
const NOTES_KEY_LABEL = 'View notes'
// The band's "Copy answer" key on the terminal, before the queue's and the notes': Claude's last answer as written,
// Markdown and all, with no picker in between (Claude Code's own /copy asks which block when there is code).
const COPY_KEY = '7'
const COPY_LABEL = 'Copy answer'
// What /notes export writes, at the project's root unless another file is named; the mark on its first line says the
// export may write it again, so a file of that name somebody wrote by hand is never overwritten.
const NOTES_FILE = 'NOTES.md'
const NOTES_FILE_MARK = '<!-- Written by Companion’s /notes export; the next export writes it again. -->'
const COPY_MIN_CHARS = 4 // copied text shorter than this is never kept as a note
const PICK_TITLE = 'Keep from this answer'
const PICK_KEYS = 'a number keeps a line, again drops it · m more · n your notes · Esc closes'
const PICK_EMPTY = 'Nothing here to keep line by line. Select the words instead, or /note <text>.'
const PICK_PAGE = 9 // lines on a page of the picker: one digit key each, as NOTES_ROWS has room for
const PICK_MAX = 45 // lines offered from one answer
const PICK_MIN_CHARS = 12 // a shorter fragment is not offered as a line
const ANSWERS_KEPT = 20 // the completed answers a "Add note" can go under
const NOTE_BUTTON_LABEL = 'Add note'
const READING_COPY = 'Reading what you copied…'
const NOTE_BUTTON_NOTE =
  'The band’s 7 copies the last answer, 8 opens your queue and 9 your notes. /queue and /note, or keys you bind to them such as Alt+Q and Alt+N, queue or keep what you copied from an answer. In fullscreen, "Add note" also goes under each answer.'
const QUEUE_KEY = 'queue' // in $.store: every project's queued actions, each carrying the folder it was queued in
const QUEUE_MAX = 20 // per project
const QUEUE_MAX_CHARS = 1000
// The band's "Queue" key on the terminal, before "Notes": 8 opens the queue, as 9 opens the notes. What was copied is
// queued by /queue, or a key the person binds to it.
const QUEUE_HOTKEY = '8'
const QUEUE_BUTTON_LABEL = 'View queue'
const QUEUE_NOTHING = 'Nothing to queue: copy words from one of Claude’s answers first.'
const KEYS_GAP = 2 // the columns between two keys, and before the first
// Each turn's end line, where the terminal draws it, carries what a fitted turn ran on: the engine's own words keep
// about this many columns of the line, the rest is the fit's.
const END_LINE_COLUMNS = 46
const ENDS_KEPT = 20 // the end lines remembered, the last turns'
const MIN_END_COLUMNS = 12 // narrower than this, the fit's words stay off the end line
const LABELS_JOIN = ' & ' // how the footer joins its labels
const FOOTER_GAP = 2 // the columns between two meters
// A meter in the footer: its label, five cells filled as far as it is used, and its percent, in the theme's success,
// warning or error colour as it fills.
const METER_CELLS = 5
const METER_FULL = '▰'
const METER_EMPTY = '▱'
// A turn's cache share on its end line: from this much read from the cache it is good, from CACHE_FAIR fair.
const CACHE_GOOD = 80
const CACHE_FAIR = 50
const FOOTER_GAP_COLUMNS = 6 // between the hint lines and the footer's labels, with room for a short label of the engine's
const MIN_TIPS_COLUMNS = 20
// The meters: the footer's context and week labels, the line under the prompt once the context is past NUDGE_PERCENT or
// the cache has likely gone cold, each turn's cost on its end line, and a compaction at a fill the settings pick.
const NUDGE_PERCENT = 60 // past this fill the line under the prompt says what each message re-sends
const TOAST_PERCENT = 80 // past this fill a toast says so too, once until the fill drops under NUDGE_PERCENT
const WEEK_KIND = 'seven_day' // the rate-limit window the footer's week label reads
const WEEK_RESET_PERCENT = 80 // from this much of the week used, its label says when the week resets
const COLD_MIN_TOKENS = 20_000 // a smaller conversation read again uncached costs too little to warn of
const OFF = 'off'
const METERS_NOTE =
  'The footer shows how full the context is and how much of the week is used; past 60% the line under the prompt says what each message sends again; each answer’s end line adds what it cost and how much came from the cache.'
const COLD_NOTE =
  'An idle conversation’s prompt cache expires, and the next message then reads it all again at full price; the line under the prompt says so. Its lifetime is not reported: 5 minutes is the cache’s default, 1 hour the longer one.'
const COMPACT_NOTE = 'Runs /compact on its own once an answer ends past this fill, before Claude Code’s own compaction near the end of the window.'
// The alert once a long answer ends: a notification through the person's own channel, the one Claude Code's own
// notifications use; on Windows, where a terminal has no channel, the system's notify sound instead.
const DONE_NOTE =
  'Once an answer that ran this long ends, a notification says so through the channel Claude Code’s own notifications use; on Windows with none, a sound plays.'
const DONE_TITLE = 'Claude is done'
const DONE_TEXT_CHARS = 120
const WINDOWS_DING = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '(New-Object Media.SoundPlayer "$env:WINDIR\\Media\\Windows Notify System Generic.wav").PlaySync()',
] as const
const DING_TIMEOUT_MS = 10_000
// /fresh: the conversation handed over to a cleared one. A model writes a short note of the task from the end of the
// conversation, the files it changed are named after it, /clear starts the conversation over, and the note waits in
// the prompt box, to edit or send.
const HANDOFF_SYSTEM = [
  'You write the note that starts a fresh Claude Code conversation where an earlier one left off, so nothing has to be explained again.',
  'Write four lines, plain text, no markdown, at most 120 words in all:',
  'Task: what the person is doing; add the reason only where the conversation gives one, and never remark that it gives none.',
  'Done: what is finished.',
  'Next: the next concrete step.',
  'Notes: decisions, constraints and open questions that still matter; "none" where there are none.',
  'Use the names the conversation uses for files, commands and things. Never add anything the conversation does not say.',
].join('\n')
const HANDOFF_LEAD = 'Picking up from an earlier conversation, cleared to save tokens:'
const HANDOFF_MAX_TOKENS = 2048 // its thinking counts against the cap
const HANDOFF_TIMEOUT_MS = 60_000
const HANDOFF_DIGEST_CHARS = 12_000 // the end of the conversation the note is written from
const HANDOFF_MESSAGE_CHARS = 1_200 // of each message
const HANDOFF_FILES = 10 // the files changed named at most, the latest
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// /clear starts the session's state over, and no session.start follows it: what the band, the hint lines and the
// footer draw from is read again this long after, once the new conversation stands.
const CLEAR_RELOAD_MS = 250
// /ctx: the context X-ray, a pane of what fills the window, each category a bar in its /context colour, then the
// biggest tool outputs, the MCP servers' tool lists and the memory files, and one tip on what to cut first.
const XRAY_PANE = 'companion-xray'
const XRAY_TITLE = 'Context X-ray'
const XRAY_KEYS = 'Esc closes'
const XRAY_CELLS = 10
const XRAY_LABEL_COLUMNS = 22
const XRAY_PARTS = 3 // the biggest of each list shown
const XRAY_CHROME = 7 // the pane's rows besides its category rows: the title, the three lists, the tip, one each side
const CHARS_PER_TOKEN = 4 // a tool output's size in tokens, estimated from its characters
const XRAY_MIN_OUTPUT = 1_000 // tokens: a smaller tool output is not worth naming
const MCP_HEAVY = 0.1 // of the window: past this the MCP tool lists are what to cut first
const MEMORY_HEAVY = 0.05 // of the window, for the memory files
const CONVERSATION_HEAVY = 40 // percent full: past this the conversation is
// /companion-setup: a pane that turns on what Companion's clicks and keys need, step by step, nothing without a press.
const SETUP_PANE = 'companion-setup'
const SETUP_TITLE = 'Companion setup'
const SETUP_ROWS = 9 // the title, the two steps, Apply, a line each side, and room to spare
const SETUP_KEYS_HINT = '↑↓ to move · Enter ticks · a applies · Esc closes'
const SETUP_STORE_KEY = 'setup' // in $.store: { done: true } once the setup was opened
const SETUP_NUDGE = 'new here? /companion-setup'
const QUEUE_ROW_COLUMNS = 13 // the pane's sides and padding, and " next" and " ✕", around an action's row
// The list 8 opens where nothing new was copied: a pane that takes the keys, no numbers, the ring on an action.
const QUEUE_PANE = 'companion-queue'
const QUEUE_TITLE = 'Queue'
const QUEUE_LIST_KEYS = '↑↓ to pick · Enter takes it · t to the top · x takes it off · Esc closes'
const QUEUE_PANE_CHROME = 5 // the pane's rows besides its actions: the keys line, the t and x row, a line each side, one spare
const BASE64_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CLIPBOARD_TIMEOUT_MS = 15000
const LAST_LABEL = 'Last: '
const NEXT_LABEL = 'Next: '
const NONE_YET = '(none yet)'
const BUTTON_CHROME = 4 // "[ " and " ]" around a label
const MORE_COLUMNS = 2 // " ⋯" after the last prompt
const QUOTE_COLUMNS = 2 // the quote bar before the last prompt, and the space after it
// The look: theme keys, which every theme draws in its own colours. One accent marks what can be pressed; the quote
// bar takes the prompt box's own border colour, so the last prompt reads as the person's words.
const ACCENT = 'suggestion'
const QUOTE_COLOR = 'promptBorder'
const QUOTE_BAR = '▎' // before the last prompt in the terminal's band
const CHEVRON = ' ›'
const MORE = '⋯' // opens the settings: a text glyph, where ⚙ turns into a colour emoji on some systems
const SUGGESTED = 'Suggested'
const MARKER = '↳' // before each choice: down then right, a reply to the answer above
// Outside the terminal, the redo is a link at the end of a Markdown line, which the plugin answers itself. A surface
// draws only https links as links, so it points at the documentation of what it stands for, a page worth landing on
// should a modified click open it.
const DOCS_URL = 'https://github.com/alvaris924/claude-companion/blob/main/docs/index.md'
export const REDO_HREF = `${DOCS_URL}?redo=1#the-model-and-effort-for-each-task`
const SUGGEST_NOTE = 'Written after each answer by the model above, as part of your plan’s usage.'
const ROUTE_NOTE =
  'A model grades each new task, as part of your plan’s usage. Suggest changes nothing and offers a button to switch ' +
  'when another model would fit; Automatic runs the task on its grade’s model and effort. Each model keeps the ' +
  'mode you pick while the session runs on it. A switch makes the new model read the conversation once without its cache.'
// The terminal's keys, said the way Claude Code's own dialogs say theirs.
const MENU_KEYS = '↑↓ to move · Enter to change · Esc to close'
const OPTION_KEYS = '↑↓ to move · Enter or its number to pick · Esc to close'
const BAND_FOCUS_HINT = 'ctrl+x tab, then ↑↓ and Enter to pick'
const HOTKEY_COLUMNS = 3 // "1: " before a numbered choice
const MENU_LABEL_COLUMNS = 24
const MENU_ROWS = 31 // the menu's rows, its longest view's, asked of the terminal as the pane opens
const PROMPT_NOTE = 'VS Code already pins your prompt above its answer, so the band there leaves it out unless this is on. The terminal always shows it.'
const SAVED_NOTE = 'Saved for every session; other open sessions take a change at their next turn.'
const LAST_MAX_CHARS = 160 // about two lines where the surface wraps the last prompt
const PANE_MAX_CHARS = 600
const CHOICE_MAX_CHARS = 200
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five']

// Sonnet 5.5 by default since 2026-10-19: Fable 5.1 writes the best choices but costs 100x Haiku per token, too much
// to spend on every answer of a new install. Every model stays one pick away in the settings, and a model already
// picked there is kept. When the chosen model gives no answer (a safety refusal, an API error, the timeout) Haiku is
// asked instead, so the choices still come.
const DEFAULT_MODEL = 'claude-sonnet-5-5'
const FALLBACK_MODEL = 'claude-haiku-5-5'
const SUGGEST_MAX_TOKENS = 2048 // the current models always think, and their thinking counts against the cap
const SUGGEST_TIMEOUT_MS = 45000
const SUGGEST_PROMPT_CHARS = 1500
const SUGGEST_REPLY_CHARS = 6000
// The first line's rules were tuned 2026-10-09 against 34 real turns of this person's sessions (12 held out): the
// earlier wording wrote as Claude about a third of the time ("Should I commit?"); Sonnet scored no better and leaked
// its reasoning. Several choices since 2026-10-16: the lines after the first are alternatives the person picks from.
const SUGGEST_ROLE =
  'You write the next message a developer will send to Claude Code, their AI coding assistant. You write AS the ' +
  'developer, TO Claude. '
// A line that talks about the exchange instead of being a message ("The reply asks...", "Here are three...").
const META_LINE = /^(reply\b|i'd go with\b|here (are|is)\b)|\bthe (reply|developer|person)\b/i
// A list marker the model put in front of a line despite being told not to: "1.", "2)", "-", "•".
const LIST_MARKER = /^\s*(?:[-*•]|\d+[.):])\s+/
// A block a host wraps around what the person typed (Claude in Chrome's <browser_instruction>, an editor's
// <ide_selection>, a <system-reminder>): a machine-style tag name in snake_case or kebab-case, opened and closed.
const INJECTED_BLOCK = /<([a-z][a-z0-9]*(?:[_-][a-z0-9]+)+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi
// A pasted image's marker in the prompt text: its file path is no part of what the person said.
const IMAGE_MARKER = /\[Image(?:: source: [^\]]*)?\]/g
const IMAGE_NOTE = '[image]' // what an image's marker becomes in the words kept of a prompt
// The form the model is shown, one reply ending per example, its likeliest next messages first.
const EXAMPLES: readonly { end: string; lines: readonly string[] }[] = [
  {
    end: 'Want me to open the PR into dev?',
    lines: ['Yes, open the PR into dev', 'Show me the diff first', 'Run the tests before opening it', 'Open it as a draft PR', 'Not yet, finish the review first'],
  },
  {
    end: 'A is quicker, B is safer; I\'d pick B.',
    lines: ['Go with B', 'Go with A', 'How much longer does B take?', 'What could B break?', 'Do A now and B later'],
  },
  {
    end: 'Next I\'ll write the design doc and start the engine.',
    lines: ['Go ahead', 'Write the doc, then stop for my review', 'Skip the doc and start the engine', 'Show me the plan first', 'What goes in the doc?'],
  },
  {
    end: 'Fixed and compiled; not tested yet.',
    lines: ['Run the tests and show me the results', 'Show me the diff', 'Commit it', 'Explain what caused it', 'Check for the same bug elsewhere'],
  },
]

// Task routing: Sonnet 5.5 grades each new task easy, mid or hard (picked 2026-10-21 over Haiku for its judgment on the
// borderline ones, at a second or two before the answer starts), and the task's requests go with the model and effort
// its grade's picker names. Rules grade a task the model gives no answer for. The grading reads the new request with
// the one before it and the end of the last answer, so a "yes, do it" is graded as the work it takes up.
const GRADE_MODEL = 'claude-sonnet-5-5'
const GRADE_EFFORT = 'low'
const GRADE_MAX_TOKENS = 2048 // its thinking counts against the cap
const GRADE_TIMEOUT_MS = 8000
// With two calls, how long the second may take once the first has answered: a call that hangs costs the task this much
// at most, not the whole timeout.
const GRADE_GRACE_MS = 2500
const GRADE_PROMPT_CHARS = 1500
const GRADE_BEFORE_CHARS = 500
const GRADE_REPLY_CHARS = 1500
const GRADE_SYSTEM =
  "You grade how much thinking a developer's request to Claude Code, their AI coding assistant, needs, so that it " +
  'runs on a model that fits. Answer with one word: easy, mid or hard.\n' +
  'easy: only a question, a lookup, a status check or a short explanation, with nothing to change or run.\n' +
  'mid: everyday work, and any request to change or run something: edit files, tweak a value, run commands, commit, ' +
  'merge, deploy, check the state of a repository or machine, a bug with a clear cause, a small feature, a change ' +
  'across a few files, tests for existing code, a doc page, a focused review.\n' +
  'hard: work that needs planning or deep reasoning: a feature across many files, a refactor or a migration, a bug ' +
  'with an unclear cause, performance, concurrency or security work, an architecture or design decision.\n' +
  'A reply that takes up what Claude offered ("yes", "do it", "go with B") is as hard as the work it takes up. ' +
  'Lean hard: a wrong easy or mid grade gets a weaker model and a worse result, while a wrong hard grade only costs ' +
  'more. If the request could reasonably need hard-level reasoning, or you are unsure between mid and hard, answer ' +
  'hard; if you are unsure between easy and mid, answer mid.'
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
// A first-party id of a current Claude model: what a task may move from. A session on an id the plugin cannot read (a
// provider's own spelling, a family it does not know) keeps its model and effort, and no grading is asked.
const FIRST_PARTY = /^claude-(?:haiku|sonnet|opus|fable)-\d/
// Caches belong to one model, and a change of effort makes the API read the conversation uncached once too, so each
// switch costs one uncached read of the conversation, more as it grows. Switching at any length was chosen 2026-10-21
// all the same: under the 100K-token line used until then, almost no task of a long session ever switched.
// Words that start substantial work: building code, reshaping it, moving it, or taking on all of it.
const HARD_WORK =
  /\b(?:implement(?:s|ed|ing)?|refactor(?:s|ed|ing)?|re-?architect(?:s|ed|ing)?|migrat(?:e|es|ed|ing)|redesign(?:s|ed|ing)?|rewrit(?:e|es|ing|ten)|rewrote|overhaul(?:s|ed|ing)?|scaffold(?:s|ed|ing)?|from scratch|(?:whole|entire) (?:code ?base|repo(?:sitory)?|project|app))\b/i
// Lead-ins that soften a request without changing it: "ok", "please", "can you", "let's".
const SOFT_LEAD = /^(?:(?:ok(?:ay)?|so|and|also|now|hey|please|pls|can you|could you|would you|will you|can we|could we|let'?s)\b[\s,:]*)+/i
// What a question or a request to explain leads with: a question word, or a verb that asks for words, not work.
const QUESTION_LEAD = /^(?:what|what's|whats|how|where|which|when|who|whose|explain|summari[sz]e|describe|define|list|remind me|tell me|show me)\b/i
// A yes-or-no question leads with one of these and ends with "?": "does it handle tabs?" ("do the release" is work).
const YES_NO_LEAD = /^(?:is|are|was|were|does|do|did|has|have|should|would|could|can|will)\b/i
// A proposal, or a change being weighed ("how about ...", "what if ...", "should we ..."): no easy task, whatever
// question it leads with.
const PROPOSAL =
  /^(?:how (?:about|bout)|what (?:about|if))\b|\b(?:should|shall) (?:we|i|it|there|this|that|they|the|have|be)\b|\bwould it be (?:better|worth)\b/i
// Signs of something broken: a question about it asks for debugging, which is no easy task.
const DEBUG_SIGNS =
  /\b(?:errors?|exceptions?|traceback|stack ?trace|fail(?:s|ed|ing|ure)?|broken|bugs?|crash(?:es|ed|ing)?|regression|flaky|wrong|(?:not|doesn'?t|does not|won'?t|can'?t) work(?:ing)?)\b/i
// A file or a path the prompt names: "src/a.ts", "README.md".
const PATH_LIKE =
  /(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|ya?ml|toml|css|scss|html|sql|txt|xml|vue|svelte|lock)\b/gi
const EASY_MAX_WORDS = 25
const HARD_MIN_WORDS = 250
const HARD_MIN_PATHS = 4
// A reply this short ("why?", "go on", "and the tests?") continues the running task with no grading. A longer prompt
// is graded, a short question or a follow-up to hard work included: the grading reads the request before it and the
// end of the answer, so a follow-up that is hard work stays hard there. Six words until the grading came, which kept
// short new questions on the task before them.
const REPLY_MAX_WORDS = 3
// What a reply may lead with before it says what it wants: a yes, an "ok", a "please", a "let's".
const REPLY_LEAD =
  /^(?:(?:yes|yep|yeah|yup|sure|ok(?:ay)?|alright|all right|great|cool|nice|perfect|good|fine|done|so|and|also|now|then|hey|please|pls|just|can you|could you|would you|will you|can we|could we|let'?s)\b[\s,.!:;]*)+/i
// Experimental since 0.12.0: a short message used to continue the running task on word count alone, which read an
// unrelated short message, "how are you" among them, as a reply and never graded it. Stripped of a leading
// acknowledgement, what is left must still lean on the last answer, not stand on its own.
const ACK_LEAD =
  /^(?:(?:yes|yep|yeah|yup|sure|ok(?:ay)?|alright|all right|great|cool|nice|perfect|good|fine|done|thanks|thank you|thx|well|hmm)\b[\s,.!:;]*)+/i
const CONTINUES =
  /^(?:but\s+|and\s+|so\s+|also\s+|why\b|how come\b|how so\b|what about\b|go on\b|go ahead\b|keep going\b|continue\b|makes sense\b|sounds good\b|got it\b)/i
// Past that, an order leads with a verb that changes or runs something, or with a go-ahead: after an easy question it
// is work of its own, not part of the question.
const ORDER_LEAD =
  /^(?:(?:add|fix|change|make|update|remove|delete|drop|rename|move|create|write|edit|build|run|test|try|check|commit|push|merge|squash|open|close|apply|revert|undo|deploy|ship|release|install|uninstall|set|turn|enable|disable|replace|bump|restore|keep|use|pr|proceed|continue|start|finish)\b|do (?:it|that|this|both|all|them|so)\b|go(?: ahead\b| for\b|[.!]*$))/i
// A yes takes up what the answer offered, which is work too, unless it comes with a question of its own.
const YES = /^(?:yes|yep|yeah|yup|sure)\b/i

/** What the grade of a task does: Suggest offers a switch and changes nothing, Automatic switches, Off does neither. */
type FitMode = 'suggest' | 'auto' | 'off'

const MODEL_FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'] as const
/** A family of models, weakest first: the mode of fitting is kept for each. */
type ModelFamily = (typeof MODEL_FAMILIES)[number]

/** The settings the pane changes; stored as their pickers' values (`choices` as text, the switches as booleans). */
type Settings = {
  suggest: boolean
  model: string
  effort: 'low' | 'medium' | 'high'
  choices: number
  onPress: 'send' | 'box'
  /** Whether a number typed into the terminal's empty prompt box picks that choice. */
  numberKeys: boolean
  /** Whether the band outside the terminal shows the last prompt, which VS Code already pins above its answer. */
  lastPrompt: boolean
  /** Whether "Add note" sits under each answer in the fullscreen terminal. */
  noteButton: boolean
  /** How each task's model and effort follow its grade: suggested (a button), switched on its own, or left alone. */
  fit: FitMode
  /** The mode picked while the session ran on each family, which `fit` stands in for where none was. */
  fitByModel: Partial<Record<ModelFamily, FitMode>>
  /** Each grade's model and effort, as "model:effort", or OWN_ROUTE for the session's own. */
  easy: string
  mid: string
  hard: string
  /** The conversation size, in tokens, past which only hard tasks switch; NO_LIMIT for none. */
  limit: string
  /** How many times a new task is graded: GRADE_ONCE, or GRADE_TWICE to keep the harder of two grades. */
  grading: string
  /** The model that grades new tasks, at low effort. */
  grader: string
  /** Whether the meters show: the footer's context and week, the context tip past NUDGE_PERCENT, each turn's cost. */
  meters: boolean
  /** The minutes idle after which the cache has likely gone cold, as text; OFF for no warning. */
  coldAfter: string
  /** The context's fill, in percent as text, past which an answer's end compacts the conversation; OFF for never. */
  compactAt: string
  /** The seconds an answer runs, as text, from which its end raises an alert; OFF for none. */
  doneAfter: string
}

const MODELS: readonly SelectOption[] = [
  { value: 'claude-fable-5-1', label: 'Fable 5.1: best picks, most of your plan' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5: the default' },
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5: fastest, least of your plan' },
]
const EFFORTS: readonly SelectOption[] = [
  { value: 'low', label: 'Low: quick' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High: slower, uses more' },
]
const CHOICE_COUNTS: readonly SelectOption[] = ['1', '2', '3', '4', '5'].map(value => ({ value }))
const PRESS_ACTIONS: readonly SelectOption[] = [
  { value: 'send', label: 'Sends it as my message' },
  { value: 'box', label: 'Puts it in the box to edit' },
]
const ON_OFF: readonly SelectOption[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]
// Suggest is the default since 0.12.0 (2026-10-22): the model's grade never changes a task's model on its own.
const FIT_MODES: readonly SelectOption[] = [
  { value: 'suggest', label: 'Suggest: you press to switch' },
  { value: 'auto', label: 'Automatic: switches on its own' },
  { value: 'off', label: 'Off' },
]
const DEFAULT_FIT: FitMode = 'suggest'
// What a grade's task runs on: a model at an effort, or the session's own.
const OWN_ROUTE = 'own'
const TIER_ROUTES: readonly SelectOption[] = [
  { value: 'claude-haiku-5-5:low', label: 'Haiku 5.5 at low effort' },
  { value: 'claude-haiku-5-5:medium', label: 'Haiku 5.5 at medium effort' },
  { value: 'claude-sonnet-5-5:low', label: 'Sonnet 5.5 at low effort' },
  { value: 'claude-sonnet-5-5:medium', label: 'Sonnet 5.5 at medium effort' },
  { value: 'claude-sonnet-5-5:high', label: 'Sonnet 5.5 at high effort' },
  { value: 'claude-opus-5-5:medium', label: 'Opus 5.5 at medium effort' },
  { value: 'claude-opus-5-5:high', label: 'Opus 5.5 at high effort' },
  { value: 'claude-opus-5-5:max', label: 'Opus 5.5 at max effort' },
  { value: 'claude-fable-5-1:high', label: 'Fable 5.1 at high effort' },
  { value: 'claude-fable-5-1:max', label: 'Fable 5.1 at max effort' },
  { value: OWN_ROUTE, label: 'My model and effort' },
]
// Haiku, Sonnet and Opus at a rising effort, picked 2026-10-21.
const DEFAULT_ROUTES = { easy: 'claude-haiku-5-5:low', mid: 'claude-sonnet-5-5:medium', hard: 'claude-opus-5-5:max' } as const
// Past this size of conversation only hard tasks switch, since each switch reads the conversation once uncached.
const NO_LIMIT = 'none'
const LIMITS: readonly SelectOption[] = [
  { value: NO_LIMIT, label: 'No limit' },
  { value: '100000', label: '100,000 tokens' },
  { value: '200000', label: '200,000 tokens' },
  { value: '400000', label: '400,000 tokens' },
]
const COLD_AFTERS: readonly SelectOption[] = [
  { value: OFF, label: 'Off' },
  { value: '5', label: '5 minutes: the cache’s default lifetime' },
  { value: '60', label: '1 hour: the longer lifetime' },
]
const COMPACT_ATS: readonly SelectOption[] = [
  { value: OFF, label: 'Off' },
  { value: '70', label: 'At 70% full' },
  { value: '80', label: 'At 80% full' },
  { value: '90', label: 'At 90% full' },
]
const DONE_AFTERS: readonly SelectOption[] = [
  { value: OFF, label: 'Off' },
  { value: '30', label: 'Answers over 30 seconds' },
  { value: '60', label: 'Answers over 1 minute' },
  { value: '300', label: 'Answers over 5 minutes' },
]
const GRADE_ONCE = 'one'
const GRADE_TWICE = 'two'
const GRADINGS: readonly SelectOption[] = [
  { value: GRADE_ONCE, label: 'One call' },
  { value: GRADE_TWICE, label: 'Two calls, keep the harder grade' },
]
// A grade as the band names it.
const GRADE_NAMES = { easy: 'Easy', mid: 'Mid', hard: 'Hard' } as const

const last = atom({ plugin: 'companion', key: 'last' } as const, null)
const suggested = atom({ plugin: 'companion', key: 'next' } as const, null)
const paneClosed = atom({ plugin: 'companion', key: 'paneClosed' } as const, false)
const savedSettings = atom({ plugin: 'companion', key: 'settings' } as const, null)
const routed = atom({ plugin: 'companion', key: 'routed' } as const, null)
const own = atom({ plugin: 'companion', key: 'own' } as const, null)
const sessionModel = atom({ plugin: 'companion', key: 'sessionModel' } as const, null)
const notesHere = atom({ plugin: 'companion', key: 'notes' } as const, [])
const notesView = atom({ plugin: 'companion', key: 'notesView' } as const, NOTES_LIST)
const answersDone = atom({ plugin: 'companion', key: 'answers' } as const, [])
const queueHere = atom({ plugin: 'companion', key: 'queue' } as const, [])
const queueFocus = atom({ plugin: 'companion', key: 'queueFocus' } as const, null)
const queueCopied = atom({ plugin: 'companion', key: 'queueCopied' } as const, null)
const boundKeys = atom({ plugin: 'companion', key: 'keys' } as const, { queue: null, note: null })
const setupView = atom({ plugin: 'companion', key: 'setup' } as const, { fullscreen: true, keys: true, isFullscreen: false })
const setupDone = atom({ plugin: 'companion', key: 'setupDone' } as const, false)
const endLines = atom({ plugin: 'companion', key: 'ends' } as const, [])
const meter = atom({ plugin: 'companion', key: 'meter' } as const, { percent: null, tokens: null, week: null })
const isColdNow = atom({ plugin: 'companion', key: 'isCold' } as const, false)
const xrayView = atom({ plugin: 'companion', key: 'xray' } as const, null)
// The terminal's settings menu: the list, or the options of the setting it names; and the element the ring is on.
const MENU_LIST = 'list'
const menuView = atom({ plugin: 'companion', key: 'menu' } as const, MENU_LIST)
const menuFocus = atom({ plugin: 'companion', key: 'menuFocus' } as const, null)

// Prompts the machine sends on its own. Every other origin (the composer, the bridge, the SDK host,
// an unclassified channel such as an editor extension) is the person typing.
const MACHINE_ORIGINS: ReadonlySet<PromptOrigin['kind']> = new Set<PromptOrigin['kind']>([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'channel',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
  'slack-ping',
  'plugin',
])

// The surfaces that raise the AbovePrompt band.
const BAND_SURFACES: ReadonlySet<string> = new Set(['terminal', 'desktop', 'vscode'])

// Moves on at every prompt of the person's: a suggestion asked before it moved is stale.
let epoch = 0
// The settings in force, as last read from the store (or picked in the pane).
let settings: Settings = settingsFrom({})

/** How much a task asks of the model: its grade. */
export type TaskLevel = 'easy' | 'mid' | 'hard'
/** What the grading reads: the request that starts a task, the one before it, and the end of the last answer. */
export type ToGrade = { prompt: string; before: string; reply: string }
/**
 * The running task: its grade (the rules' until the model's comes), what the model is still to grade, whether it was
 * asked again as usual, which keeps its turns on the session's own model and effort, and whether the person switched it
 * to its grade's model and effort, which keeps its turns there as Automatic would.
 */
type Task = { level: TaskLevel; toGrade?: ToGrade; asUsual?: boolean; isSwitched?: boolean }
/** What the settings give each grade. */
type Routes = Pick<Settings, 'easy' | 'mid' | 'hard' | 'limit' | 'grading' | 'grader'>
/** What a turn is fitted by: the routes, and whether the grade only suggests a switch or makes it. */
type TurnRoutes = Routes & { fit: Exclude<FitMode, 'off'> }
/** The model and effort a fitted turn's requests go with, beside the session's own that its first request named. */
type Plan = {
  level: TaskLevel
  model: string
  effort: TurnStepInput['effort']
  ownModel: string
  ownEffort: TurnStepInput['effort']
  /** Whether the conversation was past the limit, so the grade's pick was left unused. */
  isKept: boolean
}
/** A main-loop turn the settings fit: its task, the routes, and its plan once its first request decided one. */
type FittedTurn = { task: Task; routes: TurnRoutes; plan?: Plan | null }
/**
 * What the next turn takes from the prompt that starts it: its task (the rules' grade, whether a task starts, what the
 * model grades, whether it was asked again as usual, and whether the person switched it), or nothing (a command, a
 * program).
 */
type Pending =
  | { kind: 'task'; level: TaskLevel; isNew: boolean; toGrade: ToGrade; asUsual?: boolean; isSwitched?: boolean }
  | { kind: 'skip' }

// The task the person is on, and what their last prompt asked of the next turn; undefined continues the task.
let task: Task | null = null
let pending: Pending | undefined
// The main-loop turns being fitted, by turn id, until they complete.
const fitted = new Map<string, FittedTurn>()
// The main loop's running turn, whatever the settings: what a switch stops to ask the prompt again.
let runningTurn: string | undefined
// The main-loop turns the person sent another message during: their answers get no choices, the next message being in.
const movedOn = new Set<string>()
// The last main-loop turns that ended, by turn id, with their length: a grade that lands after its turn's end still
// reaches that turn's end line.
const endedTurns = new Map<string, number>()
// What the session had cost as each main-loop turn began, by turn id, until it ends: its own cost is what it adds.
const costAtStart = new Map<string, number>()
// The wait for the cache to go cold since the last answer ended; none while a turn runs.
let coldTimer: Timer | undefined
// The compaction at a picked fill: whether it may run (once a fill under it was seen, so a compaction that leaves the
// context past it does not run again and again), and whether one runs now.
let isCompactArmed = true
let isCompacting = false
// Whether the toast for a fill past TOAST_PERCENT was raised, until the fill drops under NUDGE_PERCENT.
let isFillToasted = false
// Set once a fitted request failed before it answered: the rest of the session's turns go as the engine makes them.
let isFitRefused = false
// The session's own model and effort as last written to state, so a turn writes them again only when they change.
let ownKey = ''
// The session's model as /model shows it, as last written to state; null until it is read.
let sessionModelKey: string | null = null
// The last main-loop answer, whose end the grading of the next task reads.
let lastReply = ''

/** `value` when it is one of `options`' values, else `fallback`. */
export function pick(value: unknown, options: readonly SelectOption[], fallback: string): string {
  return typeof value === 'string' && options.some(option => option.value === value) ? value : fallback
}

/** The settings from what the store holds, each value outside its picker's options taken as its default. */
export function settingsFrom(stored: Readonly<Record<string, unknown>>): Settings {
  return {
    suggest: typeof stored.suggest === 'boolean' ? stored.suggest : true,
    model: pick(stored.model, MODELS, DEFAULT_MODEL),
    effort: pick(stored.effort, EFFORTS, 'low') as Settings['effort'],
    choices: Number(pick(stored.choices, CHOICE_COUNTS, '3')),
    onPress: pick(stored.onPress, PRESS_ACTIONS, 'send') as Settings['onPress'],
    numberKeys: typeof stored.numberKeys === 'boolean' ? stored.numberKeys : true,
    lastPrompt: typeof stored.lastPrompt === 'boolean' ? stored.lastPrompt : false,
    noteButton: typeof stored.noteButton === 'boolean' ? stored.noteButton : true,
    // A store from before 0.12.0 holds the old switch: its "on" is Automatic, and its "off" stays off.
    fit: pick(stored.fit, FIT_MODES, typeof stored.route === 'boolean' ? (stored.route ? 'auto' : 'off') : DEFAULT_FIT) as FitMode,
    fitByModel: fitsFrom(stored.fitByModel),
    easy: pick(stored.easy, TIER_ROUTES, DEFAULT_ROUTES.easy),
    mid: pick(stored.mid, TIER_ROUTES, DEFAULT_ROUTES.mid),
    hard: pick(stored.hard, TIER_ROUTES, DEFAULT_ROUTES.hard),
    limit: pick(stored.limit, LIMITS, NO_LIMIT),
    grading: pick(stored.grading, GRADINGS, GRADE_ONCE),
    grader: pick(stored.grader, MODELS, GRADE_MODEL),
    meters: typeof stored.meters === 'boolean' ? stored.meters : true,
    coldAfter: pick(stored.coldAfter, COLD_AFTERS, '60'),
    compactAt: pick(stored.compactAt, COMPACT_ATS, OFF),
    doneAfter: pick(stored.doneAfter, DONE_AFTERS, '60'),
  }
}

/** The mode kept for each family, from what the store holds: a family or a mode it does not know is left out. */
function fitsFrom(stored: unknown): Settings['fitByModel'] {
  const fits: Settings['fitByModel'] = {}
  if (typeof stored !== 'object' || stored === null) return fits
  for (const family of MODEL_FAMILIES) {
    const mode = (stored as Record<string, unknown>)[family]
    if (typeof mode === 'string' && FIT_MODES.some(option => option.value === mode)) fits[family] = mode as FitMode
  }
  return fits
}

/** The family of a model however it is spelled ("claude-opus-5-5[1m]", "opus", "Opus 5.5"); null for one it cannot tell. */
export function familyOf(model: string | null): ModelFamily | null {
  if (model === null) return null
  const name = model.toLowerCase()
  return MODEL_FAMILIES.find(family => new RegExp(`(?:^|[^a-z])${family}(?:[^a-z]|$)`).test(name)) ?? null
}

/** The mode of fitting on a model: the one picked while the session ran on its family, else `fit`. */
export function fitFor(current: Pick<Settings, 'fit' | 'fitByModel'>, model: string | null): FitMode {
  const family = familyOf(model)
  return (family === null ? undefined : current.fitByModel[family]) ?? current.fit
}

/** The settings as the store keeps them; `route` is `fit` as the switch a session before 0.12.0 reads. */
export function storedOf(current: Settings): StoredSettings {
  return { ...current, choices: String(current.choices), route: current.fit === 'auto' }
}

/** The settings the store holds now, a pick in another session included; null where it cannot be read. */
export async function readSettings($: EngineInterface): Promise<Settings | null> {
  try {
    const stored = await $.store.get(SETTINGS_KEY)
    return settingsFrom(typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {})
  } catch {
    return null
  }
}

/** Takes the settings afresh from the store: in force, and in `$.state` for the settings pane to draw. */
export async function loadSettings($: EngineInterface): Promise<Settings> {
  settings = (await readSettings($)) ?? settings
  const stored = storedOf(settings)
  await update($, savedSettings, current => (JSON.stringify(current) === JSON.stringify(stored) ? current : stored))
  return settings
}

/** The label a picker shows for `value`. */
export function labelOf(options: readonly SelectOption[], value: string): string {
  return options.find(option => option.value === value)?.label ?? value
}

/** The limit in words: "switching at any length", or "easy and mid tasks switch up to 200,000 tokens". */
export function limitLine(current: Pick<Settings, 'limit'>): string {
  return current.limit === NO_LIMIT ? 'switching at any length' : `easy and mid tasks switch up to ${labelOf(LIMITS, current.limit)}`
}

/** The grading in words, when it is not the default: "two grading calls, the harder kept". */
export function gradingLine(current: Pick<Settings, 'grading' | 'grader'>): string | null {
  const parts = [current.grading === GRADE_TWICE ? 'two grading calls, the harder kept' : null, current.grader === GRADE_MODEL ? null : `${modelName(current.grader)} grades`]
  const named = parts.filter(part => part !== null)
  return named.length === 0 ? null : named.join('; ')
}

/** Each grade's pick in words: "easy tasks: Haiku 5.5 at low effort". */
export function tiersOf(current: Routes): string[] {
  return (['easy', 'mid', 'hard'] as const).map(level => `${level} tasks: ${labelOf(TIER_ROUTES, current[level])}`)
}

/**
 * What a mode of fitting is set to, in words: each grade's pick; Automatic adds the limit, since a switch of its own
 * reads the conversation uncached, and both add the grading when it is not the default.
 */
function fitDetails(current: Settings): string[] {
  const parts = [...tiersOf(current), current.fit === 'auto' ? limitLine(current) : null, gradingLine(current)]
  return parts.filter(part => part !== null)
}

/** The settings on one line of plain text, for a host that draws no pane; `current.fit` is the mode on the session's model. */
export function settingsLine(current: Settings): string {
  const names: Record<FitMode, string> = { suggest: 'suggest', auto: 'automatic', off: 'off' }
  const routing = current.fit === 'off' ? 'off' : `${names[current.fit]} (${fitDetails(current).join('; ')})`
  return (
    `Suggestions: ${current.suggest ? 'on' : 'off'} · Model: ${labelOf(MODELS, current.model)} · ` +
    `Effort: ${current.effort} · Choices: ${current.choices} · Clicking a choice: ${labelOf(PRESS_ACTIONS, current.onPress)} · ` +
    `Fit to the task: ${routing}`
  )
}

/** The suggestion settings in one line, as the mobile pane lists them: "On · Sonnet 5.5 · low effort · 3 choices". */
export function suggestionsLine(current: Settings): string {
  const choices = `${current.choices} ${current.choices === 1 ? 'choice' : 'choices'}`
  return [
    current.suggest ? 'On' : 'Off',
    modelName(current.model),
    `${current.effort} effort`,
    choices,
    labelOf(PRESS_ACTIONS, current.onPress),
  ].join(' · ')
}

/** The routing settings in one line, as the mobile pane lists them. */
export function routingLine(current: Settings): string {
  const name = current.fit === 'auto' ? 'Automatic' : current.fit === 'suggest' ? 'Suggest' : 'Off'
  return current.fit === 'off' ? name : [name, ...fitDetails(current)].join(' · ')
}

/** One line of at most `max` characters: whitespace runs (line breaks included) become one space. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1))}…` : flat
}

/** What the person typed, without the blocks a host wraps around it; an image's marker becomes "[image]". */
export function ownWords(text: string): string {
  return text.replace(INJECTED_BLOCK, ' ').replace(IMAGE_MARKER, IMAGE_NOTE).trim()
}

/** One line of the model's reply cut to a message: no list marker, quotes or "Next:" lead-in; empty when it is meta. */
export function cleanSuggestion(line: string): string {
  const bare = line
    .trim()
    .replace(LIST_MARKER, '')
    .replace(/^(next( message)?|suggest(ed|ion)( next)?( message)?|option \d)\s*:\s*/i, '')
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .trim()
  return META_LINE.test(bare) || bare.endsWith(':') ? '' : oneLine(bare, CHOICE_MAX_CHARS)
}

/** The model's reply cut to at most `count` different messages, in its order. */
export function cleanChoices(raw: string, count: number): string[] {
  const choices: string[] = []
  const seen = new Set<string>()
  for (const line of raw.split(/\r?\n/)) {
    const choice = cleanSuggestion(line)
    const same = choice.toLowerCase().replace(/[.!?]+$/, '')
    if (choice.length === 0 || seen.has(same)) continue

    seen.add(same)
    choices.push(choice)
    if (choices.length === count) break
  }
  return choices
}

/** The choices on one line of plain text, numbered when there are several: "1. Commit it · 2. Show me the diff". */
export function numbered(choices: readonly string[]): string {
  return choices.length === 1 ? (choices[0] ?? '') : choices.map((choice, i) => `${i + 1}. ${choice}`).join(' · ')
}

/** The model's role and the form of its reply: one message, or `count` of them one per line. */
export function suggestSystem(count: number): string {
  return count === 1
    ? `${SUGGEST_ROLE}Reply with that message only: one line, under 15 words, no quotes, no labels, no explanation.`
    : `${SUGGEST_ROLE}Reply with exactly ${COUNT_WORDS[count]} different messages they might send next, one per line, ` +
        'the likeliest first: each under 15 words, no numbering, quotes, labels or explanation.'
}

/** What the model reads: the end of the reply matters most, where the questions, offers and open items are. */
export function suggestionPrompt(lastPrompt: string, reply: string, count: number): string {
  const prompt = lastPrompt.length > SUGGEST_PROMPT_CHARS ? `${lastPrompt.slice(0, SUGGEST_PROMPT_CHARS)}…` : lastPrompt
  const tail = reply.length > SUGGEST_REPLY_CHARS ? `…${reply.slice(-SUGGEST_REPLY_CHARS)}` : reply
  const others =
    count === 2
      ? 'Line 2: one other message the developer could plausibly send instead, asking for something different: '
      : `Lines 2 to ${count}: ${COUNT_WORDS[count - 1]} other messages the developer could plausibly send instead, each ` +
        'asking for something different: '

  return (
    `<developer_last_message>\n${prompt.length > 0 ? prompt : '(none)'}\n</developer_last_message>\n\n` +
    `<claude_reply>\n${tail}\n</claude_reply>\n\n` +
    (count === 1
      ? 'Write the developer\'s next message. Decide in this order:\n'
      : `Write the developer's ${COUNT_WORDS[count]} likeliest next messages, one per line.\nLine 1, decided in this order:\n`) +
    '1. The reply asks the developer a question or offers a choice (commit, open a PR, pick an option, keep or ' +
    'revert): answer it, taking Claude\'s recommendation when it gave one.\n' +
    '2. The reply says what Claude will do next, or waits for the word: give the go-ahead.\n' +
    '3. The reply says the work is done but uncommitted, unverified or has open follow-ups: ask Claude for the most ' +
    'important one.\n' +
    '4. Otherwise: the most useful next step for the work.\n' +
    (count > 1
      ? `${others}the other option Claude offered, a check before going ahead (the tests, the diff, a review), or the ` +
        'step after this one.\n'
      : '') +
    'The developer only asks Claude for things Claude can do, never for something the reply says is already done, ' +
    'never claims results they have not seen, and names no branch, file, number or tool the reply did not name. ' +
    'Never write as Claude: no "Want me to...", "Do you see...", "Should I...". Never thank.\n\n' +
    'Examples of the form, not the content:\n' +
    EXAMPLES.map(example => `Reply ends "${example.end}":\n${example.lines.slice(0, count).join('\n')}`).join('\n\n')
  )
}

/** Opens the pane where an attached surface draws no band (the mobile app), unless the person closed it. */
export async function openPaneWhereNoBand($: EngineInterface): Promise<void> {
  if (await read($, paneClosed)) return

  const surfaces = await $.session.surfaces()
  if (surfaces.some(surface => !BAND_SURFACES.has(surface))) {
    await $.ui.open({ id: PANE, title: PANE_TITLE })
  }
}

/** The person's prompt is now the last one: the old choices answered the previous turn. */
export async function recordPrompt($: EngineInterface, text: string, isFromProgram: boolean): Promise<void> {
  epoch += 1
  const prompt: LastPrompt = { text, at: await $.clock.now(), isFromProgram }
  await update($, last, () => prompt)
  await update($, suggested, () => null)
  await update($, routed, () => null)
  await openPaneWhereNoBand($)
}

/**
 * Asks the model for the next messages after the turn of `ask` and keeps them for the band and the pane;
 * null when the model gave none or the person moved on meanwhile.
 */
export async function askNext($: EngineInterface, ask: number, lastPrompt: string, reply: string): Promise<string[] | null> {
  const { model, effort, choices: count } = settings
  try {
    const request = {
      system: suggestSystem(count),
      prompt: suggestionPrompt(lastPrompt, reply, count),
      maxTokens: SUGGEST_MAX_TOKENS,
      effort,
      timeoutMs: SUGGEST_TIMEOUT_MS,
    }
    let answer = await $.model.complete({ ...request, model })
    if (!answer.isAnswered && ask === epoch && model !== FALLBACK_MODEL) {
      answer = await $.model.complete({ ...request, model: FALLBACK_MODEL })
    }
    if (ask !== epoch || !answer.isAnswered) return null

    const choices = cleanChoices(answer.text, count)
    if (choices.length === 0) return null

    const idea: Suggestion = { choices, at: await $.clock.now() }
    await update($, suggested, () => idea)
    return choices
  } catch {
    return null // a suggestion is a bonus: the turn never hears of a failed one
  }
}

/** Where a surface draws this mod's UI: ask, then offer the likeliest dim in the prompt box where it shows one. */
export async function suggestNext($: EngineInterface, ask: number, lastPrompt: string, reply: string): Promise<void> {
  const choices = await askNext($, ask, lastPrompt, reply)
  const [likeliest] = choices ?? []
  // A queued action keeps the box: the person's own next step before a guessed one.
  if (likeliest === undefined || (await read($, queueHere)).length > 0) return

  try {
    await $.prompt.suggest({ text: likeliest }) // Tab to take; VS Code answers "not shown"
  } catch {
    // the band and the pane already show it
  }
}

/** A choice clicked: sent as the person's own words, or put in the box to edit, as the settings say. */
export async function pressChoice($: EngineInterface, text: string, choices: readonly string[]): Promise<void> {
  const { onPress } = await loadSettings($)
  await (onPress === 'box' ? putInBox($, text, choices) : sendChoice($, text))
}

/** Sends a choice as the person's own words, once however often the choices are pressed. */
export async function sendChoice($: EngineInterface, text: string): Promise<void> {
  let isTaken = false
  let offered: readonly string[] = []
  await update($, suggested, current => {
    isTaken = current !== null && current.choices.includes(text)
    offered = current?.choices ?? []
    return isTaken ? null : current
  })
  if (!isTaken) return

  // A choice continues the task it answers, unless it orders work after an easy question: taken before the choice
  // becomes the last prompt, so the grading reads the request before it.
  pending = await pendingTask($, text, offered)
  // Recorded here: the prompt hook below never sees this mod's own submit.
  await recordPrompt($, text, false)
  await $.prompt.submit({ text, asUser: true })
}

/**
 * Puts a choice in the prompt box to edit: over an empty box or an earlier choice, else in at the cursor so what the
 * person typed stays. Where no box takes a draft, the clipboard holds it to paste.
 */
export async function putInBox($: EngineInterface, text: string, choices: readonly string[]): Promise<void> {
  const box = await $.prompt.read()
  const draft = box.text.trim()
  const isOver = draft.length === 0 || choices.includes(draft)
  const before = box.text.slice(0, box.cursor)
  const spaced = !isOver && before.length > 0 && !/\s$/.test(before) ? ` ${text}` : text

  const filled = await $.prompt.fill({ text: spaced, mode: isOver ? 'replace' : 'insert' })
  if (filled.isFilled) return

  const [surface] = await $.session.surfaces()
  const isCopied = surface !== undefined && (await $.ui.copy({ text, surface })).isCopied
  $.ui.toast(isCopied ? 'Copied: paste it into the box.' : `Could not put it in the box: ${text}`)
}

/** Whether a stored value has a note's shape: a store from another version, or edited by hand, may hold anything. */
function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false
  const note = value as Record<string, unknown>
  return typeof note.id === 'string' && typeof note.text === 'string' && typeof note.at === 'number' && typeof note.root === 'string'
}

/** The folder the session works in, which notes are kept under; empty where it cannot be read. */
async function projectRoot($: EngineInterface): Promise<string> {
  try {
    return await $.session.root()
  } catch {
    return ''
  }
}

/** Every project's notes as the store holds them; none where it cannot be read. */
export async function readNotes($: EngineInterface): Promise<Note[]> {
  try {
    const stored = await $.store.get(NOTES_KEY)
    return Array.isArray(stored) ? stored.filter(isNote) : []
  } catch {
    return []
  }
}

/** This project's notes, newest first, taken from the store afresh and put in `$.state` for the pane to draw. */
export async function loadNotes($: EngineInterface): Promise<Note[]> {
  const root = await projectRoot($)
  const here = (await readNotes($)).filter(note => note.root === root).sort((a, b) => b.at - a.at)
  await update($, notesHere, () => here)
  return here
}

/** Saves every project's notes; false, with a toast, where the store would not take them. */
async function writeNotes($: EngineInterface, all: readonly Note[]): Promise<boolean> {
  try {
    await $.store.set(NOTES_KEY, [...all])
    return true
  } catch (error) {
    $.ui.toast(`Could not save the note: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

let noteSeq = 0
/** The terminal's width as its last drawing of the line under the prompt box gave it: a pane is sized before it draws. */
let terminalColumns: number | undefined

/** The rows `text` takes wrapped at `width`, word by word as the terminal wraps it; a word wider than the row is split. */
export function wrappedRows(text: string, width: number): number {
  let rows = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(part => part.length > 0)) {
    const needed = used === 0 ? word.length : used + 1 + word.length
    if (needed <= width) {
      used = needed
      continue
    }
    if (used > 0) rows += 1
    rows += Math.ceil(word.length / width) - 1
    used = word.length % width || width
  }
  return rows
}

/**
 * The terminal pane's rows for these notes, each whole at this width: the title, the shown notes wrapped, the remove
 * and clear rows, the count of older ones, a line each side; never fewer than the picker's page takes.
 */
export function notesRows(notes: readonly Note[], columns: number): number {
  const width = Math.max(10, columns - PANE_SIDES - HOTKEY_COLUMNS)
  const shown = notes.slice(0, NOTES_SHOWN)
  const lines = shown.reduce((sum, note) => sum + wrappedRows(note.text, width), 0)
  return Math.max(NOTES_ROWS, 1 + lines + 2 + (notes.length > shown.length ? 1 : 0) + 2)
}

/** What keeping a note came to: the note, or why there is none. */
export type Kept = { note: Note; isNew: boolean } | { note: null; reason: 'empty' | 'full' | 'unsaved' }

/** Keeps a message for later under this project, on one line; one already kept is not kept twice. */
export async function addNote($: EngineInterface, text: string): Promise<Kept> {
  const clean = oneLine(text, NOTE_MAX_CHARS)
  if (clean.length === 0) return { note: null, reason: 'empty' }

  const root = await projectRoot($)
  const all = await readNotes($)
  const mine = all.filter(note => note.root === root)
  const same = mine.find(note => note.text === clean)
  if (same !== undefined) return { note: same, isNew: false }
  if (mine.length >= NOTES_MAX) return { note: null, reason: 'full' }

  const at = await $.clock.now()
  noteSeq += 1
  const note: Note = { id: `${at}-${noteSeq}`, text: clean, at, root }
  if (!(await writeNotes($, [...all, note]))) return { note: null, reason: 'unsaved' }
  await loadNotes($)
  return { note, isNew: true }
}

/** Drops notes: one by its id, or with none every note of this project's. */
export async function dropNotes($: EngineInterface, id?: string): Promise<number> {
  const root = await projectRoot($)
  const all = await readNotes($)
  const kept = all.filter(note => (id === undefined ? note.root !== root : note.id !== id))
  if (kept.length !== all.length && !(await writeNotes($, kept))) return 0
  await loadNotes($)
  return all.length - kept.length
}

/** A note taken: the pane closes and its words wait in the prompt box to edit and send. The note stays kept. */
export async function useNote($: EngineInterface, id: string): Promise<void> {
  const note = (await loadNotes($)).find(candidate => candidate.id === id)
  if (note === undefined) return

  try {
    await $.ui.close({ id: NOTES_PANE })
  } catch {
    // already closed
  }
  await putInBox($, note.text, [])
}

/** Opens the notes pane on this project's notes; false where no surface draws one. The keys go to it in the terminal. */
export async function openNotes($: EngineInterface): Promise<boolean> {
  const notes = await loadNotes($)
  const rows = (await read($, notesView)).kind === 'pick' ? NOTES_ROWS : notesRows(notes, terminalColumns ?? GUESS_COLUMNS)
  const opened = await $.ui.open({ id: NOTES_PANE, title: NOTES_TITLE, focus: true, closeOnEscape: true, holdToasts: true, rows })
  return opened.isPlaced
}

/** Opens the notes, or where no surface draws a pane, answers with them as numbered lines. */
export async function showNotes($: EngineInterface): Promise<{ text: string }> {
  await update($, notesView, () => NOTES_LIST)
  if (await openNotes($)) return { text: 'Notes opened.' }
  return { text: `${notesLines(await loadNotes($), notesEmpty(await loadBoundKeys($)))}\nNo panel draws here: run /notes in VS Code or the terminal to take one.` }
}

/** What a note's keeping says, in a line. */
export function keptLine(kept: Kept, count: number): string {
  if (kept.note === null) {
    if (kept.reason === 'empty') return 'Nothing to keep. /note <text> keeps a message for later.'
    if (kept.reason === 'full') return `Notes are full (${NOTES_MAX} for this project): take or clear one first with /notes.`
    return 'Could not keep the note.'
  }
  const total = `${count} ${count === 1 ? 'note' : 'notes'}`
  return `${kept.isNew ? 'Kept' : 'Already kept'}: ${oneLine(kept.note.text, 80)} (${total}, /notes opens them)`
}

/** The notes as numbered lines, for a host that draws no pane. */
export function notesLines(notes: readonly Note[], empty: string): string {
  return notes.length === 0 ? empty : notes.map((note, i) => `${i + 1}. ${oneLine(note.text, PANE_MAX_CHARS)}`).join('\n')
}

/** The notes as a Markdown page: the export's mark, a heading, then each note with the day it was kept, newest first. */
export function notesPage(notes: readonly Note[]): string {
  const day = (at: number) => new Date(at).toISOString().slice(0, 10)
  return [NOTES_FILE_MARK, '', '# Notes', '', 'Kept with Companion in this project, newest first.', '', ...notes.map(note => `- ${note.text} (${day(note.at)})`), ''].join('\n')
}

/**
 * /notes export: this project's notes written as a Markdown page at the project's root, NOTES.md or the file named. A
 * file of that name the export did not write is left alone, and so is a path out of the project. What it came to, in
 * a line.
 */
export async function exportNotes($: EngineInterface, file: string): Promise<string> {
  const name = file.trim().length > 0 ? file.trim() : NOTES_FILE
  if (/^([a-zA-Z]:|[\\/~])/.test(name) || name.split(/[\\/]/).includes('..')) return `Notes are written inside this project: ${name} is outside it.`
  const notes = await loadNotes($)
  if (notes.length === 0) return 'No notes to export yet.'

  const root = await projectRoot($)
  const path = root.length > 0 ? `${root}/${name}` : name
  try {
    if ((await $.fs.exists(path)) && !(await $.fs.read(path)).startsWith(NOTES_FILE_MARK)) {
      return `${name} is already there and /notes export did not write it, so it was left alone. /notes export <file> writes somewhere else.`
    }
    await $.fs.write(path, notesPage(notes))
  } catch (error) {
    return `Could not write ${name}: ${error instanceof Error ? error.message : String(error)}`
  }
  return `Wrote ${notes.length} ${notes.length === 1 ? 'note' : 'notes'} to ${name}.`
}

/** Markdown's inline marks taken off a line: emphasis, code ticks and links, as the words read on screen. */
function plainWords(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * An answer's lines worth keeping one by one, in order: each sentence of its paragraphs, list items and quotes. Code,
 * tables, headings and rules are left out, as are fragments too short to stand alone; a line said twice comes once.
 */
export function linesOf(markdown: string): string[] {
  const lines: string[] = []
  let paragraph: string[] = []
  let isCode = false
  const flush = () => {
    const text = plainWords(paragraph.join(' '))
    paragraph = []
    // A sentence ends at . ! or ? before a space and a capital, a digit or an opening mark.
    for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘(])/)) {
      const line = sentence.trim()
      if (line.length >= PICK_MIN_CHARS && /\p{L}/u.test(line) && !lines.includes(line)) lines.push(line)
    }
  }

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^(```|~~~)/.test(line)) {
      flush()
      isCode = !isCode
      continue
    }
    if (isCode) continue
    if (line.length === 0 || line.startsWith('|') || /^#{1,6}\s/.test(line) || /^([-*_])(\s*\1){2,}$/.test(line)) {
      flush()
      continue
    }
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item !== null) {
      flush()
      paragraph.push(item[1] ?? '')
      continue
    }
    paragraph.push(line.replace(/^>\s?/, ''))
  }
  flush()
  return lines.slice(0, PICK_MAX)
}

// The selection last kept as a note. The engine answers with a selection until the person's next prompt or command has
// run, so a "Add note" and then /note would read the same words twice: kept once, they count as no selection after.
let usedSelection: string | null = null
// The copied text last kept as a note. The clipboard holds it until the next copy, so a second 9 would keep the same
// words again: kept once, they count as nothing copied, and 9 lists the answer's lines instead.
let usedCopy: string | null = null

/** The text the person selected last and no note took yet, trimmed; null with none, where none is seen or readable. */
async function selectedText($: EngineInterface): Promise<string | null> {
  try {
    const text = (await $.ui.selection())?.text.trim() ?? ''
    if (text.length === 0) usedSelection = null
    return text.length > 0 && text !== usedSelection ? text : null
  } catch {
    return null
  }
}

/** Keeps what the person selected as a note and says so in a line; null where nothing is selected. */
async function keepSelection($: EngineInterface): Promise<string | null> {
  const selected = await selectedText($)
  if (selected === null) return null
  usedSelection = selected
  // The fullscreen terminal copied the selection too: that copy is the same words, used already.
  usedCopy = cleanCopy(selected)
  const kept = await addNote($, selected)
  return keptLine(kept, (await loadNotes($)).length)
}

/**
 * Copied text as a note keeps it: each line without the mark the terminal or markdown starts it with (a reply's
 * bullet, a list item's dash or number, a quote or heading mark), all on one line.
 */
export function cleanCopy(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^(?:[●⎿│•▪◦*+-]|\d+[.)]|>|#{1,6})\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A text as the terminal shows it, to find copied words in an answer: no marks, on one line, in any case. */
function comparable(text: string): string {
  return plainWords(cleanCopy(text)).toLowerCase()
}

/** Whether copied text came from one of the answers: its words, in their order, inside one of them. */
export function isFromAnswers(answers: readonly string[], copied: string): boolean {
  const words = comparable(copied)
  return words.length >= COPY_MIN_CHARS && answers.some(answer => comparable(answer).includes(words))
}

// Where no Windows PowerShell is: macOS, then Wayland, then X11, the first that answers.
const CLIPBOARD_READERS: readonly (readonly string[])[] = [
  ['pbpaste'],
  ['wl-paste', '--no-newline'],
  ['xclip', '-selection', 'clipboard', '-o'],
  ['xsel', '--clipboard', '--output'],
]
// On Windows, PowerShell 7 where it is installed: it starts in about a second, Windows PowerShell 5.1 in about three.
const GET_CLIPBOARD = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw'
const WINDOWS_CLIPBOARD_READERS: readonly (readonly string[])[] = [
  ['pwsh.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', GET_CLIPBOARD],
  ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', GET_CLIPBOARD],
]
// The reader that answered last, tried first next time, so a missing one is not started on every press.
let clipboardReader: readonly string[] | undefined

/** The text on the machine's clipboard, read only when the person asks to keep it; null with none or no way to read. */
export async function readHostClipboard($: EngineInterface): Promise<string | null> {
  const known = (await $.env.get('OS')) === 'Windows_NT' ? WINDOWS_CLIPBOARD_READERS : CLIPBOARD_READERS
  const readers = clipboardReader === undefined ? known : [clipboardReader, ...known.filter(argv => argv !== clipboardReader)]
  for (const argv of readers) {
    try {
      const done = await $.process.run(argv, { timeoutMs: CLIPBOARD_TIMEOUT_MS })
      if (done.exitCode !== 0) continue
      clipboardReader = argv
      return done.stdout.trim().length > 0 ? done.stdout : null
    } catch {
      // not on this machine: the next one
    }
  }
  return null
}

/** Keeps what the person copied from one of the recent answers and says so in a line; null where nothing such is. */
async function keepCopy($: EngineInterface): Promise<string | null> {
  const copied = await readHostClipboard($)
  const clean = copied === null ? '' : cleanCopy(copied)
  if (clean.length === 0) {
    usedCopy = null
    return null
  }
  // Text from anywhere else (a password, a link, the person's own words) is never kept, nor shown.
  if (clean === usedCopy || !isFromAnswers(await read($, answersDone), clean)) return null
  usedCopy = clean
  const kept = await addNote($, clean)
  return keptLine(kept, (await loadNotes($)).length)
}

/** Whether a block of an answer, as drawn, ends one of the completed answers: "Add note" goes under those alone. */
export function endsAnswer(answers: readonly string[], block: string): boolean {
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
  const shown = squash(block)
  return shown.length > 0 && answers.some(answer => squash(answer).endsWith(shown))
}

/** Opens the notes pane on an answer's lines to pick from; false where no surface draws one. */
export async function openPicker($: EngineInterface, answer: string): Promise<boolean> {
  const view: NotesView = { kind: 'pick', lines: linesOf(answer), page: 0 }
  await update($, notesView, () => view)
  return openNotes($)
}

/**
 * "Add note" pressed, under an answer or as the band's 9: keeps the selection, or what was copied from an answer; with
 * neither, lists the lines of that answer, or of the last one.
 */
export async function pressNoteButton($: EngineInterface, answer?: string): Promise<void> {
  let said = await keepSelection($)
  if (said === null) {
    // Reading the clipboard starts a process, about a second on Windows: the press answers at once.
    $.ui.toast(READING_COPY)
    said = await keepCopy($)
  }
  if (said !== null) {
    $.ui.toast(said)
    return
  }
  const lines = answer ?? (await read($, answersDone)).at(-1)
  if (lines !== undefined) await openPicker($, lines)
}

/** A line of the picker pressed: kept as a note, or, kept already, dropped again. */
export async function toggleLine($: EngineInterface, line: string): Promise<void> {
  const clean = oneLine(line, NOTE_MAX_CHARS)
  const kept = (await loadNotes($)).find(note => note.text === clean)
  if (kept !== undefined) {
    await dropNotes($, kept.id)
    return
  }
  const result = await addNote($, line)
  if (result.note === null) $.ui.toast(keptLine(result, (await loadNotes($)).length))
}

/** The picker's next page of lines, back to the first after the last. */
async function turnPage($: EngineInterface): Promise<void> {
  await update($, notesView, view =>
    view.kind === 'pick' ? { ...view, page: (view.page + 1) % Math.max(1, Math.ceil(view.lines.length / PICK_PAGE)) } : view,
  )
}

/** From the picker, the remove list or the question back to the notes. */
async function showList($: EngineInterface): Promise<void> {
  await update($, notesView, () => NOTES_LIST)
}

/** The terminal's notes to remove one by its number. */
async function showRemove($: EngineInterface): Promise<void> {
  await update($, notesView, () => REMOVE_VIEW)
}

/** A note removed from the remove list, and the notes again. */
async function removeNote($: EngineInterface, id: string): Promise<void> {
  await dropNotes($, id)
  await showList($)
}

/** Asks, in the notes pane, before every note of this project goes. */
async function askClear($: EngineInterface): Promise<void> {
  await update($, notesView, () => CLEAR_VIEW)
}

/** The clear confirmed: this project's notes gone, and the empty list. */
async function clearNotes($: EngineInterface): Promise<void> {
  await dropNotes($)
  await showList($)
}

/** A keystroke as the keybindings file writes it ("alt+q", "ctrl+k ctrl+q") as it reads on screen ("Alt+Q"). */
export function keyName(stroke: string): string {
  const word = (part: string) => (/^(alt|meta|opt|option)$/i.test(part) ? 'Alt' : part.length === 1 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
  return stroke
    .trim()
    .split(/\s+/)
    .map(chord => chord.split('+').map(word).join('+'))
    .join(' ')
}

/**
 * The keys the person's keybindings file binds to /queue and /note (`command:queue`, `command:note`) where the prompt
 * box takes them, the Chat or Global context; none where the file is missing or not JSON.
 */
export async function readBoundKeys($: EngineInterface): Promise<BoundKeys> {
  const found: BoundKeys = { queue: null, note: null }
  try {
    const file: unknown = JSON.parse(await $.fs.read(await keybindingsPath($)))
    const blocks = typeof file === 'object' && file !== null && Array.isArray((file as { bindings?: unknown }).bindings) ? (file as { bindings: unknown[] }).bindings : []
    for (const block of blocks) {
      if (typeof block !== 'object' || block === null) continue
      const { context, bindings } = block as { context?: unknown; bindings?: unknown }
      if ((context !== 'Chat' && context !== 'Global') || typeof bindings !== 'object' || bindings === null) continue
      for (const [stroke, action] of Object.entries(bindings)) {
        if (action === 'command:queue' && found.queue === null) found.queue = keyName(stroke)
        if (action === 'command:note' && found.note === null) found.note = keyName(stroke)
      }
    }
  } catch {
    // no keybindings file, or one that is not JSON: nothing bound
  }
  return found
}

/** Reads the bound keys afresh into `$.state`, for the band's hints: the file reloads in Claude Code as it changes. */
async function loadBoundKeys($: EngineInterface): Promise<BoundKeys> {
  const keys = await readBoundKeys($)
  await update($, boundKeys, () => keys)
  return keys
}

/** Where Claude Code keeps the person's keybindings: its config folder (CLAUDE_CONFIG_DIR, else ~/.claude). */
async function keybindingsPath($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  return `${configDir}/keybindings.json`
}

// The keys /companion-setup binds where the prompt box takes them: Alt+Q to /queue, Alt+N to /note.
const SETUP_BINDINGS: readonly (readonly [string, string])[] = [
  ['alt+q', 'command:queue'],
  ['alt+n', 'command:note'],
]

/** What binding the setup's keys came to: the file's new text, the keys added, and those the person uses already. */
export type KeysAdded = { text: string; added: string[]; taken: string[] }

/** A block of a keybindings file: its context and its keys. */
type BindingBlock = { context?: unknown; bindings: Record<string, unknown> }

/**
 * A keybindings file with Alt+Q and Alt+N added to its Chat block (made where there is none), every other binding as it
 * was. A key the person already uses for something else is left alone, and an action already on some key is not bound
 * twice. Null for text that is not a keybindings file's JSON, which is never written over.
 */
export function withCompanionKeys(text: string | null): KeysAdded | null {
  let file: Record<string, unknown> & { bindings: unknown[] }
  if (text === null || text.trim().length === 0) {
    file = { $schema: 'https://www.schemastore.org/claude-code-keybindings.json', $docs: 'https://code.claude.com/docs/en/keybindings', bindings: [] }
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { bindings?: unknown }).bindings)) return null
    file = parsed as Record<string, unknown> & { bindings: unknown[] }
  }

  const isBlock = (block: unknown): block is BindingBlock =>
    typeof block === 'object' && block !== null && typeof (block as { bindings?: unknown }).bindings === 'object' && (block as { bindings?: unknown }).bindings !== null
  const blocks = file.bindings.filter(isBlock)
  const bound = new Set(blocks.filter(block => block.context === 'Chat' || block.context === 'Global').flatMap(block => Object.values(block.bindings)))
  let chat = blocks.find(block => block.context === 'Chat')
  const added: string[] = []
  const taken: string[] = []
  for (const [stroke, action] of SETUP_BINDINGS) {
    if (bound.has(action)) continue
    if (chat === undefined) {
      chat = { context: 'Chat', bindings: {} }
      file.bindings.push(chat)
    }
    if (chat.bindings[stroke] !== undefined) {
      taken.push(keyName(stroke))
      continue
    }
    chat.bindings[stroke] = action
    added.push(keyName(stroke))
  }
  return { text: `${JSON.stringify(file, null, 2)}\n`, added, taken }
}

/** Binds Alt+Q and Alt+N in the person's keybindings file, every other binding kept; what it came to, in a line. */
async function bindCompanionKeys($: EngineInterface): Promise<string> {
  const path = await keybindingsPath($)
  let current: string | null
  try {
    current = (await $.fs.exists(path)) ? await $.fs.read(path) : null
  } catch {
    return 'Could not read keybindings.json, so no keys were bound.'
  }
  const next = withCompanionKeys(current)
  if (next === null) return 'keybindings.json is not a keybindings file Companion can read, so it was left alone.'
  if (next.added.length > 0) {
    try {
      await $.fs.write(path, next.text)
    } catch (error) {
      return `Could not write keybindings.json: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  await loadBoundKeys($)
  const said: string[] = []
  if (next.added.length > 0) said.push(`Bound ${next.added.join(' and ')}.`)
  if (next.taken.length > 0) {
    said.push(`${next.taken.join(' and ')} ${next.taken.length === 1 ? 'does' : 'do'} something else for you already: bind /queue or /note to another key in keybindings.json.`)
  }
  return said.length > 0 ? said.join(' ') : 'Your keys for /queue and /note were bound already.'
}

/** Whether the setup was opened once, as the store says; the band's line about it goes away then. */
async function loadSetupDone($: EngineInterface): Promise<boolean> {
  let done = false
  try {
    const stored = await $.store.get(SETUP_STORE_KEY)
    done = typeof stored === 'object' && stored !== null && (stored as { done?: unknown }).done === true
  } catch {
    // a store that cannot be read: not set up
  }
  await update($, setupDone, () => done)
  return done
}

/** /companion-setup: opens the setup's pane, each step ticked unless it is done already. */
export async function openSetup($: EngineInterface, isFullscreen: boolean): Promise<boolean> {
  const keys = await loadBoundKeys($)
  await update($, setupView, () => ({ fullscreen: !isFullscreen, keys: keys.queue === null || keys.note === null, isFullscreen }))
  // Opened once, the line inviting to it has done its work.
  try {
    await $.store.set(SETUP_STORE_KEY, { done: true })
  } catch {
    // the line comes back next session
  }
  await update($, setupDone, () => true)
  const opened = await $.ui.open({ id: SETUP_PANE, title: SETUP_TITLE, focus: true, closeOnEscape: true, holdToasts: true, rows: SETUP_ROWS })
  return opened.isPlaced
}

/** A step of the setup ticked or unticked. */
async function toggleSetup($: EngineInterface, step: 'fullscreen' | 'keys'): Promise<void> {
  await update($, setupView, view => ({ ...view, [step]: !view[step] }))
}

/**
 * The setup applied: the keys bound first, then the pane closed and what was done said, and fullscreen last, since
 * /tui relaunches the session (with the conversation) into it. Where a plugin may not run /tui, the person is told to.
 */
async function applySetup($: EngineInterface): Promise<void> {
  const view = await read($, setupView)
  const keys = await read($, boundKeys)
  const said = view.keys && (keys.queue === null || keys.note === null) ? await bindCompanionKeys($) : null
  try {
    await $.ui.close({ id: SETUP_PANE })
  } catch {
    // already closed
  }
  const toFullscreen = view.fullscreen && !view.isFullscreen
  if (!toFullscreen) {
    $.ui.toast(said ?? 'Nothing to change: Companion is set up.')
    return
  }
  $.ui.toast(`${said === null ? '' : `${said} `}Switching to fullscreen…`)
  try {
    await $.command.run({ command: 'tui', args: 'fullscreen' })
  } catch {
    $.ui.toast('Type /tui fullscreen to switch to fullscreen.')
  }
}

/** How to run a command, said the person's way: the key bound to it, else the command itself. */
const pressOrRun = (key: string | null, command: string) => (key === null ? `run /${command}` : `press ${key}`)

/** How to queue or keep what was copied, with the person's keys where bound. */
export function copyHint(keys: BoundKeys): string {
  return `Copy text, then ${keys.queue ?? '/queue'} to queue or ${keys.note ?? '/note'} to note`
}

/**
 * What Companion's line under the prompt box says, and of what: the context's tip, the band's choices, kept words, the
 * setup, the keys.
 */
type HintFacts = { context?: string; choices: number; hasKept: boolean; isSetUp: boolean; keys: BoundKeys }

/**
 * Companion's lines under the engine's hint line, one subject each, the likeliest needed first: what the context costs
 * where it grew or went cold; the invitation to the setup until it was opened; how to work the keys, that is how to pick
 * a choice with the number keys off (numbered, the choices say it themselves) and how to queue or keep what was copied.
 * Empty where there is nothing to say.
 */
export function tipLines(
  current: Pick<Settings, 'numberKeys' | 'onPress' | 'noteButton'>,
  { context = '', choices, hasKept, isSetUp, keys }: HintFacts,
): string[] {
  const keysTip = [choices > 0 && !current.numberKeys ? pickHint(current, choices) : '', current.noteButton && hasKept ? copyHint(keys) : '']
    .filter(part => part.length > 0)
    .join(' · ')
  return [context, isSetUp ? '' : SETUP_NUDGE, keysTip].filter(line => line.length > 0)
}

/** The footer's counts on the terminal, with the keys on: what waits in this project's queue and notes. */
async function countsOf($: EngineInterface, current: Settings): Promise<string[]> {
  return current.noteButton ? footerCounts((await read($, queueHere)).length, (await read($, notesHere)).length) : []
}

/** The meters on their own line, the last under the prompt box: each a label, five cells and its percent in colour. */
function meterViews(ui: Parts, meters: readonly Meter[]) {
  const { Box, Text } = ui
  return meters.map(one => {
    const full = meterCells(one.percent)
    const color = meterColor(one.percent)
    return (
      <Box key={one.key}>
        <Text dimColor>{`${one.label} `}</Text>
        <Text color={color}>{METER_FULL.repeat(full)}</Text>
        <Text dimColor>{METER_EMPTY.repeat(METER_CELLS - full)}</Text>
        <Text color={color}>{` ${one.percent}%`}</Text>
        {one.after !== undefined && <Text dimColor>{` ${one.after}`}</Text>}
      </Box>
    )
  })
}

/** The footer's labels for this project's queue and notes: "2 queued", "1 note"; none for what is empty. */
export function footerCounts(queued: number, notes: number): string[] {
  return [queued > 0 ? `${queued} queued` : '', notes > 0 ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : ''].filter(label => label.length > 0)
}

/** What /queue on its own says when nothing was copied from an answer. */
export function nothingCopied(keys: BoundKeys): string {
  return `Nothing copied from an answer: select words in one of Claude’s answers, copy them, then ${pressOrRun(keys.queue, 'queue')} again.`
}

/** What the notes say with none kept yet. */
export function notesEmpty(keys: BoundKeys): string {
  return `No notes yet. Copy words from an answer and ${pressOrRun(keys.note, 'note')}, or /note <text>.`
}

/** What the queue says with nothing queued. */
export function queueEmpty(keys: BoundKeys): string {
  return `Nothing queued. Copy words from an answer and ${pressOrRun(keys.queue, 'queue')}, or /queue <text>.`
}

// The queue: actions copied out of the answers to send later, one at a time. /queue on its own (or a key the person
// binds to it, Alt+Q) queues what they selected or copied from an answer, as /note keeps it as a note; the footer counts
// the queue, and the prompt box offers the next one as its grey text for Tab to take. The band's 8 opens the queue as a
// list the keys work, where an action moves to the top or comes off, unsent; a prompt sent that is a queued action
// (with more words after it, or none) leaves the queue. Kept per project in this mod's store, like the notes, across
// sessions.

/** Every project's queued actions as the store holds them, in queue order; none where it cannot be read. */
export async function readQueue($: EngineInterface): Promise<QueuedAction[]> {
  try {
    const stored = await $.store.get(QUEUE_KEY)
    // A queued action has a note's shape: a store from another version, or edited by hand, may hold anything.
    return Array.isArray(stored) ? stored.filter(isNote) : []
  } catch {
    return []
  }
}

/** This project's queued actions, the next one first, taken from the store afresh and put in `$.state` for the band. */
export async function loadQueue($: EngineInterface): Promise<QueuedAction[]> {
  const root = await projectRoot($)
  const here = (await readQueue($)).filter(action => action.root === root)
  await update($, queueHere, () => here)
  return here
}

/** Saves every project's queue; false, with a toast, where the store would not take it. */
async function writeQueue($: EngineInterface, all: readonly QueuedAction[]): Promise<boolean> {
  try {
    await $.store.set(QUEUE_KEY, [...all])
    return true
  } catch (error) {
    $.ui.toast(`Could not save the queue: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

let queueSeq = 0

/** What queueing came to: the action, or why there is none. */
export type Queuing = { action: QueuedAction; isNew: boolean } | { action: null; reason: 'empty' | 'full' | 'unsaved' }

/** Queues an action at the bottom of this project's queue, on one line; one queued already is not queued twice. */
export async function addToQueue($: EngineInterface, text: string): Promise<Queuing> {
  const clean = oneLine(text, QUEUE_MAX_CHARS)
  if (clean.length === 0) return { action: null, reason: 'empty' }

  const root = await projectRoot($)
  const all = await readQueue($)
  const mine = all.filter(action => action.root === root)
  const same = mine.find(action => action.text === clean)
  if (same !== undefined) return { action: same, isNew: false }
  if (mine.length >= QUEUE_MAX) return { action: null, reason: 'full' }

  const at = await $.clock.now()
  queueSeq += 1
  const action: QueuedAction = { id: `${at}-${queueSeq}`, text: clean, at, root }
  if (!(await writeQueue($, [...all, action]))) return { action: null, reason: 'unsaved' }
  // The first action queued takes the prompt box's grey text from the likeliest suggestion.
  if ((await loadQueue($)).length === 1) await offerNext($)
  return { action, isNew: true }
}

/**
 * Takes one action off the queue by its id; where it was the next one, the box offers the new next one, unless the
 * action went as a prompt (`isSent`), whose turn offers it when it ends.
 */
export async function dropFromQueue($: EngineInterface, id: string, isSent = false): Promise<void> {
  const root = await projectRoot($)
  const all = await readQueue($)
  const kept = all.filter(action => action.id !== id)
  if (kept.length === all.length) return
  const wasNext = all.find(action => action.root === root)?.id === id
  if (!(await writeQueue($, kept))) return
  await loadQueue($)
  if (wasNext && !isSent) await offerNext($)
}

/** Moves an action to the top of the queue: the next one, which the prompt box offers for Tab to take. */
export async function moveToTop($: EngineInterface, id: string): Promise<void> {
  const root = await projectRoot($)
  const all = await readQueue($)
  const mine = all.filter(action => action.root === root)
  const moved = mine.find(action => action.id === id)
  if (moved === undefined) return
  if (mine[0]?.id === id) {
    $.ui.toast('Already the next one: Tab takes it into the prompt box.')
    return
  }
  const others = all.filter(action => action.root !== root)
  if (!(await writeQueue($, [...others, moved, ...mine.filter(action => action.id !== id)]))) return
  await loadQueue($)
  await offerNext($)
}

/** Takes every action of this project off the queue; how many went. */
export async function clearQueue($: EngineInterface): Promise<number> {
  const root = await projectRoot($)
  const all = await readQueue($)
  const kept = all.filter(action => action.root !== root)
  if (kept.length !== all.length && !(await writeQueue($, kept))) return 0
  await loadQueue($)
  return all.length - kept.length
}

/** The prompt box's grey text, Tab to take: the next queued action, else the likeliest suggestion. */
async function offerNext($: EngineInterface): Promise<void> {
  const offer = (await read($, queueHere))[0]?.text ?? (await read($, suggested))?.choices[0]
  if (offer === undefined) return
  try {
    await $.prompt.suggest({ text: offer }) // shown over an empty box while no turn runs
  } catch {
    // the band shows it
  }
}

/** A prompt the person sent that is a queued action, as Tab took it, more words after it or none: it leaves the queue. */
async function sentFromQueue($: EngineInterface, text: string): Promise<void> {
  const sent = oneLine(text, Number.MAX_SAFE_INTEGER)
  const action = (await loadQueue($)).find(candidate => sent.startsWith(candidate.text))
  if (action !== undefined) await dropFromQueue($, action.id, true)
}

/** What the person selected, else what they copied from one of the recent answers, on one line; null with neither. */
async function copiedFromAnswer($: EngineInterface): Promise<string | null> {
  try {
    // A selection is the person's own pick (the fullscreen terminal's), wherever on the screen they made it.
    const selected = cleanCopy((await $.ui.selection())?.text ?? '')
    if (selected.length > 0) return selected
  } catch {
    // none seen here
  }
  // With no answer yet nothing copied can be from one: the clipboard is not read.
  const answers = await read($, answersDone)
  if (answers.length === 0) return null
  // Reading the clipboard starts a process, about a second on Windows: the press answers at once.
  $.ui.toast(READING_COPY)
  const copied = await readHostClipboard($)
  const clean = copied === null ? '' : cleanCopy(copied)
  // Text from anywhere else (a password, a link, the person's own words) is never queued, nor shown.
  return clean.length > 0 && isFromAnswers(answers, clean) ? clean : null
}

/** What queueing says, in a line. */
export function queuedLine(queuing: Queuing, count: number): string {
  if (queuing.action === null) {
    if (queuing.reason === 'empty') return QUEUE_NOTHING
    if (queuing.reason === 'full') return `The queue is full (${QUEUE_MAX} for this project): send one or take one off first.`
    return 'Could not queue it.'
  }
  return `${queuing.isNew ? 'Queued' : 'Already queued'}: ${oneLine(queuing.action.text, 80)} (${count} in the queue, 8 to view)`
}

/** The queue as numbered lines, the next one first, for /queue list; `empty` with nothing queued. */
export function queueLines(queue: readonly QueuedAction[], empty: string): string {
  return queue.length === 0 ? empty : queue.map((action, i) => `${i + 1}. ${oneLine(action.text, PANE_MAX_CHARS)}`).join('\n')
}

/**
 * /queue on its own, and so a key bound to it (Alt+Q): queues what the person selected or copied from an answer, and
 * says so in a line. Words the last /queue took that are still on the clipboard once sent or taken off count as nothing
 * new, so a stale clipboard never queues them again.
 */
export async function queueTheCopy($: EngineInterface): Promise<string> {
  const copied = await copiedFromAnswer($)
  const nothing = nothingCopied(await read($, boundKeys))
  if (copied === null) return nothing
  const isQueued = (await loadQueue($)).some(action => action.text === oneLine(copied, QUEUE_MAX_CHARS))
  if (!isQueued && copied === (await read($, queueCopied))) return nothing
  await update($, queueCopied, () => copied)
  return queuedLine(await addToQueue($, copied), (await read($, queueHere)).length)
}

/** "Queue" pressed, the band's 8: opens the queue as a list to work from the keys; with nothing queued, says how to queue. */
export async function pressQueueButton($: EngineInterface): Promise<void> {
  if ((await loadQueue($)).length === 0) {
    $.ui.toast(queueEmpty(await read($, boundKeys)))
    return
  }
  await openQueue($)
}

/** "Copy answer" pressed, the band's 7: Claude's last answer as written, Markdown and all, onto the clipboard. */
async function copyLastAnswer($: EngineInterface, surface: RenderSurface): Promise<void> {
  const answer = (await read($, answersDone)).at(-1)
  if (answer === undefined) {
    $.ui.toast('No answer to copy yet.')
    return
  }
  let isCopied = false
  try {
    isCopied = (await $.ui.copy({ text: answer, surface })).isCopied
  } catch {
    // no surface clipboard here: the machine's
  }
  if (!isCopied) isCopied = await copyToHostClipboard($, answer)
  $.ui.toast(isCopied ? `Copied the last answer (${answer.length.toLocaleString('en-US')} characters).` : 'Could not copy the answer here. /copy does it too.')
}

/** "Notes" pressed, the band's 9 or the picker's n: opens this project's notes, the pane sized again for them. */
async function pressNotesKey($: EngineInterface): Promise<void> {
  await update($, notesView, () => NOTES_LIST)
  await openNotes($)
}

/** The key of the queue list's row `i`, from 0: rows go by place, so the ring stays put when the list changes. */
const queueRowKey = (i: number) => `queued-${i + 1}`

/** Opens the queue as a list that takes the keys, the ring on the next action; false where no surface draws a pane. */
export async function openQueue($: EngineInterface): Promise<boolean> {
  const queue = await loadQueue($)
  await update($, queueFocus, () => null)
  const rows = Math.min(QUEUE_MAX, Math.max(1, queue.length)) + QUEUE_PANE_CHROME
  const opened = await $.ui.open({ id: QUEUE_PANE, title: QUEUE_TITLE, focus: true, closeOnEscape: true, holdToasts: true, rows })
  // The ring shows on the next action from the start, so the first ↓ goes to the one after it.
  if (opened.isPlaced) await focusQueueRow($, 0)
  return opened.isPlaced
}

/** The action the list's ring is on, or the next one before the ring moved. */
async function focusedAction($: EngineInterface): Promise<{ action: QueuedAction; at: number } | null> {
  const queue = await read($, queueHere)
  const key = await read($, queueFocus)
  const found = key === null ? 0 : queue.findIndex((_, i) => queueRowKey(i) === key)
  const at = found < 0 ? 0 : found
  const action = queue[at]
  return action === undefined ? null : { action, at }
}

/** Moves the list's ring onto row `i`. */
async function focusQueueRow($: EngineInterface, i: number): Promise<void> {
  const key = queueRowKey(i)
  await update($, queueFocus, () => key)
  try {
    await $.ui.focus({ requestId: QUEUE_PANE, key })
  } catch {
    // the ring stays on the row it was on
  }
}

/** An action taken from the list (Enter): the list closes and its words wait in the prompt box; sent, it leaves the queue. */
async function takeQueued($: EngineInterface, id: string): Promise<void> {
  const action = (await read($, queueHere)).find(candidate => candidate.id === id)
  if (action === undefined) return
  try {
    await $.ui.close({ id: QUEUE_PANE })
  } catch {
    // already closed
  }
  await putInBox($, action.text, [])
}

/** t in the list: the action under the ring moves to the top, and the ring goes with it. */
async function topFocused($: EngineInterface): Promise<void> {
  const focused = await focusedAction($)
  if (focused === null) return
  await moveToTop($, focused.action.id)
  await focusQueueRow($, 0)
}

/** x in the list: the action under the ring comes off unsent, and the ring stays on its place; the last one gone, the list closes. */
async function dropFocused($: EngineInterface): Promise<void> {
  const focused = await focusedAction($)
  if (focused === null) return
  await dropFromQueue($, focused.action.id)
  const left = (await read($, queueHere)).length
  if (left === 0) {
    try {
      await $.ui.close({ id: QUEUE_PANE })
    } catch {
      // already closed
    }
    return
  }
  await focusQueueRow($, Math.min(focused.at, left - 1))
}

/**
 * Opens the settings pane on the settings the store holds now, at its list; false where no surface draws one. It asks
 * for the keys, which the terminal grants over an empty prompt box (after /companion), and for the rows the menu
 * takes, where a pane otherwise opens a third of the terminal tall; Esc closes it.
 */
export async function openSettings($: EngineInterface): Promise<boolean> {
  await loadSettings($)
  await noteSessionModel($)
  await update($, menuView, () => MENU_LIST)
  await update($, menuFocus, () => null)
  const opened = await $.ui.open({ id: SETTINGS_PANE, title: SETTINGS_TITLE, focus: true, closeOnEscape: true, holdToasts: true, rows: MENU_ROWS })
  return opened.isPlaced
}

/** The settings a drawing shows: from `$.state`, so a pick redraws it; before the first load, what the store holds. */
async function shownSettings($: EngineInterface): Promise<Settings> {
  const drawn = await read($, savedSettings)
  return drawn !== null ? settingsFrom(drawn) : ((await readSettings($)) ?? settings)
}

/**
 * The session's model as /model shows it, kept in state for the settings to draw: read afresh, since /model changes it
 * between turns. Where it cannot be read, the last one read; null before any.
 */
export async function noteSessionModel($: EngineInterface): Promise<string | null> {
  try {
    const model = await $.session.model()
    if (typeof model === 'string' && model.length > 0 && model !== sessionModelKey) {
      await update($, sessionModel, () => model)
      sessionModelKey = model
    }
  } catch {
    // an engine without the call, or a failed read: the mode for every model stands where no model is known
  }
  return sessionModelKey
}

/** The settings as the pane shows them on the session's model: `fit` is the mode kept for its family. */
export function shownOn(current: Settings, model: string | null): Settings {
  return { ...current, fit: fitFor(current, model) }
}

/**
 * A pick in the settings pane: saved in the store for every session, in force at once, and drawn back. The mode of
 * fitting is kept for the family the session runs on, and only where none is known is it the mode for every model.
 */
export async function changeSetting($: EngineInterface, field: keyof Settings, value: string | boolean): Promise<void> {
  const current = await loadSettings($)
  const family = field === 'fit' ? familyOf(await noteSessionModel($)) : null
  const change = family === null ? { [field]: value } : { fitByModel: { ...current.fitByModel, [family]: value } }
  const changed = settingsFrom({ ...storedOf(current), ...change })
  try {
    await $.store.set(SETTINGS_KEY, storedOf(changed))
    settings = changed
    await update($, savedSettings, () => storedOf(changed))
  } catch (error) {
    $.ui.toast(`Could not save the setting: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Base64 of the text's UTF-8 bytes: the module has TextEncoder but no btoa. */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64_DIGITS.charAt((n >> 18) & 63) + BASE64_DIGITS.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? BASE64_DIGITS.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? BASE64_DIGITS.charAt(n & 63) : '='
  }
  return out
}

/**
 * Puts `text` on the clipboard of the machine the session runs on, for a host that attaches no surface to copy
 * through: Windows' Set-Clipboard, the text handed over as base64 so no quoting or code page touches it.
 */
export async function copyToHostClipboard($: EngineInterface, text: string): Promise<boolean> {
  if ((await $.env.get('OS')) !== 'Windows_NT') return false

  const value = `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64Utf8(text)}'))`
  try {
    const done = await $.process.run(
      ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -Value (${value})`],
      { timeoutMs: CLIPBOARD_TIMEOUT_MS },
    )
    return done.exitCode === 0
  } catch {
    return false // PowerShell would not start, or outran the timeout
  }
}

/** How many words a text has. */
export function wordsIn(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length
}

/**
 * The rules' grade of a task, from the prompt that starts it, for when the model gives none: hard for building,
 * reshaping or moving code and for long prompts or many paths; easy for a short question or a request to explain, with
 * nothing broken in it, nothing pasted and no change proposed; mid otherwise.
 */
export function gradeTask(text: string): TaskLevel {
  const words = wordsIn(text)
  const paths = new Set((text.match(PATH_LIKE) ?? []).map(path => path.toLowerCase())).size
  if (HARD_WORK.test(text) || words > HARD_MIN_WORDS || paths >= HARD_MIN_PATHS) return 'hard'

  const asked = text.trim().replace(SOFT_LEAD, '')
  const isQuestion =
    (QUESTION_LEAD.test(asked) || (YES_NO_LEAD.test(asked) && /\?\s*$/.test(asked))) && !PROPOSAL.test(asked)
  const isPlain =
    words <= EASY_MAX_WORDS && paths <= 1 && text.trim().split('\n').length <= 2 && !text.includes('```') && !DEBUG_SIGNS.test(text)
  return isQuestion && isPlain ? 'easy' : 'mid'
}

/**
 * Whether a prompt only answers the last turn: one of its choices, an acknowledgement ("ok thanks"), a short
 * continuation tied to the answer ("why?", "and the tests?", "go on"), or a short order ("push the change"), which
 * (outside an easy task, where an order starts work of its own) is taken up by the task already running. Being short
 * is not, by itself, enough: a short message that stands on its own, such as a greeting, starts a task and is graded.
 * Experimental (0.12.0).
 */
export function isReply(text: string, choices: readonly string[]): boolean {
  const same = (said: string) => said.trim().toLowerCase().replace(/[.!?]+$/, '')
  if (choices.some(choice => same(choice) === same(text))) return true
  if (wordsIn(text) > REPLY_MAX_WORDS || HARD_WORK.test(text)) return false
  if (isOrder(text)) return true
  const left = text.trim().replace(ACK_LEAD, '')
  return left.length === 0 || CONTINUES.test(left)
}

/** Whether a reply orders work rather than asks or acknowledges: "push it", "yep, let's do it", a bare "yes". */
export function isOrder(text: string): boolean {
  const said = text.trim()
  if (ORDER_LEAD.test(said.replace(REPLY_LEAD, ''))) return true
  return YES.test(said) && !/\?\s*$/.test(said)
}

/**
 * The grade of the task a prompt works on: the rules' when it starts a task, until the model grades it, and the
 * running task's when it only answers the last turn, with no grading asked. An order after an easy question starts a
 * task of its own, a pressed choice included, so the work does not stay on the easy model. `isNew` says a task starts.
 */
export function nextLevel(text: string, running: TaskLevel | null, choices: readonly string[]): { level: TaskLevel; isNew: boolean } {
  const graded = gradeTask(text)
  if (running === null) return { level: graded, isNew: true }
  if (running === 'easy' && isOrder(text)) return { level: graded === 'easy' ? 'mid' : graded, isNew: true }
  if (isReply(text, choices)) return { level: running, isNew: false }
  return { level: graded, isNew: true }
}

/** What a prompt of the person's gives the turn it starts; taken before it becomes the last prompt. */
export async function pendingTask($: EngineInterface, text: string, choices: readonly string[]): Promise<Pending> {
  const before = (await read($, last))?.text ?? ''
  return { kind: 'task', ...nextLevel(text, task?.level ?? null, choices), toGrade: { prompt: text, before, reply: lastReply } }
}

/** Takes the person's prompt for the turn it starts; a command's or a program's prompt leaves that turn alone. */
export async function noteTask($: EngineInterface, text: string, isLeftAlone: boolean): Promise<void> {
  if (isLeftAlone) {
    pending = { kind: 'skip' }
    return
  }
  pending = await pendingTask($, text, (await read($, suggested))?.choices ?? [])
}

/** A main-loop turn begins: it takes its task from the prompt that started it, and is fitted when `routes` are given. */
export function startTurn(turnId: string, routes: TurnRoutes | undefined): void {
  runningTurn = turnId
  const decided = pending
  pending = undefined
  if (decided?.kind === 'skip') return
  if (decided?.kind === 'task' && (decided.isNew || task === null)) {
    task = decided.asUsual
      ? { level: decided.level, asUsual: true }
      : decided.isSwitched
        ? { level: decided.level, isSwitched: true }
        : { level: decided.level, toGrade: decided.toGrade }
  }
  if (task !== null && routes !== undefined && !isFitRefused) fitted.set(turnId, { task, routes })
}

/** What the grading reads: the request before, the end of the last answer and the new request, each cut to size. */
export function gradingPrompt(toGrade: ToGrade): string {
  const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)
  const tail = toGrade.reply.length > GRADE_REPLY_CHARS ? `…${toGrade.reply.slice(-GRADE_REPLY_CHARS)}` : toGrade.reply
  return (
    `<previous_request>\n${cut(toGrade.before, GRADE_BEFORE_CHARS) || '(none)'}\n</previous_request>\n\n` +
    `<claude_reply_end>\n${tail || '(none)'}\n</claude_reply_end>\n\n` +
    `<new_request>\n${cut(toGrade.prompt, GRADE_PROMPT_CHARS)}\n</new_request>\n\n` +
    'Grade the new request: easy, mid or hard.'
  )
}

/** The grade a model's answer names first ("Mid.", "hard"); null when it names none. */
export function gradeOf(answer: string): TaskLevel | null {
  const named = /\b(easy|mid|medium|hard)\b/i.exec(answer)?.[1]?.toLowerCase()
  if (named === undefined) return null
  return named === 'medium' ? 'mid' : (named as TaskLevel)
}

/** One call of the grader; null when it gives no grade in time. */
export async function gradeOnce($: EngineInterface, toGrade: ToGrade, model: string = GRADE_MODEL): Promise<TaskLevel | null> {
  try {
    const answer = await $.model.complete({
      model,
      system: GRADE_SYSTEM,
      prompt: gradingPrompt(toGrade),
      maxTokens: GRADE_MAX_TOKENS,
      effort: GRADE_EFFORT,
      timeoutMs: GRADE_TIMEOUT_MS,
    })
    return answer.isAnswered ? gradeOf(answer.text) : null
  } catch {
    return null // a request the engine refuses to send: the rules' grade stands
  }
}

/**
 * The model's grade of a task: one call, or two at once with the harder grade kept, since a grade too low costs the
 * person a weaker model and a worse result while one too high only costs more. A call that fails leaves the other's
 * grade; null when none gives one, and the rules' grade stands.
 */
export async function gradeWithModel(
  $: EngineInterface,
  toGrade: ToGrade,
  grading: string = GRADE_ONCE,
  grader: string = GRADE_MODEL,
): Promise<TaskLevel | null> {
  if (grading !== GRADE_TWICE) return gradeOnce($, toGrade, grader)

  // Both calls start together. A hard grade ends the wait, as nothing is harder; once one call has given a grade, the
  // other has GRADE_GRACE_MS more, so a hung call never holds the task up for the whole timeout.
  const order: readonly TaskLevel[] = ['easy', 'mid', 'hard']
  const pending = new Map<number, Promise<{ id: number; grade: TaskLevel | null }>>()
  for (const id of [0, 1]) pending.set(id, gradeOnce($, toGrade, grader).then(grade => ({ id, grade })))

  let best: TaskLevel | null = null
  let grace: Promise<null> | undefined
  const stop = new AbortController()
  while (pending.size > 0 && best !== 'hard') {
    const done = await Promise.race(grace === undefined ? [...pending.values()] : [...pending.values(), grace])
    if (done === null) break

    pending.delete(done.id)
    if (done.grade !== null && (best === null || order.indexOf(done.grade) > order.indexOf(best))) best = done.grade
    if (best !== null) grace ??= $.clock.sleep(GRADE_GRACE_MS, { signal: stop.signal }).then(() => null, () => null)
  }
  stop.abort() // the grace wait is over, whichever way: no timer is left running
  return best
}

/** A model id without the context-window mark some carry ("claude-opus-5-5[1m]"). */
export function baseModel(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '')
}

/** A model's short name as the settings show it ("Sonnet 5.5"); the id itself for a model they do not list. */
export function modelName(model: string): string {
  const label = MODELS.find(option => option.value === baseModel(model))?.label
  return label === undefined ? model : (label.split(':')[0] ?? label)
}

/**
 * What a grade's task goes with in place of the session's own model and effort: its picker's model, with the
 * context-window mark the session's own model carries ("[1m]"), at its effort. Null leaves them as they are: for "my
 * model and effort", and for a session on a model the plugin cannot read.
 */
export function routeFor(level: TaskLevel, routes: Routes, own: Pick<TurnStepInput, 'model' | 'effort'>): Pick<Plan, 'model' | 'effort'> | null {
  const [model, named] = routes[level].split(':')
  const effort = EFFORT_LEVELS.find(known => known === named)
  if (model === undefined || effort === undefined || !FIRST_PARTY.test(baseModel(own.model))) return null
  return { model: `${model}${own.model.slice(baseModel(own.model).length)}`, effort }
}

/** Keeps the session's own model and effort as a main-loop turn's first request names them, for the settings pane. */
export async function noteOwn($: EngineInterface, e: TurnStepInput): Promise<void> {
  const seen: OwnRequest = { model: e.model, effort: e.effort === undefined ? null : String(e.effort) }
  const key = `${seen.model} ${String(seen.effort)}`
  if (key === ownKey) return
  ownKey = key
  try {
    await update($, own, () => seen)
  } catch {
    ownKey = '' // tried again at the next turn; the request itself goes on, fitted or not, either way
  }
}

/**
 * What "my model and effort" stands for in this session, for the settings while a grade's picker names it; null before
 * the first request is seen.
 */
export function ownNote(current: Routes, seen: OwnRequest | null): string | null {
  if (seen === null || ![current.easy, current.mid, current.hard].includes(OWN_ROUTE)) return null
  const effort = seen.effort === null ? '' : ` at ${seen.effort} effort`
  return `“My model and effort” is ${modelName(seen.model)}${effort} in this session.`
}

/**
 * Decides a fitted turn at its first request: the model grades its task when the turn starts one (once per task, so
 * its other turns keep the grade), and the turn goes with what that grade's picker names. Every fitted turn gets a
 * plan, so the band says what each one runs on.
 */
export async function planTurn($: EngineInterface, turn: FittedTurn, e: TurnStepInput): Promise<Plan> {
  const { task } = turn
  if (task.toGrade !== undefined) {
    const graded = FIRST_PARTY.test(baseModel(e.model)) ? await gradeWithModel($, task.toGrade, turn.routes.grading, turn.routes.grader) : null
    task.level = graded ?? task.level
    delete task.toGrade
  }
  // Past the limit only a hard task is worth the uncached read a switch costs; one the person switched asked for it.
  const limit = Number(turn.routes.limit)
  const isKept = !task.asUsual && !task.isSwitched && task.level !== 'hard' && Number.isFinite(limit) && (await contextTokens($)) >= limit
  const route = task.asUsual || isKept ? null : routeFor(task.level, turn.routes, e)
  return { level: task.level, model: route?.model ?? e.model, effort: route?.effort ?? e.effort, ownModel: e.model, ownEffort: e.effort, isKept }
}

/** The session's context fill in tokens: 0 before the first reading, unbounded where it cannot be read. */
export async function contextTokens($: EngineInterface): Promise<number> {
  try {
    return (await $.session.usage()).context.tokens ?? 0
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Whether a fitted turn runs on another model or effort than the session's own. */
export function isMoved(turn: { model: string; effort: unknown; ownModel: string; ownEffort: unknown }): boolean {
  return turn.model !== turn.ownModel || turn.effort !== turn.ownEffort
}

const EFFORT_ORDER: readonly string[] = EFFORT_LEVELS

/** A model and an effort as the comparisons below read them: a plan's, a request's or a band line's alike. */
type ModelAndEffort = { model: string; effort?: unknown }

/** Where a model's family stands, weakest first; -1 for a model the plugin cannot read. */
function familyRank(model: string): number {
  const family = familyOf(model)
  return family === null ? -1 : MODEL_FAMILIES.indexOf(family)
}

/**
 * Whether a grade's pick is a stronger model than the session's own, or the same model at a higher effort. An effort
 * the session's request named none of cannot be compared, so the same model at an unknown effort is no step up.
 */
export function isStronger(route: ModelAndEffort, own: ModelAndEffort): boolean {
  const [routeFamily, ownFamily] = [familyRank(route.model), familyRank(own.model)]
  if (routeFamily < 0 || ownFamily < 0) return false
  if (routeFamily !== ownFamily) return routeFamily > ownFamily

  const [routeEffort, ownEffort] = [EFFORT_ORDER.indexOf(String(route.effort)), EFFORT_ORDER.indexOf(String(own.effort))]
  return ownEffort >= 0 && routeEffort > ownEffort
}

/**
 * Whether a grade's pick is another model than the session's own, or the same model at another effort that both name:
 * what a suggestion can offer, up or down. An effort the session's request named none of cannot be compared.
 */
export function isElsewhere(route: ModelAndEffort, own: ModelAndEffort): boolean {
  const [routeFamily, ownFamily] = [familyRank(route.model), familyRank(own.model)]
  if (routeFamily < 0 || ownFamily < 0) return false
  if (routeFamily !== ownFamily) return true

  const [routeEffort, ownEffort] = [EFFORT_ORDER.indexOf(String(route.effort)), EFFORT_ORDER.indexOf(String(own.effort))]
  return ownEffort >= 0 && routeEffort >= 0 && routeEffort !== ownEffort
}

/** Whether any grade of the settings could name something other than the session's own: else there is nothing to ask. */
export function canSuggest(routes: Routes, own: Pick<TurnStepInput, 'model' | 'effort'>): boolean {
  return (['easy', 'mid', 'hard'] as const).some(level => {
    const route = routeFor(level, routes, own)
    return route !== null && isElsewhere(route, own)
  })
}

/** A plan as the band keeps it. */
export function routedOf(plan: Plan, at: number): RoutedTurn {
  const named = (effort: TurnStepInput['effort']) => (effort === undefined ? null : String(effort))
  return { level: plan.level, model: plan.model, effort: named(plan.effort), ownModel: plan.ownModel, ownEffort: named(plan.ownEffort), isKept: plan.isKept, isSuggestion: false, at }
}

/**
 * The grade of a new task asked of the model off the turn, which runs as the session set it: when it names another
 * model or effort than the one running, up for a hard task or down for an easy one, the band offers the switch. Nothing
 * is shown when it names what runs, when the person has moved on to another prompt, when no surface could show it, and
 * for a prompt with an image, which asking again would lose.
 */
async function suggestSwitch($: EngineInterface, turn: FittedTurn, e: TurnStepInput): Promise<void> {
  const { task: running, routes } = turn
  const { toGrade } = running
  if (toGrade === undefined) return

  delete running.toGrade // once per task: its follow-ups ask nothing
  const own = { model: e.model, effort: e.effort }
  if (!canSuggest(routes, own) || toGrade.prompt.includes(IMAGE_NOTE)) return

  const ask = epoch
  try {
    if ((await $.session.surfaces()).length === 0) return

    const graded = await gradeWithModel($, toGrade, routes.grading, routes.grader)
    running.level = graded ?? running.level
    const route = routeFor(running.level, routes, own)
    if (ask !== epoch || route === null || !isElsewhere(route, own)) return

    const named = (effort: TurnStepInput['effort']) => (effort === undefined ? null : String(effort))
    // A model of another family whose mode is Automatic is switched to as /model would, and its mode comes with it.
    const target = familyOf(route.model)
    const switchesSession = target !== null && target !== familyOf(e.model) && fitFor(settings, route.model) === 'auto'
    const shown: RoutedTurn = {
      level: running.level,
      model: route.model,
      effort: named(route.effort),
      ownModel: e.model,
      ownEffort: named(e.effort),
      isKept: false,
      isSuggestion: true,
      switchesSession,
      at: await $.clock.now(),
    }
    await update($, routed, () => shown)
    // A short turn may have ended before its grade came: its end line says what it ran on all the same.
    const ended = endedTurns.get(e.turnId)
    if (ended !== undefined) await noteEnd($, ended)
  } catch {
    // a suggestion is a bonus: the turn never hears of a failed one
  }
}

/**
 * Remembers what the turn that just ended ran on, where a fit or a suggestion is shown for it, and what it cost, for its
 * end line; a grade that lands later adds its words to the cost already there.
 */
async function noteEnd($: EngineInterface, durationMs: number, spend?: Spend): Promise<void> {
  const fit = await read($, routed)
  const words = fit === null ? undefined : fitWords(fit)
  if (words === undefined && spend === undefined) return
  await update($, endLines, lines => {
    const prior = lines.find(line => line.durationMs === durationMs)
    const line: EndLine = { durationMs, words: words ?? prior?.words, spend: spend ?? prior?.spend }
    return [...lines.filter(other => other.durationMs !== durationMs), line].slice(-ENDS_KEPT)
  })
}

/** The engine's figures as the meters keep them: the context's fill, and the week's rate-limit window. */
export function meterOf(context: { tokens?: number; percent?: number }, rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): MeterReading {
  const week = rateLimits.find(limit => limit.kind === WEEK_KIND)
  return {
    percent: context.percent ?? null,
    tokens: context.tokens ?? null,
    week: week === undefined ? null : { percent: week.percentUsed, resetsAt: week.resetsAt ?? null },
  }
}

/** Keeps a reading for the footer and the tips, drawn again only where it changed. */
async function keepMeter($: EngineInterface, reading: MeterReading): Promise<void> {
  await update($, meter, current => (JSON.stringify(current) === JSON.stringify(reading) ? current : reading))
}

/** Takes the engine's figures afresh; the meters keep their last reading where it cannot answer. */
async function loadMeter($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    await keepMeter($, meterOf(usage.context, usage.rateLimits))
  } catch {
    // the last reading stands
  }
}

/** What the session has cost so far in dollars; null where the engine keeps no figure. */
async function costSoFar($: EngineInterface): Promise<number | null> {
  try {
    return (await $.session.usage()).cost?.usd ?? null
  } catch {
    return null
  }
}

/** Tokens in a few characters: "128k", or the count under a thousand. */
export function tokensShort(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}k`
}

/** Dollars as the end line says them: "$0.04", or "<$0.01" for less than a cent. */
export function usdShort(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

/** How long until `resetsAt` from `now`, in its largest unit: "in 2 d", "in 5 h", "in 40 min"; null where unreadable or past. */
export function resetsIn(resetsAt: string, now: number): string | null {
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} d`
}

/** One of the footer's meters: its key, its label, how much is used in whole percent, and what follows it, if anything. */
export type Meter = { key: string; label: string; percent: number; after?: string }

/** The footer's meters: the context's fill, and the week's usage with, once it is mostly used, when it resets. */
export function metersOf(reading: MeterReading, now: number): Meter[] {
  const meters: Meter[] = []
  if (reading.percent !== null) meters.push({ key: 'ctxMeter', label: 'ctx', percent: reading.percent })
  if (reading.week !== null) {
    const resets = reading.week.percent >= WEEK_RESET_PERCENT && reading.week.resetsAt !== null ? resetsIn(reading.week.resetsAt, now) : null
    meters.push({ key: 'weekMeter', label: 'week', percent: Math.round(reading.week.percent), ...(resets === null ? {} : { after: `resets ${resets}` }) })
  }
  return meters
}

/** A meter's colour, a key of the person's theme: success under NUDGE_PERCENT, warning under TOAST_PERCENT, then error. */
export function meterColor(percent: number): 'success' | 'warning' | 'error' {
  return percent >= TOAST_PERCENT ? 'error' : percent >= NUDGE_PERCENT ? 'warning' : 'success'
}

/** How many of a meter's cells are full: as near its percent as five cells come, one at least for anything used. */
export function meterCells(percent: number): number {
  return percent <= 0 ? 0 : Math.min(METER_CELLS, Math.max(1, Math.round((percent / 100) * METER_CELLS)))
}

/** An idle time picked in the settings, as the warning says it: "5 min", "1 h". */
function idleLabel(minutes: string): string {
  return minutes === '60' ? '1 h' : `${minutes} min`
}

/**
 * What the line under the prompt says of the context, first of its tips: once the cache has likely gone cold, what the
 * next message reads again at full price; else past NUDGE_PERCENT, what each message sends again and how to cut it.
 * Empty where neither.
 */
export function contextTip(reading: MeterReading, current: Pick<Settings, 'meters' | 'coldAfter'>, isCold: boolean): string {
  if (reading.tokens === null) return ''
  const tokens = tokensShort(reading.tokens)
  if (isCold && current.coldAfter !== OFF) {
    return `idle ${idleLabel(current.coldAfter)}: the cache has likely expired, so your next message reads ${tokens} tokens again at full price`
  }
  if (current.meters && reading.percent !== null && reading.percent >= NUDGE_PERCENT) {
    return `context ${reading.percent}%: each message sends ${tokens} tokens again · /compact keeps the gist, /clear starts fresh`
  }
  return ''
}

/** What a turn spent: its dollars, and the share of its input the cache served; null where the engine gave neither. */
export function turnSpend(usd: number | null, usage: ModelUsage | undefined): Spend | null {
  const input = usage === undefined ? 0 : usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  // A first message, or one after the cache expired, reads nothing from the cache: it writes it, for the next to read.
  const isWritten = usage !== undefined && usage.cache_read_input_tokens === 0 && usage.cache_creation_input_tokens > 0
  const cache = usage === undefined || input === 0 ? null : isWritten ? 'written' : Math.round((usage.cache_read_input_tokens / input) * 100)
  return usd === null && cache === null ? null : { usd: usd === null ? null : Math.max(0, usd), cache }
}

/** The cache share as the end line says it: "96% cached", "cache written"; null for none. */
function cacheText(cache: Spend['cache']): string | null {
  return cache === null ? null : cache === 'written' ? 'cache written' : `${cache}% cached`
}

/** The cache share's colour, a key of the person's theme: success when most came from the cache, warning, then error. */
export function cacheColor(cache: number | 'written'): 'success' | 'warning' | 'error' {
  return cache === 'written' ? 'warning' : cache >= CACHE_GOOD ? 'success' : cache >= CACHE_FAIR ? 'warning' : 'error'
}

/** What a turn spent as its end line says it: "$0.04 · 96% cached"; null where the engine gave no figure. */
export function turnCost(usd: number | null, usage: ModelUsage | undefined): string | null {
  const spend = turnSpend(usd, usage)
  if (spend === null) return null
  return [spend.usd === null ? null : usdShort(spend.usd), cacheText(spend.cache)].filter(part => part !== null).join(' · ')
}

/** Past TOAST_PERCENT, a toast once on what each message sends again, until the fill drops under NUDGE_PERCENT. */
function toastFill($: EngineInterface, reading: MeterReading): void {
  const percent = reading.percent ?? 0
  if (percent < NUDGE_PERCENT) {
    isFillToasted = false
    return
  }
  if (percent < TOAST_PERCENT || isFillToasted || reading.tokens === null) return
  isFillToasted = true
  $.ui.toast(`Context ${percent}% full: each message sends ${tokensShort(reading.tokens)} tokens again. /compact keeps the gist, /clear starts fresh.`)
}

/**
 * Past the fill the settings pick, with no answer running: /compact, once until the fill drops under it again, so a
 * compaction that leaves the context past it does not run again and again.
 */
export async function compactPast($: EngineInterface, percent: number): Promise<void> {
  const at = Number((await loadSettings($)).compactAt)
  if (!Number.isFinite(at)) return
  if (percent < at) {
    isCompactArmed = true
    return
  }
  if (!isCompactArmed || isCompacting || runningTurn !== undefined) return
  isCompactArmed = false
  isCompacting = true
  $.ui.toast(`Context ${percent}% full: compacting, as /companion is set to.`)
  try {
    const result = await $.session.compact()
    if ('skip' in result && typeof result.skip === 'string') $.ui.toast(`Not compacted: ${result.skip}`)
  } catch (error) {
    $.ui.toast(`Could not compact: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isCompacting = false
  }
}

/**
 * Starts the wait for the cache to go cold, from an answer's end: none with the warning off, or for a conversation too
 * small to warn of.
 */
async function watchCold($: EngineInterface): Promise<void> {
  coldTimer?.cancel()
  coldTimer = undefined
  const minutes = Number(settings.coldAfter)
  if (!Number.isFinite(minutes) || ((await read($, meter)).tokens ?? 0) < COLD_MIN_TOKENS) return
  coldTimer = $.clock.after(minutes * 60_000, () => {
    void update($, isColdNow, () => true)
  })
}

/** A turn starts: the cache is warm again, and its wait starts over when the answer ends. */
async function warmCache($: EngineInterface): Promise<void> {
  coldTimer?.cancel()
  coldTimer = undefined
  await update($, isColdNow, () => false)
}

/** Shows in the band what a fitted turn runs on, or nothing when it runs as usual. */
export async function showPlan($: EngineInterface, plan: Plan | null): Promise<void> {
  const shown = plan === null ? null : routedOf(plan, await $.clock.now())
  await update($, routed, current => (current === null && shown === null ? current : shown))
}

/** The model and effort a request of a fitted turn goes with; undefined sends it as the engine made it. */
export async function routedStep($: EngineInterface, e: TurnStepInput): Promise<Pick<TurnStepInput, 'model' | 'effort'> | undefined> {
  const turn = e.agentId === undefined ? fitted.get(e.turnId) : undefined
  if (turn === undefined) return undefined
  if (turn.routes.fit === 'suggest' && !turn.task.isSwitched) {
    // Suggest: the request goes as the engine made it, with no wait. A new task's first request has its grade asked
    // off the turn, which only ever offers a switch.
    if (turn.plan === undefined) {
      turn.plan = null
      void suggestSwitch($, turn, e)
    }
    return undefined
  }
  if (turn.plan === undefined) {
    turn.plan = await planTurn($, turn, e)
    await showPlan($, turn.plan)
  }

  const { plan } = turn
  // A request on another model than the turn's first is the engine's own choice, a fallback: it stands. A turn its
  // grade keeps on the session's own model and effort goes as the engine made it.
  if (plan === null || e.model !== plan.ownModel || !isMoved(plan)) return undefined
  return plan.effort === undefined ? { model: plan.model } : { model: plan.model, effort: plan.effort }
}

/**
 * A fitted request failed before it answered, such as a model the person's organization blocks: this turn and the rest
 * of the session go as the engine makes them, and the person hears why once.
 */
export async function giveUpFitting($: EngineInterface, turnId: string): Promise<void> {
  const plan = fitted.get(turnId)?.plan
  isFitRefused = true
  fitted.clear()
  await showPlan($, null)
  const tried =
    plan === undefined || plan === null
      ? 'another model or effort'
      : plan.model === plan.ownModel
        ? `${String(plan.effort)} effort`
        : modelName(plan.model)
  $.ui.toast(`Could not send this task to ${tried}, so the session runs on its own model and effort from here.`)
}

/**
 * Sends a request of a fitted turn: refitted when its first request decided so. One that fails before anything
 * streams is sent again as the engine made it, unless the person interrupted it.
 */
export async function* fittedStream(
  $: EngineInterface,
  e: TurnStepInput,
  fit: Pick<TurnStepInput, 'model' | 'effort'>,
  send: (input: TurnStepInput) => AsyncGenerator<TurnStepChunk, TurnStepResult>,
  signal: AbortSignal,
): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  const stream = send({ ...e, ...fit })
  let first: IteratorResult<TurnStepChunk, TurnStepResult>
  try {
    first = await stream.next()
  } catch (error) {
    if (signal.aborted) throw error
    await giveUpFitting($, e.turnId)
    return yield* send(e)
  }
  if (first.done && first.value.stopReason === null && !signal.aborted) {
    // No response arrived and nobody interrupted: the request itself failed.
    await giveUpFitting($, e.turnId)
    return yield* send(e)
  }
  if (first.done) return first.value

  yield first.value
  return yield* stream
}

/** A model and effort in words: "Opus 5.5 at max effort", or the model alone where no effort is named. */
function runsOn(model: string, effort: string | null): string {
  return effort === null ? modelName(model) : `${modelName(model)} at ${effort} effort`
}

/** A fitted turn in words: "Easy task · Haiku 5.5 at low effort". */
export function describeRouted(turn: Pick<RoutedTurn, 'level' | 'model' | 'effort' | 'isKept'>): string {
  return `${GRADE_NAMES[turn.level]} task · ${runsOn(turn.model, turn.effort)}${turn.isKept ? ' · kept: long conversation' : ''}`
}

/** What a turn with a suggestion runs on, in words: "Hard task · Sonnet 5.5 at high effort". */
export function describeSuggested(turn: Pick<RoutedTurn, 'level' | 'ownModel' | 'ownEffort'>): string {
  return describeRouted({ level: turn.level, model: turn.ownModel, effort: turn.ownEffort, isKept: false })
}

/** A task sent on to its grade's pick, in words: "Easy task · follow-ups on Haiku 5.5 at low effort". */
export function describeOnward(turn: Pick<RoutedTurn, 'level' | 'model' | 'effort'>): string {
  return `${GRADE_NAMES[turn.level]} task · follow-ups on ${runsOn(turn.model, turn.effort)}`
}

/**
 * The label of the button that takes a task to what its grade names: "Switch to Opus 5.5 at max effort" while the answer
 * runs or for a stronger pick, which asks the prompt again; "Continue on Haiku 5.5 at low effort" for a cheaper pick
 * once the answer is in, which sends the follow-ups there; "with Automatic on" where that model's mode is Automatic, so
 * the session moves there too.
 */
export function switchLabel(turn: Pick<RoutedTurn, 'model' | 'effort' | 'ownModel' | 'ownEffort' | 'switchesSession'>, isWorking: boolean): string {
  const verb = isWorking || isStronger(turn, { model: turn.ownModel, effort: turn.ownEffort }) ? 'Switch to' : 'Continue on'
  return turn.switchesSession === true ? `${verb} ${modelName(turn.model)} with Automatic on` : `${verb} ${runsOn(turn.model, turn.effort)}`
}

/** The label of the link that asks the last prompt again as usual: on the session's model, or at its effort. */
export function redoLabel(turn: RoutedTurn): string {
  if (turn.model !== turn.ownModel) return `Ask again on ${modelName(turn.ownModel)}`
  return turn.ownEffort === null ? 'Ask again as usual' : `Ask again at ${turn.ownEffort} effort`
}

/** Asks the last prompt again on the session's own model and effort, once however often it is pressed. */
export async function redoAsUsual($: EngineInterface): Promise<void> {
  const taken: { turn: RoutedTurn | null } = { turn: null }
  await update($, routed, current => {
    taken.turn = current
    return null
  })
  const prompt = await read($, last)
  if (taken.turn === null || prompt === null) return

  // A new task on the session's own model and effort, under the grade it had: its follow-ups stay there.
  pending = { kind: 'task', level: taken.turn.level, isNew: true, asUsual: true, toGrade: { prompt: prompt.text, before: '', reply: '' } }
  await recordPrompt($, prompt.text, prompt.isFromProgram)
  await $.prompt.submit({ text: prompt.text, asUser: true })
}

/**
 * A suggestion pressed: the running answer is stopped, if there is one, and the last prompt is asked again on what its
 * grade names, a new task there whose follow-ups stay. Once the answer is in, a cheaper pick would only repeat it, so
 * the task goes on there from its next turn instead. Where that model's mode is Automatic, the session switches to it
 * first, as /model does, so Automatic fits the tasks after. Once however often it is pressed.
 */
export async function switchToFit($: EngineInterface): Promise<void> {
  const taken: { turn: RoutedTurn | null } = { turn: null }
  await update($, routed, current => {
    const isOffered = current !== null && current.isSuggestion
    taken.turn = isOffered ? current : null
    return isOffered ? null : current
  })
  const offered = taken.turn
  const prompt = await read($, last)
  if (offered === null || prompt === null) return

  const isRunning = runningTurn !== undefined
  if (isRunning) {
    try {
      await $.turn.abort({ turnId: runningTurn as string })
    } catch {
      // it ended meanwhile: the prompt is asked again all the same
    }
  }
  if (offered.switchesSession === true) {
    try {
      await $.command.run({ command: 'model', args: offered.model })
    } catch {
      // the session stays on its model: the task alone switches, as any other suggestion's does
    }
  }
  if (!isRunning && !isStronger(offered, { model: offered.ownModel, effort: offered.ownEffort })) {
    task = { level: offered.level, isSwitched: true }
    const at = await $.clock.now()
    await update($, routed, () => ({ ...offered, isSuggestion: false, isOnward: true, at }))
    return
  }
  pending = { kind: 'task', level: offered.level, isNew: true, isSwitched: true, toGrade: { prompt: prompt.text, before: '', reply: '' } }
  await recordPrompt($, prompt.text, prompt.isFromProgram)
  await $.prompt.submit({ text: prompt.text, asUser: true })
}

/** The elements the band and the panes draw with, which every surface carries. */
type Parts = Pick<ElementTable, 'Box' | 'Button' | 'Markdown' | 'Text'>

/** Text as markdown that draws it as written: every ASCII punctuation mark escaped, so nothing formats or links. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[!-/:-@[-`{-~]/g, '\\$&')
}

/** The last prompt as a markdown quote, on one line and at most `max` characters. */
export function quoteOf(text: string, max: number): string {
  return `> ${escapeMarkdown(oneLine(text, max))}`
}

/** A fitted turn in words, as its line says it: where its follow-ups go, what it runs on, or what it ran on. */
export function fitWords(fit: RoutedTurn): string {
  return fit.isOnward === true ? describeOnward(fit) : fit.isSuggestion ? describeSuggested(fit) : describeRouted(fit)
}

/**
 * What the line on a fitted turn needs to know of where it is drawn. `isQuiet`: the terminal's band, where the turn's
 * end line says what it ran on, so the band draws the line for its button, while the answer runs, or for words no end
 * line says (`showsWords`, as where a task was just sent on), and its words only where `showsWords`.
 */
type FitRowOptions = { hasPrompt: boolean; isWorking: boolean; isTerminal: boolean; hasNumberKeys: boolean; isQuiet?: boolean; showsWords?: boolean }

/**
 * What a turn runs on, quietly, with one button: the switch a suggestion offers (stopping the answer that is running,
 * or sending a finished task's follow-ups on), or once a fitted turn that ran on something else has ended, the redo that
 * asks the prompt again as usual; a task sent on shows where its follow-ups go, with nothing to press. A dim line and a
 * button on the terminal (0 presses it, with the number keys on), one dim markdown line with its link elsewhere. Null
 * where a quiet band has nothing of it to draw.
 */
function fitRow($: EngineInterface, ui: Parts, fit: RoutedTurn, { hasPrompt, isWorking, isTerminal, hasNumberKeys, isQuiet = false, showsWords = true }: FitRowOptions) {
  const { Box, Button, Markdown, Text } = ui
  const { isSuggestion } = fit
  const isOnward = fit.isOnward === true
  const hasButton = hasPrompt && !isOnward && (isSuggestion || (!isWorking && isMoved(fit)))
  if (isQuiet && !hasButton && !isWorking && !showsWords) return null
  const words = fitWords(fit)
  const label = isSuggestion ? switchLabel(fit, isWorking) : redoLabel(fit)
  const key = isSuggestion ? 'switch' : 'redo'
  const press = () => (isSuggestion ? switchToFit($) : redoAsUsual($))
  if (!isTerminal) {
    return (
      <Box key="fit">
        <Markdown
          key="task"
          text={`${escapeMarkdown(words)}${hasButton ? ` · [${escapeMarkdown(label)}](${REDO_HREF})` : ''}`}
          dimColor
          {...(hasButton ? { pressableLinks: [REDO_HREF], onLinkPress: press } : {})}
        />
      </Box>
    )
  }
  return (
    <Box key="fit" flexWrap="wrap" columnGap={2}>
      {(showsWords || !hasButton) && (
        <Box key="task" flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {words}
          </Text>
        </Box>
      )}
      {hasButton && hasNumberKeys && <Button key={key} label={label} plain hotkey="0" onPress={press} />}
      {hasButton && !hasNumberKeys && (
        <Button key={key} label={label} plain onPress={press}>
          <Text color={ACCENT}>{`${label}${CHEVRON}`}</Text>
        </Button>
      )}
    </Box>
  )
}

/**
 * The choices where the surface lays text out itself: a small "Suggested" label over one quiet button per choice, a ↳
 * and the choice. `dimColor` asks for the surface's secondary button, the dark one VS Code draws for the ⋯, rather
 * than its filled one; the choice is a Text child so it wraps inside its button.
 */
function choiceList($: EngineInterface, ui: Parts, choices: readonly string[], trailing: RenderElement | null = null) {
  const { Box, Button, Text } = ui
  const caption = (
    <Text size="caption" weight="semibold" dimColor>
      {SUGGESTED}
    </Text>
  )
  return (
    <Box key="choices" flexDirection="column" rowGap="xs">
      {trailing === null ? (
        caption
      ) : (
        <Box key="head" flexWrap="nowrap" columnGap={1}>
          <Box key="caption" flexGrow={1} flexShrink={1}>
            {caption}
          </Box>
          {trailing}
        </Box>
      )}
      {choices.map((choice, i) => (
        <Button key={`choice-${i + 1}`} label={choice} plain dimColor onPress={() => pressChoice($, choice, choices)}>
          <Text color="text">{`${MARKER} ${choice}`}</Text>
        </Button>
      ))}
    </Box>
  )
}

/**
 * The choices on the terminal, numbered as Claude Code's own surveys number their answers, one a line: with the number
 * keys on, a number typed into the empty prompt box picks one. The hint line under the prompt box says so.
 */
function numberedChoices($: EngineInterface, ui: Parts, choices: readonly string[], columns: number, current: Settings) {
  const { Box, Button } = ui
  const room = Math.max(10, columns - (current.numberKeys ? HOTKEY_COLUMNS : BUTTON_CHROME))
  return (
    <Box key="choices" flexDirection="column">
      {choices.map((choice, i) =>
        current.numberKeys ? (
          <Button key={`choice-${i + 1}`} label={oneLine(choice, room)} plain hotkey={String(i + 1)} onPress={() => pressChoice($, choice, choices)} />
        ) : (
          <Button key={`choice-${i + 1}`} label={oneLine(choice, room)} onPress={() => pressChoice($, choice, choices)} />
        ),
      )}
    </Box>
  )
}

/** One of the band's keys on the terminal: a digit from the empty prompt box presses it, or with the number keys off, the band's focus. */
function keyButton(ui: Parts, current: Settings, key: string, label: string, hotkey: string, press: () => Promise<unknown>) {
  const { Button } = ui
  return current.numberKeys ? <Button key={key} label={label} plain hotkey={hotkey} onPress={press} /> : <Button key={key} label={label} onPress={press} />
}

/**
 * The terminal's keys: 7 copies Claude's last answer (once there is one), 8 opens the queue and 9 the notes. In the band,
 * hidden, for the digits, or beside the last prompt for the band's focus; and under the prompt box, for the eye and a
 * click.
 */
function bandKeys($: EngineInterface, ui: Parts, current: Settings, surface: RenderSurface, isAnswered: boolean) {
  return [
    isAnswered ? keyButton(ui, current, 'copyKey', COPY_LABEL, COPY_KEY, () => copyLastAnswer($, surface)) : null,
    keyButton(ui, current, 'queueKey', QUEUE_BUTTON_LABEL, QUEUE_HOTKEY, () => pressQueueButton($)),
    keyButton(ui, current, 'noteKey', NOTES_KEY_LABEL, NOTE_KEY, () => pressNotesKey($)),
  ].filter(key => key !== null)
}

/** The columns the band's keys take on the last prompt's row: each one's number or brackets and label, and the gaps. */
function keysColumns(current: Settings, isAnswered: boolean): number {
  const labels = [isAnswered ? COPY_LABEL : null, QUEUE_BUTTON_LABEL, NOTES_KEY_LABEL].filter(label => label !== null)
  const chrome = current.numberKeys ? HOTKEY_COLUMNS : BUTTON_CHROME
  return labels.reduce((sum, label) => sum + chrome + label.length, 0) + KEYS_GAP * labels.length
}

/** How the terminal picks a choice from the keys: its number, or with the number keys off, the band's focus. */
export function pickHint(current: Pick<Settings, 'numberKeys' | 'onPress'>, count: number): string {
  if (!current.numberKeys) return BAND_FOCUS_HINT
  const numbers = count === 1 ? '1' : `1–${count}`
  return current.onPress === 'box' ? `type ${numbers} to edit before sending` : `type ${numbers} to send`
}

/** One row of the terminal's settings menu: the setting, its label there, its options and a line on what it does. */
type MenuRow = { field: keyof Settings; label: string; options: readonly SelectOption[]; about: string }

const SUGGEST_ROWS: readonly MenuRow[] = [
  { field: 'suggest', label: 'Suggest next messages', options: ON_OFF, about: 'After each answer a model writes the messages you are likeliest to send next.' },
  { field: 'model', label: 'Model', options: MODELS, about: 'The model that writes them, as part of your plan’s usage.' },
  { field: 'effort', label: 'Thinking effort', options: EFFORTS, about: 'How long that model thinks before it writes them.' },
  { field: 'choices', label: 'Number of choices', options: CHOICE_COUNTS, about: 'How many it offers after each answer.' },
  { field: 'onPress', label: 'Picking a choice', options: PRESS_ACTIONS, about: 'Sends the choice as your message, or puts it in the prompt box to edit first.' },
  {
    field: 'numberKeys',
    label: 'Number keys',
    options: ON_OFF,
    about: 'A choice’s number typed into the empty prompt box picks it. Off, a number there is typed as usual.',
  },
]
const ROUTE_ROWS: readonly MenuRow[] = [
  {
    field: 'fit',
    label: 'Fit to each task',
    options: FIT_MODES,
    about:
      'A model grades each new task. Suggest changes nothing and offers a button when another model would fit; Automatic switches on its own. Each model keeps the mode you pick while on it.',
  },
  { field: 'easy', label: 'Easy tasks', options: TIER_ROUTES, about: 'What questions, lookups and short explanations run on, or are suggested to switch to.' },
  { field: 'mid', label: 'Mid tasks', options: TIER_ROUTES, about: 'What everyday changes, commands and fixes with a clear cause run on, or are suggested to switch to.' },
  { field: 'hard', label: 'Hard tasks', options: TIER_ROUTES, about: 'What planning, refactors, migrations and bugs with an unclear cause run on, or are suggested to switch to.' },
  { field: 'limit', label: 'Switch limit', options: LIMITS, about: 'Automatic only: past this size of conversation only hard tasks switch, since a switch reads it once uncached.' },
  { field: 'grader', label: 'Grader', options: MODELS, about: 'The model that grades each new task, at low effort, as part of your plan’s usage.' },
  { field: 'grading', label: 'Grading', options: GRADINGS, about: 'Two calls keep the harder of two grades, for twice the grading cost.' },
]
const PROMPT_ROWS: readonly MenuRow[] = [{ field: 'lastPrompt', label: 'In VS Code', options: ON_OFF, about: PROMPT_NOTE }]
const NOTE_ROWS: readonly MenuRow[] = [{ field: 'noteButton', label: 'Copy, queue, notes keys', options: ON_OFF, about: NOTE_BUTTON_NOTE }]
const METER_ROWS: readonly MenuRow[] = [
  { field: 'meters', label: 'Meters', options: ON_OFF, about: METERS_NOTE },
  { field: 'coldAfter', label: 'Cold cache warning', options: COLD_AFTERS, about: COLD_NOTE },
  { field: 'compactAt', label: 'Auto-compact', options: COMPACT_ATS, about: COMPACT_NOTE },
  { field: 'doneAfter', label: 'Done alert', options: DONE_AFTERS, about: DONE_NOTE },
]
const MENU: readonly MenuRow[] = [...SUGGEST_ROWS, ...ROUTE_ROWS, ...PROMPT_ROWS, ...NOTE_ROWS, ...METER_ROWS]

/** A setting's value as its picker holds it: booleans as on or off, the number of choices as text. */
function pickerValue(current: Settings, field: keyof Settings): string {
  const value = current[field]
  return typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)
}

/** An option's label up to its colon, as a menu row shows it: "Sonnet 5.5", "High". */
export function shortLabel(label: string): string {
  return label.split(': ')[0] ?? label
}

/** The keys of a menu row and of an option in a setting's list. */
const ROW_KEY = 'setting-'
const rowKey = (field: keyof Settings): string => `${ROW_KEY}${field}`
const optionKey = (value: string): string => `option-${value}`

/** What the line atop the menu says of a row: what it does, and what "my model and effort" is where a grade names it. */
function aboutOf(row: MenuRow, current: Settings, note: string | null): string {
  const isOwn = (row.field === 'easy' || row.field === 'mid' || row.field === 'hard') && current[row.field] === OWN_ROUTE
  return isOwn && note !== null ? `${row.about} ${note}` : row.about
}

/** A menu row pressed: a switch flips where it stands; any other setting lists its options, the ring on its own. */
async function pressMenuRow($: EngineInterface, row: MenuRow): Promise<void> {
  const current = await loadSettings($)
  if (row.options === ON_OFF) {
    await changeSetting($, row.field, !current[row.field])
    return
  }
  await update($, menuView, () => row.field)
  await focusMenu($, optionKey(pickerValue(current, row.field)))
}

/** An option picked: saved, and back to the list with the ring on its row. */
async function pickOption($: EngineInterface, row: MenuRow, value: string): Promise<void> {
  await changeSetting($, row.field, row.options === ON_OFF ? value === 'on' : value)
  await update($, menuView, () => MENU_LIST)
  await focusMenu($, rowKey(row.field))
}

/**
 * Moves the menu's ring onto `key` once the next drawing brings it, and the window as little as shows it; where the
 * ring cannot move, it stays put. The line on what the row does follows at once.
 */
async function focusMenu($: EngineInterface, key: string): Promise<void> {
  await update($, menuFocus, () => key)
  try {
    await $.ui.focus({ requestId: SETTINGS_PANE, key })
    await $.ui.scroll({ in: SETTINGS_PANE, to: { key } })
  } catch {
    // the ring stays on the row it was on
  }
}

/** The keys the menu's ring walks in the view shown, top to bottom: the rows, or the options of the setting open. */
async function menuKeys($: EngineInterface): Promise<string[]> {
  const view = await read($, menuView)
  const open = MENU.find(row => row.field === view)
  return open === undefined ? MENU.map(row => rowKey(row.field)) : open.options.map(option => optionKey(option.value))
}

/**
 * The settings as the terminal's menu, where no picker opens under a pointer: a row per setting with its value, which
 * the arrows walk and Enter changes. The keys and a line on what the row under the ring does head it, where a terminal
 * too short to show it whole still shows them. A switch flips in place; any other setting lists its options, numbered
 * as Claude Code numbers a menu's.
 */
function settingsMenu($: EngineInterface, ui: Parts, current: Settings, view: string, focus: string | null, note: string | null) {
  const { Box, Button, Text } = ui
  const open = MENU.find(row => row.field === view)
  if (open !== undefined) return optionList($, ui, current, open, note)

  const focused = MENU.find(row => rowKey(row.field) === focus) ?? SUGGEST_ROWS[0]
  const rowButton = (row: MenuRow, isFirst: boolean) => (
    <Button key={rowKey(row.field)} label={row.label} plain {...(isFirst ? { autoFocus: true as const } : {})} onPress={() => pressMenuRow($, row)}>
      {row.label.padEnd(MENU_LABEL_COLUMNS)}
      <Text color={ACCENT}>{shortLabel(labelOf(row.options, pickerValue(current, row.field)))}</Text>
    </Button>
  )
  return (
    <Box flexDirection="column">
      <Box key="title">
        <Text weight="semibold">{SETTINGS_TITLE}</Text>
        <Text dimColor>{` · ${MENU_KEYS}`}</Text>
      </Box>
      {focused !== undefined && (
        <Box key="about">
          <Text dimColor>{aboutOf(focused, current, note)}</Text>
        </Box>
      )}
      <Text weight="semibold">Suggested next messages</Text>
      <Box key="suggestRows" flexDirection="column" paddingLeft={2}>
        {SUGGEST_ROWS.map((row, i) => rowButton(row, i === 0))}
      </Box>
      <Text weight="semibold">Model and effort for each task</Text>
      <Box key="routeRows" flexDirection="column" paddingLeft={2}>
        {ROUTE_ROWS.map(row => rowButton(row, false))}
      </Box>
      <Text weight="semibold">Last prompt</Text>
      <Box key="promptRows" flexDirection="column" paddingLeft={2}>
        {PROMPT_ROWS.map(row => rowButton(row, false))}
      </Box>
      <Text weight="semibold">Notes</Text>
      <Box key="noteRows" flexDirection="column" paddingLeft={2}>
        {NOTE_ROWS.map(row => rowButton(row, false))}
      </Box>
      <Text weight="semibold">Meters and alerts</Text>
      <Box key="meterRows" flexDirection="column" paddingLeft={2}>
        {METER_ROWS.map(row => rowButton(row, false))}
      </Box>
    </Box>
  )
}

/** One setting's options, numbered (the first nine, and 0 for a tenth), its own marked; Enter or a number picks. */
function optionList($: EngineInterface, ui: Parts, current: Settings, row: MenuRow, note: string | null) {
  const { Box, Button, Text } = ui
  const value = pickerValue(current, row.field)
  return (
    <Box flexDirection="column">
      <Box key="title">
        <Text weight="semibold">{row.label}</Text>
        <Text dimColor>{` · ${OPTION_KEYS}`}</Text>
      </Box>
      <Box key="about">
        <Text dimColor>{aboutOf(row, current, note)}</Text>
      </Box>
      <Box key="options" flexDirection="column" paddingLeft={2}>
        {row.options.map((option, i) => {
          const hotkey = i < 9 ? String(i + 1) : i === 9 ? '0' : undefined
          const label = option.label ?? option.value
          return (
            <Button key={optionKey(option.value)} label={label} plain {...(hotkey === undefined ? {} : { hotkey })} onPress={() => pickOption($, row, option.value)}>
              {`${hotkey === undefined ? ' '.repeat(HOTKEY_COLUMNS) : ''}${label}${option.value === value ? '  ✓' : ''}`}
            </Button>
          )
        })}
      </Box>
    </Box>
  )
}

/** After /clear: the settings, the project's queue and notes, the keys, the setup and the meters read again. */
async function reloadAfterClear($: EngineInterface): Promise<void> {
  await loadSettings($)
  await loadQueue($)
  await loadNotes($)
  await loadBoundKeys($)
  await loadSetupDone($)
  await loadMeter($)
}

/** A turn's length as the alert says it: "45s", "2m 4s". */
export function durationText(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * Once an answer that ran past the time the settings pick ends: a notification through the person's own channel; on
 * Windows, where the terminal has none, the system's notify sound. Notifications the person switched off stay off.
 */
export async function alertDone($: EngineInterface, durationMs: number, answer: string): Promise<void> {
  const after = Number(settings.doneAfter)
  if (!Number.isFinite(after) || durationMs < after * 1000) return
  try {
    const sent = await $.ui.notify(`Done after ${durationText(durationMs)}: ${oneLine(answer, DONE_TEXT_CHARS)}`, { title: DONE_TITLE })
    if (sent.isSent || sent.reason !== 'no-channel') return
  } catch {
    return // a hook refused it, or the write failed
  }
  if ((await $.env.get('OS')) !== 'Windows_NT') return
  try {
    await $.process.run([...WINDOWS_DING], { timeoutMs: DING_TIMEOUT_MS })
  } catch {
    // no sound: PowerShell would not start
  }
}

/** The file a tool call names, as its input gives it; null for none. */
function fileOf(input: Record<string, unknown>): string | null {
  const path = input.file_path ?? input.notebook_path ?? input.path
  return typeof path === 'string' && path.length > 0 ? path : null
}

/** A path as Companion names it: relative to the session's folder where it lies under it, with forward slashes. */
export function shortPath(path: string, root: string): string {
  const slashed = path.replace(/\\/g, '/')
  const base = root.replace(/\\/g, '/').replace(/\/$/, '')
  return base.length > 0 && slashed.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? slashed.slice(base.length + 1) : slashed
}

/** The files the conversation changed, each once where it was last changed, the latest last. */
export function filesChanged(messages: readonly SessionMessage[], root: string): string[] {
  const files: string[] = []
  for (const message of messages) {
    for (const use of message.toolUses) {
      const file = EDIT_TOOLS.has(use.tool) ? fileOf(use.input) : null
      if (file === null) continue
      const short = shortPath(file, root)
      if (files.includes(short)) files.splice(files.indexOf(short), 1)
      files.push(short)
    }
  }
  return files.slice(-HANDOFF_FILES)
}

/** The end of the conversation as the handoff's model reads it: each message's words, as many of the latest as fit. */
export function handoffDigest(messages: readonly SessionMessage[]): string {
  const lines: string[] = []
  let room = HANDOFF_DIGEST_CHARS
  for (const message of [...messages].reverse()) {
    const text = oneLine(message.text, HANDOFF_MESSAGE_CHARS)
    if (text.length === 0) continue
    const line = `${message.role === 'user' ? 'Person' : 'Claude'}: ${text}`
    if (line.length > room) break
    lines.unshift(line)
    room -= line.length
  }
  return lines.join('\n\n')
}

/** The note the fresh conversation starts from: the lead, the model's four lines, and the files changed. */
export function handoffText(written: string, files: readonly string[]): string {
  const body = written.trim().replace(/\n{2,}/g, '\n')
  return [HANDOFF_LEAD, body, files.length === 0 ? '' : `Files changed: ${files.join(', ')}`].filter(part => part.length > 0).join('\n')
}

/** The handoff where the prompt box would not take it: copied for a paste, else in a toast. */
async function copyHandoff($: EngineInterface, handoff: string): Promise<void> {
  const [surface] = await $.session.surfaces()
  const isCopied = surface !== undefined && (await $.ui.copy({ text: handoff, surface })).isCopied
  $.ui.toast(isCopied ? 'Cleared. The handoff is copied: paste it into the prompt box.' : `Cleared. The handoff: ${handoff}`)
}

/**
 * /fresh: a handoff written from the conversation, /clear, and the handoff in the prompt box to edit or send. Nothing
 * is cleared where the handoff could not be written, and nothing starts while an answer runs.
 */
export async function startFresh($: EngineInterface): Promise<void> {
  if (runningTurn !== undefined) {
    $.ui.toast('An answer is still running: /fresh once it ends.')
    return
  }
  const messages = await $.session.messages()
  const digest = handoffDigest(messages)
  if (digest.length === 0) {
    $.ui.toast('Nothing to hand over yet: this conversation is empty.')
    return
  }
  let written = ''
  try {
    const answer = await $.model.complete({
      model: settings.model,
      system: HANDOFF_SYSTEM,
      prompt: digest,
      maxTokens: HANDOFF_MAX_TOKENS,
      effort: 'low',
      timeoutMs: HANDOFF_TIMEOUT_MS,
    })
    written = answer.isAnswered ? answer.text : ''
  } catch {
    written = '' // a request the engine refuses to send
  }
  if (written.trim().length === 0) {
    $.ui.toast('Could not write the handoff, so nothing was cleared.')
    return
  }
  const handoff = handoffText(written, filesChanged(messages, await projectRoot($)))
  try {
    await $.command.run({ command: 'clear', args: '' })
  } catch {
    await copyHandoff($, handoff)
    $.ui.toast('Could not clear the conversation: type /clear, then paste the handoff, which is copied.')
    return
  }
  const filled = await $.prompt.fill({ text: handoff, mode: 'replace' })
  if (filled.isFilled) {
    $.ui.toast('Cleared. The handoff is in the prompt box: edit it, or press Enter.')
    return
  }
  await copyHandoff($, handoff)
}

/** A tool call as the X-ray names it: the tool and its file or command, "Read parser.ts", "Bash npm test". */
function callLabel(use: ToolUseSummary, root: string): string {
  const file = fileOf(use.input)
  const command = typeof use.input.command === 'string' ? oneLine(use.input.command, 30) : null
  const what = file !== null ? xrayPath(file, root) : command
  return what === null || what.length === 0 ? use.tool : `${use.tool} ${what}`
}

/** A path as the X-ray names it: relative to the session's folder where it lies under it, else its last two parts. */
export function xrayPath(path: string, root: string): string {
  const short = shortPath(path, root)
  return short.includes(':') || short.startsWith('/') ? short.split('/').slice(-2).join('/') : short
}

/** The biggest tool outputs still in the conversation, by their stored text, in tokens estimated from it. */
export function biggestOutputs(messages: readonly SessionMessage[], root: string): XrayPart[] {
  return messages
    .flatMap(message => message.toolUses)
    .filter(use => (use.text ?? '').length > 0)
    .map(use => ({ label: callLabel(use, root), tokens: Math.round((use.text ?? '').length / CHARS_PER_TOKEN) }))
    .filter(part => part.tokens >= XRAY_MIN_OUTPUT)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, XRAY_PARTS)
}

/** What to cut first: the MCP tool lists, the memory files or the conversation, where one weighs; else nothing yet. */
export function xrayTip({ window, percent, mcp, memory, biggestMemory }: { window: number; percent: number; mcp: number; memory: number; biggestMemory?: string }): string {
  if (mcp >= window * MCP_HEAVY) return `MCP tool lists take ${tokensShort(mcp)} of every message: turn off the servers you do not use in /mcp.`
  if (memory >= window * MEMORY_HEAVY && biggestMemory !== undefined) {
    return `Memory files take ${tokensShort(memory)} of every message: trim the biggest, ${biggestMemory}.`
  }
  if (percent >= CONVERSATION_HEAVY) return 'Most of it is the conversation: /compact keeps the gist, /fresh starts over with a handoff.'
  return 'Plenty of room: nothing to cut yet.'
}

/** The X-ray of a breakdown: its rows, the biggest outputs, the MCP servers and memory files, and the tip. */
export function xrayOf(breakdown: SessionContextBreakdown, messages: readonly SessionMessage[], root: string): XrayView {
  const biggestFirst = (a: XrayPart, b: XrayPart) => b.tokens - a.tokens
  const sum = (parts: readonly XrayPart[]) => parts.reduce((total, part) => total + part.tokens, 0)
  const byServer = new Map<string, number>()
  for (const tool of breakdown.mcpTools) {
    if (tool.isLoaded) byServer.set(tool.serverName, (byServer.get(tool.serverName) ?? 0) + tool.tokens)
  }
  const servers = [...byServer].map(([label, tokens]) => ({ label, tokens })).sort(biggestFirst)
  const memory = breakdown.memoryFiles.map(file => ({ label: xrayPath(file.path, root), tokens: file.tokens })).sort(biggestFirst)
  const percent = Math.round(breakdown.percentage)
  const window = breakdown.rawMaxTokens
  return {
    tokens: breakdown.totalTokens,
    window,
    percent,
    rows: breakdown.categories
      .filter(category => !category.isDeferred && category.tokens > 0)
      .map(category => ({ name: category.name, tokens: category.tokens, color: category.color, isUsed: category.kind === 'used' })),
    outputs: biggestOutputs(messages, root),
    servers: servers.slice(0, XRAY_PARTS),
    memory: memory.slice(0, XRAY_PARTS),
    tip: xrayTip({ window, percent, mcp: sum(servers), memory: sum(memory), ...(memory[0] === undefined ? {} : { biggestMemory: memory[0].label }) }),
  }
}

/** How many of a row's ten cells are full: its share of the window, one at least for anything in it. */
export function xrayCells(tokens: number, window: number): number {
  return tokens <= 0 || window <= 0 ? 0 : Math.min(XRAY_CELLS, Math.max(1, Math.round((tokens / window) * XRAY_CELLS)))
}

/** A list of the X-ray's parts in a line: "Read parser.ts 12k · Bash npm test 8k". */
function partsText(parts: readonly XrayPart[]): string {
  return parts.map(part => `${part.label} ${tokensShort(part.tokens)}`).join(' · ')
}

/** The X-ray as text, where no pane is placed: its fill, a line per row, the lists and the tip. */
export function xrayText(view: XrayView): string {
  return [
    `${XRAY_TITLE}: ${tokensShort(view.tokens)} of ${tokensShort(view.window)} (${view.percent}%)`,
    ...view.rows.map(row => `${row.name}: ${tokensShort(row.tokens)}`),
    view.outputs.length === 0 ? '' : `Biggest tool outputs: ${partsText(view.outputs)}`,
    view.servers.length === 0 ? '' : `MCP servers: ${partsText(view.servers)}`,
    view.memory.length === 0 ? '' : `Memory files: ${partsText(view.memory)}`,
    view.tip,
  ]
    .filter(line => line.length > 0)
    .join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadSettings($)
    await $.command.register({
      name: 'companion',
      description: 'Open the companion settings: the suggested next messages, and fitting the model and effort to each task',
    })
    await $.command.register({
      name: 'last-prompt',
      description: 'Show your most recent prompt and the suggested next ones',
    })
    await $.command.register({
      name: 'copy-next',
      description: 'Copy a suggested next message to the clipboard (the first, or the one numbered)',
      argumentHint: '[1-5]',
    })
    await $.command.register({
      name: 'note',
      description: 'Keep a message for later in this project, or with nothing after it open the notes',
      argumentHint: '[text to keep]',
    })
    await $.command.register({
      name: 'notes',
      description: 'Open the notes kept for this project; "clear" drops them all, "export" writes them to NOTES.md',
      argumentHint: '[clear | export [file]]',
    })
    await $.command.register({
      name: 'save-next',
      description: 'Keep a suggested next message as a note (the first, or the one numbered)',
      argumentHint: '[1-5]',
    })
    await $.command.register({
      name: 'queue',
      description: 'Queue what you copied from an answer, or the text after it; "list" prints the queue, "clear" empties it',
      argumentHint: '[text | list | clear]',
    })
    await $.command.register({
      name: 'companion-setup',
      description: 'Set Companion up: fullscreen for clicking, and Alt+Q and Alt+N to queue or keep what you copied',
    })
    await $.command.register({
      name: 'fresh',
      description: 'Start over to save tokens: a short handoff of the task is written, the conversation cleared, and the handoff put in the prompt box',
    })
    await $.command.register({ name: 'ctx', description: 'Context X-ray: what fills the context window, and what to cut first' })
    // What the band draws from the start: the project's queue and notes, the keys bound to /queue and /note, and
    // whether the setup was opened yet.
    await loadQueue($)
    await loadNotes($)
    await loadBoundKeys($)
    await loadSetupDone($)
    await loadMeter($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    // The engine measured the session after a turn, or a rate-limit window moved: the meters read it.
    const reading = meterOf(e.context, e.rateLimits)
    await keepMeter($, reading)
    const current = await loadSettings($)
    if (current.meters) toastFill($, reading)
    // A compaction waits for this hook to end: it is a request of its own.
    const percent = reading.percent
    if (percent !== null && current.compactAt !== OFF) {
      $.clock.after(1, () => {
        void compactPast($, percent)
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'note' }, async ($, e) => {
    const text = e.args.trim()
    if (text.length > 0) {
      const kept = await addNote($, text)
      return { text: keptLine(kept, (await loadNotes($)).length) }
    }

    // On its own: what the person selected or copied from an answer, else the last answer's lines, else the notes.
    const said = (await keepSelection($)) ?? (await keepCopy($))
    if (said !== null) return { text: said }
    const latest = (await read($, answersDone)).at(-1)
    if (latest !== undefined && (await openPicker($, latest))) return { text: 'Pick the lines to keep from the last answer.' }
    return showNotes($)
  })

  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      $.clock.after(CLEAR_RELOAD_MS, () => {
        void reloadAfterClear($)
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'fresh' }, async $ => {
    // The handoff is written, and the conversation cleared, once this command's row is in: /clear waits on no hook.
    $.clock.after(1, () => {
      void startFresh($)
    })
    return { text: 'Writing a handoff, then starting fresh.' }
  })

  on('command.run', { command: 'ctx' }, async ($, e) => {
    const columns = e.presentation?.columns
    const usage = await $.session.usage({ breakdown: 'summary', ...(columns === undefined ? {} : { columns }) })
    const breakdown = usage.context.breakdown
    if (breakdown === undefined) return { text: 'No measure of the context yet: send a message first.' }
    const view = xrayOf(breakdown, await $.session.messages(), await projectRoot($))
    await update($, xrayView, () => view)
    const opened = await $.ui.open({ id: XRAY_PANE, title: XRAY_TITLE, focus: true, closeOnEscape: true, holdToasts: true, rows: view.rows.length + XRAY_CHROME })
    return { text: opened.isPlaced ? 'Context X-ray opened.' : xrayText(view) }
  })

  on('command.run', { command: 'companion-setup' }, async ($, e) => {
    // Fullscreen and the Alt keys are the CLI's: where no terminal draws, there is nothing to set up.
    if (!(await $.session.surfaces()).includes('terminal')) {
      return { text: 'Companion’s setup is for the Claude Code CLI in a terminal, where fullscreen and the Alt keys live.' }
    }
    if (await openSetup($, e.presentation?.isFullscreen === true)) return { text: 'Companion setup opened.' }
    return { text: 'Companion setup: run /tui fullscreen for clicking, and bind keys to /queue and /note in ~/.claude/keybindings.json.' }
  })

  on('command.run', { command: 'notes' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    if (word.toLowerCase() === 'export') return { text: await exportNotes($, rest.join(' ')) }
    if (e.args.trim().toLowerCase() === 'clear') {
      const count = (await loadNotes($)).length
      if (count === 0) return { text: 'No notes to clear.' }
      // Asked in the pane first; where none draws, the command itself was the ask.
      await askClear($)
      if (await openNotes($)) return { text: `Clear all ${count} ${count === 1 ? 'note' : 'notes'}? Answer in the Notes pane.` }
      const dropped = await dropNotes($)
      return { text: `Cleared ${dropped} ${dropped === 1 ? 'note' : 'notes'} for this project.` }
    }
    return showNotes($)
  })

  on('command.run', { command: 'queue' }, async ($, e) => {
    const text = e.args.trim()
    const word = text.toLowerCase()
    if (word === 'clear') {
      const dropped = await clearQueue($)
      if (dropped === 0) return { text: 'Nothing queued to clear.' }
      return { text: `Took ${dropped} ${dropped === 1 ? 'action' : 'actions'} off the queue.` }
    }
    if (word === 'list') return { text: queueLines(await loadQueue($), queueEmpty(await loadBoundKeys($))) }
    if (text.length > 0) {
      const queuing = await addToQueue($, text)
      return { text: queuedLine(queuing, (await read($, queueHere)).length) }
    }
    // On its own, and so as a key bound to it (Alt+Q): what was copied from an answer, queued.
    return { text: await queueTheCopy($) }
  })

  on('command.run', { command: 'save-next' }, async ($, e) => {
    const idea = await read($, suggested)
    if (idea === null) return { text: 'No suggestion yet: they come with the next answer.' }

    const asked = e.args.trim()
    const number = asked.length === 0 ? 1 : Number(asked)
    const choice = Number.isInteger(number) ? idea.choices[number - 1] : undefined
    if (choice === undefined) return { text: `Pick 1 to ${idea.choices.length}. ${NEXT_LABEL}${numbered(idea.choices)}` }

    return { text: keptLine(await addNote($, choice), (await loadNotes($)).length) }
  })

  on('command.run', { command: 'companion' }, async $ => {
    if (await openSettings($)) return { text: 'Companion settings opened.' }

    const current = shownOn(await loadSettings($), await noteSessionModel($))
    const note = current.fit !== 'off' ? ownNote(current, await read($, own)) : null
    const lines = [settingsLine(current), note, 'No panel draws here: run /companion in VS Code or the terminal to change them.']
    return { text: lines.filter(line => line !== null).join('\n') }
  })

  on('command.run', { command: 'copy-next' }, async ($, e) => {
    const idea = await read($, suggested)
    if (idea === null) return { text: 'No suggestion yet: they come with the next answer.' }

    const asked = e.args.trim()
    const number = asked.length === 0 ? 1 : Number(asked)
    const choice = Number.isInteger(number) ? idea.choices[number - 1] : undefined
    if (choice === undefined) return { text: `Pick 1 to ${idea.choices.length}. ${NEXT_LABEL}${numbered(idea.choices)}` }

    // A surface copies through its own clipboard; where none attaches, the machine's clipboard.
    const [surface] = await $.session.surfaces()
    const isCopied =
      surface === undefined ? await copyToHostClipboard($, choice) : (await $.ui.copy({ text: choice, surface })).isCopied

    return { text: isCopied ? `Copied: ${choice}` : `Could not copy here. ${NEXT_LABEL}${choice}` }
  })

  on('command.run', { command: 'last-prompt' }, async $ => {
    // Where nothing draws a pane, the answer itself carries both lines into the transcript.
    if ((await $.session.surfaces()).length === 0) {
      const prompt = await read($, last)
      const idea = await read($, suggested)
      const lastLine = `${LAST_LABEL}${prompt === null ? NONE_YET : oneLine(prompt.text, PANE_MAX_CHARS)}`

      return { text: `${lastLine}\n${NEXT_LABEL}${idea === null ? NONE_YET : numbered(idea.choices)}` }
    }

    await update($, paneClosed, () => false)
    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: 'Last prompt pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // Read before next(e): the engine starts this prompt's own turn inside it, and its turn.start can run first.
    const runningWhenSent = runningTurn
    const result = await next(e)

    // A dropped prompt never reached the session, and the machine's own deliveries are not "my prompt".
    if ('drop' in result || MACHINE_ORIGINS.has(e.origin.kind)) return result

    const text = ownWords(e.text)
    if (text.length > 0) {
      // A message (not a command such as /companion) sent while an answer still ran is queued as the next one.
      if (runningWhenSent !== undefined && e.command === undefined) movedOn.add(runningWhenSent)
      // A slash command's turns run as the command sets them, and a program nobody watches (claude -p, the Agent SDK
      // with no surface) picked its own model. An SDK host's prompt with a surface attached, as from the Claude app,
      // is the person's.
      const isProgram = e.origin.kind === 'sdk' && (await $.session.surfaces()).length === 0
      await noteTask($, text, e.command !== undefined || isProgram)
      await recordPrompt($, text, e.origin.kind === 'sdk')
      // A queued action sent, as Tab took it from the box: it leaves the queue.
      if (e.command === undefined) await sentFromQueue($, text)
    }

    return result
  }).catch(($, e, next) => next(e)) // a failure here never holds up the prompt

  on('turn.start', async ($, e, next) => {
    // The main loop's turns take their task from the prompt that started them; a subagent's are its own.
    if (e.agentId === undefined) {
      const current = await loadSettings($)
      // The turn's cost is what it adds to the session's; and a turn warms the cache again.
      const usd = current.meters ? await costSoFar($) : null
      if (usd !== null) costAtStart.set(e.turnId, usd)
      await warmCache($)
      // The mode kept for the session's model: /model, or a switch pressed, may have changed it since the last turn.
      const fit = fitFor(current, await noteSessionModel($))
      startTurn(
        e.turnId,
        fit === 'off' ? undefined : { fit, easy: current.easy, mid: current.mid, hard: current.hard, limit: current.limit, grading: current.grading, grader: current.grader },
      )
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    // The session's own model and effort, as each main-loop turn's first request names them before any fitting.
    if (e.agentId === undefined && e.index === 0) await noteOwn($, e)
    // A fitted turn's requests go with its task's model and effort; every other request as the engine made it.
    const fit = await routedStep($, e)
    if (fit === undefined) return yield* next(e)
    return yield* fittedStream($, e, fit, input => next(input), next.signal)
  }).catch(async function* ($, e, next) {
    return yield* next(e) // a failure here sends the request as the engine made it
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const plan = e.agentId === undefined ? fitted.get(e.turnId)?.plan : undefined
    fitted.delete(e.turnId)
    const hasMovedOn = movedOn.delete(e.turnId)
    if (e.agentId === undefined && runningTurn === e.turnId) runningTurn = undefined
    // A main-loop turn that ran fitted, or with a switch suggested, says so on the line that ends it.
    if (e.agentId === undefined) {
      endedTurns.set(e.turnId, e.durationMs)
      for (const id of [...endedTurns.keys()].slice(0, -ENDS_KEPT)) endedTurns.delete(id)
      // With the meters on, what the turn cost: what it added to the session's total, and its share read from the cache.
      const start = costAtStart.get(e.turnId)
      costAtStart.delete(e.turnId)
      const now = settings.meters && start !== undefined ? await costSoFar($) : null
      const spend = settings.meters ? turnSpend(now === null || start === undefined ? null : now - start, e.usage) : null
      await noteEnd($, e.durationMs, spend ?? undefined)
      // The cache's wait for going cold starts at the answer's end, on the conversation's size as measured now.
      await loadMeter($)
      await watchCold($)
    }
    // Main-thread turns that answered: a subagent's report, an interrupted turn or a refusal suggests nothing.
    if (e.agentId !== undefined || e.reason !== 'answer' || e.answer.trim().length === 0) return result
    // A long answer's end raises the alert, off the turn so its end never waits on the notification.
    const { durationMs, answer: done } = e
    $.clock.after(1, () => {
      void alertDone($, durationMs, done)
    })

    lastReply = e.answer
    const answer = e.answer
    await update($, answersDone, done => [...done, answer].slice(-ANSWERS_KEPT))
    const current = await loadSettings($)
    const ask = epoch
    const prompt = await read($, last)
    // Read afresh: another session in the project may have queued or sent one meanwhile, and the keybindings file may
    // have a key for /queue or /note since.
    const queue = await loadQueue($)
    await loadBoundKeys($)

    if ((await $.session.surfaces()).length > 0) {
      // The band or the pane shows them: asked on a timer, so the end of the turn never waits on the model.
      if (current.suggest && !hasMovedOn) {
        $.clock.after(1, () => {
          void suggestNext($, ask, prompt?.text ?? '', e.answer)
        })
      }
      // The next queued action is the person's own next step: the prompt box offers it at once, for Tab to take.
      if (queue.length > 0 && !hasMovedOn) {
        $.clock.after(1, () => {
          void offerNext($)
        })
      }
      return result
    }

    // Nothing draws this mod's UI: what a fitted turn ran on and the choices become the turn's text, which the engine
    // shows as a notice beneath the answer. A program's prompt (claude -p, the Agent SDK) has nobody to read one.
    if (prompt === null || prompt.isFromProgram) return result
    const choices = current.suggest && !hasMovedOn ? await askNext($, ask, prompt.text, e.answer) : null
    const lines = [
      plan === undefined || plan === null ? '' : describeRouted(routedOf(plan, 0)),
      choices === null ? '' : `${NEXT_LABEL}${numbered(choices)}`,
    ].filter(line => line.length > 0)

    return lines.length === 0 ? result : { ...result, text: lines.join('\n') }
  }).catch(($, e, next) => next(e))

  on('prompt.suggest', async ($, e, next) => {
    // The engine's own guess after a turn: the box shows the next queued action instead, the person's own next step,
    // else this mod's likeliest choice, so the two agree.
    if (e.origin.kind === 'suggestion') {
      const offer = (await read($, queueHere))[0]?.text ?? (await read($, suggested))?.choices[0]
      if (offer !== undefined) return next({ ...e, text: offer })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    // The person closed the pane: keep it closed until /last-prompt asks for it again.
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, paneClosed, () => true)
    }

    return next(e)
  }).catch(($, e, next) => next(e)) // nor the close

  on('ui.focus', { requestId: SETTINGS_PANE }, async ($, e, next) => {
    // The settings menu's ring moved: the line under the menu says what the row it landed on does.
    const result = await next(e)
    if (!('deny' in result && result.deny !== undefined) && e.element !== undefined) {
      const landed = e.element
      await update($, menuFocus, () => landed)
    }
    return result
  }).catch(($, e, next) => next(e)) // nor the ring

  on('ui.focus', { requestId: QUEUE_PANE }, async ($, e, next) => {
    // The queue list's ring moved: t and x act on the row it landed on.
    const result = await next(e)
    if (!('deny' in result && result.deny !== undefined) && e.element !== undefined && e.element.startsWith('queued-')) {
      const landed = e.element
      await update($, queueFocus, () => landed)
    }
    return result
  }).catch(($, e, next) => next(e)) // nor the ring

  on('ui.scroll', { requestId: SETTINGS_PANE }, async ($, e, next) => {
    // A terminal too short for the menu scrolls its window under ↑↓ and leaves the ring on a row out of sight: there an
    // arrow moves the ring a row instead, as it does where the menu fits, and the window follows the ring. The wheel,
    // the page keys and this mod's own scrolls pass.
    const isArrow = e.origin.kind === 'person' && e.pointer === undefined && Math.abs(e.by) === 1
    if (!isArrow) return next(e)

    const keys = await menuKeys($)
    const at = Math.max(0, keys.indexOf((await read($, menuFocus)) ?? ''))
    const target = keys[Math.min(keys.length - 1, Math.max(0, at + e.by))]
    if (target !== undefined) {
      // Moved once this scroll is answered: the ring and the window wait on no hook of theirs.
      $.clock.after(1, () => {
        void focusMenu($, target)
      })
    }
    return {}
  }).catch(($, e, next) => next(e)) // nor the window

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prompt = await read($, last)
    const idea = await read($, suggested)
    const fit = await read($, routed)
    // VS Code pins the prompt above its answer, so outside the terminal the band shows it only when asked to.
    const isTerminal = e.surface === 'terminal'
    const current = await shownSettings($)
    const showsPrompt = prompt !== null && (isTerminal || current.lastPrompt)
    // The queue on the terminal alone, where 8 fills it and the prompt box offers its next action for Tab.
    const queue = isTerminal ? await read($, queueHere) : []
    if (e.props.hasSurvey || (!showsPrompt && idea === null && fit === null && queue.length === 0)) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = ui
    // The terminal's band is kept quiet: the last prompt and the choices, little else. The lines under the prompt box
    // show the keys and say how to work them, the footer counts the queue and the notes, and each turn's end line says
    // what it ran on.
    // The terminal's "Copy answer", "View queue" and "View notes", once an answer is in to copy from or something waits
    // in the queue or the notes; "Copy answer" first, once there is an answer to copy. A digit typed into the empty
    // prompt box presses a band's button alone, so with the number keys on they stay here, hidden, and show under the
    // prompt box; with them off, the band's focus has to reach them, so they show here, beside the last prompt.
    const isAnswered = (await read($, answersDone)).length > 0
    const hasKept = isAnswered || queue.length > 0 || (await read($, notesHere)).length > 0
    const hasKeys = isTerminal && current.noteButton && hasKept
    const keys = hasKeys ? bandKeys($, ui, current, e.surface, isAnswered) : []
    const showsKeys = keys.length > 0 && !current.numberKeys
    // The terminal's columns are exact, so its lines are cut to fit. VS Code and the apps lay text out in their own
    // font, where the columns they report undercount the room (VS Code 2.1.300 said 42 for a band twice that wide),
    // so there the texts go whole and wrap, as markdown: the last prompt a quote, the choices rows of links.
    const keysRoom = showsKeys ? keysColumns(current, isAnswered) : 0
    const lastRoom = isTerminal ? Math.max(10, e.props.bodyColumns - QUOTE_COLUMNS - MORE_COLUMNS - keysRoom) : LAST_MAX_CHARS
    const more = <Button key="settings" label={MORE} plain dimColor onPress={() => openSettings($)} />
    // Once a fitted turn has ended, its end line says what it ran on, so the band keeps only the button.
    const ended = (await read($, endLines)).at(-1)
    const fitLine =
      fit === null
        ? null
        : fitRow($, ui, fit, {
            hasPrompt: prompt !== null,
            isWorking: e.props.isWorking,
            isTerminal,
            hasNumberKeys: isTerminal && current.numberKeys,
            isQuiet: isTerminal,
            showsWords: !isTerminal || e.props.isWorking || ended?.words !== fitWords(fit),
          })
    const hasHead = showsPrompt || showsKeys
    if (!hasHead && fitLine === null && idea === null && keys.length === 0) return next(e)
    // Without the quote or the keys, the ⋯ ends the band's first row: the model line, or else the "Suggested" label.
    const moreOnFit = !hasHead && fitLine !== null
    // The last prompt's row: on the terminal the band's last, right over the prompt box, the model line and the choices
    // above it; elsewhere its first, as VS Code pins the prompt above its answer.
    const head = hasHead && (
      <Box key="firstRow" flexWrap="nowrap" columnGap={1}>
        {/* A bar of its own, not a quote border: the terminal draws that border a row above and below the text, two
            rows the band can spare. */}
        {showsPrompt && prompt !== null && isTerminal && (
          <Box key="quoteBar" flexShrink={0}>
            <Text color={QUOTE_COLOR}>{QUOTE_BAR}</Text>
          </Box>
        )}
        {showsPrompt && prompt !== null && isTerminal && (
          <Box key="prompt" flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{oneLine(prompt.text, lastRoom)}</Text>
          </Box>
        )}
        {showsPrompt && prompt !== null && !isTerminal && (
          <Box key="prompt" flexGrow={1} flexShrink={1}>
            <Markdown text={quoteOf(prompt.text, lastRoom)} />
          </Box>
        )}
        {!showsPrompt && <Box key="space" flexGrow={1} />}
        {showsKeys && (
          <Box key="keys" flexShrink={0} columnGap={KEYS_GAP}>
            {keys}
          </Box>
        )}
        {more}
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap="xs">
        {!isTerminal && head}
        {moreOnFit ? (
          <Box key="fitHead" flexWrap="nowrap" columnGap={1}>
            <Box key="fitText" flexGrow={1} flexShrink={1}>
              {fitLine}
            </Box>
            {more}
          </Box>
        ) : (
          fitLine
        )}
        {idea !== null && isTerminal && numberedChoices($, ui, idea.choices, e.props.bodyColumns, current)}
        {idea !== null && !isTerminal && choiceList($, ui, idea.choices, hasHead || moreOnFit ? null : more)}
        {isTerminal && head}
        {keys.length > 0 && !showsKeys && (
          <Box key="keyPresses" display="none">
            {keys}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // On the terminal, a line of Companion's own under the engine's hint line, so neither cuts the other short. It stays
    // while the person types and while an answer runs, so the prompt box never jumps a row; only the pick goes while
    // typing, when a digit types itself.
    if (e.surface !== 'terminal') return next(e)
    if (e.viewport !== undefined) terminalColumns = e.viewport.columns
    const current = await shownSettings($)
    const idea = await read($, suggested)
    const keys = await read($, boundKeys)
    const queue = await read($, queueHere)
    const isAnswered = (await read($, answersDone)).length > 0
    const hasKept = isAnswered || queue.length > 0 || (await read($, notesHere)).length > 0
    // The keys under the hint line, as the band holds them hidden for the digits; a click presses one in fullscreen.
    const keyRow = current.noteButton && current.numberKeys && hasKept ? bandKeys($, $.ui.resolve(e), current, e.surface, isAnswered) : []
    // The invitation to /companion-setup: until the setup was opened once, unless there is nothing left for it to do
    // (both keys bound, and fullscreen on).
    const isSetUp = (await read($, setupDone)) || (keys.queue !== null && keys.note !== null && e.viewport?.isFullscreen === true)
    const context = contextTip(await read($, meter), current, await read($, isColdNow))
    const tips = tipLines(current, { context, choices: e.props.isDraft ? 0 : (idea?.choices.length ?? 0), hasKept, isSetUp, keys })
    const drawn = await next(e)
    // The meters, on a line of their own at the bottom: the context's fill, and the week's usage.
    const meters = current.meters ? metersOf(await read($, meter), await $.clock.now()) : []
    if (tips.length === 0 && keyRow.length === 0 && meters.length === 0) return drawn
    // The footer's labels sit at the right of the hint lines' first row while the lines leave them room; a tip line
    // wider would push them down a row of their own, so each wraps short of them.
    const columns = e.viewport?.columns
    const labels = (await countsOf($, current)).join(LABELS_JOIN)
    const room = columns === undefined ? undefined : Math.max(MIN_TIPS_COLUMNS, columns - labels.length - FOOTER_GAP_COLUMNS)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        {keyRow.length > 0 && (
          <Box key="keys" columnGap={KEYS_GAP}>
            {keyRow}
          </Box>
        )}
        {tips.length > 0 && (
          <Box key="tips" flexDirection="column" {...(room === undefined ? {} : { width: room })}>
            {/* A line each, whole: wrapped onto a second row where it is wider than the room, never cut. */}
            {tips.map((tip, i) => (
              <Box key={`tip-${i}`}>
                <Text dimColor wrap="wrap">
                  {tip}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        {meters.length > 0 && (
          <Box key="meters" columnGap={FOOTER_GAP}>
            {meterViews($.ui.resolve(e), meters)}
          </Box>
        )}
      </Box>
    )
  }).catch(($, e, next) => next(e)) // the engine's own line

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    // The footer counts what waits in this project's queue and notes, on the terminal, where 8 and 9 open them.
    if (e.surface !== 'terminal') return next(e)
    const counts = await countsOf($, await shownSettings($))
    return counts.length === 0 ? next(e) : next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...counts] } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const drawn = await next(e)
    // The line is told apart by the turn's length, which it carries to the millisecond as the turn's end does.
    if (e.surface !== 'terminal' || e.props.waitingFor !== undefined) return drawn
    const end = (await read($, endLines)).findLast(line => line.durationMs === e.props.durationMs)
    // What the turn ran on, where it was fitted, then what it cost and its cache share, that in colour.
    const spend = end?.spend
    const plain = [end?.words, spend === undefined || spend.usd === null ? undefined : usdShort(spend.usd)].filter(part => part !== undefined).join(' · ')
    const cache = spend === undefined ? null : cacheText(spend.cache)
    const said = [plain, cache ?? ''].filter(part => part.length > 0).join(' · ')
    const room = (e.viewport?.columns ?? 0) - END_LINE_COLUMNS
    if (said.length === 0 || room < MIN_END_COLUMNS) return drawn
    // Whole, the cache share is drawn in colour; cut to the room, the line is drawn dim alone, a colour cut off misleading.
    const colour = said.length <= room && spend !== undefined && spend.cache !== null ? cacheColor(spend.cache) : null

    const { Box, Text } = $.ui.resolve(e)
    // The engine's line takes the row's width and sits a row down in its own drawing, so the fit's words go at the
    // row's end, a row down as well.
    return (
      <Box flexWrap="nowrap">
        <Box key="own" flexGrow={0} flexShrink={1}>
          {drawn}
        </Box>
        <Box key="fitEnd" flexShrink={0} marginTop={1}>
          {colour === null && <Text dimColor>{oneLine(said, room)}</Text>}
          {colour !== null && plain.length > 0 && <Text dimColor>{`${plain} · `}</Text>}
          {colour !== null && <Text color={colour}>{cache}</Text>}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const prompt = await read($, last)
    const idea = await read($, suggested)
    const fit = await read($, routed)
    const ui = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = ui
    // As in the band: cut to the terminal's exact columns, whole and wrapping everywhere else.
    const isTerminal = e.surface === 'terminal'
    const choiceRoom = Math.max(10, e.props.bodyColumns - HOTKEY_COLUMNS)

    return (
      <Box flexDirection="column" rowGap="sm">
        <Box key="last" flexDirection="column">
          <Text size="caption" weight="semibold" dimColor>
            Last prompt
          </Text>
          {prompt === null && <Text dimColor>No prompt yet.</Text>}
          {prompt !== null && isTerminal && (
            <Box key="prompt" borderStyle="quote" borderColor={QUOTE_COLOR} paddingLeft={1}>
              <Text>{oneLine(prompt.text, PANE_MAX_CHARS)}</Text>
            </Box>
          )}
          {prompt !== null && !isTerminal && (
            <Box key="prompt">
              <Markdown text={quoteOf(prompt.text, PANE_MAX_CHARS)} />
            </Box>
          )}
        </Box>
        {fit !== null && fitRow($, ui, fit, { hasPrompt: prompt !== null, isWorking: false, isTerminal, hasNumberKeys: false })}
        {idea !== null && !isTerminal && choiceList($, ui, idea.choices)}
        {idea !== null && isTerminal && (
          <Box key="choices" flexDirection="column">
            <Text dimColor>{NEXT_LABEL.trim()}</Text>
            {idea.choices.map((choice, i) => (
              <Button
                key={`choice-${i + 1}`}
                label={oneLine(choice, choiceRoom)}
                plain
                hotkey={String(i + 1)}
                onPress={() => pressChoice($, choice, idea.choices)}
              />
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    // Only the fullscreen terminal takes the click: its main screen has no mouse, and other surfaces are not tried yet.
    // There /note on its own does the same.
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || e.props.isSummary === true) return drawn
    const current = await shownSettings($)
    const answer = e.props.text
    // Read from $.state: a completed answer redraws its last block with the button.
    if (!current.noteButton || !endsAnswer(await read($, answersDone), answer)) return drawn

    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="noteRow" paddingLeft={2}>
          <Button key="note" label={NOTE_BUTTON_LABEL} plain dimColor onPress={() => pressNoteButton($, answer)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: NOTES_PANE }, async ($, e) => {
    // Drawn from $.state, so keeping, taking or clearing a note redraws it.
    const notes = await read($, notesHere)
    const view = await read($, notesView)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (view.kind === 'pick') {
      const kept = new Set(notes.map(note => note.text))
      const isKept = (line: string) => kept.has(oneLine(line, NOTE_MAX_CHARS))
      const yours = `Your notes (${notes.length})`
      if (e.surface === 'terminal') {
        const pages = Math.max(1, Math.ceil(view.lines.length / PICK_PAGE))
        const page = Math.min(view.page, pages - 1)
        const shown = view.lines.slice(page * PICK_PAGE, (page + 1) * PICK_PAGE)
        const room = Math.max(10, e.props.bodyColumns - HOTKEY_COLUMNS - 2)
        return (
          <Box flexDirection="column">
            <Box key="title">
              <Text weight="semibold">{PICK_TITLE}</Text>
              <Text dimColor>{` · ${PICK_KEYS}`}</Text>
            </Box>
            {shown.length === 0 && (
              <Text dimColor wrap="truncate-end">
                {PICK_EMPTY}
              </Text>
            )}
            {shown.map((line, i) => (
              <Button
                key={`line-${i + 1}`}
                label={`${isKept(line) ? '✓' : ' '} ${oneLine(line, room)}`}
                plain
                hotkey={String(i + 1)}
                onPress={() => toggleLine($, line)}
              />
            ))}
            {pages > 1 && <Button key="more" label={`More lines (${page + 1} of ${pages})`} plain hotkey="m" onPress={() => turnPage($)} />}
            <Button key="yours" label={yours} plain hotkey="n" onPress={() => pressNotesKey($)} />
          </Box>
        )
      }

      // Outside the terminal every line shows at once: a quiet button each, ✓ once kept.
      return (
        <Box flexDirection="column" rowGap="xs">
          <Text size="footnote" weight="semibold" dimColor>
            {PICK_TITLE}
          </Text>
          {view.lines.length === 0 && (
            <Text size="footnote" dimColor>
              {PICK_EMPTY}
            </Text>
          )}
          {view.lines.map((line, i) => (
            <Button key={`line-${i + 1}`} label={line} plain dimColor onPress={() => toggleLine($, line)}>
              {isKept(line) ? <Text dimColor>{`✓ ${line}`}</Text> : <Text color="text">{`+ ${line}`}</Text>}
            </Button>
          ))}
          <Button key="yours" label={yours} plain dimColor onPress={() => showList($)} />
          <Text size="footnote" dimColor>
            Click a line to keep it as a note, and again to drop it.
          </Text>
        </Box>
      )
    }

    if (notes.length === 0) {
      return (
        <Text dimColor wrap={e.surface === 'terminal' ? 'truncate-end' : 'wrap'}>
          {notesEmpty(await read($, boundKeys))}
        </Text>
      )
    }

    const isTerminal = e.surface === 'terminal'
    const shown = notes.slice(0, NOTES_SHOWN)

    // Every note of the project goes only on a yes.
    if (view.kind === 'clear') {
      const question = `Clear all ${notes.length} ${notes.length === 1 ? 'note' : 'notes'} for this project?`
      return isTerminal ? (
        <Box flexDirection="column">
          <Text weight="semibold">{question}</Text>
          <Button key="yes" label="Yes, clear them" plain hotkey="y" autoFocus onPress={() => clearNotes($)} />
          <Button key="no" label="No, keep them" plain hotkey="n" onPress={() => showList($)} />
        </Box>
      ) : (
        <Box flexDirection="column" rowGap="xs">
          <Text>{question}</Text>
          <Box key="answers" columnGap={1}>
            <Button key="yes" label="Yes, clear them" onPress={() => clearNotes($)} />
            <Button key="no" label="No, keep them" onPress={() => showList($)} />
          </Box>
        </Box>
      )
    }

    // The terminal removes one note by its number; elsewhere each note carries its own ✕.
    if (view.kind === 'remove' && isTerminal) {
      return (
        <Box flexDirection="column">
          <Box key="title">
            <Text weight="semibold">Remove a note</Text>
            <Text dimColor>{` · ${REMOVE_KEYS}`}</Text>
          </Box>
          {shown.map((note, i) => (
            <Button key={`remove-${i + 1}`} label={note.text} plain hotkey={String(i + 1)} onPress={() => removeNote($, note.id)} />
          ))}
          <Button key="back" label="Back to your notes" plain hotkey="n" onPress={() => showList($)} />
        </Box>
      )
    }

    if (isTerminal) {
      return (
        <Box flexDirection="column">
          <Box key="title">
            <Text weight="semibold">{NOTES_TITLE}</Text>
            <Text dimColor>{` · ${NOTES_KEYS}`}</Text>
          </Box>
          {/* Each note whole, wrapped over as many rows as it takes: the pane opened tall enough for them. */}
          {shown.map((note, i) => (
            <Button key={`note-${i + 1}`} label={note.text} plain hotkey={String(i + 1)} onPress={() => useNote($, note.id)} />
          ))}
          <Button key="remove" label="Remove a note" plain hotkey="x" onPress={() => showRemove($)} />
          <Button key="clear" label="Clear all notes" plain hotkey="0" onPress={() => askClear($)} />
          {notes.length > shown.length && (
            <Text dimColor wrap="truncate-end">{`${notes.length - shown.length} older, not shown`}</Text>
          )}
        </Box>
      )
    }

    // Outside the terminal each note is a quiet button, with a small one beside it that removes the note.
    return (
      <Box flexDirection="column" rowGap="xs">
        {notes.map(note => (
          <Box key={`row-${note.id}`} flexWrap="nowrap" columnGap={1}>
            <Box key={`take-${note.id}`} flexGrow={1} flexShrink={1}>
              <Button key={`note-${note.id}`} label={note.text} plain dimColor onPress={() => useNote($, note.id)}>
                <Text color="text">{`${MARKER} ${note.text}`}</Text>
              </Button>
            </Box>
            <Button key={`drop-${note.id}`} label="Remove note" plain dimColor onPress={() => dropNotes($, note.id)}>
              <Text>✕</Text>
            </Button>
          </Box>
        ))}
        <Button key="clear" label="Clear all notes" plain dimColor onPress={() => askClear($)} />
        <Text size="footnote" dimColor>
          A note goes into the prompt box to edit, and stays here. ✕ removes it.
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: XRAY_PANE }, async ($, e) => {
    // Drawn from $.state, as /ctx measured it: each category a bar in its /context colour, then the lists and the tip.
    const view = await read($, xrayView)
    const { Box, Text } = $.ui.resolve(e)
    if (view === null) {
      return (
        <Box key="empty">
          <Text dimColor>No measure yet: /ctx measures the context.</Text>
        </Box>
      )
    }
    const parts = (key: string, title: string, list: readonly XrayPart[]) =>
      list.length > 0 && (
        <Box key={key}>
          <Text dimColor wrap="truncate-end">{`${title}: ${partsText(list)}`}</Text>
        </Box>
      )
    return (
      <Box flexDirection="column">
        <Box key="title">
          <Text weight="semibold">{XRAY_TITLE}</Text>
          <Text dimColor>{` · ${tokensShort(view.tokens)} of ${tokensShort(view.window)} (${view.percent}%) · ${XRAY_KEYS}`}</Text>
        </Box>
        {view.rows.map((row, i) => {
          const full = xrayCells(row.tokens, view.window)
          return (
            <Box key={`row-${i + 1}`}>
              <Text>{row.name.padEnd(XRAY_LABEL_COLUMNS)}</Text>
              {row.isUsed ? <Text color={row.color}>{METER_FULL.repeat(full)}</Text> : <Text dimColor>{METER_FULL.repeat(full)}</Text>}
              <Text dimColor>{`${METER_EMPTY.repeat(XRAY_CELLS - full)} ${tokensShort(row.tokens)}`}</Text>
            </Box>
          )
        })}
        {parts('outputs', 'Biggest tool outputs', view.outputs)}
        {parts('servers', 'MCP servers', view.servers)}
        {parts('memory', 'Memory files', view.memory)}
        <Box key="tip">
          <Text color={ACCENT}>{view.tip}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SETUP_PANE }, async ($, e) => {
    // The setup's steps, each a row Enter ticks, or a line saying it is done already; a applies.
    const view = await read($, setupView)
    const keys = await read($, boundKeys)
    const { Box, Button, Text } = $.ui.resolve(e)
    const room = Math.max(10, e.props.bodyColumns - 2)
    const tick = (isOn: boolean) => (isOn ? '[x]' : '[ ]')
    const isBound = keys.queue !== null && keys.note !== null
    return (
      <Box flexDirection="column">
        <Box key="title">
          <Text weight="semibold">{SETUP_TITLE}</Text>
          <Text dimColor>{` · ${SETUP_KEYS_HINT}`}</Text>
        </Box>
        {view.isFullscreen ? (
          <Box key="fullscreenDone">
            <Text dimColor wrap="truncate-end">
              ✓ Fullscreen is on: click suggestions, the queue and notes, and select words to queue them
            </Text>
          </Box>
        ) : (
          <Button
            key="fullscreen"
            label={oneLine(`${tick(view.fullscreen)} Fullscreen: click suggestions, the queue and notes; select words to queue them (runs /tui fullscreen)`, room)}
            plain
            onPress={() => toggleSetup($, 'fullscreen')}
          />
        )}
        {isBound ? (
          <Box key="keysDone">
            <Text dimColor wrap="truncate-end">{`✓ ${keys.queue} queues and ${keys.note} keeps what you copied`}</Text>
          </Box>
        ) : (
          <Button
            key="keys"
            label={oneLine(`${tick(view.keys)} Alt+Q queues, Alt+N keeps what you copied (adds them to ~/.claude/keybindings.json)`, room)}
            plain
            onPress={() => toggleSetup($, 'keys')}
          />
        )}
        <Button key="apply" label="Apply" plain hotkey="a" onPress={() => applySetup($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: QUEUE_PANE }, async ($, e) => {
    // The queue as a list the keys work, drawn from $.state: no numbers, the ring walks the rows, Enter takes the one
    // it is on into the prompt box, and t and x move it to the top or take it off.
    const queue = await read($, queueHere)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (queue.length === 0) {
      return (
        <Text dimColor wrap="truncate-end">
          {queueEmpty(await read($, boundKeys))}
        </Text>
      )
    }

    const room = Math.max(10, e.props.bodyColumns - QUEUE_ROW_COLUMNS)
    return (
      <Box flexDirection="column">
        <Box key="title">
          <Text weight="semibold">{QUEUE_TITLE}</Text>
          <Text dimColor>{` · ${QUEUE_LIST_KEYS}`}</Text>
        </Box>
        {queue.map((action, i) => (
          <Box key={`row-${i + 1}`} flexWrap="nowrap" columnGap={1}>
            <Box key="take" flexGrow={1} flexShrink={1}>
              <Button key={queueRowKey(i)} label={oneLine(action.text, room)} plain onPress={() => takeQueued($, action.id)} />
            </Box>
            {i === 0 && (
              <Box key="next">
                <Text color="success">next</Text>
              </Box>
            )}
          </Box>
        ))}
        <Box key="keys" columnGap={3}>
          <Button key="top" label="To the top" plain hotkey="t" onPress={() => topFocused($)} />
          <Button key="drop" label="Take it off" plain hotkey="x" onPress={() => dropFocused($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    // Drawn from $.state (a pick redraws it); a render never writes, so before the first load it reads the store. The
    // mode shown is the one kept for the session's model, read as the pane opened.
    const current = shownOn(await shownSettings($), await read($, sessionModel))
    const note = ownNote(current, await read($, own))
    if (e.surface === 'terminal') {
      return settingsMenu($, $.ui.resolve(e), current, await read($, menuView), await read($, menuFocus), note)
    }
    if (e.surface === 'mobile') {
      // The mobile app draws no picker: the settings as text, in the same groups, changed from a computer.
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" rowGap="md">
          <Box key="suggestions" flexDirection="column">
            <Text size="footnote" weight="semibold" dimColor>
              Suggested next messages
            </Text>
            <Box key="summary">
              <Text>{suggestionsLine(current)}</Text>
            </Box>
          </Box>
          <Box key="routing" flexDirection="column">
            <Text size="footnote" weight="semibold" dimColor>
              Model and effort for each task
            </Text>
            <Box key="routeSummary">
              <Text>{routingLine(current)}</Text>
            </Box>
            {note !== null && (
              <Box key="ownNote">
                <Text size="footnote" dimColor>
                  {note}
                </Text>
              </Box>
            )}
          </Box>
          <Text size="footnote" dimColor>
            Change them on a computer: /companion in VS Code or the terminal.
          </Text>
        </Box>
      )
    }

    // Grouped as a settings app groups them: a small heading, the pickers in a rounded card, a footnote under it.
    const { Box, Select, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" rowGap="md">
        <Box key="suggestions" flexDirection="column">
          <Text size="footnote" weight="semibold" dimColor>
            Suggested next messages
          </Text>
          <Box key="suggestCard" flexDirection="column" borderStyle="round" borderColor={QUOTE_COLOR} paddingX="sm">
            <Select
              key="suggest"
              label="Suggest next messages"
              value={current.suggest ? 'on' : 'off'}
              options={ON_OFF}
              onSelect={value => changeSetting($, 'suggest', value === 'on')}
            />
            <Select key="model" label="Model" value={current.model} options={MODELS} onSelect={value => changeSetting($, 'model', value)} />
            <Select key="effort" label="Thinking effort" value={current.effort} options={EFFORTS} onSelect={value => changeSetting($, 'effort', value)} />
            <Select
              key="choices"
              label="Number of choices"
              value={String(current.choices)}
              options={CHOICE_COUNTS}
              onSelect={value => changeSetting($, 'choices', value)}
            />
            <Select
              key="onPress"
              label="Clicking a choice"
              value={current.onPress}
              options={PRESS_ACTIONS}
              onSelect={value => changeSetting($, 'onPress', value)}
            />
          </Box>
          <Text size="footnote" dimColor>
            {SUGGEST_NOTE}
          </Text>
        </Box>
        <Box key="routing" flexDirection="column">
          <Text size="footnote" weight="semibold" dimColor>
            Model and effort for each task
          </Text>
          <Box key="routeCard" flexDirection="column" borderStyle="round" borderColor={QUOTE_COLOR} paddingX="sm">
            <Select
              key="fit"
              label="Fit model and effort to each task"
              value={current.fit}
              options={FIT_MODES}
              onSelect={value => changeSetting($, 'fit', value)}
            />
            <Select key="easy" label="Easy tasks" value={current.easy} options={TIER_ROUTES} onSelect={value => changeSetting($, 'easy', value)} />
            <Select key="mid" label="Mid tasks" value={current.mid} options={TIER_ROUTES} onSelect={value => changeSetting($, 'mid', value)} />
            <Select key="hard" label="Hard tasks" value={current.hard} options={TIER_ROUTES} onSelect={value => changeSetting($, 'hard', value)} />
            <Select
              key="limit"
              label="Automatic: easy and mid tasks switch up to"
              value={current.limit}
              options={LIMITS}
              onSelect={value => changeSetting($, 'limit', value)}
            />
            <Select key="grader" label="Grader" value={current.grader} options={MODELS} onSelect={value => changeSetting($, 'grader', value)} />
            <Select key="grading" label="Grading" value={current.grading} options={GRADINGS} onSelect={value => changeSetting($, 'grading', value)} />
          </Box>
          {note !== null && (
            <Box key="ownNote">
              <Text size="footnote" dimColor>
                {note}
              </Text>
            </Box>
          )}
          <Text size="footnote" dimColor>
            {ROUTE_NOTE}
          </Text>
        </Box>
        <Box key="promptGroup" flexDirection="column">
          <Text size="footnote" weight="semibold" dimColor>
            Last prompt
          </Text>
          <Box key="promptCard" flexDirection="column" borderStyle="round" borderColor={QUOTE_COLOR} paddingX="sm">
            <Select
              key="lastPrompt"
              label="Show it in the band in VS Code"
              value={current.lastPrompt ? 'on' : 'off'}
              options={ON_OFF}
              onSelect={value => changeSetting($, 'lastPrompt', value === 'on')}
            />
          </Box>
          <Text size="footnote" dimColor>
            {PROMPT_NOTE}
          </Text>
        </Box>
        <Box key="notesGroup" flexDirection="column">
          <Text size="footnote" weight="semibold" dimColor>
            Notes
          </Text>
          <Box key="notesCard" flexDirection="column" borderStyle="round" borderColor={QUOTE_COLOR} paddingX="sm">
            <Select
              key="noteButton"
              label="Copy, queue and notes keys in the terminal, and Add note under each answer in fullscreen"
              value={current.noteButton ? 'on' : 'off'}
              options={ON_OFF}
              onSelect={value => changeSetting($, 'noteButton', value === 'on')}
            />
          </Box>
          <Text size="footnote" dimColor>
            {NOTE_BUTTON_NOTE}
          </Text>
        </Box>
        <Box key="metersGroup" flexDirection="column">
          <Text size="footnote" weight="semibold" dimColor>
            Meters
          </Text>
          <Box key="metersCard" flexDirection="column" borderStyle="round" borderColor={QUOTE_COLOR} paddingX="sm">
            <Select
              key="meters"
              label="Meters in the terminal's footer, tips and end lines"
              value={current.meters ? 'on' : 'off'}
              options={ON_OFF}
              onSelect={value => changeSetting($, 'meters', value === 'on')}
            />
            <Select key="coldAfter" label="Cold cache warning" value={current.coldAfter} options={COLD_AFTERS} onSelect={value => changeSetting($, 'coldAfter', value)} />
            <Select key="compactAt" label="Auto-compact" value={current.compactAt} options={COMPACT_ATS} onSelect={value => changeSetting($, 'compactAt', value)} />
            <Select key="doneAfter" label="Done alert" value={current.doneAfter} options={DONE_AFTERS} onSelect={value => changeSetting($, 'doneAfter', value)} />
          </Box>
          <Text size="footnote" dimColor>
            {COMPACT_NOTE}
          </Text>
        </Box>
        <Text size="footnote" dimColor>
          {SAVED_NOTE}
        </Text>
      </Box>
    )
  })
}
