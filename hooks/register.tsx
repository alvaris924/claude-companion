import { atom, read, update } from 'claude-code'
import type {
  CommandInfo,
  EngineInterface,
  PromptOrigin,
  Register,
  SelectOption,
  TurnStepChunk,
  TurnStepInput,
  TurnStepResult,
} from 'claude-code'

import type { LastPrompt, RoutedTurn, StoredSettings, Suggestion } from '../types'

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
// Skills and searches: the lines after the first may run one of the session's skills or commands, which go with the
// request as one cached block, or ask Claude to find a skill or search the web. Claude's own tools do that finding: the
// plugin makes no network requests. A choice that names a command the session lacks is dropped.
//
// Task routing, off by default: each prompt of the person's is graded light, standard or heavy by rules, with no model
// call, and the turns of its task run to fit. A turn.step hook sends a light task's requests to Haiku 5.5 at low effort
// and a heavy task's one effort level up, one model up too when picked, while the conversation is under 100,000 tokens.
// The band says what a fitted turn ran on, with a button that asks the prompt again as usual.
//
// Settings: suggestions on or off, the model, its effort, how many choices, what a click does. /companion, or the ⚙ in
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
const GEAR_COLUMNS = 2 // " ⚙" after the last prompt
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

// Skills and searches among the choices: the session's commands go with the request as one cached block, cut to size.
const CATALOGUE_MAX_COMMANDS = 80
const CATALOGUE_DESCRIPTION_CHARS = 100
const CATALOGUE_MAX_CHARS = 8000
// This mod's own commands, never a choice.
const OWN_COMMANDS: ReadonlySet<string> = new Set(['companion', 'last-prompt', 'copy-next'])
// Commands no choice runs, whether the model names them or not: they end the session, sign out or throw the
// conversation away. The list names what to drop, so a command the plugin has not met yet can still be offered.
const NEVER_OFFERED: ReadonlySet<string> = new Set(['clear', 'reset', 'new', 'exit', 'quit', 'logout', 'login', 'rewind', 'resume', 'upgrade'])
// A choice that runs a command: "/name", then its arguments.
const COMMAND_LINE = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/

// Task routing: a light task leaves the session's model for Haiku 5.5 at low effort; a heavy one climbs one effort
// level, and one model too when the settings say so.
const LIGHT_MODEL = 'claude-haiku-5-5'
const LIGHT_EFFORT = 'low'
// The current models from the cheapest to the most capable: "one model up" for a heavy task.
const MODEL_LADDER: readonly string[] = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']
const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const
// A first-party id of a Claude model priced above Haiku: what a light task may leave. An id the plugin cannot read (a
// provider's own spelling, a family it does not know) keeps its model.
const ABOVE_HAIKU = /^claude-(?:sonnet|opus|fable)-\d/
// Caches belong to one model, so a switch sends the whole conversation to a model that has not cached it. Below Haiku
// 5.5's long-context price line, 100K prompt tokens, that costs no more than a cached read on Sonnet, Opus or Fable;
// above it Haiku costs five times as much. Raising the effort makes the API read the conversation uncached once, so the
// same line holds for it.
const ROUTE_MAX_CONTEXT_TOKENS = 100_000
// Words that start substantial work: building code, reshaping it, moving it, or taking on all of it.
const HEAVY_WORK =
  /\b(?:implement(?:s|ed|ing)?|refactor(?:s|ed|ing)?|re-?architect(?:s|ed|ing)?|migrat(?:e|es|ed|ing)|redesign(?:s|ed|ing)?|rewrit(?:e|es|ing|ten)|rewrote|overhaul(?:s|ed|ing)?|scaffold(?:s|ed|ing)?|from scratch|(?:whole|entire) (?:code ?base|repo(?:sitory)?|project|app))\b/i
// Lead-ins that soften a request without changing it: "ok", "please", "can you", "let's".
const SOFT_LEAD = /^(?:(?:ok(?:ay)?|so|and|also|now|hey|please|pls|can you|could you|would you|will you|can we|could we|let'?s)\b[\s,:]*)+/i
// What a question or a request to explain leads with: a question word, or a verb that asks for words, not work.
const QUESTION_LEAD = /^(?:what|what's|whats|how|where|which|when|who|whose|explain|summari[sz]e|describe|define|list|remind me|tell me|show me)\b/i
// A yes-or-no question leads with one of these and ends with "?": "does it handle tabs?" ("do the release" is work).
const YES_NO_LEAD = /^(?:is|are|was|were|does|do|did|has|have|should|would|could|can|will)\b/i
// Signs of something broken: a question about it asks for debugging, which is no light task.
const DEBUG_SIGNS =
  /\b(?:errors?|exceptions?|traceback|stack ?trace|fail(?:s|ed|ing|ure)?|broken|bugs?|crash(?:es|ed|ing)?|regression|flaky|wrong|(?:not|doesn'?t|does not|won'?t|can'?t) work(?:ing)?)\b/i
// A file or a path the prompt names: "src/a.ts", "README.md".
const PATH_LIKE =
  /(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|ya?ml|toml|css|scss|html|sql|txt|xml|vue|svelte|lock)\b/gi
const LIGHT_MAX_WORDS = 25
const HEAVY_MIN_WORDS = 250
const HEAVY_MIN_PATHS = 4
// A reply this short continues the running task, and so does a follow-up of up to this many words to heavy work.
const REPLY_MAX_WORDS = 6
const HEAVY_FOLLOW_UP_MAX_WORDS = 40

/** The settings the pane changes; stored as their pickers' values (`choices` as text, the switches as booleans). */
type Settings = {
  suggest: boolean
  /** Whether the lines after the first may run a skill or a command, or ask Claude to find a skill or search the web. */
  skills: boolean
  model: string
  effort: 'low' | 'medium' | 'high'
  choices: number
  onPress: 'send' | 'box'
  /** Whether each task's turns run on a model and effort that fit it. */
  route: boolean
  light: 'haiku' | 'keep'
  heavy: 'effort' | 'model' | 'keep'
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
const LIGHT_ROUTES: readonly SelectOption[] = [
  { value: 'haiku', label: 'Haiku 5.5 at low effort' },
  { value: 'keep', label: 'My model and effort' },
]
const HEAVY_ROUTES: readonly SelectOption[] = [
  { value: 'effort', label: 'My model, one effort level up' },
  { value: 'model', label: 'One model and one effort level up' },
  { value: 'keep', label: 'My model and effort' },
]

const last = atom({ plugin: 'companion', key: 'last' } as const, null)
const suggested = atom({ plugin: 'companion', key: 'next' } as const, null)
const paneClosed = atom({ plugin: 'companion', key: 'paneClosed' } as const, false)
const savedSettings = atom({ plugin: 'companion', key: 'settings' } as const, null)
const routed = atom({ plugin: 'companion', key: 'routed' } as const, null)

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

/** How much a task asks of the model, graded from the person's prompt. */
export type TaskLevel = 'light' | 'standard' | 'heavy'
/** The running task: its level, and whether its turns may change model or effort, decided at its first request. */
type Task = { level: TaskLevel; mayChange?: boolean }
/** What the settings give a light and a heavy task. */
type Routes = Pick<Settings, 'light' | 'heavy'>
/** The model and effort a fitted turn's requests go with, beside the session's own that its first request named. */
type Plan = {
  level: 'light' | 'heavy'
  model: string
  effort: TurnStepInput['effort']
  ownModel: string
  ownEffort: TurnStepInput['effort']
}
/** A main-loop turn the settings fit: its task, the routes, and its plan once its first request decided one. */
type FittedTurn = { task: Task; routes: Routes; plan?: Plan | null }
/** What the next turn takes from the prompt that starts it: a graded task, or nothing (a command, a program). */
type Pending = { kind: 'task'; level: TaskLevel; isNew: boolean } | { kind: 'skip' }
/** The commands a choice may run: their lines for the request, and their names. */
type Catalogue = { lines: string; names: ReadonlySet<string> }

const NO_COMMANDS: Catalogue = { lines: '', names: new Set<string>() }

// The task the person is on, and what their last prompt asked of the next turn; undefined continues the task.
let task: Task | null = null
let pending: Pending | undefined
// The main-loop turns being fitted, by turn id, until they complete.
const fitted = new Map<string, FittedTurn>()
// Set once a fitted request failed before it answered: the rest of the session's turns go as the engine makes them.
let isFitRefused = false

/** `value` when it is one of `options`' values, else `fallback`. */
export function pick(value: unknown, options: readonly SelectOption[], fallback: string): string {
  return typeof value === 'string' && options.some(option => option.value === value) ? value : fallback
}

/** The settings from what the store holds, each value outside its picker's options taken as its default. */
export function settingsFrom(stored: Readonly<Record<string, unknown>>): Settings {
  return {
    suggest: typeof stored.suggest === 'boolean' ? stored.suggest : true,
    skills: typeof stored.skills === 'boolean' ? stored.skills : true,
    model: pick(stored.model, MODELS, DEFAULT_MODEL),
    effort: pick(stored.effort, EFFORTS, 'low') as Settings['effort'],
    choices: Number(pick(stored.choices, CHOICE_COUNTS, '3')),
    onPress: pick(stored.onPress, PRESS_ACTIONS, 'send') as Settings['onPress'],
    route: typeof stored.route === 'boolean' ? stored.route : false,
    light: pick(stored.light, LIGHT_ROUTES, 'haiku') as Settings['light'],
    heavy: pick(stored.heavy, HEAVY_ROUTES, 'effort') as Settings['heavy'],
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

/** The settings on one line of plain text, for a host that draws no pane. */
export function settingsLine(current: Settings): string {
  const routing = current.route
    ? `on (light tasks: ${labelOf(LIGHT_ROUTES, current.light)}; heavy tasks: ${labelOf(HEAVY_ROUTES, current.heavy)})`
    : 'off'
  return (
    `Suggestions: ${current.suggest ? 'on' : 'off'} · Model: ${labelOf(MODELS, current.model)} · ` +
    `Effort: ${current.effort} · Choices: ${current.choices} · Clicking a choice: ${labelOf(PRESS_ACTIONS, current.onPress)} · ` +
    `Skills and searches: ${current.skills ? 'on' : 'off'} · Fit to the task: ${routing}`
  )
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

/** The command a choice runs, "/name args"; undefined for a plain message. */
export function commandOf(text: string): { name: string; args: string } | undefined {
  const match = COMMAND_LINE.exec(text.trim())
  const name = match?.[1]
  return name === undefined ? undefined : { name, args: (match?.[2] ?? '').trim() }
}

/** Whether a choice may be offered: a plain message, or a command `commands` lists (any, when not given) but the never-offered. */
export function isOfferable(choice: string, commands?: ReadonlySet<string>): boolean {
  const command = commandOf(choice)
  if (command === undefined) return true

  const name = command.name.toLowerCase()
  return !NEVER_OFFERED.has(name) && (commands === undefined || commands.has(name))
}

/**
 * The model's reply cut to at most `count` different messages, in its order. A line that runs a command stays only
 * when `commands` lists it, where given, and it is no command a choice never runs.
 */
export function cleanChoices(raw: string, count: number, commands?: ReadonlySet<string>): string[] {
  const choices: string[] = []
  const seen = new Set<string>()
  for (const line of raw.split(/\r?\n/)) {
    const choice = cleanSuggestion(line)
    const same = choice.toLowerCase().replace(/[.!?]+$/, '')
    if (choice.length === 0 || seen.has(same) || !isOfferable(choice, commands)) continue

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

/** The rule that lets the lines after the first run a command, or ask Claude to find a skill or search the web. */
export function skillsRule(hasCommands: boolean): string {
  return (
    'A line after the first may also be, even when the reply did not name it: ' +
    (hasCommands
      ? 'one of the commands in <commands>, written as /name and a short argument if it takes one, when running it is ' +
        'the natural next step; '
      : '') +
    '"Find a skill for ..." when the work needs something the session has no command for; or "Search the web for ..." ' +
    'when the reply guesses at something that changes over time, such as a library\'s current API or a version. Most ' +
    'lines stay plain messages.\n\n'
  )
}

/** The block of commands that opens the request: the same text every call, so the prompt cache serves it. */
export function commandsBlock(lines: string): string {
  return `<commands>\nThe slash commands the developer can run in this session:\n${lines}\n</commands>\n\n`
}

/** The session's commands a choice may run, one line each ("/name: what it does"), skills and the person's own first. */
export async function commandCatalogue($: EngineInterface): Promise<Catalogue> {
  let listed: readonly CommandInfo[]
  try {
    listed = await $.command.list()
  } catch {
    return NO_COMMANDS
  }

  const offered = listed.filter(
    command => command.plugin !== 'companion' && !OWN_COMMANDS.has(command.name) && !NEVER_OFFERED.has(command.name.toLowerCase()),
  )
  // The typeahead lists the built-ins first; the skills and the person's own commands are what a choice is for.
  const ordered = [...offered.filter(command => command.source !== 'builtin'), ...offered.filter(command => command.source === 'builtin')]
  const lines: string[] = []
  const names = new Set<string>()
  let size = 0
  for (const command of ordered) {
    const said = oneLine(command.description, CATALOGUE_DESCRIPTION_CHARS)
    const line = said.length > 0 ? `/${command.name}: ${said}` : `/${command.name}`
    if (lines.length === CATALOGUE_MAX_COMMANDS || size + line.length > CATALOGUE_MAX_CHARS) break

    lines.push(line)
    names.add(command.name.toLowerCase())
    size += line.length + 1
  }
  return { lines: lines.join('\n'), names }
}

/**
 * What the model reads: the end of the reply matters most, where the questions, offers and open items are. With
 * `skills`, the lines after the first may also run a command or ask for a skill or a search.
 */
export function suggestionPrompt(lastPrompt: string, reply: string, count: number, skills?: { hasCommands: boolean }): string {
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
    (skills === undefined || count === 1 ? '' : skillsRule(skills.hasCommands)) +
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
  // One choice is the likeliest message alone, under the tuned rules: it never runs a command.
  const offersSkills = settings.skills && count > 1
  try {
    const commands = offersSkills ? await commandCatalogue($) : NO_COMMANDS
    const text = suggestionPrompt(lastPrompt, reply, count, offersSkills ? { hasCommands: commands.names.size > 0 } : undefined)
    const request = {
      system: suggestSystem(count),
      // The commands open the request, the same text every call, so the prompt cache serves them after the first.
      prompt: commands.names.size > 0 ? [{ text: commandsBlock(commands.lines), cache: true as const }, { text }] : text,
      maxTokens: SUGGEST_MAX_TOKENS,
      effort,
      timeoutMs: SUGGEST_TIMEOUT_MS,
    }
    let answer = await $.model.complete({ ...request, model })
    if (!answer.isAnswered && ask === epoch && model !== FALLBACK_MODEL) {
      answer = await $.model.complete({ ...request, model: FALLBACK_MODEL })
    }
    if (ask !== epoch || !answer.isAnswered) return null

    const choices = cleanChoices(answer.text, count, offersSkills ? commands.names : undefined)
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

/** Sends a choice as the person's own words, or runs the command it names, once however often the choices are pressed. */
export async function sendChoice($: EngineInterface, text: string): Promise<void> {
  let isTaken = false
  await update($, suggested, current => {
    isTaken = current !== null && current.choices.includes(text)
    return isTaken ? null : current
  })
  if (!isTaken) return

  // Recorded here: the prompt hook below never sees this mod's own submit.
  await recordPrompt($, text, false)
  const command = commandOf(text)
  if (command === undefined) {
    pending = undefined // a choice continues the task it answers
    await $.prompt.submit({ text, asUser: true })
    return
  }

  pending = { kind: 'skip' } // a command's turns run as the command sets them
  try {
    await $.command.run({ command: command.name, args: command.args })
  } catch {
    $.ui.toast(`Could not run ${text}`)
  }
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
 * How much a task asks of the model, from the prompt that starts it: heavy for building, reshaping or moving code and
 * for long prompts or many paths; light for a short question or a request to explain, with nothing broken in it and
 * nothing pasted; standard otherwise.
 */
export function gradeTask(text: string): TaskLevel {
  const words = wordsIn(text)
  const paths = new Set((text.match(PATH_LIKE) ?? []).map(path => path.toLowerCase())).size
  if (HEAVY_WORK.test(text) || words > HEAVY_MIN_WORDS || paths >= HEAVY_MIN_PATHS) return 'heavy'

  const asked = text.trim().replace(SOFT_LEAD, '')
  const isQuestion = QUESTION_LEAD.test(asked) || (YES_NO_LEAD.test(asked) && /\?\s*$/.test(asked))
  const isPlain =
    words <= LIGHT_MAX_WORDS && paths <= 1 && text.trim().split('\n').length <= 2 && !text.includes('```') && !DEBUG_SIGNS.test(text)
  return isQuestion && isPlain ? 'light' : 'standard'
}

/** Whether a prompt only answers the last turn: one of its choices, or a few words that start no new work. */
export function isReply(text: string, choices: readonly string[]): boolean {
  const same = (said: string) => said.trim().toLowerCase().replace(/[.!?]+$/, '')
  if (choices.some(choice => same(choice) === same(text))) return true
  return wordsIn(text) <= REPLY_MAX_WORDS && !HEAVY_WORK.test(text)
}

/**
 * The level of the task a prompt works on: its own grade when it starts a task, the running task's when it answers
 * the last turn or follows up heavy work. `isNew` says a task starts, so its first request decides afresh.
 */
export function nextLevel(text: string, running: TaskLevel | null, choices: readonly string[]): { level: TaskLevel; isNew: boolean } {
  const graded = gradeTask(text)
  if (running === null) return { level: graded, isNew: true }
  if (isReply(text, choices)) return { level: running, isNew: false }
  if (running === 'heavy' && graded !== 'heavy' && wordsIn(text) <= HEAVY_FOLLOW_UP_MAX_WORDS) return { level: running, isNew: false }
  return { level: graded, isNew: true }
}

/** Grades the person's prompt for the turn it starts; a command's or a program's prompt leaves that turn alone. */
export async function noteTask($: EngineInterface, text: string, isLeftAlone: boolean): Promise<void> {
  if (isLeftAlone) {
    pending = { kind: 'skip' }
    return
  }
  const choices = (await read($, suggested))?.choices ?? []
  pending = { kind: 'task', ...nextLevel(text, task?.level ?? null, choices) }
}

/** A main-loop turn begins: it takes its task from the prompt that started it, and is fitted when `routes` are given. */
export function startTurn(turnId: string, routes: Routes | undefined): void {
  const decided = pending
  pending = undefined
  if (decided?.kind === 'skip') return
  if (decided?.kind === 'task' && (decided.isNew || task === null)) task = { level: decided.level }
  if (task !== null && routes !== undefined && !isFitRefused) fitted.set(turnId, { task, routes })
}

/** The session's context fill in tokens: 0 before the first reading, unbounded where it cannot be read. */
export async function contextTokens($: EngineInterface): Promise<number> {
  try {
    return (await $.session.usage()).context.tokens ?? 0
  } catch {
    return Number.POSITIVE_INFINITY
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

/** One effort level up, `max` at most; a number, or no effort at all, stays as it is. */
export function raisedEffort(effort: TurnStepInput['effort']): TurnStepInput['effort'] {
  if (typeof effort !== 'string') return effort
  const at = EFFORT_LADDER.indexOf(effort)
  return at < 0 ? effort : (EFFORT_LADDER[Math.min(at + 1, EFFORT_LADDER.length - 1)] ?? effort)
}

/** One model up the ladder, Fable 5.1 at its top; a model off the ladder stays as it is. */
export function steppedUp(model: string): string {
  const at = MODEL_LADDER.indexOf(baseModel(model))
  return at < 0 ? model : (MODEL_LADDER[at + 1] ?? model)
}

/** What a task's turns go with in place of the session's own model and effort; null leaves them as they are. */
export function routeFor(
  level: TaskLevel,
  routes: Routes,
  own: Pick<TurnStepInput, 'model' | 'effort'>,
): Pick<Plan, 'model' | 'effort'> | null {
  if (level === 'light') {
    const isLighter = routes.light === 'haiku' && ABOVE_HAIKU.test(baseModel(own.model))
    return isLighter ? { model: LIGHT_MODEL, effort: LIGHT_EFFORT } : null
  }
  if (level === 'standard' || routes.heavy === 'keep') return null

  const model = routes.heavy === 'model' ? steppedUp(own.model) : own.model
  const effort = raisedEffort(own.effort)
  return model === own.model && effort === own.effort ? null : { model, effort }
}

/** Decides a fitted turn at its first request: what its task's level gets, while the conversation is small enough. */
export async function planTurn($: EngineInterface, turn: FittedTurn, e: TurnStepInput): Promise<Plan | null> {
  const level = turn.task.level
  const route = routeFor(level, turn.routes, e)
  if (route === null || level === 'standard') return null

  // Decided once per task: a task that changed model or effort keeps it, as going back would cost a cache write too.
  turn.task.mayChange ??= (await contextTokens($)) < ROUTE_MAX_CONTEXT_TOKENS
  return turn.task.mayChange ? { level, ...route, ownModel: e.model, ownEffort: e.effort } : null
}

/** A plan as the band keeps it. */
export function routedOf(plan: Plan, at: number): RoutedTurn {
  const named = (effort: TurnStepInput['effort']) => (effort === undefined ? null : String(effort))
  return { level: plan.level, model: plan.model, effort: named(plan.effort), ownModel: plan.ownModel, ownEffort: named(plan.ownEffort), at }
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
  // A request on another model than the turn's first is the engine's own choice, a fallback: it stands.
  if (plan === null || e.model !== plan.ownModel) return undefined
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

/** A fitted turn in words: "Light task: Haiku 5.5 at low effort". */
export function describeRouted(turn: Pick<RoutedTurn, 'level' | 'model' | 'effort'>): string {
  const runsOn = turn.effort === null ? modelName(turn.model) : `${modelName(turn.model)} at ${turn.effort} effort`
  return `${turn.level === 'light' ? 'Light' : 'Heavy'} task: ${runsOn}`
}

/** The label of the button that asks the last prompt again as usual: on the session's model, or at its effort. */
export function redoLabel(turn: RoutedTurn): string {
  if (turn.model !== turn.ownModel) return `Redo on ${modelName(turn.ownModel)}`
  return turn.ownEffort === null ? 'Redo as usual' : `Redo at ${turn.ownEffort} effort`
}

/** Asks the last prompt again on the session's own model and effort, once however often it is pressed. */
export async function redoAsUsual($: EngineInterface): Promise<void> {
  let wasFitted = false
  await update($, routed, current => {
    wasFitted = current !== null
    return null
  })
  const prompt = await read($, last)
  if (!wasFitted || prompt === null) return

  // A new task at the person's own level: its follow-ups stay there.
  pending = { kind: 'task', level: 'standard', isNew: true }
  await recordPrompt($, prompt.text, prompt.isFromProgram)
  await $.prompt.submit({ text: prompt.text, asUser: true })
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
    return { text: `${settingsLine(current)}\nNo panel draws here: run /companion in VS Code or the terminal to change them.` }
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
      startTurn(e.turnId, current.route ? { light: current.light, heavy: current.heavy } : undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
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

    const { Box, Button, Text } = $.ui.resolve(e)
    // The terminal's columns are exact, so its lines are cut to fit. VS Code and the apps lay text out in their own
    // font, where the columns they report undercount the room (VS Code 2.1.300 said 42 for a band twice that wide),
    // so there the texts go whole and wrap; a choice wraps inside its button (a Text child, a label never wraps).
    const isTerminal = e.surface === 'terminal'
    const lastRoom = isTerminal ? Math.max(10, e.props.bodyColumns - LAST_LABEL.length - GEAR_COLUMNS) : LAST_MAX_CHARS
    const choiceRoom = Math.max(10, e.props.bodyColumns - NEXT_LABEL.length - BUTTON_CHROME)

    return (
      <Box flexDirection="column">
        {prompt !== null && (
          <Box flexWrap="nowrap" columnGap={1}>
            <Box flexWrap="nowrap" flexGrow={1} flexShrink={1}>
              <Text dimColor>{LAST_LABEL}</Text>
              <Box key="prompt" flexShrink={1}>
                <Text wrap={isTerminal ? 'truncate-end' : 'wrap'}>{oneLine(prompt.text, lastRoom)}</Text>
              </Box>
            </Box>
            <Button key="settings" label="⚙" plain dimColor onPress={() => openSettings($)} />
          </Box>
        )}
        {fit !== null && (
          <Box key="fit" flexWrap="wrap" columnGap={1}>
            <Box key="task" flexShrink={1}>
              <Text dimColor wrap={isTerminal ? 'truncate-end' : 'wrap'}>
                {describeRouted(fit)}
              </Text>
            </Box>
            {fit.level === 'light' && !e.props.isWorking && prompt !== null && (
              <Button key="redo" label={redoLabel(fit)} dimColor onPress={() => redoAsUsual($)} />
            )}
          </Box>
        )}
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
        {idea !== null && !isTerminal && (
          <Box key="choices" flexDirection="column">
            <Text dimColor>{NEXT_LABEL.trim()}</Text>
            {idea.choices.map((choice, i) => (
              <Button key={`choice-${i + 1}`} variant={i === 0 ? 'primary' : undefined} onPress={() => pressChoice($, choice, idea.choices)}>
                <Text>{choice}</Text>
              </Button>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const prompt = await read($, last)
    const idea = await read($, suggested)
    const fit = await read($, routed)
    const { Box, Button, Text } = $.ui.resolve(e)
    // As in the band: cut to the terminal's exact columns, whole and wrapping everywhere else.
    const isTerminal = e.surface === 'terminal'
    const choiceRoom = Math.max(10, e.props.bodyColumns - BUTTON_CHROME)

    return (
      <Box flexDirection="column">
        {prompt === null ? (
          <Text dimColor>No prompt yet.</Text>
        ) : (
          <Box flexWrap="nowrap">
            <Text dimColor>{LAST_LABEL}</Text>
            <Box key="prompt" flexShrink={1}>
              <Text>{oneLine(prompt.text, PANE_MAX_CHARS)}</Text>
            </Box>
          </Box>
        )}
        {fit !== null && (
          <Box key="fit" flexWrap="wrap" columnGap={1}>
            <Box key="task" flexShrink={1}>
              <Text dimColor>{describeRouted(fit)}</Text>
            </Box>
            {fit.level === 'light' && prompt !== null && (
              <Button key="redo" label={redoLabel(fit)} dimColor onPress={() => redoAsUsual($)} />
            )}
          </Box>
        )}
        {idea !== null && (
          <Box key="choices" flexDirection="column">
            <Text dimColor>{NEXT_LABEL.trim()}</Text>
            {idea.choices.map((choice, i) =>
              isTerminal ? (
                <Button
                  key={`choice-${i + 1}`}
                  label={oneLine(choice, choiceRoom)}
                  variant={i === 0 ? 'primary' : undefined}
                  onPress={() => pressChoice($, choice, idea.choices)}
                />
              ) : (
                <Button key={`choice-${i + 1}`} variant={i === 0 ? 'primary' : undefined} onPress={() => pressChoice($, choice, idea.choices)}>
                  <Text>{choice}</Text>
                </Button>
              ),
            )}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    // Drawn from $.state (a pick redraws it); a render never writes, so before the first load it reads the store.
    const drawn = await read($, savedSettings)
    const current = drawn !== null ? settingsFrom(drawn) : ((await readSettings($)) ?? settings)
    if (e.surface === 'mobile') {
      // The mobile app draws no picker: the settings as text, changed from a computer.
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Box key="summary">
            <Text>{settingsLine(current)}</Text>
          </Box>
          <Text dimColor>Change them from VS Code or the terminal: /companion.</Text>
        </Box>
      )
    }

    const { Box, Select, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor>Suggested next messages</Text>
        <Select
          key="suggest"
          label="Suggest next messages"
          value={current.suggest ? 'on' : 'off'}
          options={ON_OFF}
          onSelect={value => changeSetting($, 'suggest', value === 'on')}
        />
        <Select
          key="skills"
          label="Offer skills and web searches"
          value={current.skills ? 'on' : 'off'}
          options={ON_OFF}
          onSelect={value => changeSetting($, 'skills', value === 'on')}
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
        <Text dimColor>Model and effort for each task</Text>
        <Select
          key="route"
          label="Fit model and effort to each task"
          value={current.route ? 'on' : 'off'}
          options={ON_OFF}
          onSelect={value => changeSetting($, 'route', value === 'on')}
        />
        <Select key="light" label="Light tasks" value={current.light} options={LIGHT_ROUTES} onSelect={value => changeSetting($, 'light', value)} />
        <Select key="heavy" label="Heavy tasks" value={current.heavy} options={HEAVY_ROUTES} onSelect={value => changeSetting($, 'heavy', value)} />
        <Text dimColor>Saved for every session; other open sessions take a change at their next turn.</Text>
      </Box>
    )
  })
}
