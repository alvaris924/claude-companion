import { atom, read, update } from 'claude-code'
import type {
  ElementTable,
  EngineInterface,
  PromptOrigin,
  Register,
  RenderElement,
  SelectOption,
  TurnStepChunk,
  TurnStepInput,
  TurnStepResult,
} from 'claude-code'

import type { LastPrompt, OwnRequest, RoutedTurn, StoredSettings, Suggestion } from '../types'

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
const SETTINGS_HINT = '/companion for settings'
const HOTKEY_COLUMNS = 3 // "1: " before a numbered choice
const MENU_LABEL_COLUMNS = 24
const MENU_ROWS = 24 // the menu's rows, its longest view's, asked of the terminal as the pane opens
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
    // A store from before 0.12.0 holds the old switch: its "on" is Automatic, and its "off" stays off.
    fit: pick(stored.fit, FIT_MODES, typeof stored.route === 'boolean' ? (stored.route ? 'auto' : 'off') : DEFAULT_FIT) as FitMode,
    fitByModel: fitsFrom(stored.fitByModel),
    easy: pick(stored.easy, TIER_ROUTES, DEFAULT_ROUTES.easy),
    mid: pick(stored.mid, TIER_ROUTES, DEFAULT_ROUTES.mid),
    hard: pick(stored.hard, TIER_ROUTES, DEFAULT_ROUTES.hard),
    limit: pick(stored.limit, LIMITS, NO_LIMIT),
    grading: pick(stored.grading, GRADINGS, GRADE_ONCE),
    grader: pick(stored.grader, MODELS, GRADE_MODEL),
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
  if (likeliest === undefined) return

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
  } catch {
    // a suggestion is a bonus: the turn never hears of a failed one
  }
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

/** What the line on a fitted turn needs to know of where it is drawn. */
type FitRowOptions = { hasPrompt: boolean; isWorking: boolean; isTerminal: boolean; hasNumberKeys: boolean }

/**
 * What a turn runs on, quietly, with one button: the switch a suggestion offers (stopping the answer that is running,
 * or sending a finished task's follow-ups on), or once a fitted turn that ran on something else has ended, the redo that
 * asks the prompt again as usual; a task sent on shows where its follow-ups go, with nothing to press. A dim line and a
 * button on the terminal (0 presses it, with the number keys on), one dim markdown line with its link elsewhere.
 */
function fitRow($: EngineInterface, ui: Parts, fit: RoutedTurn, { hasPrompt, isWorking, isTerminal, hasNumberKeys }: FitRowOptions) {
  const { Box, Button, Markdown, Text } = ui
  const { isSuggestion } = fit
  const isOnward = fit.isOnward === true
  const hasButton = hasPrompt && !isOnward && (isSuggestion || (!isWorking && isMoved(fit)))
  const words = isOnward ? describeOnward(fit) : isSuggestion ? describeSuggested(fit) : describeRouted(fit)
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
      <Box key="task" flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {words}
        </Text>
      </Box>
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
 * The choices on the terminal, numbered as Claude Code's own surveys number their answers: with the number keys on, a
 * number typed into the empty prompt box picks one. A dim line under them says so, and where the settings are.
 */
function numberedChoices($: EngineInterface, ui: Parts, choices: readonly string[], columns: number, current: Settings) {
  const { Box, Button, Text } = ui
  const room = Math.max(10, columns - (current.numberKeys ? HOTKEY_COLUMNS : BUTTON_CHROME))
  return (
    <Box key="choices" flexDirection="column">
      <Box key="list" flexWrap="wrap" columnGap={3}>
        {choices.map((choice, i) =>
          current.numberKeys ? (
            <Button key={`choice-${i + 1}`} label={oneLine(choice, room)} plain hotkey={String(i + 1)} onPress={() => pressChoice($, choice, choices)} />
          ) : (
            <Button key={`choice-${i + 1}`} label={oneLine(choice, room)} onPress={() => pressChoice($, choice, choices)} />
          ),
        )}
      </Box>
      <Box key="hint">
        <Text dimColor wrap="truncate-end">
          {`${pickHint(current, choices.length)} · ${SETTINGS_HINT}`}
        </Text>
      </Box>
    </Box>
  )
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
const MENU: readonly MenuRow[] = [...SUGGEST_ROWS, ...ROUTE_ROWS, ...PROMPT_ROWS]

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

    return next(e)
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
    }

    return result
  }).catch(($, e, next) => next(e)) // a failure here never holds up the prompt

  on('turn.start', async ($, e, next) => {
    // The main loop's turns take their task from the prompt that started them; a subagent's are its own.
    if (e.agentId === undefined) {
      const current = await loadSettings($)
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
    // Main-thread turns that answered: a subagent's report, an interrupted turn or a refusal suggests nothing.
    if (e.agentId !== undefined || e.reason !== 'answer' || e.answer.trim().length === 0) return result

    lastReply = e.answer
    const current = await loadSettings($)
    const ask = epoch
    const prompt = await read($, last)

    if ((await $.session.surfaces()).length > 0) {
      // The band or the pane shows them: asked on a timer, so the end of the turn never waits on the model.
      if (current.suggest && !hasMovedOn) {
        $.clock.after(1, () => {
          void suggestNext($, ask, prompt?.text ?? '', e.answer)
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
    // The engine's own guess after a turn: the box shows this mod's likeliest choice instead, so the two agree.
    if (e.origin.kind === 'suggestion') {
      const likeliest = (await read($, suggested))?.choices[0]
      if (likeliest !== undefined) return next({ ...e, text: likeliest })
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
    if (e.props.hasSurvey || (!showsPrompt && idea === null && fit === null)) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = ui
    // The terminal's columns are exact, so its lines are cut to fit. VS Code and the apps lay text out in their own
    // font, where the columns they report undercount the room (VS Code 2.1.300 said 42 for a band twice that wide),
    // so there the texts go whole and wrap, as markdown: the last prompt a quote, the choices rows of links.
    const lastRoom = isTerminal ? Math.max(10, e.props.bodyColumns - QUOTE_COLUMNS - MORE_COLUMNS) : LAST_MAX_CHARS
    const more = <Button key="settings" label={MORE} plain dimColor onPress={() => openSettings($)} />
    const fitLine =
      fit !== null && fitRow($, ui, fit, { hasPrompt: prompt !== null, isWorking: e.props.isWorking, isTerminal, hasNumberKeys: isTerminal && current.numberKeys })
    // Without the quote, the ⋯ ends the band's first row: the model line, or else the "Suggested" label.
    const moreOnFit = !showsPrompt && fit !== null

    return (
      <Box flexDirection="column" rowGap="xs">
        {showsPrompt && prompt !== null && (
          <Box flexWrap="nowrap" columnGap={1}>
            {isTerminal ? (
              <Box key="prompt" flexGrow={1} flexShrink={1} borderStyle="quote" borderColor={QUOTE_COLOR} paddingLeft={1}>
                <Text wrap="truncate-end">{oneLine(prompt.text, lastRoom)}</Text>
              </Box>
            ) : (
              <Box key="prompt" flexGrow={1} flexShrink={1}>
                <Markdown text={quoteOf(prompt.text, lastRoom)} />
              </Box>
            )}
            {more}
          </Box>
        )}
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
        {idea !== null && !isTerminal && choiceList($, ui, idea.choices, showsPrompt || moreOnFit ? null : more)}
      </Box>
    )
  })

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
        <Text size="footnote" dimColor>
          {SAVED_NOTE}
        </Text>
      </Box>
    )
  })
}
