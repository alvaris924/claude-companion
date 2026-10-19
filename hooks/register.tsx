import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, SelectOption } from 'claude-code'

import type { LastPrompt, StoredSettings, Suggestion } from '../types'

// The companion: the person's one Claude Code mod, the home of every small helper around the prompt.
//
// Last prompt: the person's most recent prompt above the chat box, in the band directly above the prompt
// (AbovePrompt) on the terminal, the desktop app and VS Code. A surface that attaches without the band (the mobile
// app) gets a small pane instead, opened at the first prompt; /last-prompt opens it again after the person closed it.
//
// Next message: one model call after each main-thread turn that answered (Fable 5.1 by default, Haiku when it gives
// no answer) reads the person's last prompt and the end of the reply, and offers the messages the person might send
// next, the likeliest first. The band shows them as choices under the last prompt; clicking one sends it as the
// person's own words, or puts it in the prompt box to edit. The likeliest is also offered dim in the prompt box where
// the box shows suggestions (the terminal), Tab to take; VS Code 2.1.300 shows none there.
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

// Fable 5.1 by default since 2026-10-16, at the person's request: Anthropic's most capable model, at 100x Haiku's price
// per token and as quick at low effort (1.6 s measured). When the chosen model gives no answer (a safety refusal, an API
// error, the timeout) Haiku is asked instead, so the choices still come.
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

/** The settings the pane changes; stored as their pickers' values (`choices` as text, `suggest` as a boolean). */
type Settings = {
  suggest: boolean
  model: string
  effort: 'low' | 'medium' | 'high'
  choices: number
  onPress: 'send' | 'box'
}

const MODELS: readonly SelectOption[] = [
  { value: 'claude-fable-5-1', label: 'Fable 5.1: best picks, most of your plan' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
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

const last = atom({ plugin: 'companion', key: 'last' } as const, null)
const suggested = atom({ plugin: 'companion', key: 'next' } as const, null)
const paneClosed = atom({ plugin: 'companion', key: 'paneClosed' } as const, false)
const savedSettings = atom({ plugin: 'companion', key: 'settings' } as const, null)

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

/** `value` when it is one of `options`' values, else `fallback`. */
export function pick(value: unknown, options: readonly SelectOption[], fallback: string): string {
  return typeof value === 'string' && options.some(option => option.value === value) ? value : fallback
}

/** The settings from what the store holds, each value outside its picker's options taken as its default. */
export function settingsFrom(stored: Readonly<Record<string, unknown>>): Settings {
  return {
    suggest: typeof stored.suggest === 'boolean' ? stored.suggest : true,
    model: pick(stored.model, MODELS, 'claude-fable-5-1'),
    effort: pick(stored.effort, EFFORTS, 'low') as Settings['effort'],
    choices: Number(pick(stored.choices, CHOICE_COUNTS, '3')),
    onPress: pick(stored.onPress, PRESS_ACTIONS, 'send') as Settings['onPress'],
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
  return (
    `Suggestions: ${current.suggest ? 'on' : 'off'} · Model: ${labelOf(MODELS, current.model)} · ` +
    `Effort: ${current.effort} · Choices: ${current.choices} · Clicking a choice: ${labelOf(PRESS_ACTIONS, current.onPress)}`
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
  await update($, suggested, current => {
    isTaken = current !== null && current.choices.includes(text)
    return isTaken ? null : current
  })
  if (!isTaken) return

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadSettings($)
    await $.command.register({
      name: 'companion',
      description: 'Open the companion settings: suggestions, model, effort, choices, what a click does',
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
    if (text.length > 0) await recordPrompt($, text, e.origin.kind === 'sdk')

    return result
  }).catch(($, e, next) => next(e)) // a failure here never holds up the prompt

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Main-thread turns that answered: a subagent's report, an interrupted turn or a refusal suggests nothing; nor
    // does anything when the person switched suggestions off.
    if (e.agentId !== undefined || e.reason !== 'answer' || e.answer.trim().length === 0) return result
    if (!(await loadSettings($)).suggest) return result

    const ask = epoch
    const prompt = await read($, last)

    if ((await $.session.surfaces()).length > 0) {
      // The band or the pane shows them: asked on a timer, so the end of the turn never waits on the model.
      $.clock.after(1, () => {
        void suggestNext($, ask, prompt?.text ?? '', e.answer)
      })
      return result
    }

    // Nothing draws this mod's UI: the choices become the turn's text, which the engine shows as a notice beneath the
    // answer. A program's prompt (claude -p, the Agent SDK) has nobody to read one.
    if (prompt === null || prompt.isFromProgram) return result
    const choices = await askNext($, ask, prompt.text, e.answer)

    return choices === null ? result : { ...result, text: `${NEXT_LABEL}${numbered(choices)}` }
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
    if (e.props.hasSurvey || (prompt === null && idea === null)) return next(e)

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
        <Text dimColor>Saved for every session; other open sessions take a change at their next answer.</Text>
      </Box>
    )
  })
}
