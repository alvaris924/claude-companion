import { atom, read, update } from 'claude-code'
import type {
  ElementTable,
  EngineInterface,
  PromptOrigin,
  Register,
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
// Task routing, off by default: Sonnet 5.5 grades each new task of the person's easy, mid or hard, and a turn.step
// hook sends the task's requests with that grade's model and effort (Haiku 5.5 low, Sonnet 5.5 medium and Opus 5.5 max
// unless picked otherwise), at any length of conversation. A reply or a short follow-up keeps the running task's grade
// with no call, and rules grade a task the model gives no answer for. The band says what every fitted turn runs on,
// with a link that asks the prompt again as usual where it ran on something else.
//
// The look, after Apple's developer pages and quiet note apps: the last prompt as a quote, secondary text dimmed, the
// choices as quiet buttons with a ↳, and a type scale for the rest. VS Code and the desktop app draw every Button in
// their own chrome, so the choices ask for the secondary one (dark in VS Code) rather than the filled one. Colours are
// theme keys, so a dark theme and a light one each draw it in their own; the terminal keeps one size and its row of
// buttons.
//
// Settings: suggestions on or off, the model, its effort, how many choices, what a click does. /companion, or the ⋯ in
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
  'Sonnet 5.5 grades each new task, as part of your plan’s usage, and the task runs on its grade’s model and effort. ' +
  'A switch makes the new model read the conversation once without its cache.'
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
const GRADE_PROMPT_CHARS = 1500
const GRADE_BEFORE_CHARS = 500
const GRADE_REPLY_CHARS = 1500
const GRADE_SYSTEM =
  "You grade how much thinking a developer's request to Claude Code, their AI coding assistant, needs, so that it " +
  'runs on a model that fits. Answer with one word: easy, mid or hard.\n' +
  'easy: a quick question, a lookup, a status check, a short explanation, or a tiny edit such as a rename, a typo or ' +
  'one obvious line.\n' +
  'mid: everyday coding work: a bug with a clear cause, a small feature, a change across a few files, tests for ' +
  'existing code, a doc page, a focused review.\n' +
  'hard: work that needs planning or deep reasoning: a feature across many files, a refactor or a migration, a bug ' +
  'with an unclear cause, performance, concurrency or security work, an architecture or design decision.\n' +
  'A reply that takes up what Claude offered ("yes", "do it", "go with B") is as hard as the work it takes up. ' +
  'Between two grades, pick the harder one.'
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
// Past that, an order leads with a verb that changes or runs something, or with a go-ahead: after an easy question it
// is work of its own, not part of the question.
const ORDER_LEAD =
  /^(?:(?:add|fix|change|make|update|remove|delete|drop|rename|move|create|write|edit|build|run|test|try|check|commit|push|merge|squash|open|close|apply|revert|undo|deploy|ship|release|install|uninstall|set|turn|enable|disable|replace|bump|restore|keep|use|pr|proceed|continue|start|finish)\b|do (?:it|that|this|both|all|them|so)\b|go(?: ahead\b| for\b|[.!]*$))/i
// A yes takes up what the answer offered, which is work too, unless it comes with a question of its own.
const YES = /^(?:yes|yep|yeah|yup|sure)\b/i

/** The settings the pane changes; stored as their pickers' values (`choices` as text, the switches as booleans). */
type Settings = {
  suggest: boolean
  model: string
  effort: 'low' | 'medium' | 'high'
  choices: number
  onPress: 'send' | 'box'
  /** Whether each task's turns run on the model and effort its grade's picker names. */
  route: boolean
  /** Each grade's model and effort, as "model:effort", or OWN_ROUTE for the session's own. */
  easy: string
  mid: string
  hard: string
  /** The conversation size, in tokens, past which only hard tasks switch; NO_LIMIT for none. */
  limit: string
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
// A grade as the band names it.
const GRADE_NAMES = { easy: 'Easy', mid: 'Mid', hard: 'Hard' } as const

const last = atom({ plugin: 'companion', key: 'last' } as const, null)
const suggested = atom({ plugin: 'companion', key: 'next' } as const, null)
const paneClosed = atom({ plugin: 'companion', key: 'paneClosed' } as const, false)
const savedSettings = atom({ plugin: 'companion', key: 'settings' } as const, null)
const routed = atom({ plugin: 'companion', key: 'routed' } as const, null)
const own = atom({ plugin: 'companion', key: 'own' } as const, null)

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
 * The running task: its grade (the rules' until the model's comes), what the model is still to grade, and whether it
 * was asked again as usual, which keeps its turns on the session's own model and effort.
 */
type Task = { level: TaskLevel; toGrade?: ToGrade; asUsual?: boolean }
/** What the settings give each grade. */
type Routes = Pick<Settings, 'easy' | 'mid' | 'hard' | 'limit'>
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
type FittedTurn = { task: Task; routes: Routes; plan?: Plan | null }
/**
 * What the next turn takes from the prompt that starts it: its task (the rules' grade, whether a task starts, what the
 * model grades, and whether it was asked again as usual), or nothing (a command, a program).
 */
type Pending = { kind: 'task'; level: TaskLevel; isNew: boolean; toGrade: ToGrade; asUsual?: boolean } | { kind: 'skip' }

// The task the person is on, and what their last prompt asked of the next turn; undefined continues the task.
let task: Task | null = null
let pending: Pending | undefined
// The main-loop turns being fitted, by turn id, until they complete.
const fitted = new Map<string, FittedTurn>()
// Set once a fitted request failed before it answered: the rest of the session's turns go as the engine makes them.
let isFitRefused = false
// The session's own model and effort as last written to state, so a turn writes them again only when they change.
let ownKey = ''
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
    route: typeof stored.route === 'boolean' ? stored.route : false,
    easy: pick(stored.easy, TIER_ROUTES, DEFAULT_ROUTES.easy),
    mid: pick(stored.mid, TIER_ROUTES, DEFAULT_ROUTES.mid),
    hard: pick(stored.hard, TIER_ROUTES, DEFAULT_ROUTES.hard),
    limit: pick(stored.limit, LIMITS, NO_LIMIT),
  }
}

/** The settings as the store keeps them. */
export function storedOf(current: Settings): StoredSettings {
  return { ...current, choices: String(current.choices) }
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

/** Each grade's pick in words: "easy tasks: Haiku 5.5 at low effort". */
export function tiersOf(current: Routes): string[] {
  return (['easy', 'mid', 'hard'] as const).map(level => `${level} tasks: ${labelOf(TIER_ROUTES, current[level])}`)
}

/** The settings on one line of plain text, for a host that draws no pane. */
export function settingsLine(current: Settings): string {
  const routing = current.route ? `on (${[...tiersOf(current), limitLine(current)].join('; ')})` : 'off'
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
  return current.route ? ['On', ...tiersOf(current), limitLine(current)].join(' · ') : 'Off'
}

/** One line of at most `max` characters: whitespace runs (line breaks included) become one space. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1))}…` : flat
}

/** What the person typed, without the blocks a host wraps around it; an image's marker becomes "[image]". */
export function ownWords(text: string): string {
  return text.replace(INJECTED_BLOCK, ' ').replace(IMAGE_MARKER, '[image]').trim()
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

/** Opens the settings pane on the settings the store holds now; false where no surface draws one. */
export async function openSettings($: EngineInterface): Promise<boolean> {
  await loadSettings($)
  return (await $.ui.open({ id: SETTINGS_PANE, title: SETTINGS_TITLE })).isPlaced
}

/** A pick in the settings pane: saved in the store for every session, in force at once, and drawn back. */
export async function changeSetting($: EngineInterface, field: keyof Settings, value: string | boolean): Promise<void> {
  const current = await loadSettings($)
  const changed = settingsFrom({ ...storedOf(current), [field]: value })
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

/** Whether a prompt only answers the last turn: one of its choices, or a few words that start no new work. */
export function isReply(text: string, choices: readonly string[]): boolean {
  const same = (said: string) => said.trim().toLowerCase().replace(/[.!?]+$/, '')
  if (choices.some(choice => same(choice) === same(text))) return true
  return wordsIn(text) <= REPLY_MAX_WORDS && !HARD_WORK.test(text)
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
export function startTurn(turnId: string, routes: Routes | undefined): void {
  const decided = pending
  pending = undefined
  if (decided?.kind === 'skip') return
  if (decided?.kind === 'task' && (decided.isNew || task === null)) {
    task = decided.asUsual ? { level: decided.level, asUsual: true } : { level: decided.level, toGrade: decided.toGrade }
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

/** The model's grade of a task; null when it gives none in time, and the rules' grade stands. */
export async function gradeWithModel($: EngineInterface, toGrade: ToGrade): Promise<TaskLevel | null> {
  try {
    const answer = await $.model.complete({
      model: GRADE_MODEL,
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
    const graded = FIRST_PARTY.test(baseModel(e.model)) ? await gradeWithModel($, task.toGrade) : null
    task.level = graded ?? task.level
    delete task.toGrade
  }
  // Past the limit only a hard task is worth the uncached read a switch costs.
  const limit = Number(turn.routes.limit)
  const isKept = !task.asUsual && task.level !== 'hard' && Number.isFinite(limit) && (await contextTokens($)) >= limit
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

/** A plan as the band keeps it. */
export function routedOf(plan: Plan, at: number): RoutedTurn {
  const named = (effort: TurnStepInput['effort']) => (effort === undefined ? null : String(effort))
  return { level: plan.level, model: plan.model, effort: named(plan.effort), ownModel: plan.ownModel, ownEffort: named(plan.ownEffort), isKept: plan.isKept, at }
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

/** A fitted turn in words: "Easy task · Haiku 5.5 at low effort". */
export function describeRouted(turn: Pick<RoutedTurn, 'level' | 'model' | 'effort' | 'isKept'>): string {
  const runsOn = turn.effort === null ? modelName(turn.model) : `${modelName(turn.model)} at ${turn.effort} effort`
  return `${GRADE_NAMES[turn.level]} task · ${runsOn}${turn.isKept ? ' · kept: long conversation' : ''}`
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

/**
 * What a fitted turn runs on, quietly, and once one that ran on something else has ended, a link that asks the prompt
 * again as usual: a dim line and a button on the terminal, one dim markdown line with its link elsewhere.
 */
function fitRow($: EngineInterface, ui: Parts, fit: RoutedTurn, canRedo: boolean, isTerminal: boolean) {
  const { Box, Button, Markdown, Text } = ui
  const hasRedo = canRedo && isMoved(fit)
  if (!isTerminal) {
    const redo = hasRedo ? ` · [${escapeMarkdown(redoLabel(fit))}](${REDO_HREF})` : ''
    return (
      <Box key="fit">
        <Markdown
          key="task"
          text={`${escapeMarkdown(describeRouted(fit))}${redo}`}
          dimColor
          {...(hasRedo ? { pressableLinks: [REDO_HREF], onLinkPress: () => redoAsUsual($) } : {})}
        />
      </Box>
    )
  }
  return (
    <Box key="fit" flexWrap="wrap" columnGap={2}>
      <Box key="task" flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {describeRouted(fit)}
        </Text>
      </Box>
      {hasRedo && (
        <Button key="redo" label={redoLabel(fit)} plain onPress={() => redoAsUsual($)}>
          <Text color={ACCENT}>{`${redoLabel(fit)}${CHEVRON}`}</Text>
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
function choiceList($: EngineInterface, ui: Parts, choices: readonly string[]) {
  const { Box, Button, Text } = ui
  return (
    <Box key="choices" flexDirection="column" rowGap="xs">
      <Text size="caption" weight="semibold" dimColor>
        {SUGGESTED}
      </Text>
      {choices.map((choice, i) => (
        <Button key={`choice-${i + 1}`} label={choice} plain dimColor onPress={() => pressChoice($, choice, choices)}>
          <Text color="text">{`${MARKER} ${choice}`}</Text>
        </Button>
      ))}
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

    const current = await loadSettings($)
    const note = current.route ? ownNote(current, await read($, own)) : null
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
    const result = await next(e)

    // A dropped prompt never reached the session, and the machine's own deliveries are not "my prompt".
    if ('drop' in result || MACHINE_ORIGINS.has(e.origin.kind)) return result

    const text = ownWords(e.text)
    if (text.length > 0) {
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
      startTurn(e.turnId, current.route ? { easy: current.easy, mid: current.mid, hard: current.hard, limit: current.limit } : undefined)
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
    // Main-thread turns that answered: a subagent's report, an interrupted turn or a refusal suggests nothing.
    if (e.agentId !== undefined || e.reason !== 'answer' || e.answer.trim().length === 0) return result

    lastReply = e.answer
    const current = await loadSettings($)
    const ask = epoch
    const prompt = await read($, last)

    if ((await $.session.surfaces()).length > 0) {
      // The band or the pane shows them: asked on a timer, so the end of the turn never waits on the model.
      if (current.suggest) {
        $.clock.after(1, () => {
          void suggestNext($, ask, prompt?.text ?? '', e.answer)
        })
      }
      return result
    }

    // Nothing draws this mod's UI: what a fitted turn ran on and the choices become the turn's text, which the engine
    // shows as a notice beneath the answer. A program's prompt (claude -p, the Agent SDK) has nobody to read one.
    if (prompt === null || prompt.isFromProgram) return result
    const choices = current.suggest ? await askNext($, ask, prompt.text, e.answer) : null
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const prompt = await read($, last)
    const idea = await read($, suggested)
    const fit = await read($, routed)
    if (e.props.hasSurvey || (prompt === null && idea === null && fit === null)) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = ui
    // The terminal's columns are exact, so its lines are cut to fit. VS Code and the apps lay text out in their own
    // font, where the columns they report undercount the room (VS Code 2.1.300 said 42 for a band twice that wide),
    // so there the texts go whole and wrap, as markdown: the last prompt a quote, the choices rows of links.
    const isTerminal = e.surface === 'terminal'
    const lastRoom = isTerminal ? Math.max(10, e.props.bodyColumns - QUOTE_COLUMNS - MORE_COLUMNS) : LAST_MAX_CHARS
    const choiceRoom = Math.max(10, e.props.bodyColumns - NEXT_LABEL.length - BUTTON_CHROME)

    return (
      <Box flexDirection="column" rowGap="xs">
        {prompt !== null && (
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
            <Button key="settings" label={MORE} plain dimColor onPress={() => openSettings($)} />
          </Box>
        )}
        {fit !== null && fitRow($, ui, fit, !e.props.isWorking && prompt !== null, isTerminal)}
        {idea !== null && isTerminal && (
          <Box>
            <Text dimColor>{NEXT_LABEL}</Text>
            <Box key="choices" flexWrap="wrap" columnGap={1} flexShrink={1}>
              {idea.choices.map((choice, i) => (
                <Button
                  key={`choice-${i + 1}`}
                  label={oneLine(choice, choiceRoom)}
                  variant={i === 0 ? 'primary' : undefined}
                  onPress={() => pressChoice($, choice, idea.choices)}
                />
              ))}
            </Box>
          </Box>
        )}
        {idea !== null && !isTerminal && choiceList($, ui, idea.choices)}
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
    const choiceRoom = Math.max(10, e.props.bodyColumns - BUTTON_CHROME)

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
        {fit !== null && fitRow($, ui, fit, prompt !== null, isTerminal)}
        {idea !== null && !isTerminal && choiceList($, ui, idea.choices)}
        {idea !== null && isTerminal && (
          <Box key="choices" flexDirection="column">
            <Text dimColor>{NEXT_LABEL.trim()}</Text>
            {idea.choices.map((choice, i) => (
              <Button
                key={`choice-${i + 1}`}
                label={oneLine(choice, choiceRoom)}
                variant={i === 0 ? 'primary' : undefined}
                onPress={() => pressChoice($, choice, idea.choices)}
              />
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    // Drawn from $.state (a pick redraws it); a render never writes, so before the first load it reads the store.
    const drawn = await read($, savedSettings)
    const current = drawn !== null ? settingsFrom(drawn) : ((await readSettings($)) ?? settings)
    const note = ownNote(current, await read($, own))
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
              key="route"
              label="Fit model and effort to each task"
              value={current.route ? 'on' : 'off'}
              options={ON_OFF}
              onSelect={value => changeSetting($, 'route', value === 'on')}
            />
            <Select key="easy" label="Easy tasks" value={current.easy} options={TIER_ROUTES} onSelect={value => changeSetting($, 'easy', value)} />
            <Select key="mid" label="Mid tasks" value={current.mid} options={TIER_ROUTES} onSelect={value => changeSetting($, 'mid', value)} />
            <Select key="hard" label="Hard tasks" value={current.hard} options={TIER_ROUTES} onSelect={value => changeSetting($, 'hard', value)} />
            <Select key="limit" label="Easy and mid tasks switch up to" value={current.limit} options={LIMITS} onSelect={value => changeSetting($, 'limit', value)} />
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
        <Text size="footnote" dimColor>
          {SAVED_NOTE}
        </Text>
      </Box>
    )
  })
}
