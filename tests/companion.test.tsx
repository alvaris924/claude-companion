import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { ModelUsage, On, RenderSurface, SessionContextBreakdown, SessionMessage, TurnStepInput, UiNotifyResult } from 'claude-code'

import { REDO_HREF, cacheColor, canSuggest, durationText, xrayOf, xrayText, xrayTip, cleanCopy, familyOf, footerCounts, meterCells, resetsIn, turnCost, isFromAnswers, keyName, linesOf, withCompanionKeys, fitFor, gradeOf, gradeTask, isElsewhere, isOrder, isReply, isStronger, nextLevel, pickHint, settingsFrom, shortLabel, storedOf, tipLines, notesRows, wrappedRows } from '../hooks/register'

const PLUGIN = 'companion'
const PANE = 'last-prompt'
const SETTINGS = 'companion-settings'
const SCROLL = { offset: 0, bodyRows: 4 }
const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: SCROLL, view: {} },
} as const
// A band wide enough for the keys' full labels beside the last prompt.
const WIDE_BAND = { ...BAND, props: { ...BAND.props, bodyColumns: 120 } } as const
const PANE_PROPS = { isFocused: false, bodyColumns: 60, placement: 'inline', scroll: SCROLL, view: {} } as const
const PANE_MOUNT = { plugin: PLUGIN, component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, title: 'Last & next prompt' } } as const
const SETTINGS_MOUNT = { plugin: PLUGIN, component: 'Pane', requestId: SETTINGS, props: { ...PANE_PROPS, title: 'Companion settings' } } as const
const PRESENTATION = { isFullscreen: false, columns: 100 }
const NO_USAGE: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPLY = 'Merged the fix into the feature branch. Want me to open the parser PR into dev next?'
const CHOICES = ['Open the parser PR into dev', 'Show me the diff first', 'Run the tests before opening it'] as const
const ALL_THREE = `Next: 1. ${CHOICES[0]} · 2. ${CHOICES[1]} · 3. ${CHOICES[2]}`
// A host that attaches no surface (VS Code up to 2.1.296, a -p run): `$.session.surfaces()` answers this there.
const NOTHING_DRAWS: readonly RenderSurface[] = []
// The model and effort the session's own requests name, and what a fitted turn sends instead.
const SONNET_HIGH = { model: 'claude-sonnet-5-5', effort: 'high' } as const
const OPUS_MAX = { model: 'claude-opus-5-5', effort: 'max' } as const
const HAIKU_LOW = { model: 'claude-haiku-5-5', effort: 'low' } as const
const SONNET_MEDIUM = { model: 'claude-sonnet-5-5', effort: 'medium' } as const
const QUESTION = 'what does the config loader do?'

/** How the engine beneath the plugins behaves in one test. */
type Setup = {
  /** The model's reply text. */
  answer?: string
  /** How long the model takes, on the mocked clock. */
  lateMs?: number
  /** How long each grading call takes before it answers, on the mocked clock. */
  gradeLateMs?: number
  /** Whether the prompt box shows a dim suggestion: the terminal does, VS Code 2.1.300 does not. */
  showsSuggestions?: boolean
  /** Models that reply with no text. */
  declinedBy?: readonly string[]
  /** The settings the plugin's store holds at the start, as the settings pane saves them. */
  stored?: Readonly<Record<string, unknown>>
  /** The context window's fill in tokens, as `$.session.usage()` reports it; absent before the first reading. */
  contextTokens?: number
  /** A model whose requests fail before they answer: with an error, or with no response at all. */
  refused?: { model: string; how: 'throws' | 'no-response' }
  /**
   * What the grading answers for each new request, "mid" for any other: one answer for every call, or a list with an
   * answer for each call in turn. "none" is a call that gives no answer.
   */
  grades?: Readonly<Record<string, string | readonly string[]>>
  /** The session's model as `$.session.model()` answers it; absent, it answers nothing a model could be read from. */
  sessionModel?: string
  /** Whether a slash command a plugin runs fails, as on a host that does not have it. */
  commandsFail?: boolean
  /** Run as a prompt is submitted, before the submit resolves: the real engine starts the prompt's turn there. */
  onSubmit?: (text: string) => Promise<void>
  /** What the plugin's store holds under `notes` at the start: notes as stored, or anything else a store may hold. */
  notes?: readonly unknown[]
  /** What the plugin's store holds under `queue` at the start: queued actions, or anything else a store may hold. */
  queue?: readonly unknown[]
  /** The text of the person's keybindings file; absent, there is none. */
  keybindings?: string
  /** Files the machine holds at the start, by path written with slashes; `$.fs` reads, finds and writes them. */
  files?: Readonly<Record<string, string>>
  /** Whether the surface refuses a copy, as a remote one with no clipboard path does. */
  copyFails?: boolean
  /** The folder the session works in, as `$.session.root()` answers it. */
  root?: string
  /** Programs the machine does not have: starting one fails, as a missing executable does. */
  missing?: readonly string[]
}

/** What the engine did beneath the plugins, as the tests read it back. */
type World = {
  clock: MockClock
  requests: { model: string; effort: string | undefined; maxTokens: number | undefined; prompt: string }[]
  /** The grading calls, apart from the suggestion calls in `requests`. */
  graded: { model: string; effort: string | undefined; system: unknown; prompt: string }[]
  /** The model and effort each request of a turn went with, as the engine beneath the plugins received it. */
  steps: { model: string; effort: TurnStepInput['effort'] }[]
  box: string
  opened: string[]
  /** What each pane was opened with: its id, title, and the keys and rows it asked for. */
  openedWith: Readonly<Record<string, unknown>>[]
  /** How far each scroll the plugins let through moved a window, in rows. */
  scrolled: number[]
  /** The turns the plugins cancelled while they ran. */
  aborted: string[]
  submitted: string[]
  offered: string[]
  filled: string[]
  copied: string[]
  toasts: string[]
  ran: (readonly string[])[]
  /** The files the plugins wrote, by path written with slashes. */
  written: { path: string; text: string }[]
  /** The panes the plugins closed. */
  closed: string[]
  /** The folder the session works in. */
  root: string
  /** What the person selected with the mouse last, as `$.ui.selection()` answers it. */
  selection: { text: string; requestId?: string } | undefined
  /** The text on the machine's clipboard, as Windows' Get-Clipboard reads it. */
  hostClipboard: string
  /** The slash commands the plugins ran, as typed: "/model claude-opus-5-5". */
  commands: string[]
  /** The session's model, which a /model the plugins run changes. */
  sessionModel: string | undefined
  /** What the session has cost so far in dollars, as `$.session.usage()` reports it; undefined for no figure. */
  usd: number | undefined
  /** How many times the plugins compacted the conversation. */
  compacted: number
  /** The conversation so far, as `$.session.messages()` answers it. */
  messages: SessionMessage[]
  /** What the model writes when asked for a handoff; undefined gives no answer. */
  handoff: string | undefined
  /** What the plugins asked a handoff of: the conversation's words they sent. */
  handedOver: string[]
  /** The notifications the plugins raised, by their text. */
  notified: string[]
  /** What the person's notification channel answers. */
  notifyResult: UiNotifyResult
  /** The context window broken down, as `$.session.usage({ breakdown })` answers it; undefined for none. */
  breakdown: SessionContextBreakdown | undefined
}

/**
 * What the engine does beneath the plugins in these tests: its clock, the plugin's store, the surfaces, prompt entry,
 * the models, the prompt box (what it holds, its dim suggestion, a fill), the clipboard, toasts, an empty drawing, pane
 * opening (placed wherever a surface attaches), and a Windows host whose processes all succeed.
 */
function engine(on: On, surfaces: readonly RenderSurface[], setup: Setup = {}): World {
  const { answer = CHOICES.join('\n'), lateMs = 0, gradeLateMs = 0, showsSuggestions = true, declinedBy = [], stored, contextTokens, refused, grades = {}, sessionModel, commandsFail = false, onSubmit, notes, queue, keybindings, files: given = {}, copyFails = false, root = '/work/parser', missing = [] } = setup
  mock.store(on, { ...(stored === undefined ? {} : { settings: stored }), ...(notes === undefined ? {} : { notes }), ...(queue === undefined ? {} : { queue }) })
  const callsFor: Record<string, number> = {} // grading calls so far, by the request graded
  const world: World = {
    clock: mock.clock(on, { now: 1_000 }),
    requests: [],
    graded: [],
    steps: [],
    box: '',
    opened: [],
    openedWith: [],
    scrolled: [],
    aborted: [],
    submitted: [],
    offered: [],
    filled: [],
    copied: [],
    toasts: [],
    ran: [],
    written: [],
    closed: [],
    root,
    selection: undefined,
    hostClipboard: '',
    commands: [],
    sessionModel,
    usd: undefined,
    compacted: 0,
    messages: [],
    handoff: undefined,
    handedOver: [],
    notified: [],
    notifyResult: { isSent: true, channel: 'terminal_bell' },
    breakdown: undefined,
  }

  on('session.surfaces', () => ({ value: surfaces }))
  on('session.root', () => ({ value: world.root }))
  on('ui.selection', () => ({ value: world.selection }))
  on('ui.close', (_, e) => {
    world.closed.push(e.id)
    return { value: undefined }
  })
  on('session.model', () => ({ value: world.sessionModel ?? '' }))
  on('command.run', (_, e) => {
    if (commandsFail) throw new Error('no such command here')
    world.commands.push(`/${e.command} ${e.args}`.trim())
    if (e.command === 'model') world.sessionModel = e.args
    return { text: '' }
  })
  on('prompt.submit', async (_, e) => {
    world.submitted.push(e.text)
    if (e.origin.kind === 'composer') world.box = '' // the composer empties as it sends
    if (onSubmit !== undefined) await onSubmit(e.text)
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('model.complete', async (_, e) => {
    if (typeof e.system === 'string' && e.system.includes('fresh Claude Code conversation') && typeof e.prompt === 'string') {
      world.handedOver.push(e.prompt)
      const handoff = world.handoff
      if (handoff === undefined) return { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: NO_USAGE } }
      return { value: { isAnswered: true as const, text: handoff, usage: NO_USAGE } }
    }
    const graded = typeof e.prompt === 'string' ? /<new_request>\n([\s\S]*?)\n<\/new_request>/.exec(e.prompt)?.[1] : undefined
    if (graded !== undefined && typeof e.prompt === 'string') {
      world.graded.push({ model: e.model, effort: e.effort, system: e.system, prompt: e.prompt })
      const calls = (callsFor[graded] = (callsFor[graded] ?? 0) + 1)
      const given = grades[graded]
      const said = (Array.isArray(given) ? given[calls - 1] : given) ?? 'mid'
      if (said === 'hang') await world.clock.sleep(60_000) // a call that does not answer in time
      if (gradeLateMs > 0) await world.clock.sleep(gradeLateMs)
      if (declinedBy.includes(e.model) || said === 'none' || said === 'hang') return { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: NO_USAGE } }
      return { value: { isAnswered: true as const, text: said, usage: NO_USAGE } }
    }
    world.requests.push({ model: e.model, effort: e.effort, maxTokens: e.maxTokens, prompt: e.prompt })
    if (lateMs > 0) await world.clock.sleep(lateMs)
    if (declinedBy.includes(e.model)) return { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: NO_USAGE } }
    return { value: { isAnswered: true as const, text: answer, usage: NO_USAGE } }
  })
  on('prompt.suggest', (_, e) => {
    world.offered.push(e.text)
    return { isShown: showsSuggestions }
  })
  on('prompt.read', () => ({ value: { text: world.box, cursor: world.box.length } }))
  on('prompt.fill', (_, e) => {
    world.filled.push(e.text)
    world.box = e.mode === 'replace' ? e.text : world.box + e.text // a cursor at the end
    return { isFilled: true }
  })
  on('ui.copy', (_, e) => {
    if (copyFails) return { value: { isCopied: false as const, reason: 'no-clipboard' as const } }
    world.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // The engine's own lines, from the props the plugins handed on: the hint line under the prompt box with what a
    // plugin added at its end, the footer's labels, and a turn's end line.
    if (e.component === 'PromptHint') {
      return (
        <Box key="engineHint">
          <Text>{e.props.tail === undefined ? e.props.hint : `${e.props.hint} · ${e.props.tail}`}</Text>
        </Box>
      )
    }
    if (e.component === 'SessionMode') {
      return (
        <Box key="engineModes">
          <Text>{e.props.modes.join(' & ')}</Text>
        </Box>
      )
    }
    if (e.component === 'TurnDuration') {
      return (
        <Box key="engineEnd">
          <Text>{`${e.props.word} for ${e.props.durationMs}ms`}</Text>
        </Box>
      )
    }
    return <Box />
  })
  on('ui.open', (_, e) => {
    world.opened.push(e.id)
    world.openedWith.push({ ...e })
    return { value: surfaces.length > 0 ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no surface draws it' } }
  })
  on('ui.focus', { plugin: '*' }, () => ({})) // the ring lands where the person's keys moved it
  on('ui.scroll', (_, e) => {
    world.scrolled.push(e.by)
    return {}
  })
  on('turn.abort', (_, e) => {
    world.aborted.push(e.turnId)
    return { value: undefined }
  })
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      context: { tokens: contextTokens, window: 1_000_000, ...(e?.breakdown !== undefined && world.breakdown !== undefined ? { breakdown: world.breakdown } : {}) },
      rateLimits: [],
      ...(world.usd === undefined ? {} : { cost: { usd: world.usd } }),
    },
  }))
  on('session.messages', () => ({ value: world.messages }))
  on('ui.notify', (_, e) => {
    world.notified.push(e.text)
    return { value: world.notifyResult }
  })
  on('session.compact', () => {
    world.compacted += 1
    return { messages: [{ role: 'user' as const, text: 'The conversation so far, summed up.', toolUses: [] }] }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.step', async function* (_, e) {
    world.steps.push({ model: e.model, effort: e.effort })
    if (refused?.model === e.model && refused.how === 'throws') throw new Error('this model is not available here')
    const isRefused = refused?.model === e.model
    return { turnId: e.turnId, index: e.index, answer: isRefused ? '' : 'done', toolUses: [], stopReason: isRefused ? null : ('end_turn' as const), usage: null }
  })
  on('env.get', (_, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : e.name === 'USERPROFILE' ? '/Users/dev' : undefined }))
  // The machine's files, by path with slashes and no drive: the engine hands a path on as the machine writes it, on
  // Windows with backslashes and the drive it resolved to.
  const slashed = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')
  const files = new Map(Object.entries(given).map(([path, text]) => [slashed(path), text]))
  if (keybindings !== undefined) files.set(slashed('/Users/dev/.claude/keybindings.json'), keybindings)
  on('fs.read', (_, e) => {
    const text = files.get(slashed(e.path))
    if (text === undefined) throw new Error(`ENOENT: no such file, open '${e.path}'`)
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has(slashed(e.path)) }))
  on('fs.write', (_, e) => {
    world.written.push({ path: slashed(e.path), text: e.text })
    files.set(slashed(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    world.ran.push(e.argv)
    if (missing.includes(e.argv[0] ?? '')) throw new Error(`${e.argv[0]} is not installed`)
    const stdout = e.argv.join(' ').includes('Get-Clipboard') ? world.hostClipboard : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return world
}

type Found = { text: string; props: Record<string, unknown> }

/** Sends one request of a turn through the plugins, as the engine does: its stream read to the end. */
async function step($: Engine, input: TurnStepInput): Promise<void> {
  const stream = $.turn.step(input)
  for await (const chunk of stream) void chunk
  await stream.result
}

/** Runs one main-loop turn: its start, `requests` requests on the session's own model and effort, its end. */
async function runTurn($: Engine, turnId: string, text: string, own: { model: string; effort?: TurnStepInput['effort'] }, requests = 1) {
  await $.turn.start({ text, turnId })
  for (let index = 0; index < requests; index += 1) await step($, { turnId, index, messageCount: 1 + index, ...own })
  return $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId, reason: 'answer' })
}

/** The person types a prompt into the composer. */
async function typed($: Engine, text: string): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** A mounted band or pane, as the helpers below read and press it. */
type Drawn = {
  find: (query: { key: string }) => Promise<Found | undefined>
  press: (target: { key: string; link?: { href: string } }) => Promise<unknown>
}

/** Markdown the plugin wrote, as a person reads it: no quote mark, links as their text, escapes undone. */
function plainOf(markdown: string): string {
  return markdown
    .replace(/^> /, '')
    .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1')
    .replace(/\\(.)/g, '$1')
}

/** The last prompt a mounted band or pane shows: the terminal's Text, elsewhere a markdown quote. */
async function promptShown(mounted: Drawn): Promise<string | undefined> {
  const found = await mounted.find({ key: 'prompt' })
  return found === undefined ? undefined : plainOf(found.text)
}

/**
 * The choices a mounted band or pane offers, in order: each Button's label, which names it on every surface (the
 * terminal draws it cut to fit; elsewhere it is the whole choice, drawn as a Text child after a ↳).
 */
async function choicesDrawn(mounted: Drawn): Promise<string[]> {
  const texts: string[] = []
  for (const key of ['choice-1', 'choice-2', 'choice-3', 'choice-4', 'choice-5']) {
    const found = await mounted.find({ key })
    if (found !== undefined) texts.push(typeof found.props.label === 'string' ? found.props.label : found.text)
  }
  return texts
}

/** Presses the button of the choice numbered `n`, from 1. */
async function pressChoiceIn(mounted: Drawn, n: number): Promise<void> {
  await mounted.press({ key: `choice-${n}` })
}

const WIDE = { columns: 120, rows: 30, isFullscreen: false }
const IDLE = { isDraft: false, isWorking: false }

/** The hint site under the prompt box: the engine's own line as the plugins left it, and Companion's lines under it. */
async function hintSite($: Engine, state: { isDraft: boolean; isWorking: boolean } = IDLE, surface: RenderSurface = 'terminal', viewport = WIDE) {
  const hint = await $.ui.mount({ plugin: PLUGIN, component: 'PromptHint', surface, props: { ...state, hint: '? for shortcuts' }, viewport })
  const own = (await hint.find({ key: 'engineHint' }))?.text
  const keys = (await hint.find({ key: 'keys' }))?.text
  const lines: string[] = []
  for (let line = await hint.find({ key: 'tip-0' }); line !== undefined; line = await hint.find({ key: `tip-${lines.length}` })) lines.push(line.text)
  await hint.unmount()
  return { own, keys, tips: lines.length === 0 ? undefined : lines.join('\n') }
}

/** Companion's lines under the engine's hint line, joined by newlines; idle unless told, undefined where it draws none. */
async function hintLine($: Engine, state: { isDraft: boolean; isWorking: boolean } = IDLE, surface: RenderSurface = 'terminal', viewport = WIDE) {
  return (await hintSite($, state, surface, viewport)).tips
}

/** The footer's labels as the engine joins them, after a mode of its own. */
async function footerLine($: Engine, surface: RenderSurface = 'terminal') {
  const footer = await $.ui.mount({ plugin: PLUGIN, component: 'SessionMode', surface, props: { modes: ['focus'] } })
  const text = (await footer.find({ key: 'engineModes' }))?.text
  await footer.unmount()
  return text
}

/** The meters on their line at the bottom, under the prompt box, joined by " & "; undefined where none shows. */
async function meterLine($: Engine, surface: RenderSurface = 'terminal') {
  const hint = await $.ui.mount({ plugin: PLUGIN, component: 'PromptHint', surface, props: { ...IDLE, hint: '? for shortcuts' }, viewport: WIDE })
  const parts: string[] = []
  for (const key of ['ctxMeter', 'weekMeter']) {
    const text = (await hint.find({ key }))?.text
    if (text !== undefined) parts.push(text)
  }
  await hint.unmount()
  return parts.length === 0 ? undefined : parts.join(' & ')
}

/** The theme colour a meter's percent is drawn in, for the meter keyed `key`. */
async function meterColorOf($: Engine, key: string) {
  const hint = await $.ui.mount({ plugin: PLUGIN, component: 'PromptHint', surface: 'terminal', props: { ...IDLE, hint: '? for shortcuts' }, viewport: WIDE })
  const percent = (await hint.findAll({ type: 'Text' })).filter(text => /^ \d+%$/.test(text.text))
  const index = ['ctxMeter', 'weekMeter'].indexOf(key)
  await hint.unmount()
  return percent[index]?.props.color
}

/** What the plugins add to the end line of a turn that took `durationMs`; undefined where they add nothing. */
async function endWords($: Engine, durationMs = 5, columns = WIDE.columns) {
  const end = await $.ui.mount({ plugin: PLUGIN, component: 'TurnDuration', surface: 'terminal', props: { word: 'Baked', durationMs }, viewport: { ...WIDE, columns } })
  const text = (await end.find({ key: 'fitEnd' }))?.text
  await end.unmount()
  return text
}

describe('companion', () => {
  test('the band shows the last prompt the person typed, on one line', async ($, on) => {
    engine(on, ['terminal'])

    const empty = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await empty.find({ key: 'prompt' })).toBeUndefined()
    await empty.unmount()

    await $.prompt.submit({ text: 'rename the\nconfig loader   please', wait: false, origin: { kind: 'composer' } })

    const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await promptShown(terminal)).toBe('rename the config loader please')
    await terminal.unmount()
    // VS Code pins the prompt above its answer itself, so there the band leaves it out unless asked to show it.
    for (const surface of ['desktop', 'vscode'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect(await promptShown(band)).toBeUndefined()
      await band.unmount()
    }
  })

  test('machine deliveries and empty prompts leave the last prompt alone', async ($, on) => {
    engine(on, ['terminal'])

    await $.prompt.submit({ text: 'my real prompt', wait: false, origin: { kind: 'composer' } })
    await $.prompt.submit({ text: 'Background task finished', wait: false, origin: { kind: 'task-notification' } })
    await $.prompt.submit({ text: 'Another plugin speaking', wait: false, origin: { kind: 'plugin', name: 'other', asUser: true } })
    await $.prompt.submit({ text: '   ', wait: false, origin: { kind: 'composer' } })

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await promptShown(band)).toBe('my real prompt')
    await band.unmount()
  })

  test('a long prompt is cut to the band width, room left for the quote bar and the ⋯', async ($, on) => {
    engine(on, ['terminal'])

    await $.prompt.submit({ text: 'x'.repeat(500), wait: false, origin: { kind: 'composer' } })

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = await promptShown(band) ?? ''
    expect(text.length).toBe(80 - 2 - 2) // "│ " before it, " ⋯" after it
    expect(text.endsWith('…')).toBe(true)
    await band.unmount()
  })

  test('where a surface without the band attaches (the mobile app), a pane opens, follows the latest prompt, and /last-prompt opens it again', async ($, on) => {
    const world = engine(on, ['mobile'])

    await $.prompt.submit({ text: 'first prompt', wait: false, origin: { kind: 'bridge' } })
    expect(world.opened).toEqual([PANE])

    const pane = await $.ui.mount({ ...PANE_MOUNT, surface: 'mobile' })
    expect(await promptShown(pane)).toBe('first prompt')

    await $.prompt.submit({ text: 'second prompt', wait: false, origin: { kind: 'unclassified' } })
    await pane.redraw()
    expect(await promptShown(pane)).toBe('second prompt')
    await pane.unmount()

    const ran = await $.command.run({ command: 'last-prompt', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(ran.text).toBe('Last prompt pane opened.')
    expect(world.opened.length).toBe(3)
  })

  test('the terminal alone opens no pane', async ($, on) => {
    const world = engine(on, ['terminal'])

    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
    expect(world.opened).toEqual([])
  })

  test('after a turn the band offers three choices, the likeliest marked and offered dim in the prompt box', async ($, on) => {
    const world = engine(on, ['terminal'])

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'merge the parser work', turnId: 't1' })
    const done = await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect(done.text).toBe(REPLY) // the band shows them, so no line beneath the answer
    expect(world.requests.length).toBe(1)
    expect(world.requests[0]?.prompt).toContain('merge the parser work')
    expect(world.requests[0]?.prompt).toContain('open the parser PR into dev next?')
    expect(world.offered).toEqual([CHOICES[0]])
    expect(world.filled).toEqual([])

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await promptShown(band)).toBe('merge the parser work')
    expect(await choicesDrawn(band)).toEqual([...CHOICES])
    expect((await band.find({ key: 'choice-1' }))?.props).toMatchObject({ plain: true, hotkey: '1' })
    expect((await band.find({ key: 'choice-2' }))?.props).toMatchObject({ plain: true, hotkey: '2' })
    await band.unmount()
  })

  test('by default the choices are asked of Sonnet 5.5 at low effort, with room for its thinking', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect(world.requests.map(request => request.model)).toEqual(['claude-sonnet-5-5'])
    expect(world.requests[0]?.effort).toBe('low')
    expect(world.requests[0]?.maxTokens ?? 0).toBeGreaterThanOrEqual(1024)
  })

  test('when the chosen model gives no answer, Haiku is asked instead and its choices show', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, declinedBy: ['claude-sonnet-5-5'] })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect(world.requests.map(request => request.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5'])
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await choicesDrawn(band)).toEqual([...CHOICES])
    await band.unmount()
  })

  test('Haiku chosen in the settings is not asked twice when it gives no answer', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, declinedBy: ['claude-haiku-5-5'], stored: { model: 'claude-haiku-5-5' } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.requests.length).toBe(1)
  })

  test('the stored settings choose the model, its effort and how many choices come', async ($, on) => {
    const stored = { model: 'claude-opus-5-5', effort: 'medium', choices: '2' }
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect(world.requests.map(request => [request.model, request.effort])).toEqual([['claude-opus-5-5', 'medium']])
    expect(world.requests[0]?.prompt).toContain('two likeliest next messages')
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await choicesDrawn(band)).toEqual([CHOICES[0], CHOICES[1]]) // the model's third line is left out
    await band.unmount()
  })

  test('a model picked in the settings is kept whatever the default is', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { model: 'claude-fable-5-1' } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect(world.requests.map(request => request.model)).toEqual(['claude-fable-5-1'])
  })

  test('one choice asks for the single next message', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { choices: '1' } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect(world.requests[0]?.prompt).toContain("Write the developer's next message. Decide in this order:")
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await choicesDrawn(band)).toEqual([CHOICES[0]])
    await band.unmount()
  })

  test('with suggestions switched off no model is asked, and the band keeps the last prompt', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { suggest: false, lastPrompt: true } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(10)

    expect(world.requests).toEqual([])
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await promptShown(band)).toBe('merge the parser work')
    expect(await choicesDrawn(band)).toEqual([])
    await band.unmount()
  })

  test('the look: the last prompt as a quote, the choices as quiet buttons, the settings in rounded cards', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { lastPrompt: true } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    // Outside the terminal: a markdown quote, a small label, and one dim (secondary) button per choice, a ↳ before it.
    for (const surface of ['vscode', 'desktop'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect((await band.find({ key: 'prompt' }))?.text).toBe('> merge the parser work')
      expect((await band.find({ key: 'settings' }))?.props.label).toBe('⋯')
      expect((await band.find({ type: 'Text', text: 'Suggested' }))?.props).toMatchObject({ size: 'caption', dimColor: true })
      for (const [i, choice] of CHOICES.entries()) {
        const button = await band.find({ key: `choice-${i + 1}` })
        expect(button?.props).toMatchObject({ label: choice, plain: true, dimColor: true })
        expect(button?.text).toBe(`↳ ${choice}`)
      }
      await band.unmount()
    }
    // The terminal keeps its quote bar, and numbers its choices.
    const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await terminal.find({ key: 'quoteBar' }))?.text).toBe('▎')
    expect(await terminal.find({ type: 'Text', text: '▎' })).toMatchObject({ props: { color: 'promptBorder' } })
    expect((await terminal.find({ key: 'choice-1' }))?.props).toMatchObject({ plain: true, hotkey: '1', label: CHOICES[0] })
    await terminal.unmount()

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    for (const key of ['suggestCard', 'routeCard', 'promptCard', 'notesCard']) expect((await pane.find({ key }))?.props.borderStyle).toBe('round')
    await pane.unmount()
  })

  test('a prompt full of markdown is drawn as typed: nothing in it formats or links', async ($, on) => {
    engine(on, ['vscode'], { showsSuggestions: false, stored: { lastPrompt: true } })
    const typed = '**bold** _it_ [a link](https://example.com) `code` # not a heading > nor a quote | 1. 2.'

    await $.prompt.submit({ text: typed, wait: false, origin: { kind: 'composer' } })

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    const quoted = (await band.find({ key: 'prompt' }))?.text ?? ''
    expect(quoted.startsWith('> ')).toBe(true)
    expect(/(^|[^\\])[*_[\]()`#>|.]/.test(quoted.slice(2))).toBe(false) // every mark escaped
    expect(plainOf(quoted)).toBe(typed)
    await band.unmount()
  })

  test('/companion opens the settings pane, and so does the ⋯ in the band', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { lastPrompt: true } })

    const ran = await $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(ran.text).toBe('Companion settings opened.')

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await band.press({ key: 'settings' })
    await band.unmount()

    expect(world.opened).toEqual([SETTINGS, SETTINGS])
  })

  test('the settings pane shows the stored settings', async ($, on) => {
    engine(on, ['vscode'], { stored: { model: 'claude-opus-5-5', effort: 'high', choices: '2', onPress: 'box' } })

    for (const surface of ['vscode', 'desktop'] as const) {
      const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface })
      expect((await pane.find({ key: 'suggest' }))?.props.value).toBe('on')
      expect((await pane.find({ key: 'model' }))?.props.value).toBe('claude-opus-5-5')
      expect((await pane.find({ key: 'effort' }))?.props.value).toBe('high')
      expect((await pane.find({ key: 'choices' }))?.props.value).toBe('2')
      expect((await pane.find({ key: 'onPress' }))?.props.value).toBe('box')
      await pane.unmount()
    }
    // The terminal's menu: a row per setting, its value after it.
    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    expect((await menu.find({ key: 'setting-suggest' }))?.text).toBe(`${'Suggest next messages'.padEnd(24)}On`)
    expect((await menu.find({ key: 'setting-model' }))?.text).toBe(`${'Model'.padEnd(24)}Opus 5.5`)
    expect((await menu.find({ key: 'setting-effort' }))?.text).toBe(`${'Thinking effort'.padEnd(24)}High`)
    expect((await menu.find({ key: 'setting-choices' }))?.text).toBe(`${'Number of choices'.padEnd(24)}2`)
    expect((await menu.find({ key: 'setting-onPress' }))?.text).toBe(`${'Picking a choice'.padEnd(24)}Puts it in the box to edit`)
    await menu.unmount()
  })

  test('picks in the settings pane are saved, drawn back, and in force for the next choices', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false })

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    await pane.select({ key: 'model', value: 'claude-haiku-5-5' })
    await pane.select({ key: 'choices', value: '2' })
    await pane.select({ key: 'suggest', value: 'on' })
    await pane.redraw()
    expect((await pane.find({ key: 'model' }))?.props.value).toBe('claude-haiku-5-5')
    expect((await pane.find({ key: 'choices' }))?.props.value).toBe('2')
    expect((await pane.find({ key: 'effort' }))?.props.value).toBe('low') // untouched
    await pane.unmount()

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect(world.requests.map(request => request.model)).toEqual(['claude-haiku-5-5'])
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await choicesDrawn(band)).toEqual([CHOICES[0], CHOICES[1]])
    await band.unmount()
  })

  test('on the mobile app the settings pane lists the settings as text', async ($, on) => {
    engine(on, ['mobile'])

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'mobile' })
    expect((await pane.find({ key: 'summary' }))?.text).toContain('Sonnet 5.5')
    await pane.unmount()
  })

  test('where no panel draws, /companion answers with the settings and where to change them', async ($, on) => {
    engine(on, NOTHING_DRAWS)

    const ran = await $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(ran.text).toContain('Suggestions: on · Model: Sonnet 5.5: the default · Effort: low · Choices: 3')
    expect(ran.text).toContain('run /companion in VS Code or the terminal')
  })

  test('in VS Code the choices show in the band, no pane opens, and nothing is written into the prompt box', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    expect(world.opened).toEqual([]) // VS Code draws the band

    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.filled).toEqual([])

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await choicesDrawn(band)).toEqual([...CHOICES])
    await band.unmount()
  })

  test('in VS Code the choices and the last prompt are drawn whole, however few columns the band reports', async ($, on) => {
    const long = [
      'Fix the empty header for new accounts before writing the settings table',
      'Show me the diff for the last commit before anything else',
      'Write the settings table and push it with the release',
    ]
    const world = engine(on, ['vscode'], { answer: long.join('\n'), showsSuggestions: false, stored: { lastPrompt: true } })
    const narrow = { ...BAND, props: { ...BAND.props, bodyColumns: 42 } } // what VS Code 2.1.300 reported

    const typed = 'the band looks great, but it does not show the full messages, so check the cut again please'
    await $.prompt.submit({ text: typed, wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...narrow, surface: 'vscode' })
    expect(await choicesDrawn(band)).toEqual(long)
    expect(await promptShown(band)).toBe(typed)
    await band.unmount()
  })

  test('the terminal cuts a choice to the band width', async ($, on) => {
    const long = 'Fix the empty header for new accounts before writing the settings table'
    const world = engine(on, ['terminal'], { answer: long })
    const narrow = { ...BAND, props: { ...BAND.props, bodyColumns: 42 } }

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...narrow, surface: 'terminal' })
    const [cut] = await choicesDrawn(band)
    expect(cut).toBe(`${long.slice(0, 42 - '1: '.length - 1)}…`)
    await band.unmount()
  })

  test('the last prompt leaves out the blocks a host wraps around what the person typed', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { lastPrompt: true } })
    const sent =
      '<browser_instruction>\nInstructions a browser extension adds.\n</browser_instruction>' +
      'looks great but not showing full messages\n[Image: source: /tmp/screenshot.png]\ncheck again'

    await $.prompt.submit({ text: sent, wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await promptShown(band)).toBe('looks great but not showing full messages [image] check again')
    await band.unmount()
    expect(world.requests[0]?.prompt).toContain('looks great but not showing full messages')
    expect(world.requests[0]?.prompt).not.toContain('browser_instruction')

    // A prompt that is nothing but such a block is no prompt of the person's.
    await $.prompt.submit({ text: '<system-reminder>a reminder</system-reminder>', wait: false, origin: { kind: 'composer' } })
    const after = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await promptShown(after)).toBe('looks great but not showing full messages [image] check again')
    await after.unmount()
  })

  test('pressing a choice sends it as the person, it becomes the last prompt, and the choices go', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { lastPrompt: true } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await pressChoiceIn(band, 2)
    expect(world.submitted).toEqual(['merge the parser work', CHOICES[1]])

    await band.redraw()
    expect(await promptShown(band)).toBe(CHOICES[1])
    expect(await choicesDrawn(band)).toEqual([])
    await band.unmount()
  })

  test('set to "box", a click puts the choice in the prompt box: over an earlier choice, beside what the person typed', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { onPress: 'box' } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await pressChoiceIn(band, 2)
    expect(world.box).toBe(CHOICES[1])
    await pressChoiceIn(band, 1)
    expect(world.box).toBe(CHOICES[0]) // an earlier choice is replaced

    world.box = 'and then'
    await pressChoiceIn(band, 3)
    expect(world.box).toBe(`and then ${CHOICES[2]}`) // what the person typed stays
    await band.unmount()

    expect(world.submitted).toEqual(['merge the parser work']) // nothing was sent
  })

  test('in the mobile pane the choices are links, and pressing one sends it', async ($, on) => {
    const world = engine(on, ['mobile'])

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'bridge' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const pane = await $.ui.mount({ ...PANE_MOUNT, surface: 'mobile' })
    expect(await choicesDrawn(pane)).toEqual([...CHOICES])

    await pressChoiceIn(pane, 3)
    expect(world.submitted).toEqual(['merge the parser work', CHOICES[2]])
    await pane.unmount()
  })

  test('the model reply is cut to three clean, different choices', async ($, on) => {
    const messy = [
      'Here are three options:',
      `1. "${CHOICES[0]}"`,
      `2) ${CHOICES[0]}.`,
      '- The reply asks about the PR, so the developer says yes',
      `• ${CHOICES[1]}`,
      `Next: ${CHOICES[2]}`,
      'Commit it',
    ].join('\n')
    engine(on, NOTHING_DRAWS, { answer: messy })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    const done = await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(done.text).toBe(ALL_THREE)
  })

  test('a one-line model reply is one choice, shown without numbers', async ($, on) => {
    engine(on, NOTHING_DRAWS, { answer: CHOICES[0] })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    const done = await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(done.text).toBe(`Next: ${CHOICES[0]}`)
  })

  test('where no surface attaches, the choices are the turn text the engine shows beneath the answer', async ($, on) => {
    const world = engine(on, NOTHING_DRAWS)

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    const done = await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(done.text).toBe(ALL_THREE)
    expect(world.requests.length).toBe(1)
    expect(world.opened).toEqual([])
    expect(world.offered).toEqual([]) // no prompt box takes one there
  })

  test('where no surface attaches, /last-prompt answers with both lines', async ($, on) => {
    const world = engine(on, NOTHING_DRAWS)

    const early = await $.command.run({ command: 'last-prompt', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(early.text).toBe('Last: (none yet)\nNext: (none yet)')

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    const ran = await $.command.run({ command: 'last-prompt', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(ran.text).toBe(`Last: merge the parser work\n${ALL_THREE}`)
    expect(world.opened).toEqual([])
  })

  test('where no surface attaches (on Windows), /copy-next copies the first choice or the numbered one through Set-Clipboard', async ($, on) => {
    const world = engine(on, NOTHING_DRAWS, { answer: 'Open the PR\nShip it… then check the logs\nShow me the diff' })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    const first = await $.command.run({ command: 'copy-next', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(first.text).toBe('Copied: Open the PR')

    const second = await $.command.run({ command: 'copy-next', args: ' 2 ', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(second.text).toBe('Copied: Ship it… then check the logs')
    expect(world.ran.length).toBe(2)
    expect(world.ran[1]?.[0]).toBe('powershell.exe')
    expect(world.ran[1]?.at(-1)).toContain("FromBase64String('U2hpcCBpdOKApiB0aGVuIGNoZWNrIHRoZSBsb2dz')")

    const wrong = await $.command.run({ command: 'copy-next', args: '7', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(wrong.text).toBe('Pick 1 to 3. Next: 1. Open the PR · 2. Ship it… then check the logs · 3. Show me the diff')
    expect(world.ran.length).toBe(2)
    expect(world.copied).toEqual([])
  })

  test('/copy-next before any suggestion says so, and where a surface draws it copies through that surface', async ($, on) => {
    const world = engine(on, ['terminal'])

    const early = await $.command.run({ command: 'copy-next', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(early.text).toBe('No suggestion yet: they come with the next answer.')

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const ran = await $.command.run({ command: 'copy-next', args: '3', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(ran.text).toBe(`Copied: ${CHOICES[2]}`)
    expect(world.copied).toEqual([CHOICES[2]])
    expect(world.ran).toEqual([])
  })

  test('a model reply that only talks about the exchange gives no choices', async ($, on) => {
    const world = engine(on, NOTHING_DRAWS, { answer: 'The reply asks whether to open the PR, so the developer says yes' })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    const done = await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(world.requests.length).toBe(1)
    expect(done.text).toBe(REPLY)
    const shown = await $.command.run({ command: 'last-prompt', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(shown.text).toBe('Last: merge the parser work\nNext: (none yet)')
  })

  test("where no surface attaches, a program's prompt (claude -p, the Agent SDK) asks for no suggestion", async ($, on) => {
    const world = engine(on, NOTHING_DRAWS)

    await $.prompt.submit({ text: 'run the nightly report job', wait: false, origin: { kind: 'sdk' } })
    const done = await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect(done.text).toBe(REPLY)
    expect(world.requests).toEqual([])
  })

  test('where no surface attaches, interrupted turns and subagent reports keep their own text', async ($, on) => {
    const world = engine(on, NOTHING_DRAWS)

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    const cut = await $.turn.complete({ answer: 'Half an ans', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })
    const report = await $.turn.complete({ answer: 'Subagent report', durationMs: 5, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })

    expect(cut.text).toBe('Half an ans')
    expect(report.text).toBe('Subagent report')
    expect(world.requests).toEqual([])
  })

  test('choices that arrive after the person moved on are dropped', async ($, on) => {
    const world = engine(on, ['terminal'], { lateMs: 5_000 })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.requests.length).toBe(1)

    await $.prompt.submit({ text: 'actually, fix the login bug first', wait: false, origin: { kind: 'composer' } })
    await world.clock.advance(5_000)

    expect(world.offered).toEqual([])
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await choicesDrawn(band)).toEqual([])
    await band.unmount()
  })

  test('interrupted turns and subagent reports ask for no suggestion', async ($, on) => {
    const world = engine(on, ['terminal'])

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: 'Half an ans', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })
    await $.turn.complete({ answer: 'Subagent report', durationMs: 5, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
    await $.turn.complete({ answer: '   ', durationMs: 5, isAborted: false, turnId: 't3', reason: 'answer' })
    await world.clock.advance(10)

    expect(world.requests).toEqual([])
  })

  test("the engine's own guess passes until choices are here, then the box shows the likeliest", async ($, on) => {
    const world = engine(on, ['terminal'])

    await $.prompt.suggest({ text: 'engine guess', origin: { kind: 'suggestion' } })
    expect(world.offered).toEqual(['engine guess'])

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    await $.prompt.suggest({ text: 'another engine guess', origin: { kind: 'suggestion' } })

    expect(world.offered).toEqual(['engine guess', CHOICES[0], CHOICES[0]])
  })
})

describe('working the mod from the keyboard', () => {
  /** One answered turn: the band then offers the three choices. */
  async function answered($: Engine, world: World): Promise<void> {
    await typed($, 'merge the parser work')
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
  }

  /** The person moves the settings menu's ring onto `element`, as an arrow key does. */
  async function ringOn($: Engine, element: string): Promise<void> {
    await $.ui.focus({ component: 'Pane', requestId: SETTINGS, plugin: PLUGIN, element, origin: { kind: 'person' } })
  }

  test('the terminal numbers the choices as Claude Code numbers a survey, and the hint line under the prompt box says how to pick one', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    await answered($, world)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    for (const [i, choice] of CHOICES.entries()) {
      expect((await band.find({ key: `choice-${i + 1}` }))?.props).toMatchObject({ label: choice, plain: true, hotkey: String(i + 1) })
    }
    // A line each for 1, 2 and 3.
    expect((await band.find({ key: 'choices' }))?.props).toMatchObject({ flexDirection: 'column' })
    // 7, 8 and 9 stay in the band for the digits, hidden; they show under the prompt box.
    expect((await band.find({ key: 'keyPresses' }))?.props).toMatchObject({ display: 'none' })
    expect((await band.find({ key: 'copyKey' }))?.props).toMatchObject({ label: 'Copy answer', plain: true, hotkey: '7' })
    expect((await band.find({ key: 'queueKey' }))?.props).toMatchObject({ label: 'View queue', plain: true, hotkey: '8' })
    expect((await band.find({ key: 'noteKey' }))?.props).toMatchObject({ label: 'View notes', plain: true, hotkey: '9' })
    expect((await band.find({ key: 'firstRow' }))?.text).not.toMatch(/View queue/)
    expect(await band.find({ key: 'hint' })).toBeUndefined()
    const TIPS = 'new here? /companion-setup\nCopy text, then /queue to queue or /note to note'
    // Lines of their own under the engine's, which keeps its words whole: the keys, then how to work them. The numbered
    // choices say themselves how to pick one.
    expect(await hintSite($)).toEqual({ own: '? for shortcuts', keys: 'Copy answerView queueView notes', tips: TIPS })
    // It stays while typing and while an answer runs, so the prompt box keeps its row.
    expect(await hintLine($, { isDraft: true, isWorking: false })).toBe(TIPS)
    expect(await hintLine($, { isDraft: false, isWorking: true })).toBe(TIPS)
    // A line each, whole, never cut: each wraps where it is wider than its room.
    const site = await $.ui.mount({ plugin: PLUGIN, component: 'PromptHint', surface: 'terminal', props: { ...IDLE, hint: '? for shortcuts' }, viewport: WIDE })
    for (const tip of TIPS.split('\n')) expect(await site.find({ type: 'Text', text: tip })).toMatchObject({ props: { wrap: 'wrap' } })
    await site.unmount()
    await band.press({ key: 'choice-2' }) // what the engine does with a 2 typed into the empty prompt box
    expect(world.submitted).toEqual(['merge the parser work', CHOICES[1]])
    await band.unmount()

    // Under the prompt box a click presses one, in fullscreen.
    const hint = await $.ui.mount({ plugin: PLUGIN, component: 'PromptHint', surface: 'terminal', props: { ...IDLE, hint: '? for shortcuts' }, viewport: WIDE })
    await hint.press({ key: 'copyKey' })
    expect(world.copied).toEqual([REPLY])
    await hint.unmount()

    // Under a pointer they keep their look: no numbers, and nothing added to the hint line.
    const vscode = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect((await vscode.find({ key: 'choice-1' }))?.props.hotkey).toBeUndefined()
    expect(await vscode.find({ key: 'noteKey' })).toBeUndefined()
    await vscode.unmount()
    expect(await hintSite($, IDLE, 'desktop')).toEqual({ own: '? for shortcuts', tips: undefined })
  })

  test("on the terminal the last prompt is the band's last row, right over the prompt box; elsewhere its first", async ($, on) => {
    const world = engine(on, ['terminal', 'vscode'], { showsSuggestions: false, stored: { lastPrompt: true } })
    await answered($, world)
    const order = async (surface: RenderSurface) => {
      const band = await $.ui.mount({ ...BAND, surface })
      const keys = (await band.findAll({ type: 'Box' })).map(box => box.props.key)
      await band.unmount()
      return keys
    }
    const terminal = await order('terminal')
    expect(terminal.indexOf('choices')).toBeGreaterThan(-1)
    expect(terminal.indexOf('firstRow')).toBeGreaterThan(terminal.indexOf('choices'))
    const vscode = await order('vscode')
    expect(vscode.indexOf('firstRow')).toBeGreaterThan(-1)
    expect(vscode.indexOf('firstRow')).toBeLessThan(vscode.indexOf('choices'))
  })

  test('the hint line follows the settings: where a pick goes, and the number keys switched off', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { onPress: 'box' } })
    await answered($, world)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await hintLine($)).not.toMatch(/type 1–3/)

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    await menu.press({ key: 'setting-numberKeys' })
    await band.redraw()
    // Off, a number is typed as usual: the choices are buttons the band's focus reaches.
    expect((await band.find({ key: 'choice-1' }))?.props.hotkey).toBeUndefined()
    expect((await band.find({ key: 'choice-1' }))?.props.plain).toBeUndefined()
    expect(await hintLine($)).toMatch(/^ctrl\+x tab, then ↑↓ and Enter to pick · Copy text, /m) // with the keys' other tip
    expect((await band.find({ key: 'noteKey' }))?.props.hotkey).toBeUndefined()
    expect((await band.find({ key: 'queueKey' }))?.props.hotkey).toBeUndefined()
    // Reached by the band's focus, the keys show in the band, beside the last prompt, and not under the prompt box.
    expect((await band.find({ key: 'firstRow' }))?.text).toMatch(/merge the parser work.*View queue.*View notes/)
    expect(await band.find({ key: 'keyPresses' })).toBeUndefined()
    expect((await hintSite($)).keys).toBeUndefined()
    await menu.unmount()
    await band.unmount()

    expect(pickHint({ numberKeys: true, onPress: 'send' }, 1)).toBe('type 1 to send')
  })

  test('/companion opens the settings with the keys, at their full height, and Esc closes them', async ($, on) => {
    const world = engine(on, ['terminal'])

    const ran = await $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(ran.text).toBe('Companion settings opened.')
    expect(world.openedWith).toEqual([{ id: SETTINGS, title: 'Companion settings', focus: true, closeOnEscape: true, holdToasts: true, rows: 31 }])
  })

  test('the terminal menu: a row per setting with its value, the ring starting on the first, and keys said under it', async ($, on) => {
    engine(on, ['terminal'], { stored: { route: true } })

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    const rows = ['suggest', 'model', 'effort', 'choices', 'onPress', 'numberKeys', 'fit', 'easy', 'mid', 'hard', 'limit', 'grader', 'grading', 'lastPrompt', 'noteButton', 'meters', 'coldAfter', 'compactAt']
    for (const field of rows) expect(await menu.find({ key: `setting-${field}` })).toBeDefined()
    expect((await menu.find({ key: 'setting-meters' }))?.text).toBe(`${'Meters'.padEnd(24)}On`)
    expect((await menu.find({ key: 'setting-coldAfter' }))?.text).toBe(`${'Cold cache warning'.padEnd(24)}1 hour`)
    expect((await menu.find({ key: 'setting-compactAt' }))?.text).toBe(`${'Auto-compact'.padEnd(24)}Off`)
    expect((await menu.find({ key: 'setting-lastPrompt' }))?.text).toBe(`${'In VS Code'.padEnd(24)}Off`)
    expect((await menu.find({ key: 'setting-noteButton' }))?.text).toBe(`${'Copy, queue, notes keys'.padEnd(24)}On`)
    expect((await menu.find({ key: 'setting-suggest' }))?.props.autoFocus).toBe(true)
    expect((await menu.find({ key: 'setting-fit' }))?.text).toBe(`${'Fit to each task'.padEnd(24)}Automatic`)
    expect((await menu.find({ key: 'setting-easy' }))?.text).toBe(`${'Easy tasks'.padEnd(24)}Haiku 5.5 at low effort`)
    expect((await menu.find({ key: 'setting-limit' }))?.text).toBe(`${'Switch limit'.padEnd(24)}No limit`)
    expect((await menu.find({ key: 'setting-grader' }))?.text).toBe(`${'Grader'.padEnd(24)}Sonnet 5.5`)
    expect((await menu.find({ key: 'setting-grading' }))?.text).toBe(`${'Grading'.padEnd(24)}One call`)
    expect((await menu.find({ key: 'title' }))?.text).toBe('Companion settings · ↑↓ to move · Enter to change · Esc to close')
    expect((await menu.find({ key: 'about' }))?.text).toBe('After each answer a model writes the messages you are likeliest to send next.')
    await menu.unmount()

    expect(shortLabel('Sonnet 5.5: the default')).toBe('Sonnet 5.5')
    expect(shortLabel('Haiku 5.5 at low effort')).toBe('Haiku 5.5 at low effort')
  })

  test('the line atop the menu says what the row under the ring does', async ($, on) => {
    engine(on, ['terminal'])

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    await ringOn($, 'setting-grader')
    expect((await menu.find({ key: 'about' }))?.text).toBe('The model that grades each new task, at low effort, as part of your plan’s usage.')
    await ringOn($, 'setting-numberKeys')
    expect((await menu.find({ key: 'about' }))?.text).toContain('typed into the empty prompt box picks it')
    await menu.unmount()
  })

  test('in a terminal too short for the menu, ↑↓ move the ring a row as where it fits; the wheel still scrolls', async ($, on) => {
    const world = engine(on, ['terminal'])
    const scroll = { component: 'Pane', requestId: SETTINGS, offset: 0, bodyRows: 10, contentRows: 18 } as const
    const arrow = async (by: number) => {
      const kept = await $.ui.scroll({ ...scroll, by, origin: { kind: 'person' } })
      await world.clock.advance(1)
      return kept
    }

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    const about = async () => (await menu.find({ key: 'about' }))?.text
    expect(await arrow(1)).toEqual({}) // the window stays where it is
    expect(await about()).toBe('The model that writes them, as part of your plan’s usage.')
    await arrow(1)
    expect(await about()).toBe('How long that model thinks before it writes them.')
    await arrow(-1)
    await arrow(-1)
    await arrow(-1) // past the first row it stays there
    expect(await about()).toBe('After each answer a model writes the messages you are likeliest to send next.')
    expect(world.scrolled).toEqual([])

    await $.ui.scroll({ ...scroll, by: 1, origin: { kind: 'person' }, pointer: { column: 4, row: 2 } })
    expect(world.scrolled).toEqual([1])
    await menu.unmount()
  })

  test('Enter on a switch flips it where it stands, saved for the next answer', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    await menu.press({ key: 'setting-suggest' })
    expect((await menu.find({ key: 'setting-suggest' }))?.text).toBe(`${'Suggest next messages'.padEnd(24)}Off`)
    expect(await menu.find({ key: 'option-on' })).toBeUndefined() // no list for a switch
    await menu.unmount()

    await answered($, world)
    expect(world.requests).toEqual([])
  })

  test('Enter on a setting lists its options numbered, its own marked and under the ring; a pick saves it and goes back', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    await menu.press({ key: 'setting-grader' })
    expect((await menu.find({ key: 'title' }))?.text).toBe('Grader · ↑↓ to move · Enter or its number to pick · Esc to close')
    expect((await menu.find({ key: 'option-claude-fable-5-1' }))?.props).toMatchObject({ plain: true, hotkey: '1' })
    expect((await menu.find({ key: 'option-claude-haiku-5-5' }))?.props).toMatchObject({ plain: true, hotkey: '4' })
    expect((await menu.find({ key: 'option-claude-sonnet-5-5' }))?.text).toBe('Sonnet 5.5: the default  ✓')

    // Back on the list, the line under it speaks of the row just changed, where the ring goes. (The kit draws no ring
    // to move; the terminal moves it onto the setting's own option, then back onto its row.)
    await menu.press({ key: 'option-claude-haiku-5-5' })
    expect((await menu.find({ key: 'setting-grader' }))?.text).toBe(`${'Grader'.padEnd(24)}Haiku 5.5`)
    expect((await menu.find({ key: 'about' }))?.text).toBe('The model that grades each new task, at low effort, as part of your plan’s usage.')
    await menu.unmount()

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    expect(world.graded.map(call => call.model)).toEqual(['claude-haiku-5-5'])
    expect(world.steps).toEqual([HAIKU_LOW])
  })

  test('a list longer than nine numbers its tenth 0 and lines the rest up under the others', async ($, on) => {
    engine(on, ['terminal'], { stored: { route: true } })

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    await menu.press({ key: 'setting-easy' })
    expect((await menu.find({ key: 'option-claude-haiku-5-5:low' }))?.text).toBe('Haiku 5.5 at low effort  ✓')
    expect((await menu.find({ key: 'option-claude-fable-5-1:max' }))?.props.hotkey).toBe('0')
    expect((await menu.find({ key: 'option-own' }))?.props.hotkey).toBeUndefined()
    expect((await menu.find({ key: 'option-own' }))?.text).toBe('   My model and effort')
    await menu.press({ key: 'option-own' })
    expect((await menu.find({ key: 'setting-easy' }))?.text).toBe(`${'Easy tasks'.padEnd(24)}My model and effort`)
    await menu.unmount()
  })

  test('/companion starts the menu at its list, whichever setting was open when it closed', async ($, on) => {
    const world = engine(on, ['terminal'])

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    await menu.press({ key: 'setting-model' })
    expect(await menu.find({ key: 'option-claude-opus-5-5' })).toBeDefined()
    await $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    await menu.redraw()
    expect(await menu.find({ key: 'setting-model' })).toBeDefined()
    expect(await menu.find({ key: 'option-claude-opus-5-5' })).toBeUndefined()
    expect(world.opened).toEqual([SETTINGS])
    await menu.unmount()
  })
})

describe('task routing', () => {
  test('off: nothing is graded, requests go as the engine made them, and the band shows no task', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { fit: 'off' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(world.graded).toEqual([])
    expect(world.steps).toEqual([SONNET_HIGH])
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'task' })).toBeUndefined()
    await band.unmount()
    expect(await endWords($)).toBeUndefined()
  })

  test('each end line on the terminal says what its own turn ran on, told apart by its length; too narrow, nothing', async ($, on) => {
    const hard = 'refactor the config loader into one module per source'
    engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'easy', [hard]: 'hard' } })

    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...OPUS_MAX })
    await $.turn.complete({ answer: REPLY, durationMs: 3630, isAborted: false, turnId: 't1', reason: 'answer' })
    await typed($, hard)
    await runTurn($, 't2', hard, OPUS_MAX) // 5 ms

    expect(await endWords($, 3630)).toBe('Easy task · Haiku 5.5 at low effort')
    expect(await endWords($, 5)).toBe('Hard task · Opus 5.5 at max effort')
    expect(await endWords($, 4000)).toBeUndefined() // no turn of that length ran fitted
    expect(await endWords($, 5, 50)).toBeUndefined() // the engine's own words fill a row this narrow
    expect(await endWords($, 3630, 71)).toBe('Easy task · Haiku 5.5 at…') // cut to the room left
  })

  test('Sonnet 5.5 grades a new task once, and an easy one runs on Haiku 5.5 at low effort for every request of its turn', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX, 2)

    expect(world.graded.map(({ model, effort }) => ({ model, effort }))).toEqual([{ model: 'claude-sonnet-5-5', effort: 'low' }])
    expect(world.graded[0]?.prompt).toContain(`<new_request>\n${QUESTION}\n</new_request>`)
    expect(String(world.graded[0]?.system)).toContain('Answer with one word: easy, mid or hard.')
    expect(world.steps).toEqual([HAIKU_LOW, HAIKU_LOW])
    // The terminal's end line says what the turn ran on; the band keeps the redo alone.
    expect(await endWords($)).toBe('Easy task · Haiku 5.5 at low effort')
    const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await terminal.find({ key: 'task' })).toBeUndefined()
    expect((await terminal.find({ key: 'redo' }))?.props).toMatchObject({ label: 'Ask again on Opus 5.5', plain: true, hotkey: '0' })
    await terminal.unmount()
    // Elsewhere one markdown line: what the turn ran on, then the redo as a link the plugin answers.
    for (const surface of ['desktop', 'vscode'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      const task = await band.find({ key: 'task' })
      expect(plainOf(task?.text ?? '')).toBe('Easy task · Haiku 5.5 at low effort · Ask again on Opus 5.5')
      expect(task?.props.pressableLinks).toEqual([REDO_HREF])
      await band.unmount()
    }
  })

  test("a mid task runs on Sonnet 5.5 at medium effort and a hard one on Opus 5.5 at max, shown where that is the session's own too", async ($, on) => {
    const mid = 'add a test for the parser'
    const hard = 'refactor the config loader into one module per source'
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [mid]: 'mid', [hard]: 'hard' } })

    await typed($, mid)
    await runTurn($, 't1', mid, OPUS_MAX)
    expect(await endWords($)).toBe('Mid task · Sonnet 5.5 at medium effort')

    await typed($, hard)
    await runTurn($, 't2', hard, OPUS_MAX)
    expect(await endWords($)).toBe('Hard task · Opus 5.5 at max effort')
    // Nothing to redo: the band draws no line for the turn.
    const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await after.find({ key: 'fit' })).toBeUndefined()
    await after.unmount()

    expect(world.steps).toEqual([SONNET_MEDIUM, OPUS_MAX])
  })

  test('the model decides, not the rules: a short question it grades hard runs on the hard pick', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'hard' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(world.steps).toEqual([OPUS_MAX])
  })

  test('where the model gives no grade, the rules grade the task', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, declinedBy: ['claude-sonnet-5-5'] })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    const hard = 'migrate the store to the new key format'
    await typed($, hard)
    await runTurn($, 't2', hard, SONNET_HIGH)

    expect(world.graded.length).toBe(2)
    expect(world.steps).toEqual([HAIKU_LOW, OPUS_MAX])
  })

  test('a task switches at any length of conversation', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, contextTokens: 450_000, grades: { [QUESTION]: 'easy' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(world.steps).toEqual([HAIKU_LOW])
  })

  test('past the limit only hard tasks switch; easy and mid ones keep the session model and the end line says why', async ($, on) => {
    const mid = 'add a test for the parser'
    const hard = 'refactor the config loader into one module per source'
    const world = engine(on, ['terminal'], {
      stored: { route: true, limit: '200000' },
      contextTokens: 450_000,
      grades: { [QUESTION]: 'easy', [mid]: 'mid', [hard]: 'hard' },
    })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    expect(await endWords($)).toBe('Easy task · Opus 5.5 at max effort · kept: long conversation')
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'redo' })).toBeUndefined()
    await band.unmount()
    await typed($, mid)
    await runTurn($, 't2', mid, OPUS_MAX)
    await typed($, hard)
    await runTurn($, 't3', hard, SONNET_HIGH)

    expect(world.steps).toEqual([OPUS_MAX, OPUS_MAX, OPUS_MAX])
  })

  test('under the limit every grade switches, and the setting is saved from the pane', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true }, contextTokens: 150_000, grades: { [QUESTION]: 'easy' } })

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect((await pane.find({ key: 'limit' }))?.props.value).toBe('none')
    await pane.select({ key: 'limit', value: '200000' })
    await pane.redraw()
    expect((await pane.find({ key: 'limit' }))?.props.value).toBe('200000')
    await pane.unmount()

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    expect(world.steps).toEqual([HAIKU_LOW])
  })

  test('by default a new task is graded with one call', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: ['easy', 'hard'] } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)

    expect(world.graded.length).toBe(1)
    expect(world.steps).toEqual([HAIKU_LOW])
  })

  test('with two calls picked, both grade the task at once and the harder grade is kept', async ($, on) => {
    const mid = 'add a test for the parser'
    const world = engine(on, ['terminal'], {
      stored: { route: true, grading: 'two' },
      grades: { [QUESTION]: ['easy', 'hard'], [mid]: ['mid', 'easy'] },
    })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    await typed($, mid)
    await runTurn($, 't2', mid, SONNET_HIGH)

    expect(world.graded.length).toBe(4)
    expect(world.steps).toEqual([OPUS_MAX, SONNET_MEDIUM])
    // Replies are not graded at all, however many calls are picked.
    await typed($, 'and the tests?')
    await runTurn($, 't3', 'and the tests?', SONNET_HIGH)
    expect(world.graded.length).toBe(4)
  })

  test('with two calls, one that gives no grade leaves the other, and none leaves the rules', async ($, on) => {
    const hard = 'migrate the store to the new key format'
    const world = engine(on, ['terminal'], {
      stored: { route: true, grading: 'two' },
      grades: { [QUESTION]: ['none', 'easy'], [hard]: ['none', 'none'] },
    })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    await typed($, hard)
    await runTurn($, 't2', hard, SONNET_HIGH)

    expect(world.graded.length).toBe(4)
    expect(world.steps).toEqual([HAIKU_LOW, OPUS_MAX]) // the rules grade the migration hard
  })

  test('with two calls, a second that hangs holds the task up for 2.5 seconds at most, and a hard grade does not wait at all', async ($, on) => {
    const hard = 'refactor the config loader into one module per source'
    const world = engine(on, ['terminal'], {
      stored: { route: true, grading: 'two' },
      grades: { [QUESTION]: ['easy', 'hang'], [hard]: ['hard', 'hang'] },
    })

    await typed($, QUESTION)
    const slow = runTurn($, 't1', QUESTION, OPUS_MAX)
    await world.clock.advance(3000)
    await slow
    expect(world.steps).toEqual([HAIKU_LOW]) // the first call's grade, once the grace wait ended

    // The first call answers hard: nothing is harder, so the hung second call is not waited for.
    await typed($, hard)
    await runTurn($, 't2', hard, SONNET_HIGH)
    expect(world.steps).toEqual([HAIKU_LOW, OPUS_MAX])
    await world.clock.advance(60_000) // the hung calls end
  })

  test('the grading picker is saved from the settings pane and takes effect on the next task', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true }, grades: { [QUESTION]: ['easy', 'hard'] } })

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect((await pane.find({ key: 'grading' }))?.props.value).toBe('one')
    await pane.select({ key: 'grading', value: 'two' })
    await pane.redraw()
    expect((await pane.find({ key: 'grading' }))?.props.value).toBe('two')
    await pane.unmount()

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    expect(world.graded.length).toBe(2)
    expect(world.steps).toEqual([OPUS_MAX]) // easy and hard answered: the harder kept, so Opus
  })

  test('Sonnet 5.5 grades by default, and the Grader picker changes the model that every grading call uses', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true, grading: 'two' }, grades: { [QUESTION]: 'easy' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    expect(world.graded.map(call => call.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5'])

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect((await pane.find({ key: 'grader' }))?.props.value).toBe('claude-sonnet-5-5')
    await pane.select({ key: 'grader', value: 'claude-haiku-5-5' })
    await pane.redraw()
    expect((await pane.find({ key: 'grader' }))?.props.value).toBe('claude-haiku-5-5')
    await pane.unmount()

    const next = 'what does the store keep?'
    await typed($, next)
    await runTurn($, 't2', next, OPUS_MAX)
    expect(world.graded.slice(2).map(call => ({ model: call.model, effort: call.effort }))).toEqual([
      { model: 'claude-haiku-5-5', effort: 'low' },
      { model: 'claude-haiku-5-5', effort: 'low' },
    ])
  })

  test('where no panel draws, /companion names a grader that is not the default', async ($, on) => {
    engine(on, NOTHING_DRAWS, { stored: { route: true, grader: 'claude-opus-5-5' } })

    const ran = await $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(ran.text).toContain('switching at any length; Opus 5.5 grades)')
  })

  test('where no panel draws, /companion names two-call grading', async ($, on) => {
    engine(on, NOTHING_DRAWS, { stored: { route: true, grading: 'two' } })

    const ran = await $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    expect(ran.text).toContain('switching at any length; two grading calls, the harder kept)')
  })

  test('a session with a 1M context window keeps it on the model it switches to', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, { model: 'claude-opus-5-5[1m]', effort: 'max' })

    expect(world.steps).toEqual([{ model: 'claude-haiku-5-5[1m]', effort: 'low' }])
    expect(await endWords($)).toBe('Easy task · Haiku 5.5 at low effort')
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await band.find({ key: 'redo' }))?.props.label).toBe('Ask again on Opus 5.5')
    await band.unmount()
  })

  test('while the turn runs the band offers no redo; after it, the redo asks the prompt again as usual', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...SONNET_HIGH })
    const working = await $.ui.mount({ ...BAND, surface: 'vscode', props: { ...BAND.props, isWorking: true } })
    const busy = await working.find({ key: 'task' })
    expect(plainOf(busy?.text ?? '')).toBe('Easy task · Haiku 5.5 at low effort')
    expect(busy?.props.pressableLinks).toBeUndefined()
    await working.unmount()
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await band.press({ key: 'task', link: { href: REDO_HREF } })
    expect(world.submitted).toEqual([QUESTION, QUESTION])
    await runTurn($, 't2', QUESTION, SONNET_HIGH)
    expect(world.steps).toEqual([HAIKU_LOW, SONNET_HIGH])
    expect(world.graded.length).toBe(1)

    // The turn asked again ran on the session's own model and effort, under its grade, so it offers no redo itself.
    await band.redraw()
    const again = await band.find({ key: 'task' })
    expect(plainOf(again?.text ?? '')).toBe('Easy task · Sonnet 5.5 at high effort')
    expect(again?.props.pressableLinks).toBeUndefined()
    await band.unmount()
  })

  test("replies keep the running task's grade with no grading; new work is graded afresh", async ($, on) => {
    const work = 'fix the failing parser test in the loader please'
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'easy', [work]: 'mid' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    await typed($, 'and the tests?')
    await runTurn($, 't2', 'and the tests?', OPUS_MAX)
    await typed($, work)
    await runTurn($, 't3', work, OPUS_MAX)

    expect(world.graded.length).toBe(2)
    expect(world.steps).toEqual([HAIKU_LOW, HAIKU_LOW, SONNET_MEDIUM])
  })

  test('after an easy question an order is graded as the work it asks for, read with the question and the answer', async ($, on) => {
    const order = 'add that to the docs'
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'easy', [order]: 'mid' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    await typed($, order)
    await runTurn($, 't2', order, OPUS_MAX)

    expect(world.steps).toEqual([HAIKU_LOW, SONNET_MEDIUM])
    const grading = world.graded[1]?.prompt ?? ''
    expect(grading).toContain(`<previous_request>\n${QUESTION}\n</previous_request>`)
    expect(grading).toContain(`<claude_reply_end>\n${REPLY}\n</claude_reply_end>`)
    expect(grading).toContain(`<new_request>\n${order}\n</new_request>`)
  })

  test('a pressed choice that asks continues an easy task; one that orders work is graded', async ($, on) => {
    const world = engine(on, ['vscode'], {
      showsSuggestions: false,
      stored: { route: true },
      grades: { [QUESTION]: 'easy', [CHOICES[0]]: 'mid' },
    })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    for (const [turnId, n, text] of [['t2', 2, CHOICES[1]], ['t3', 1, CHOICES[0]]] as const) {
      await world.clock.advance(1)
      const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
      await pressChoiceIn(band, n)
      await band.unmount()
      await runTurn($, turnId, text, OPUS_MAX)
    }

    expect(world.submitted).toEqual([QUESTION, CHOICES[1], CHOICES[0]])
    expect(world.graded.length).toBe(2)
    expect(world.steps).toEqual([HAIKU_LOW, HAIKU_LOW, SONNET_MEDIUM])
  })

  test('a pressed choice continues the task it answers', async ($, on) => {
    const hard = 'refactor the config loader into one module per source'
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true }, grades: { [hard]: 'hard' } })

    await typed($, hard)
    await runTurn($, 't1', hard, SONNET_HIGH)
    await world.clock.advance(1)
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await pressChoiceIn(band, 1)
    await band.unmount()
    await runTurn($, 't2', CHOICES[0], SONNET_HIGH)

    expect(world.graded.length).toBe(1)
    expect(world.steps).toEqual([OPUS_MAX, OPUS_MAX])
  })

  test('subagents, slash commands and models the plugin cannot read keep their requests, and nothing is graded', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    // A subagent's turn.
    await typed($, QUESTION)
    await $.turn.start({ text: 'look around', turnId: 'a1-t1', agentId: 'a1' })
    await step($, { turnId: 'a1-t1', index: 0, messageCount: 1, agentId: 'a1', ...SONNET_HIGH })
    // A slash command.
    const review = '/review the parser'
    await $.prompt.submit({ text: review, command: { name: 'review', args: 'the parser' }, wait: false, origin: { kind: 'composer' } })
    await runTurn($, 't1', review, SONNET_HIGH)
    // A provider's own spelling of a model.
    await typed($, QUESTION)
    await runTurn($, 't3', QUESTION, { model: 'anthropic.claude-sonnet-5-5', effort: 'high' })

    expect(world.graded).toEqual([])
    expect(world.steps).toEqual([SONNET_HIGH, SONNET_HIGH, { model: 'anthropic.claude-sonnet-5-5', effort: 'high' }])
  })

  test("an SDK host's prompt with a surface attached, as from the Claude app, is the person's and is fitted", async ($, on) => {
    const world = engine(on, ['mobile'], { stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    await $.prompt.submit({ text: QUESTION, wait: false, origin: { kind: 'sdk' } })
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(world.steps).toEqual([HAIKU_LOW])
  })

  test("a program's prompt where nothing is drawn (claude -p, the Agent SDK) keeps its model and effort, ungraded", async ($, on) => {
    const world = engine(on, NOTHING_DRAWS, { stored: { route: true } })

    await $.prompt.submit({ text: QUESTION, wait: false, origin: { kind: 'sdk' } })
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(world.graded).toEqual([])
    expect(world.steps).toEqual([SONNET_HIGH])
  })

  test('a request the engine sends on another model mid-turn, a fallback, keeps that model', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...SONNET_HIGH })
    await step($, { turnId: 't1', index: 1, messageCount: 2, model: 'claude-opus-5-5', effort: 'high' })

    expect(world.steps).toEqual([HAIKU_LOW, { model: 'claude-opus-5-5', effort: 'high' }])
  })

  for (const how of ['throws', 'no-response'] as const) {
    test(`a fitted request that fails before it answers (${how}) goes again as the engine made it, and fitting stops`, async ($, on) => {
      const hard = 'refactor the config loader into one module per source'
      const world = engine(on, ['terminal'], {
        stored: { route: true },
        grades: { [QUESTION]: 'easy', [hard]: 'hard' },
        refused: { model: 'claude-haiku-5-5', how },
      })

      await typed($, QUESTION)
      await runTurn($, 't1', QUESTION, SONNET_HIGH)
      await typed($, hard)
      await runTurn($, 't2', hard, SONNET_HIGH)

      expect(world.steps).toEqual([HAIKU_LOW, SONNET_HIGH, SONNET_HIGH])
      expect(world.graded.length).toBe(1)
      expect(world.toasts).toEqual(['Could not send this task to Haiku 5.5, so the session runs on its own model and effort from here.'])
      const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
      expect(await band.find({ key: 'task' })).toBeUndefined()
      await band.unmount()
    })
  }

  test('where no surface attaches, the line beneath the answer says what a fitted turn ran on', async ($, on) => {
    engine(on, NOTHING_DRAWS, { stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    await typed($, QUESTION)
    const done = await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(done.text).toBe(`Easy task · Haiku 5.5 at low effort\n${ALL_THREE}`)
  })

  test('in the mobile pane a fitted turn shows with its redo', async ($, on) => {
    const world = engine(on, ['mobile'], { stored: { route: true }, grades: { [QUESTION]: 'easy' } })

    await $.prompt.submit({ text: QUESTION, wait: false, origin: { kind: 'bridge' } })
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    const pane = await $.ui.mount({ ...PANE_MOUNT, surface: 'mobile' })
    expect(plainOf((await pane.find({ key: 'task' }))?.text ?? '')).toBe('Easy task · Haiku 5.5 at low effort · Ask again on Sonnet 5.5')
    await pane.press({ key: 'task', link: { href: REDO_HREF } })
    expect(world.submitted).toEqual([QUESTION, QUESTION])
    await pane.unmount()
  })

  test("the settings pane shows each grade's pick and saves one for the next task", async ($, on) => {
    const hard = 'implement the export command for the settings'
    const world = engine(on, ['vscode'], { showsSuggestions: false, grades: { [hard]: 'hard' } })

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect((await pane.find({ key: 'fit' }))?.props.value).toBe('suggest')
    expect((await pane.find({ key: 'easy' }))?.props.value).toBe('claude-haiku-5-5:low')
    expect((await pane.find({ key: 'mid' }))?.props.value).toBe('claude-sonnet-5-5:medium')
    expect((await pane.find({ key: 'hard' }))?.props.value).toBe('claude-opus-5-5:max')
    await pane.select({ key: 'fit', value: 'auto' })
    await pane.select({ key: 'hard', value: 'claude-fable-5-1:high' })
    await pane.redraw()
    expect((await pane.find({ key: 'fit' }))?.props.value).toBe('auto')
    expect((await pane.find({ key: 'hard' }))?.props.value).toBe('claude-fable-5-1:high')
    await pane.unmount()

    await typed($, hard)
    await runTurn($, 't1', hard, SONNET_HIGH)
    expect(world.steps).toEqual([{ model: 'claude-fable-5-1', effort: 'high' }])
  })

  test('with a grade on "my model and effort", the settings say what that is in this session', async ($, on) => {
    engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true, hard: 'own' }, grades: { [QUESTION]: 'easy' } })
    const own = '“My model and effort” is Opus 5.5 at max effort in this session.'

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect(await pane.find({ key: 'ownNote' })).toBeUndefined()
    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    await pane.redraw()
    expect((await pane.find({ key: 'ownNote' }))?.text).toBe(own)
    const mobile = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'mobile' })
    expect((await mobile.find({ key: 'ownNote' }))?.text).toBe(own)
    await mobile.unmount()

    await pane.select({ key: 'hard', value: 'claude-opus-5-5:max' })
    await pane.redraw()
    expect(await pane.find({ key: 'ownNote' })).toBeUndefined()
    await pane.unmount()
  })

  test('where no panel draws, /companion says how tasks are fitted', async ($, on) => {
    engine(on, NOTHING_DRAWS, { stored: { route: true, easy: 'own' } })
    const run = () => $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })

    const ran = await run()
    expect(ran.text).toContain(
      'Clicking a choice: Sends it as my message · Fit to the task: automatic (easy tasks: My model and effort; ' +
        'mid tasks: Sonnet 5.5 at medium effort; hard tasks: Opus 5.5 at max effort; switching at any length)',
    )
    expect(ran.text).not.toContain('in this session')

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    expect((await run()).text).toContain('“My model and effort” is Opus 5.5 at max effort in this session.')
  })

  test("the model's answer gives the grade it names first", () => {
    const answers = ['easy', 'Mid.', 'This one is hard.', 'medium', 'easy, not hard', 'no idea']
    expect(answers.map(gradeOf)).toEqual(['easy', 'mid', 'hard', 'mid', 'easy', null])
  })

  test('the rules grade a task the model gives no grade for: work verbs, long prompts and many paths hard; plain questions easy; the rest mid', () => {
    const hard = [
      'refactor the parser into a state machine',
      'Please implement the export command',
      'migrate the store to the new key format',
      'rewrite the band from scratch',
      'review the whole codebase for dead code',
      'update src/a.ts, src/b.ts, src/c.ts and docs/index.md to the new names',
      'word '.repeat(260),
    ]
    const easy = [
      QUESTION,
      'how does the cache work',
      'can you explain the settings pane?',
      'where is the band drawn?',
      'does it handle tabs?',
      'show me the diff',
      'ok, so which model writes the suggestions?',
    ]
    const mid = [
      'add a test for the parser',
      'why does the build fail?',
      'what is wrong with the loader?',
      'do the release notes',
      'how do I fix the failing test?',
      'explain this:\n```\nconst a = 1\n```',
      'what do src/a.ts and src/b.ts share?',
      'fix the typo in the README',
      // Proposals and changes being weighed, whatever question they lead with.
      'how about if we split the band into two rows?',
      'what if the band showed the model too?',
      'so how many settings should we add for this?',
      'where is the settings tab, it should have a button',
      'should we cache the settings?',
      'would it be better to keep one module?',
    ]

    expect(hard.map(gradeTask)).toEqual(hard.map(() => 'hard'))
    expect(easy.map(gradeTask)).toEqual(easy.map(() => 'easy'))
    expect(mid.map(gradeTask)).toEqual(mid.map(() => 'mid'))
  })

  test('a reply continues the running task; anything longer starts one, a follow-up of hard work included', () => {
    const typedChoice = 'How does the loader pick a source for each key'
    const orderChoice = 'Run the tests before opening the parser PR'

    expect(nextLevel(QUESTION, null, [])).toEqual({ level: 'easy', isNew: true })
    expect(nextLevel('yes, go ahead', 'hard', [])).toEqual({ level: 'hard', isNew: false })
    expect(nextLevel(`${typedChoice}?`, 'easy', [typedChoice])).toEqual({ level: 'easy', isNew: false })
    expect(nextLevel(`${orderChoice}.`, 'easy', [orderChoice])).toEqual({ level: 'mid', isNew: true })
    expect(nextLevel(`${orderChoice}.`, 'hard', [orderChoice])).toEqual({ level: 'hard', isNew: false })
    expect(nextLevel('now refactor the parser', 'easy', [])).toEqual({ level: 'hard', isNew: true })
    expect(nextLevel('ok and now also update the readme and the changelog too', 'hard', [])).toEqual({ level: 'mid', isNew: true })
    expect(nextLevel('What does Time.deltaTime measure? One sentence.', 'hard', [])).toEqual({ level: 'easy', isNew: true })
    expect(nextLevel('what is a NavMesh?', 'hard', [])).toEqual({ level: 'easy', isNew: true })
    // Up to three words is a reply: it stays with the running task, ungraded.
    expect(nextLevel('and the tests?', 'hard', [])).toEqual({ level: 'hard', isNew: false })
    expect(nextLevel('add a test for the parser and run the whole suite again', 'easy', [])).toEqual({ level: 'mid', isNew: true })
  })

  test('after an easy question an order starts a task of its own; a question or thanks continues it', () => {
    const orders = [
      'yes',
      "yep, let's do it",
      'go ahead',
      'push the change',
      'add that to the docs',
      'ok do it',
      'can you fix it?',
      'done, please merge and push',
      'squash-merge it for me',
    ]
    const replies = ['why?', 'ok thanks', 'and the tests?', 'yes, but why?', 'makes sense', 'why is that?', 'go on']

    expect(orders.map(isOrder)).toEqual(orders.map(() => true))
    expect(replies.map(isOrder)).toEqual(replies.map(() => false))
    for (const order of orders) expect(nextLevel(order, 'easy', [])).toEqual({ level: 'mid', isNew: true })
    for (const reply of replies) expect(nextLevel(reply, 'easy', [])).toEqual({ level: 'easy', isNew: false })
    expect(nextLevel('push the change', 'hard', [])).toEqual({ level: 'hard', isNew: false })
  })

  test('a short message that stands on its own is not a reply, however few words it has (experimental, 0.12.0)', () => {
    const onItsOwn = ['how are you', 'suggest next fix', 'nice weather today', 'what is a NavMesh?']
    const stillReplies = ['why?', 'ok thanks', 'and the tests?', 'yes, but why?', 'makes sense', 'why is that?', 'go on', 'yes, go ahead']

    for (const text of onItsOwn) expect(isReply(text, [])).toBe(false)
    for (const text of stillReplies) expect(isReply(text, [])).toBe(true)
    // Graded fresh, as the plain short question it is, no longer absorbed by whatever task was running before it.
    expect(nextLevel('how are you', 'hard', [])).toEqual({ level: 'easy', isNew: true })
    // A short order still continues a running mid or hard task, same as before this fix.
    expect(nextLevel('yes, go ahead', 'hard', [])).toEqual({ level: 'hard', isNew: false })
    expect(nextLevel('push the change', 'hard', [])).toEqual({ level: 'hard', isNew: false })
  })
})

describe('suggest mode', () => {
  const HARD = 'implement the export command for the settings'
  const WORK = 'fix the failing parser test in the loader please'
  const HAIKU_OWN = { model: 'claude-haiku-5-5', effort: 'low' } as const
  const ROUTES = { easy: 'claude-haiku-5-5:low', mid: 'claude-sonnet-5-5:medium', hard: 'claude-opus-5-5:max', limit: 'none', grading: 'one', grader: 'claude-sonnet-5-5' }

  /** The prompt is typed and its turn runs its first request on the session's own model and effort, its answer still coming. */
  async function startedOn($: Engine, world: World, turnId: string, text: string, own: { model: string; effort?: TurnStepInput['effort'] }): Promise<void> {
    await typed($, text)
    await $.turn.start({ text, turnId })
    await step($, { turnId, index: 0, messageCount: 1, ...own })
    await world.clock.advance(1)
  }

  /** The band while the answer runs. */
  const working = ($: Engine, surface: RenderSurface) => $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isWorking: true } })

  test('the default: a turn runs as the session set it, with no wait for the grade, which is asked off the turn', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [HARD]: 'hang' } })

    await typed($, HARD)
    await $.turn.start({ text: HARD, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...SONNET_HIGH })
    expect(world.steps).toEqual([SONNET_HIGH]) // sent as the engine made it, the grade still out
    expect(world.graded.length).toBe(1)
    const band = await working($, 'terminal')
    expect(await band.find({ key: 'switch' })).toBeUndefined()

    // A grade that never comes: the rules' stands, as under Automatic.
    await world.clock.advance(60_000)
    await band.redraw()
    expect(await band.find({ key: 'switch' })).toBeDefined()
    await band.unmount()
  })

  test('a stronger grade is offered as one button, while the answer runs, and nothing else changes', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [HARD]: 'hard' } })
    await startedOn($, world, 't1', HARD, SONNET_HIGH)

    const terminal = await working($, 'terminal')
    expect((await terminal.find({ key: 'task' }))?.text).toBe('Hard task · Sonnet 5.5 at high effort')
    expect((await terminal.find({ key: 'switch' }))?.props).toMatchObject({ label: 'Switch to Opus 5.5 at max effort', plain: true, hotkey: '0' })
    expect(await terminal.find({ key: 'redo' })).toBeUndefined()
    await terminal.unmount()

    for (const surface of ['desktop', 'vscode'] as const) {
      const band = await working($, surface)
      const task = await band.find({ key: 'task' })
      expect(plainOf(task?.text ?? '')).toBe('Hard task · Sonnet 5.5 at high effort · Switch to Opus 5.5 at max effort')
      expect(task?.props.pressableLinks).toEqual([REDO_HREF])
      await band.unmount()
    }
    expect(world.steps).toEqual([SONNET_HIGH])
    expect(world.aborted).toEqual([])
  })

  test('pressing it stops the running answer and asks the prompt again on the stronger model; the task stays there', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [HARD]: 'hard' } })
    await startedOn($, world, 't1', HARD, SONNET_HIGH)

    const band = await working($, 'terminal')
    await band.press({ key: 'switch' })
    expect(world.aborted).toEqual(['t1'])
    expect(world.submitted).toEqual([HARD, HARD])
    expect(world.commands).toEqual([]) // the task switches, the session stays on its model
    await band.redraw()
    expect(await band.find({ key: 'switch' })).toBeUndefined() // once, however often it is pressed

    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })
    await runTurn($, 't2', HARD, SONNET_HIGH)
    await typed($, 'and the tests?')
    await runTurn($, 't3', 'and the tests?', SONNET_HIGH)
    expect(world.steps).toEqual([SONNET_HIGH, OPUS_MAX, OPUS_MAX])
    expect(world.graded.length).toBe(1) // the switched task and its follow-up are not graded again

    // The task now runs as Automatic runs one: what it ran on (on its end line), and the way back.
    await band.unmount()
    expect(await endWords($)).toBe('Hard task · Opus 5.5 at max effort')
    const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await after.find({ key: 'redo' }))?.props.label).toBe('Ask again on Sonnet 5.5')
    await after.unmount()
  })

  test('after the answer has ended there is nothing to stop: pressing it just asks again', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [HARD]: 'hard' } })

    await typed($, HARD)
    await runTurn($, 't1', HARD, SONNET_HIGH)
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'switch' })
    expect(world.aborted).toEqual([])
    expect(world.submitted).toEqual([HARD, HARD])
    await band.unmount()
  })

  test('a switch ignores the limit on long conversations, and the limit does not hold back a suggestion', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { limit: '200000' }, contextTokens: 450_000, grades: { [WORK]: 'mid' } })
    await startedOn($, world, 't1', WORK, HAIKU_OWN)

    const band = await working($, 'terminal')
    expect((await band.find({ key: 'switch' }))?.props.label).toBe('Switch to Sonnet 5.5 at medium effort')
    await band.press({ key: 'switch' })
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })
    await runTurn($, 't2', WORK, HAIKU_OWN)
    expect(world.steps).toEqual([HAIKU_OWN, SONNET_MEDIUM])
    await band.unmount()
  })

  test('it stays quiet when the grade names what already runs', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [HARD]: 'hard', [WORK]: 'mid' } })

    // A hard task on Opus at max effort: graded, and its pick is what runs, so nothing is offered.
    await startedOn($, world, 't1', HARD, OPUS_MAX)
    expect(world.graded.length).toBe(1)
    let band = await working($, 'terminal')
    expect(await band.find({ key: 'task' })).toBeUndefined()
    expect(await band.find({ key: 'switch' })).toBeUndefined()
    await band.unmount()
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    // A mid task on Sonnet at medium effort, the same.
    await startedOn($, world, 't2', WORK, SONNET_MEDIUM)
    expect(world.graded.length).toBe(2)
    band = await working($, 'terminal')
    expect(await band.find({ key: 'switch' })).toBeUndefined()
    await band.unmount()
  })

  test('where no grade could name anything but the session runs on, no grade is asked', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { easy: 'own', mid: 'own', hard: 'own' }, grades: { [HARD]: 'hard' } })
    await startedOn($, world, 't1', HARD, SONNET_HIGH)
    expect(world.graded).toEqual([])
    const band = await working($, 'terminal')
    expect(await band.find({ key: 'switch' })).toBeUndefined()
    await band.unmount()
  })

  test('an easy task on a strong model is offered the cheaper one, and while the answer runs a press asks again there', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [QUESTION]: 'easy' } })
    await startedOn($, world, 't1', QUESTION, OPUS_MAX)

    const band = await working($, 'terminal')
    expect((await band.find({ key: 'task' }))?.text).toBe('Easy task · Opus 5.5 at max effort')
    expect((await band.find({ key: 'switch' }))?.props).toMatchObject({ label: 'Switch to Haiku 5.5 at low effort', plain: true, hotkey: '0' })
    await band.press({ key: 'switch' })
    expect(world.aborted).toEqual(['t1'])
    expect(world.submitted).toEqual([QUESTION, QUESTION])
    await band.unmount()

    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })
    await runTurn($, 't2', QUESTION, OPUS_MAX)
    await typed($, 'and the tests?')
    await runTurn($, 't3', 'and the tests?', OPUS_MAX)
    expect(world.steps).toEqual([OPUS_MAX, HAIKU_LOW, HAIKU_LOW])
    expect(world.graded.length).toBe(1)
  })

  test('once the answer is in, a cheaper pick reads "Continue on": nothing is asked again, and the follow-ups go there', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [QUESTION]: 'easy', [WORK]: 'mid' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    await world.clock.advance(1)

    for (const surface of ['desktop', 'vscode'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect(plainOf((await band.find({ key: 'task' }))?.text ?? '')).toBe('Easy task · Opus 5.5 at max effort · Continue on Haiku 5.5 at low effort')
      await band.unmount()
    }
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await band.find({ key: 'switch' }))?.props.label).toBe('Continue on Haiku 5.5 at low effort')
    await band.press({ key: 'switch' })
    expect(world.aborted).toEqual([])
    expect(world.submitted).toEqual([QUESTION]) // nothing is asked again
    await band.redraw()
    expect((await band.find({ key: 'task' }))?.text).toBe('Easy task · follow-ups on Haiku 5.5 at low effort')
    expect(await band.find({ key: 'switch' })).toBeUndefined()
    expect(await band.find({ key: 'redo' })).toBeUndefined()
    await band.unmount()

    // The follow-ups go to Haiku with no new grading; their end line then speaks as under Automatic, the band keeps
    // the way back.
    await typed($, 'and the tests?')
    await runTurn($, 't2', 'and the tests?', OPUS_MAX)
    expect(world.steps).toEqual([OPUS_MAX, HAIKU_LOW])
    expect(world.graded.length).toBe(1)
    expect(await endWords($)).toBe('Easy task · Haiku 5.5 at low effort')
    const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await after.find({ key: 'task' })).toBeUndefined()
    expect((await after.find({ key: 'redo' }))?.props.label).toBe('Ask again on Opus 5.5')
    await after.unmount()

    // A new task is graded afresh, on the session's own model.
    await typed($, WORK)
    await runTurn($, 't3', WORK, OPUS_MAX)
    expect(world.steps).toEqual([OPUS_MAX, HAIKU_LOW, OPUS_MAX])
    expect(world.graded.length).toBe(2)
  })

  test('"Continue on" a model whose mode is Automatic moves the session there too', async ($, on) => {
    const world = engine(on, ['terminal'], {
      showsSuggestions: false,
      sessionModel: 'claude-opus-5-5',
      stored: { fitByModel: { haiku: 'auto' } },
      grades: { [QUESTION]: 'easy' },
    })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_MAX)
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await band.find({ key: 'switch' }))?.props.label).toBe('Continue on Haiku 5.5 with Automatic on')
    await band.press({ key: 'switch' })
    expect(world.commands).toEqual(['/model claude-haiku-5-5'])
    expect(world.submitted).toEqual([QUESTION])
    await band.unmount()
  })

  test('a reply asks nothing, and a new task is graded afresh', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [QUESTION]: 'easy', [WORK]: 'mid' } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    await typed($, 'and the tests?')
    await runTurn($, 't2', 'and the tests?', SONNET_HIGH)
    expect(world.graded.length).toBe(1)
    await typed($, WORK)
    await runTurn($, 't3', WORK, SONNET_HIGH)
    expect(world.graded.length).toBe(2)
    expect(world.steps).toEqual([SONNET_HIGH, SONNET_HIGH, SONNET_HIGH])
  })

  test("a grade that comes after a short turn ended still goes on that turn's end line, and the band keeps the button", async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [QUESTION]: 'easy' }, gradeLateMs: 3_000 })

    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...OPUS_MAX })
    await $.turn.complete({ answer: REPLY, durationMs: 2_100, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(await endWords($, 2_100)).toBeUndefined() // no grade yet
    await world.clock.advance(3_000)

    expect(await endWords($, 2_100)).toBe('Easy task · Opus 5.5 at max effort')
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'task' })).toBeUndefined()
    expect((await band.find({ key: 'switch' }))?.props.label).toBe('Continue on Haiku 5.5 at low effort')
    await band.unmount()
  })

  test('a grade that comes after the person has moved on is dropped', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [HARD]: 'hang' } })

    await typed($, HARD)
    await $.turn.start({ text: HARD, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...SONNET_HIGH })
    await typed($, 'what is next?')
    await world.clock.advance(60_000)

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'switch' })).toBeUndefined()
    await band.unmount()
  })

  test('where no surface could show the button, no grade is asked', async ($, on) => {
    const none = engine(on, NOTHING_DRAWS)
    await typed($, HARD)
    await runTurn($, 't1', HARD, SONNET_HIGH)
    expect(none.graded).toEqual([])
  })

  test('a prompt with an image gets no suggestion: asking it again would lose the image', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, grades: { [HARD]: 'hard' } })

    await typed($, `${HARD} [Image: source: /shots/a.png]`)
    await $.turn.start({ text: HARD, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...SONNET_HIGH })
    await world.clock.advance(1)

    expect(world.graded).toEqual([])
    const band = await working($, 'terminal')
    expect(await band.find({ key: 'switch' })).toBeUndefined()
    await band.unmount()
  })

  test("the grader and the grading settings apply to the grade asked off the turn", async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { grader: 'claude-haiku-5-5', grading: 'two' }, grades: { [HARD]: 'hard' } })
    await startedOn($, world, 't1', HARD, SONNET_HIGH)

    expect(world.graded.map(call => call.model)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5'])
    const band = await working($, 'terminal')
    expect(await band.find({ key: 'switch' })).toBeDefined()
    await band.unmount()
  })

  test('Automatic still switches on its own, with nothing to press', async ($, on) => {
    const auto = engine(on, ['terminal'], { showsSuggestions: false, stored: { fit: 'auto' }, grades: { [HARD]: 'hard' } })
    await typed($, HARD)
    await runTurn($, 't1', HARD, SONNET_HIGH)
    expect(auto.steps).toEqual([OPUS_MAX])
    expect(auto.aborted).toEqual([])
  })

  test('the setting is migrated from the old switch: on is Automatic, off stays off, and a store without one is Suggest', () => {
    expect(settingsFrom({}).fit).toBe('suggest')
    expect(settingsFrom({ route: true }).fit).toBe('auto')
    expect(settingsFrom({ route: false }).fit).toBe('off')
    expect(settingsFrom({ fit: 'suggest', route: true }).fit).toBe('suggest')
    expect(settingsFrom({ fit: 'off' }).fit).toBe('off')
    expect(settingsFrom({ fit: 'nonsense' }).fit).toBe('suggest')
    // A session still on the version before keeps reading the switch.
    expect(storedOf(settingsFrom({ fit: 'auto' }))).toMatchObject({ fit: 'auto', route: true })
    expect(storedOf(settingsFrom({ fit: 'suggest' }))).toMatchObject({ fit: 'suggest', route: false })
    expect(storedOf(settingsFrom({ fit: 'off' }))).toMatchObject({ fit: 'off', route: false })
  })

  test('a stronger pick is a higher model, or the same model at a higher effort that both name', () => {
    expect(isStronger(OPUS_MAX, SONNET_HIGH)).toBe(true)
    expect(isStronger(SONNET_HIGH, OPUS_MAX)).toBe(false)
    expect(isStronger(OPUS_MAX, { model: 'claude-opus-5-5', effort: 'high' })).toBe(true)
    expect(isStronger(OPUS_MAX, OPUS_MAX)).toBe(false)
    expect(isStronger(OPUS_MAX, { model: 'claude-opus-5-5', effort: undefined })).toBe(false) // an unnamed effort cannot be compared
    expect(isStronger(OPUS_MAX, { model: 'claude-opus-5-5[1m]', effort: 'high' })).toBe(true) // the context mark is no model of its own
    expect(isStronger(OPUS_MAX, { model: 'a-providers-own-model', effort: 'high' })).toBe(false)
    expect(isStronger({ model: 'claude-fable-5-1', effort: 'high' }, OPUS_MAX)).toBe(true)
  })

  test('a pick elsewhere is another model, or the same model at another effort that both name', () => {
    expect(isElsewhere(HAIKU_LOW, OPUS_MAX)).toBe(true)
    expect(isElsewhere(OPUS_MAX, SONNET_HIGH)).toBe(true)
    expect(isElsewhere(OPUS_MAX, OPUS_MAX)).toBe(false)
    expect(isElsewhere({ model: 'claude-opus-5-5', effort: 'high' }, OPUS_MAX)).toBe(true)
    expect(isElsewhere(OPUS_MAX, { model: 'claude-opus-5-5[1m]', effort: 'max' })).toBe(false) // the context mark is no model of its own
    expect(isElsewhere(OPUS_MAX, { model: 'claude-opus-5-5', effort: undefined })).toBe(false) // an unnamed effort cannot be compared
    expect(isElsewhere(HAIKU_LOW, { model: 'a-providers-own-model', effort: 'high' })).toBe(false)
  })

  test('there is nothing to ask when no grade could name anything but what the session runs on', () => {
    expect(canSuggest(ROUTES, OPUS_MAX)).toBe(true) // easy and mid name cheaper models
    expect(canSuggest(ROUTES, SONNET_HIGH)).toBe(true)
    expect(canSuggest(ROUTES, HAIKU_OWN)).toBe(true)
    expect(canSuggest({ ...ROUTES, easy: 'own', mid: 'own', hard: 'own' }, SONNET_HIGH)).toBe(false) // "my model and effort" names nothing else
    expect(canSuggest({ ...ROUTES, easy: 'own', mid: 'own' }, OPUS_MAX)).toBe(false) // hard names what runs
    expect(canSuggest({ ...ROUTES, easy: 'own', mid: 'own' }, { model: 'claude-opus-5-5', effort: 'high' })).toBe(true) // the same model at max
    expect(canSuggest({ ...ROUTES, easy: 'own', mid: 'own' }, { model: 'claude-opus-5-5', effort: undefined })).toBe(false)
    expect(canSuggest(ROUTES, { model: 'a-providers-own-model', effort: 'high' })).toBe(false)
  })

  test('the menu and the pane offer Suggest, Automatic and Off', async ($, on) => {
    engine(on, ['terminal'])

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    expect((await menu.find({ key: 'setting-fit' }))?.text).toBe(`${'Fit to each task'.padEnd(24)}Suggest`)
    await menu.press({ key: 'setting-fit' })
    expect((await menu.find({ key: 'option-suggest' }))?.text).toBe('Suggest: you press to switch  ✓')
    expect((await menu.find({ key: 'option-auto' }))?.props).toMatchObject({ plain: true, hotkey: '2' })
    expect((await menu.find({ key: 'option-off' }))?.props.hotkey).toBe('3')
    await menu.press({ key: 'option-auto' })
    expect((await menu.find({ key: 'setting-fit' }))?.text).toBe(`${'Fit to each task'.padEnd(24)}Automatic`)
    await menu.unmount()

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect((await pane.find({ key: 'fit' }))?.props.value).toBe('auto')
    await pane.select({ key: 'fit', value: 'off' })
    await pane.redraw()
    expect((await pane.find({ key: 'fit' }))?.props.value).toBe('off')
    await pane.unmount()
  })

  test('the settings in words say which mode and what it is set to', async ($, on) => {
    engine(on, NOTHING_DRAWS, { stored: { fit: 'suggest' } })
    const run = () => $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })

    expect((await run()).text).toContain('Fit to the task: suggest (easy tasks: Haiku 5.5 at low effort; mid tasks: Sonnet 5.5 at medium effort; hard tasks: Opus 5.5 at max effort)')
  })

  test('each family keeps its own mode, read from any spelling of a model; the others keep the mode for every model', () => {
    const stored = settingsFrom({ fit: 'suggest', fitByModel: { opus: 'auto', sonnet: 'nonsense', gpt: 'auto' } })
    expect(stored.fitByModel).toEqual({ opus: 'auto' }) // a mode or a family it does not know is left out
    expect(settingsFrom({ fit: 'off' }).fitByModel).toEqual({}) // a store from before has none
    expect(storedOf(stored)).toMatchObject({ fit: 'suggest', fitByModel: { opus: 'auto' }, route: false })

    expect(fitFor(stored, 'claude-opus-5-5')).toBe('auto')
    expect(fitFor(stored, 'claude-opus-5-5[1m]')).toBe('auto')
    expect(fitFor(stored, 'opus')).toBe('auto')
    expect(fitFor(stored, 'claude-sonnet-5-5')).toBe('suggest')
    expect(fitFor(stored, null)).toBe('suggest')
    expect(fitFor(stored, 'a-providers-own-model')).toBe('suggest')

    expect(familyOf('Opus 5.5')).toBe('opus')
    expect(familyOf('claude-haiku-5-5')).toBe('haiku')
    expect(familyOf('fable[1m]')).toBe('fable')
    expect(familyOf('opusculum')).toBeNull()
  })

  test('a pick is kept for the family the session runs on, and the setting shows it again whenever the session is back there', async ($, on) => {
    const world = engine(on, ['terminal'], { sessionModel: 'claude-opus-5-5' })
    const ROW = 'Fit to each task'.padEnd(24)
    const open = () => $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
    const fitRowOf = async () => {
      const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
      const row = (await menu.find({ key: 'setting-fit' }))?.text
      await menu.unmount()
      return row
    }

    await open()
    let menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    expect((await menu.find({ key: 'setting-fit' }))?.text).toBe(`${ROW}Suggest`)
    await menu.press({ key: 'setting-fit' })
    expect((await menu.find({ key: 'about' }))?.text).toContain('Each model keeps the mode you pick while on it.')
    await menu.press({ key: 'option-auto' })
    expect((await menu.find({ key: 'setting-fit' }))?.text).toBe(`${ROW}Automatic`)
    await menu.unmount()

    // On Sonnet nothing was picked: the mode for every model stands, and a pick there is Sonnet's alone.
    world.sessionModel = 'claude-sonnet-5-5'
    await open()
    expect(await fitRowOf()).toBe(`${ROW}Suggest`)
    menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    await menu.press({ key: 'setting-fit' })
    await menu.press({ key: 'option-off' })
    await menu.unmount()

    world.sessionModel = 'claude-opus-5-5'
    await open()
    expect(await fitRowOf()).toBe(`${ROW}Automatic`)
    world.sessionModel = 'claude-haiku-5-5'
    await open()
    expect(await fitRowOf()).toBe(`${ROW}Suggest`)

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect((await pane.find({ key: 'fit' }))?.props).toMatchObject({ label: 'Fit model and effort to each task', value: 'suggest' })
    await pane.unmount()
  })

  test('each turn runs under the mode of the model the session is on', async ($, on) => {
    const OTHER = 'what does the parser return?'
    const world = engine(on, ['terminal'], {
      showsSuggestions: false,
      sessionModel: 'claude-opus-5-5',
      stored: { fit: 'suggest', fitByModel: { opus: 'auto' } },
      grades: { [QUESTION]: 'easy', [OTHER]: 'easy' },
    })
    const OPUS_HIGH = { model: 'claude-opus-5-5', effort: 'high' } as const

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, OPUS_HIGH)
    expect(world.steps).toEqual([HAIKU_LOW]) // Automatic on Opus sends an easy question to Haiku

    world.sessionModel = 'claude-sonnet-5-5' // the person ran /model sonnet
    await typed($, OTHER)
    await runTurn($, 't2', OTHER, SONNET_HIGH)
    expect(world.steps).toEqual([HAIKU_LOW, SONNET_HIGH]) // Suggest on Sonnet changes nothing
  })

  test('a switch to a model whose mode is Automatic says so, and a press moves the session there as /model does', async ($, on) => {
    const world = engine(on, ['terminal'], {
      showsSuggestions: false,
      sessionModel: 'claude-sonnet-5-5',
      stored: { fitByModel: { opus: 'auto' } },
      grades: { [HARD]: 'hard', [QUESTION]: 'easy' },
    })
    const OPUS_HIGH = { model: 'claude-opus-5-5', effort: 'high' } as const
    await startedOn($, world, 't1', HARD, SONNET_HIGH)

    for (const surface of ['desktop', 'vscode'] as const) {
      const shown = await working($, surface)
      expect(plainOf((await shown.find({ key: 'task' }))?.text ?? '')).toBe('Hard task · Sonnet 5.5 at high effort · Switch to Opus 5.5 with Automatic on')
      await shown.unmount()
    }
    const band = await working($, 'terminal')
    expect((await band.find({ key: 'switch' }))?.props).toMatchObject({ label: 'Switch to Opus 5.5 with Automatic on', hotkey: '0' })
    await band.press({ key: 'switch' })
    expect(world.aborted).toEqual(['t1'])
    expect(world.commands).toEqual(['/model claude-opus-5-5'])
    expect(world.submitted).toEqual([HARD, HARD])
    await band.unmount()

    // The session is on Opus now, whose Automatic fits each task: the hard one at max effort, an easy one on Haiku.
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })
    await runTurn($, 't2', HARD, OPUS_HIGH)
    await typed($, QUESTION)
    await runTurn($, 't3', QUESTION, OPUS_HIGH)
    expect(world.steps).toEqual([SONNET_HIGH, OPUS_MAX, HAIKU_LOW])
  })

  test('where /model cannot run, the press still switches the task', async ($, on) => {
    const world = engine(on, ['terminal'], {
      showsSuggestions: false,
      sessionModel: 'claude-sonnet-5-5',
      stored: { fitByModel: { opus: 'auto' } },
      grades: { [HARD]: 'hard' },
      commandsFail: true,
    })
    await startedOn($, world, 't1', HARD, SONNET_HIGH)

    const band = await working($, 'terminal')
    await band.press({ key: 'switch' })
    expect(world.submitted).toEqual([HARD, HARD])
    await band.unmount()
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })
    await runTurn($, 't2', HARD, SONNET_HIGH)
    expect(world.steps).toEqual([SONNET_HIGH, OPUS_MAX])
  })

  test('the settings in words give the mode kept for the session model', async ($, on) => {
    engine(on, NOTHING_DRAWS, { sessionModel: 'claude-opus-5-5', stored: { fit: 'suggest', fitByModel: { opus: 'auto' } } })
    const run = () => $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })

    expect((await run()).text).toContain('Fit to the task: automatic (')
  })
})

describe('a prompt sent while the answer runs', () => {
  test('a turn the engine starts inside the prompt submit, as the real engine does, still gets its choices', async ($, on) => {
    const holder: { world?: World } = {}
    let started = false
    const world = engine(on, ['terminal'], {
      stored: { fit: 'off' },
      onSubmit: async text => {
        if (started) return
        started = true
        await $.turn.start({ text, turnId: 't1' }) // the turn begins before the submit hook resumes
        await holder.world?.clock.advance(5)
      },
    })
    holder.world = world

    await typed($, 'first question')
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.requests.length).toBe(1)
    expect(world.requests[0]?.prompt).toContain('first question')
  })

  test('is the next message already: no choices are asked for that answer, and the next answer gets its own', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { fit: 'off' } })

    await typed($, 'first question')
    await $.turn.start({ text: 'first question', turnId: 't1' })
    await world.clock.advance(10)
    await typed($, 'second question')
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.requests).toEqual([])

    await runTurn($, 't2', 'second question', SONNET_HIGH)
    await world.clock.advance(1)
    expect(world.requests.length).toBe(1)
    expect(world.requests[0]?.prompt).toContain('second question')
  })

  test('where nothing draws, the line beneath the answer carries no choices either', async ($, on) => {
    const world = engine(on, NOTHING_DRAWS, { stored: { fit: 'off' } })

    await typed($, 'first question')
    await $.turn.start({ text: 'first question', turnId: 't1' })
    await world.clock.advance(10)
    await typed($, 'second question')
    const done = await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(done.text).toBe(REPLY)
    expect(world.requests).toEqual([])
  })
})

describe('the last prompt outside the terminal', () => {
  const HARD = 'implement the export command for the settings'

  test('off by default: the band leaves the prompt to VS Code, and the ⋯ ends the "Suggested" row', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    // Nothing else to show yet: the band draws nothing at all.
    const before = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await before.find({ key: 'settings' })).toBeUndefined()
    await before.unmount()

    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    for (const surface of ['vscode', 'desktop'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect(await band.find({ key: 'prompt' })).toBeUndefined()
      expect(await choicesDrawn(band)).toEqual([...CHOICES])
      const head = await band.find({ key: 'head' })
      expect(head?.text).toContain('Suggested')
      expect((await band.find({ key: 'settings' }))?.props.label).toBe('⋯')
      await band.press({ key: 'settings' })
      await band.unmount()
    }
    expect(world.opened).toEqual([SETTINGS, SETTINGS])

    // The terminal, where nothing pins the prompt, keeps it.
    const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await promptShown(terminal)).toBe('merge the parser work')
    await terminal.unmount()
  })

  test('with a model line and no quote, the ⋯ ends the model line', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, grades: { [HARD]: 'hard' } })
    await typed($, HARD)
    await $.turn.start({ text: HARD, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...SONNET_HIGH })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'vscode', props: { ...BAND.props, isWorking: true } })
    expect(await band.find({ key: 'prompt' })).toBeUndefined()
    expect(plainOf((await band.find({ key: 'fitHead' }))?.text ?? '')).toContain('Hard task · Sonnet 5.5 at high effort · Switch to Opus 5.5 at max effort')
    expect(await band.find({ key: 'settings' })).toBeDefined()
    await band.unmount()
  })

  test('turned on, VS Code shows the prompt on one line again', async ($, on) => {
    engine(on, ['vscode'], { stored: { lastPrompt: true } })
    await $.prompt.submit({ text: 'rename the\nconfig loader   please', wait: false, origin: { kind: 'composer' } })

    for (const surface of ['desktop', 'vscode'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect(await promptShown(band)).toBe('rename the config loader please')
      expect(await band.find({ key: 'head' })).toBeUndefined() // the ⋯ is back on the prompt's row
      await band.unmount()
    }
  })

  test('the setting is off unless stored on, and both the pane and the terminal menu change it', async ($, on) => {
    expect(settingsFrom({}).lastPrompt).toBe(false)
    expect(settingsFrom({ lastPrompt: true }).lastPrompt).toBe(true)
    expect(settingsFrom({ lastPrompt: 'yes' }).lastPrompt).toBe(false)
    expect(storedOf(settingsFrom({ lastPrompt: true }))).toMatchObject({ lastPrompt: true })

    engine(on, ['vscode'])
    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect((await pane.find({ key: 'lastPrompt' }))?.props).toMatchObject({ value: 'off', label: 'Show it in the band in VS Code' })
    await pane.select({ key: 'lastPrompt', value: 'on' })
    await pane.redraw()
    expect((await pane.find({ key: 'lastPrompt' }))?.props.value).toBe('on')
    await pane.unmount()

    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    expect((await menu.find({ key: 'setting-lastPrompt' }))?.text).toBe(`${'In VS Code'.padEnd(24)}On`)
    await menu.press({ key: 'setting-lastPrompt' })
    expect((await menu.find({ key: 'setting-lastPrompt' }))?.text).toBe(`${'In VS Code'.padEnd(24)}Off`)
    await menu.unmount()
  })
})

describe('notes', () => {
  const NOTES = 'companion-notes'
  const AT = 1_700_000_000_000
  const stored = (id: string, text: string, at = AT, root = '/work/parser') => ({ id, text, at, root })
  const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })
  const mountNotes = ($: Engine, surface: RenderSurface) => $.ui.mount({ ...SETTINGS_MOUNT, requestId: NOTES, surface })
  const labels = async (pane: Drawn, keys: readonly string[]) => {
    const out: string[] = []
    for (const key of keys) {
      const found = await pane.find({ key })
      if (found !== undefined) out.push(typeof found.props.label === 'string' ? found.props.label : found.text)
    }
    return out
  }

  test('/note keeps a message for later, once, and says how many are kept', async ($, on) => {
    engine(on, ['terminal'])

    const first = await run($, 'note', 'run the   parser tests\nagain')
    expect(first.text).toBe('Kept: run the parser tests again (1 note, /notes opens them)')
    expect((await run($, 'note', 'run the parser tests again')).text).toBe('Already kept: run the parser tests again (1 note, /notes opens them)')
    expect((await run($, 'note', 'check the changelog')).text).toBe('Kept: check the changelog (2 notes, /notes opens them)')
  })

  test('/notes opens the pane with the keys, newest first, numbered in the terminal', async ($, on) => {
    const world = engine(on, ['terminal'], { notes: [stored('a', 'older note', AT), stored('b', 'newer note', AT + 5)] })

    expect((await run($, 'notes')).text).toBe('Notes opened.')
    expect(world.openedWith).toEqual([{ id: NOTES, title: 'Notes', focus: true, closeOnEscape: true, holdToasts: true, rows: 15 }])
    const pane = await mountNotes($, 'terminal')
    expect(await labels(pane, ['note-1', 'note-2'])).toEqual(['newer note', 'older note'])
    expect((await pane.find({ key: 'note-1' }))?.props).toMatchObject({ plain: true, hotkey: '1' })
    expect((await pane.find({ key: 'clear' }))?.props).toMatchObject({ plain: true, hotkey: '0' })
    await pane.unmount()
    // /note with nothing after it opens them too.
    expect((await run($, 'note')).text).toBe('Notes opened.')
  })

  test('in the terminal each note shows whole, and the pane opens tall enough for the long ones', async ($, on) => {
    const LONG = 'Clerk: paste the publishable key into the dashboard settings, save it, then run the sign-in flow again from a fresh browser profile and check that the redirect lands on the game page'
    const notes = [stored('a', LONG, AT), ...Array.from({ length: 8 }, (_, i) => stored(`n${i}`, `${LONG} (${i})`, AT + 1 + i))]
    const world = engine(on, ['terminal'], { notes })
    await hintSite($) // the terminal draws the line under the prompt box: 120 columns
    expect((await run($, 'notes')).text).toBe('Notes opened.')
    // At 120 columns a note takes two rows, so nine of them more than the 15 rows of short ones.
    expect(world.openedWith.at(-1)?.rows).toBe(notesRows(notes, 120))
    expect(notesRows(notes, 120)).toBe(1 + 9 * 2 + 2 + 2)
    const pane = await mountNotes($, 'terminal')
    expect(await labels(pane, ['note-9'])).toEqual([LONG])
    await pane.unmount()
    // Wrapped as the terminal wraps: word by word, a word wider than the row split.
    expect([wrappedRows('', 10), wrappedRows('aaa bbb ccc', 7), wrappedRows('a'.repeat(25), 10), wrappedRows(`${'a'.repeat(25)} bb`, 10)]).toEqual([1, 2, 3, 3])
    // Short notes keep the pane at its 15 rows.
    expect(notesRows([stored('s', 'short note')], 120)).toBe(15)
  })

  test('with no notes the pane says how to keep one', async ($, on) => {
    engine(on, ['terminal'])
    await run($, 'notes')

    const pane = await mountNotes($, 'terminal')
    expect((await pane.find({ type: 'Text' }))?.text).toContain('No notes yet. Copy words from an answer and run /note')
    await pane.unmount()
  })

  test('/save-next keeps a suggested message; a number picks which, and a wrong one lists them', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    expect((await run($, 'save-next')).text).toBe('No suggestion yet: they come with the next answer.')

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    expect((await run($, 'save-next', '2')).text).toBe(`Kept: ${CHOICES[1]} (1 note, /notes opens them)`)
    expect((await run($, 'save-next')).text).toBe(`Kept: ${CHOICES[0]} (2 notes, /notes opens them)`)
    expect((await run($, 'save-next', '9')).text).toContain('Pick 1 to 3.')
  })

  test('notes belong to the project folder, and come back when the session does', async ($, on) => {
    const world = engine(on, ['terminal'])

    await run($, 'note', 'only for the parser')
    world.root = '/work/game'
    expect((await run($, 'note', 'only for the game')).text).toContain('(1 note,')
    await run($, 'notes')
    let pane = await mountNotes($, 'terminal')
    expect(await labels(pane, ['note-1', 'note-2'])).toEqual(['only for the game'])
    await pane.unmount()

    world.root = '/work/parser'
    await run($, 'notes')
    pane = await mountNotes($, 'terminal')
    expect(await labels(pane, ['note-1', 'note-2'])).toEqual(['only for the parser'])
    await pane.unmount()
  })

  test('taking a note keeps it: the words go to the prompt box, the pane closes, and the note stays', async ($, on) => {
    const world = engine(on, ['terminal'], { notes: [stored('a', 'first note', AT), stored('b', 'second note', AT + 5)] })
    await run($, 'notes')

    const pane = await mountNotes($, 'terminal')
    await pane.press({ key: 'note-1' }) // the newest, "second note"
    expect(world.box).toBe('second note')
    expect(world.closed).toEqual([NOTES])
    await pane.unmount()

    await run($, 'notes')
    const again = await mountNotes($, 'terminal')
    expect(await labels(again, ['note-1', 'note-2'])).toEqual(['second note', 'first note'])
    await again.unmount()
  })

  test('outside the terminal each note is a quiet button that stays when taken; the cross removes it', async ($, on) => {
    const world = engine(on, ['vscode'], { notes: [stored('a', 'first note', AT), stored('b', 'second note', AT + 5)] })
    await run($, 'notes')

    const pane = await mountNotes($, 'vscode')
    expect((await pane.find({ key: 'note-b' }))?.props).toMatchObject({ plain: true, dimColor: true, label: 'second note' })
    expect((await pane.find({ key: 'note-b' }))?.text).toBe('↳ second note')
    await pane.press({ key: 'drop-b' })
    await pane.redraw()
    expect(await pane.find({ key: 'note-b' })).toBeUndefined()
    expect(world.box).toBe('') // removed, not taken
    await pane.press({ key: 'note-a' })
    expect(world.box).toBe('first note')
    await pane.redraw()
    expect(await pane.find({ key: 'note-a' })).toBeDefined()
    await pane.unmount()
  })

  test('x lists the notes to remove one by its number, and n goes back', async ($, on) => {
    engine(on, ['terminal'], { notes: [stored('a', 'first note', AT), stored('b', 'second note', AT + 5)] })
    await run($, 'notes')

    const pane = await mountNotes($, 'terminal')
    expect((await pane.find({ key: 'remove' }))?.props).toMatchObject({ plain: true, hotkey: 'x' })
    await pane.press({ key: 'remove' })
    await pane.redraw()
    expect(await labels(pane, ['remove-1', 'remove-2'])).toEqual(['second note', 'first note'])
    await pane.press({ key: 'remove-1' })
    await pane.redraw()
    expect(await labels(pane, ['note-1', 'note-2'])).toEqual(['first note']) // back on the list, one gone

    await pane.press({ key: 'remove' })
    await pane.redraw()
    await pane.press({ key: 'back' })
    await pane.redraw()
    expect(await labels(pane, ['note-1', 'note-2'])).toEqual(['first note'])
    await pane.unmount()
  })

  test('0 asks before clearing: n keeps every note, y clears this project and leaves the others', async ($, on) => {
    const world = engine(on, ['terminal'], { notes: [stored('a', 'mine'), stored('b', 'mine too', AT + 1), stored('c', 'another project', AT, '/work/game')] })
    await run($, 'notes')

    const pane = await mountNotes($, 'terminal')
    await pane.press({ key: 'clear' })
    await pane.redraw()
    expect((await pane.find({ type: 'Text' }))?.text).toBe('Clear all 2 notes for this project?')
    expect((await pane.find({ key: 'yes' }))?.props).toMatchObject({ plain: true, hotkey: 'y' })
    expect((await pane.find({ key: 'no' }))?.props).toMatchObject({ plain: true, hotkey: 'n' })
    await pane.press({ key: 'no' })
    await pane.redraw()
    expect(await labels(pane, ['note-1', 'note-2'])).toEqual(['mine too', 'mine'])

    await pane.press({ key: 'clear' })
    await pane.redraw()
    await pane.press({ key: 'yes' })
    await pane.redraw()
    expect((await pane.find({ type: 'Text' }))?.text).toContain('No notes yet')
    await pane.unmount()
    expect((await run($, 'notes', 'clear')).text).toBe('No notes to clear.')

    // The other project's note is still there.
    world.root = '/work/game'
    await run($, 'notes')
    const other = await mountNotes($, 'terminal')
    expect(await labels(other, ['note-1', 'note-2'])).toEqual(['another project'])
    await other.unmount()
  })

  test('/notes clear asks in the pane first', async ($, on) => {
    engine(on, ['vscode'], { notes: [stored('a', 'one'), stored('b', 'two', AT + 1)] })
    expect((await run($, 'notes', 'clear')).text).toBe('Clear all 2 notes? Answer in the Notes pane.')

    const pane = await mountNotes($, 'vscode')
    expect((await pane.find({ type: 'Text' }))?.text).toBe('Clear all 2 notes for this project?')
    await pane.press({ key: 'yes' })
    await pane.redraw()
    expect((await pane.find({ type: 'Text' }))?.text).toContain('No notes yet')
    await pane.unmount()
  })

  test('where no pane draws, /notes clear clears at once and says how many', async ($, on) => {
    engine(on, NOTHING_DRAWS, { notes: [stored('a', 'one'), stored('b', 'two', AT + 1)] })
    expect((await run($, 'notes', 'clear')).text).toBe('Cleared 2 notes for this project.')
  })

  test('a project holds 50 notes, and the 51st says so', async ($, on) => {
    const many = Array.from({ length: 50 }, (_, i) => stored(`n${i}`, `note ${i}`, AT + i))
    engine(on, ['terminal'], { notes: many })

    expect((await run($, 'note', 'one more')).text).toBe('Notes are full (50 for this project): take or clear one first with /notes.')
    expect((await run($, 'note', 'note 7')).text).toContain('Already kept')
  })

  test('a store holding anything but notes is read as none, and a long note is cut where it is kept', async ($, on) => {
    engine(on, ['terminal'], { notes: [1, 'x', null, { id: 1 }, { id: 'a', text: 'ok', at: 'now', root: '/work/parser' }] })
    expect((await run($, 'notes', 'clear')).text).toBe('No notes to clear.')
    const long = 'word '.repeat(200)
    const kept = (await run($, 'note', long)).text ?? ''
    expect(kept.length).toBeLessThan(140)
    await run($, 'notes')
    const pane = await mountNotes($, 'terminal')
    // Kept at 500 characters, and shown whole: the pane wraps it.
    expect(((await pane.find({ key: 'note-1' }))?.props.label as string).length).toBe(500)
    await pane.unmount()
  })

  test('where no surface draws a pane, /notes answers with the notes as numbered lines', async ($, on) => {
    engine(on, NOTHING_DRAWS, { notes: [stored('a', 'older note', AT), stored('b', 'newer note', AT + 5)] })

    expect((await run($, 'notes')).text).toBe('1. newer note\n2. older note\nNo panel draws here: run /notes in VS Code or the terminal to take one.')
  })

  test('/notes export writes the project’s notes, newest first with their day, to NOTES.md, and writes it again next time', async ($, on) => {
    const DAY = 86_400_000
    const world = engine(on, ['terminal'], { notes: [stored('a', 'older note', AT), stored('b', 'newer note', AT + DAY), stored('c', 'another project', AT, '/work/game')] })

    expect((await run($, 'notes', 'export')).text).toBe('Wrote 2 notes to NOTES.md.')
    expect(world.written).toEqual([
      {
        path: '/work/parser/NOTES.md',
        text: [
          '<!-- Written by Companion’s /notes export; the next export writes it again. -->',
          '',
          '# Notes',
          '',
          'Kept with Companion in this project, newest first.',
          '',
          '- newer note (2023-11-15)',
          '- older note (2023-11-14)',
          '',
        ].join('\n'),
      },
    ])
    await run($, 'note', 'a third note')
    expect((await run($, 'notes', 'export')).text).toBe('Wrote 3 notes to NOTES.md.') // its own file, written again
    expect(world.written).toHaveLength(2)
    expect(world.written[1]?.text).toContain('- a third note (')
  })

  test('/notes export leaves a NOTES.md it did not write alone, writes another file named, and never outside the project', async ($, on) => {
    const world = engine(on, ['terminal'], { notes: [stored('a', 'a note')], files: { '/work/parser/NOTES.md': '# My own notes\n' } })

    expect((await run($, 'notes', 'export')).text).toBe('NOTES.md is already there and /notes export did not write it, so it was left alone. /notes export <file> writes somewhere else.')
    expect(world.written).toEqual([])
    expect((await run($, 'notes', 'export docs/companion-notes.md')).text).toBe('Wrote 1 note to docs/companion-notes.md.')
    expect(world.written.map(file => file.path)).toEqual(['/work/parser/docs/companion-notes.md'])
    for (const outside of ['../elsewhere.md', 'docs/../../up.md', 'C:/notes.md', '/etc/notes.md', '~/notes.md']) {
      expect((await run($, 'notes', `export ${outside}`)).text).toBe(`Notes are written inside this project: ${outside} is outside it.`)
    }
    expect(world.written).toHaveLength(1)
  })

  test('/notes export with no notes writes nothing', async ($, on) => {
    const world = engine(on, ['terminal'])
    expect((await run($, 'notes', 'export')).text).toBe('No notes to export yet.')
    expect(world.written).toEqual([])
  })
})

describe('copy the last answer', () => {
  const ANSWER = '## Plan\n\n- **Cache** tokens by `hash`\n- Read in chunks'
  const answerTurn = async ($: Engine, world: World, answer = ANSWER) => {
    await $.prompt.submit({ text: 'plan the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
  }

  test('7: Copy answer, first on the keys line once an answer is in, copies it as written and says how long it was', async ($, on) => {
    const world = engine(on, ['terminal', 'vscode'], { showsSuggestions: false, stored: { lastPrompt: true } })
    await $.prompt.submit({ text: 'plan the parser work', wait: false, origin: { kind: 'composer' } })
    let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'copyKey' })).toBeUndefined() // nothing answered yet
    await band.unmount()

    // An earlier answer, then the one to copy: the last is the one copied.
    await $.turn.complete({ answer: 'An earlier answer.', durationMs: 5, isAborted: false, turnId: 't0', reason: 'answer' })
    await $.turn.complete({ answer: ANSWER, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    band = await $.ui.mount({ ...WIDE_BAND, surface: 'terminal' })
    expect((await band.find({ key: 'copyKey' }))?.props).toMatchObject({ label: 'Copy answer', plain: true, hotkey: '7' })
    expect((await hintSite($)).keys).toMatch(/Copy answer.*View queue.*View notes/)
    await band.press({ key: 'copyKey' })
    expect(world.copied).toEqual([ANSWER]) // the Markdown, marks and all
    expect(world.toasts.at(-1)).toBe(`Copied the last answer (${ANSWER.length} characters).`)
    await band.unmount()

    const vscode = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await vscode.find({ key: 'copyKey' })).toBeUndefined()
    await vscode.unmount()
  })

  test('where the surface takes no copy, the machine’s clipboard does', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, copyFails: true })
    await answerTurn($, world)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'copyKey' })
    await band.unmount()
    expect(world.copied).toEqual([])
    expect(world.ran.at(-1)?.join(' ')).toContain('Set-Clipboard')
    expect(world.toasts.at(-1)).toBe(`Copied the last answer (${ANSWER.length} characters).`)
  })
})

describe('notes from an answer', () => {
  const NOTES = 'companion-notes'
  // An answer as the model writes it: a paragraph, a list, code, a table and a heading.
  const ANSWER = [
    'The parser keeps a cache of tokens. It resets on save!',
    '',
    '## Why it matters',
    '',
    '- **Speed:** a warm cache halves the parse time.',
    '- Run `npm test` before the release.',
    '',
    '```sh',
    'npm test -- --watch',
    '```',
    '',
    '| Step | Time |',
    '| --- | --- |',
    '| Parse | 2 s |',
    '',
    'See [the docs](https://example.com/docs) for more. Ok.',
  ].join('\n')
  const LINES = [
    'The parser keeps a cache of tokens.',
    'It resets on save!',
    'Speed: a warm cache halves the parse time.',
    'Run npm test before the release.',
    'See the docs for more.',
  ]
  const FULLSCREEN = { columns: 100, rows: 30, isFullscreen: true }
  const MAIN_SCREEN = { columns: 100, rows: 30, isFullscreen: false }
  const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })
  const mountNotes = ($: Engine, surface: RenderSurface) => $.ui.mount({ ...SETTINGS_MOUNT, requestId: NOTES, surface })
  let mounts = 0 // each answer row its own instance
  const mountAnswer = ($: Engine, surface: RenderSurface, text: string, viewport = FULLSCREEN, extra: Record<string, unknown> = {}) => {
    mounts += 1
    return $.ui.mount({ plugin: PLUGIN, surface, component: 'AssistantMessage', requestId: `msg-${mounts}`, props: { text, isFirstOfReply: true, ...extra }, viewport })
  }
  const answerTurn = async ($: Engine, world: World, answer: string, turnId = 't1') => {
    await $.prompt.submit({ text: 'how does the parser cache work?', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId, reason: 'answer' })
    await world.clock.advance(1)
  }
  const label = async (pane: Drawn, key: string) => {
    const found = await pane.find({ key })
    return typeof found?.props.label === 'string' ? found.props.label : undefined
  }

  test('an answer is cut into the lines worth keeping: sentences and list items, no code, table or heading', () => {
    expect(linesOf(ANSWER)).toEqual(LINES)
    expect(linesOf('Short. Too.\n\nThe same line again here.\nThe same line again here.')).toEqual(['The same line again here.'])
    expect(linesOf('> A quoted line that stays in.')).toEqual(['A quoted line that stays in.'])
    expect(linesOf('```\nonly code here\n```')).toEqual([])
  })

  test('"Add note" goes under a completed answer in the fullscreen terminal, and nowhere before it completes', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })

    let row = await mountAnswer($, 'terminal', ANSWER)
    expect(await row.find({ key: 'note' })).toBeUndefined() // still being written
    await row.unmount()

    await answerTurn($, world, ANSWER)
    row = await mountAnswer($, 'terminal', ANSWER)
    expect((await row.find({ key: 'note' }))?.props).toMatchObject({ label: 'Add note', plain: true, dimColor: true })
    await row.unmount()
  })

  test('no "Add note" on the main screen, outside the terminal, on a summary, mid-answer, or with the setting off', async ($, on) => {
    const world = engine(on, ['terminal', 'vscode'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world, ANSWER)

    for (const row of [
      await mountAnswer($, 'terminal', ANSWER, MAIN_SCREEN),
      await mountAnswer($, 'vscode', ANSWER),
      await mountAnswer($, 'terminal', ANSWER, FULLSCREEN, { isSummary: true }),
      await mountAnswer($, 'terminal', 'Let me look at the parser first.'),
    ]) {
      expect(await row.find({ key: 'note' })).toBeUndefined()
      await row.unmount()
    }

    // The last block of a longer answer counts: what the answer ends with.
    const last = await mountAnswer($, 'terminal', 'See [the docs](https://example.com/docs) for more. Ok.')
    expect(await last.find({ key: 'note' })).toBeDefined()
    await last.unmount()

    await run($, 'companion')
    const menu = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'terminal' })
    await menu.press({ key: 'setting-noteButton' })
    await menu.unmount()
    const off = await mountAnswer($, 'terminal', ANSWER)
    expect(await off.find({ key: 'note' })).toBeUndefined()
    await off.unmount()
  })

  test('"Add note" keeps what the person selected, and says so', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world, ANSWER)
    world.selection = { text: '  a warm cache halves the parse time ', requestId: 'msg-1' }

    const row = await mountAnswer($, 'terminal', ANSWER)
    await row.press({ key: 'note' })
    expect(world.toasts).toEqual(['Kept: a warm cache halves the parse time (1 note, /notes opens them)']) // a selection reads no clipboard
    expect(world.opened).not.toContain(NOTES) // nothing to pick: the selection was it

    // The engine still answers with the same selection until a command runs: kept once, it is not kept again.
    await row.press({ key: 'note' })
    expect(world.toasts.filter(toast => toast.startsWith('Kept'))).toHaveLength(1)
    expect(world.opened).toContain(NOTES)
    expect((await run($, 'note')).text).toBe('Pick the lines to keep from the last answer.')
    // A new selection counts again, and so do the same words once the selection was gone in between.
    world.selection = undefined
    await run($, 'note')
    world.selection = { text: 'a warm cache halves the parse time' }
    expect((await run($, 'note')).text).toBe('Already kept: a warm cache halves the parse time (1 note, /notes opens them)')
    await row.unmount()
  })

  test('"Add note" with nothing selected lists the answer: a number keeps a line, again drops it', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world, ANSWER)

    const row = await mountAnswer($, 'terminal', ANSWER)
    await row.press({ key: 'note' })
    await row.unmount()
    expect(world.opened).toContain(NOTES)

    const pane = await mountNotes($, 'terminal')
    expect(await label(pane, 'line-1')).toBe(`  ${LINES[0]}`)
    expect((await pane.find({ key: 'line-2' }))?.props).toMatchObject({ plain: true, hotkey: '2' })
    expect(await pane.find({ key: 'more' })).toBeUndefined() // five lines: one page
    await pane.press({ key: 'line-2' })
    await pane.redraw()
    expect(await label(pane, 'line-2')).toBe(`✓ ${LINES[1]}`)
    expect(await label(pane, 'yours')).toBe('Your notes (1)')
    await pane.press({ key: 'line-2' })
    await pane.redraw()
    expect(await label(pane, 'line-2')).toBe(`  ${LINES[1]}`)
    expect(await label(pane, 'yours')).toBe('Your notes (0)')

    // n goes to the notes themselves.
    await pane.press({ key: 'line-3' })
    await pane.press({ key: 'yours' })
    await pane.redraw()
    expect(await label(pane, 'note-1')).toBe(LINES[2])
    await pane.unmount()
  })

  test('a long answer pages nine lines at a time, m turning the page', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    const long = Array.from({ length: 12 }, (_, i) => `Line number ${i + 1} of the long answer.`).join(' ')
    await answerTurn($, world, long)

    expect((await run($, 'note')).text).toBe('Pick the lines to keep from the last answer.')
    const pane = await mountNotes($, 'terminal')
    expect(await label(pane, 'line-9')).toBe('  Line number 9 of the long answer.')
    expect(await label(pane, 'more')).toBe('More lines (1 of 2)')
    await pane.press({ key: 'more' })
    await pane.redraw()
    expect(await label(pane, 'line-1')).toBe('  Line number 10 of the long answer.')
    expect(await pane.find({ key: 'line-4' })).toBeUndefined()
    await pane.press({ key: 'more' })
    await pane.redraw()
    expect(await label(pane, 'line-1')).toBe('  Line number 1 of the long answer.')
    await pane.unmount()
  })

  test('/note on its own keeps the selection, else lists the last answer, else opens the notes', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    expect((await run($, 'note')).text).toBe('Notes opened.') // no answer yet

    await answerTurn($, world, ANSWER)
    world.selection = { text: 'It resets on save' }
    expect((await run($, 'note')).text).toBe('Kept: It resets on save (1 note, /notes opens them)')

    world.selection = undefined
    expect((await run($, 'note')).text).toBe('Pick the lines to keep from the last answer.')
    // The latest answer is the one listed.
    await answerTurn($, world, 'A second answer, about the release notes. It ships on Friday.', 't2')
    await run($, 'note')
    const pane = await mountNotes($, 'terminal')
    expect(await label(pane, 'line-1')).toBe('  A second answer, about the release notes.')
    await pane.unmount()

    // /notes always opens the notes themselves.
    await run($, 'notes')
    const list = await mountNotes($, 'terminal')
    expect(await label(list, 'note-1')).toBe('It resets on save')
    await list.unmount()
  })

  test('outside the terminal the picker shows every line as a quiet button, + to keep and ✓ once kept', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world, ANSWER)
    await run($, 'note')

    const pane = await mountNotes($, 'vscode')
    expect((await pane.find({ key: 'line-1' }))?.props).toMatchObject({ plain: true, dimColor: true, label: LINES[0] })
    expect((await pane.find({ key: 'line-5' }))?.text).toBe(`+ ${LINES[4]}`)
    await pane.press({ key: 'line-5' })
    await pane.redraw()
    expect((await pane.find({ key: 'line-5' }))?.text).toBe(`✓ ${LINES[4]}`)
    await pane.unmount()
  })
})

describe('copy, then 9', () => {
  const NOTES = 'companion-notes'
  const ANSWER = 'The parser keeps a cache of tokens. It resets on save!\n\n- **Speed:** a warm cache halves the parse time.\n- Run `npm test` before the release.'
  const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })
  const mountNotes = ($: Engine, surface: RenderSurface) => $.ui.mount({ ...SETTINGS_MOUNT, requestId: NOTES, surface })
  const answerTurn = async ($: Engine, world: World, answer: string) => {
    await $.prompt.submit({ text: 'how does the parser cache work?', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
  }
  const label = async (pane: Drawn, key: string) => {
    const found = await pane.find({ key })
    return typeof found?.props.label === 'string' ? found.props.label : undefined
  }

  test('copied text loses the marks the terminal draws, and counts only when an answer holds its words', () => {
    expect(cleanCopy('● The parser keeps a cache of tokens.\n  It resets on save!')).toBe('The parser keeps a cache of tokens. It resets on save!')
    expect(cleanCopy('- Speed: a warm cache\r\n  halves the parse time.\r\n')).toBe('Speed: a warm cache halves the parse time.')
    expect(isFromAnswers([ANSWER], 'Speed: a warm cache halves')).toBe(true) // the bold and the dash are gone, as on screen
    expect(isFromAnswers([ANSWER], 'run NPM TEST before')).toBe(true) // in any case
    expect(isFromAnswers([ANSWER], 'hunter2 is my password')).toBe(false)
    expect(isFromAnswers([ANSWER], 'the')).toBe(false) // too short to tell
  })

  test('the band offers 9: Notes on the terminal once an answer is in, and nowhere else', async ($, on) => {
    // The prompt quote on in VS Code, so its band draws there too.
    const world = engine(on, ['terminal', 'vscode'], { showsSuggestions: false, stored: { suggest: false, lastPrompt: true } })
    await $.prompt.submit({ text: 'how does the parser cache work?', wait: false, origin: { kind: 'composer' } })
    let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'noteKey' })).toBeUndefined() // nothing answered yet
    await band.unmount()

    await $.turn.complete({ answer: ANSWER, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    band = await $.ui.mount({ ...WIDE_BAND, surface: 'terminal' })
    expect((await band.find({ key: 'noteKey' }))?.props).toMatchObject({ label: 'View notes', plain: true, hotkey: '9' })
    await band.unmount()
    expect(await hintLine($)).toContain('Copy text, then /queue to queue or /note to note')

    const vscode = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await vscode.find({ key: 'prompt' })).toBeDefined() // the band is drawn there
    expect(await vscode.find({ key: 'noteKey' })).toBeUndefined()
    await vscode.unmount()
  })

  test('/note keeps what was copied from an answer, once; anything else, or nothing new, lists the lines; 9 opens the notes', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world, ANSWER)

    world.hostClipboard = '- Speed: a warm cache\r\n  halves the parse time.\r\n'
    expect((await run($, 'note')).text).toBe('Kept: Speed: a warm cache halves the parse time. (1 note, /notes opens them)')
    expect(world.opened).not.toContain(NOTES)

    // Still on the clipboard and kept already: /note lists the answer's lines instead.
    expect((await run($, 'note')).text).toBe('Pick the lines to keep from the last answer.')
    const picker = await mountNotes($, 'terminal')
    expect(await label(picker, 'line-1')).toBe('  The parser keeps a cache of tokens.')
    await picker.unmount()

    // Text from anywhere else is never kept.
    world.hostClipboard = 'hunter2 is my password'
    expect((await run($, 'note')).text).toBe('Pick the lines to keep from the last answer.')

    // 9 opens the notes themselves, whatever view the pane was left in.
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'noteKey' })
    await band.unmount()
    expect(world.openedWith.at(-1)).toMatchObject({ id: NOTES, focus: true })
    const list = await mountNotes($, 'terminal')
    expect(await label(list, 'note-1')).toBe('Speed: a warm cache halves the parse time.')
    expect(await list.find({ key: 'note-2' })).toBeUndefined()
    await list.unmount()
  })

  test('/note on its own keeps what was copied from an answer, read through Get-Clipboard on Windows', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world, ANSWER)
    world.hostClipboard = 'Run npm test before the release.'

    expect((await run($, 'note')).text).toBe('Kept: Run npm test before the release. (1 note, /notes opens them)')
    expect(world.ran.at(-1)?.join(' ')).toContain('Get-Clipboard -Raw')
  })

  test('without PowerShell 7 the clipboard is read by Windows PowerShell, which goes first from then on', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false }, missing: ['pwsh.exe'] })
    await answerTurn($, world, ANSWER)
    world.hostClipboard = 'Run npm test before the release.'

    expect((await run($, 'note')).text).toBe('Kept: Run npm test before the release. (1 note, /notes opens them)')
    expect(world.ran.map(argv => argv[0])).toEqual(['pwsh.exe', 'powershell.exe'])
    world.hostClipboard = 'The parser keeps a cache of tokens.'
    await run($, 'note')
    expect(world.ran.map(argv => argv[0])).toEqual(['pwsh.exe', 'powershell.exe', 'powershell.exe'])
  })

  test('with the setting off the band has no 9', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false, noteButton: false } })
    await answerTurn($, world, ANSWER)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'noteKey' })).toBeUndefined()
    expect(await band.find({ key: 'queueKey' })).toBeUndefined()
    expect(await band.find({ key: 'copyKey' })).toBeUndefined()
    await band.unmount()
  })
})

describe('the queue', () => {
  // A finished task's answer with follow-ups worth doing, one at a time.
  const ANSWER = 'Done: big files load 3× faster, and the tests pass.\n\nStill worth doing:\n\n- Cache tokens by the file’s hash.\n- Read the file in chunks.\n- Add a benchmark that fails above 3 s.'
  const CACHE = 'Cache tokens by the file’s hash.'
  const CHUNKS = 'Read the file in chunks.'
  const BENCH = 'Add a benchmark that fails above 3 s.'
  const NOTHING = 'Nothing copied from an answer: select words in one of Claude’s answers, copy them, then run /queue again.'
  const EMPTY = 'Nothing queued. Copy words from an answer and run /queue, or /queue <text>.'
  const QUEUE = 'companion-queue'
  const run =($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })
  const answerTurn = async ($: Engine, world: World, turnId = 't1') => {
    await $.prompt.submit({ text: 'speed up the parser for big files', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: ANSWER, durationMs: 5, isAborted: false, turnId, reason: 'answer' })
    await world.clock.advance(1)
  }
  const label = async (band: Drawn, key: string) => {
    const found = await band.find({ key })
    return typeof found?.props.label === 'string' ? found.props.label : undefined
  }
  /** The person copies `text` and queues it: /queue on its own, as a key bound to it (Alt+Q) runs it. */
  const queueCopy = async ($: Engine, world: World, text: string) => {
    world.hostClipboard = text
    return (await run($, 'queue')).text
  }

  test('the band offers 8: Queue and 9: Notes once an answer is in, on the terminal alone, and says how to fill them', async ($, on) => {
    const world = engine(on, ['terminal', 'vscode'], { showsSuggestions: false, stored: { suggest: false, lastPrompt: true } })
    await answerTurn($, world)

    const band = await $.ui.mount({ ...WIDE_BAND, surface: 'terminal' })
    expect((await band.find({ key: 'queueKey' }))?.props).toMatchObject({ label: 'View queue', plain: true, hotkey: '8' })
    expect((await band.find({ key: 'noteKey' }))?.props).toMatchObject({ label: 'View notes', plain: true, hotkey: '9' })
    await band.unmount()
    expect(await hintLine($)).toContain('Copy text, then /queue to queue or /note to note')
    expect(await footerLine($)).toBe('focus') // nothing queued yet

    const vscode = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect(await vscode.find({ key: 'queueKey' })).toBeUndefined()
    await vscode.unmount()
  })

  test('the hints name the keys the keybindings file binds to /queue and /note', async ($, on) => {
    const keybindings = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor', 'alt+q': 'command:queue', 'meta+n': 'command:note' } }] })
    const world = engine(on, ['terminal'], { showsSuggestions: false, keybindings })
    await answerTurn($, world) // the answer's end reads the file afresh
    expect(await hintLine($)).toBe('new here? /companion-setup\nCopy text, then Alt+Q to queue or Alt+N to note')
    expect((await run($, 'queue', 'list')).text).toBe('Nothing queued. Copy words from an answer and press Alt+Q, or /queue <text>.')

    expect(keyName('ctrl+shift+k')).toBe('Ctrl+Shift+K')
    expect(keyName('ctrl+k ctrl+q')).toBe('Ctrl+K Ctrl+Q')
    expect(keyName('option+q')).toBe('Alt+Q')
  })

  test('a keybindings file that is not JSON names no key', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, keybindings: '{ not json' })
    await answerTurn($, world)
    expect((await run($, 'queue', 'list')).text).toBe(EMPTY)
  })

  test('a key bound to /queue where the prompt box does not take it is not named', async ($, on) => {
    const keybindings = JSON.stringify({ bindings: [{ context: 'Transcript', bindings: { 'alt+q': 'command:queue' } }] })
    const world = engine(on, ['terminal'], { showsSuggestions: false, keybindings })
    await answerTurn($, world)
    expect((await run($, 'queue', 'list')).text).toBe(EMPTY)
  })

  test('/queue on its own (Alt+Q where bound) queues a new copy from an answer, once; anything else, or a stale copy, is not queued', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    expect(await queueCopy($, world, CACHE)).toBe(NOTHING) // nothing answered yet: the clipboard is not read
    expect(world.ran).toEqual([])
    await answerTurn($, world)

    expect(await queueCopy($, world, '- Cache tokens by the file’s hash.\r\n')).toBe(`Queued: ${CACHE} (1 in the queue, 8 to view)`)
    expect(await queueCopy($, world, CACHE)).toBe(`Already queued: ${CACHE} (1 in the queue, 8 to view)`) // still on the clipboard
    expect(await queueCopy($, world, 'hunter2 is my password')).toBe(NOTHING) // never queued, nor shown
    expect(await queueCopy($, world, '')).toBe(NOTHING)
    expect(world.opened).toEqual([]) // queueing never opens the list

    // Sent or taken off, the words still on the clipboard are not queued again; a new copy is.
    await run($, 'queue', 'clear')
    expect(await queueCopy($, world, CACHE)).toBe(NOTHING)
    expect((await run($, 'queue', 'list')).text).toBe(EMPTY)
    expect(await queueCopy($, world, BENCH)).toBe(`Queued: ${BENCH} (1 in the queue, 8 to view)`)
  })

  test('a selection is queued as it is, with no clipboard read', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world)
    world.selection = { text: '  Read the file in chunks. ' }
    expect((await run($, 'queue')).text).toBe(`Queued: ${CHUNKS} (1 in the queue, 8 to view)`)
    expect(world.ran).toEqual([])
  })

  test('8 opens the queue as a list, never reading the clipboard; with nothing queued it says how to queue', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'queueKey' })
    expect(world.toasts.at(-1)).toBe(EMPTY)
    expect(world.opened).toEqual([])

    await queueCopy($, world, CACHE)
    await band.press({ key: 'queueKey' })
    expect(world.opened).toEqual([QUEUE])
    expect(world.ran).toHaveLength(1) // the /queue's read alone
    await band.unmount()
  })

  test('the list 8 opens takes the keys: no numbers, Enter takes an action, t moves one to the top, x takes one off', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    for (const text of [CACHE, CHUNKS, BENCH]) await run($, 'queue', text)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    // Actions wait, though nothing was answered yet: 8 and 9 are offered.
    expect(await band.find({ key: 'queueKey' })).toBeDefined()
    expect(await band.find({ key: 'noteKey' })).toBeDefined()
    expect(await band.find({ key: 'copyKey' })).toBeUndefined() // no answer to copy yet
    await band.press({ key: 'queueKey' })
    await band.unmount()
    expect(world.openedWith).toEqual([{ id: QUEUE, title: 'Queue', focus: true, closeOnEscape: true, holdToasts: true, rows: 8 }])

    const list = await $.ui.mount({ ...SETTINGS_MOUNT, requestId: QUEUE, surface: 'terminal' })
    expect((await list.find({ key: 'title' }))?.text).toBe('Queue · ↑↓ to pick · Enter takes it · t to the top · x takes it off · Esc closes')
    expect([await label(list, 'queued-1'), await label(list, 'queued-2'), await label(list, 'queued-3')]).toEqual([CACHE, CHUNKS, BENCH])
    expect((await list.find({ key: 'queued-1' }))?.props.hotkey).toBeUndefined()
    expect((await list.find({ key: 'top' }))?.props).toMatchObject({ plain: true, hotkey: 't' })
    expect((await list.find({ key: 'drop' }))?.props).toMatchObject({ plain: true, hotkey: 'x' })

    // x before the ring moves: the next one comes off.
    await list.press({ key: 'drop' })
    expect((await run($, 'queue', 'list')).text).toBe(`1. ${CHUNKS}\n2. ${BENCH}`)
    // The ring on the second row: t moves it to the top, and the ring goes with it.
    await $.ui.focus({ component: 'Pane', requestId: QUEUE, plugin: PLUGIN, element: 'queued-2', origin: { kind: 'person' } })
    await list.press({ key: 'top' })
    expect((await run($, 'queue', 'list')).text).toBe(`1. ${BENCH}\n2. ${CHUNKS}`)
    await $.ui.focus({ component: 'Pane', requestId: QUEUE, plugin: PLUGIN, element: 'queued-2', origin: { kind: 'person' } })
    await list.press({ key: 'drop' })
    expect((await run($, 'queue', 'list')).text).toBe(`1. ${BENCH}`)

    // Enter on a row: the list closes and the action waits in the prompt box; sent, it leaves the queue.
    await list.redraw()
    await list.press({ key: 'queued-1' })
    expect(world.closed).toEqual([QUEUE])
    expect(world.box).toBe(BENCH)
    await list.unmount()
    await typed($, BENCH)
    expect((await run($, 'queue', 'list')).text).toBe(EMPTY)
  })

  test('the last action taken off in the list closes it', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await run($, 'queue', CACHE)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'queueKey' })
    await band.unmount()

    const list = await $.ui.mount({ ...SETTINGS_MOUNT, requestId: QUEUE, surface: 'terminal' })
    await list.press({ key: 'drop' })
    expect(world.closed).toEqual([QUEUE])
    await list.redraw()
    expect(await list.find({ key: 'queued-1' })).toBeUndefined()
    await list.unmount()
  })

  test('the band keeps the choices, the footer counts the queue, and the next one is the grey text Tab takes', async ($, on) => {
    const world = engine(on, ['terminal'])
    await answerTurn($, world)
    expect(world.offered).toEqual([CHOICES[0]])

    await queueCopy($, world, CACHE)
    await queueCopy($, world, BENCH)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await choicesDrawn(band)).toEqual([...CHOICES])
    expect(await band.find({ key: 'queue' })).toBeUndefined() // the queue is not drawn in the band
    await band.unmount()
    expect(await footerLine($)).toBe('focus & 2 queued')
    expect(await footerLine($, 'desktop')).toBe('focus') // the terminal alone, where 8 opens it
    // The first action queued took the grey text from the likeliest choice; the second, behind it, changed nothing.
    expect(world.offered).toEqual([CHOICES[0], CACHE])
  })

  test('in the list, a move or a removal of the next one changes the grey text; the last one gone, the choice is back', async ($, on) => {
    const world = engine(on, ['terminal'])
    await answerTurn($, world)
    for (const text of [CACHE, CHUNKS, BENCH]) await queueCopy($, world, text)
    const list = await $.ui.mount({ ...SETTINGS_MOUNT, requestId: QUEUE, surface: 'terminal' })
    const ringOn = (element: string) => $.ui.focus({ component: 'Pane', requestId: QUEUE, plugin: PLUGIN, element, origin: { kind: 'person' } })

    await ringOn('queued-3')
    await list.press({ key: 'top' })
    expect((await run($, 'queue', 'list')).text).toBe(`1. ${BENCH}\n2. ${CACHE}\n3. ${CHUNKS}`)
    expect(world.offered.at(-1)).toBe(BENCH)
    await ringOn('queued-1')
    await list.press({ key: 'top' })
    expect(world.toasts.at(-1)).toBe('Already the next one: Tab takes it into the prompt box.')

    await list.press({ key: 'drop' })
    expect(world.offered.at(-1)).toBe(CACHE)
    const offers = world.offered.length
    await ringOn('queued-2')
    await list.press({ key: 'drop' }) // not the next one: the grey text stays
    expect(world.offered.length).toBe(offers)
    await ringOn('queued-1')
    await list.press({ key: 'drop' })
    expect(world.offered.at(-1)).toBe(CHOICES[0])
    expect(await footerLine($)).toBe('focus')
    expect(world.submitted).toEqual(['speed up the parser for big files']) // nothing was sent
    await list.unmount()
  })

  test('a sent prompt that is a queued action leaves the queue, with more words after it or none; others leave it be', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await answerTurn($, world)
    for (const text of [CACHE, CHUNKS, BENCH]) await queueCopy($, world, text)

    await typed($, 'what does the loader do?')
    expect((await run($, 'queue', 'list')).text).toBe(`1. ${CACHE}\n2. ${CHUNKS}\n3. ${BENCH}`)
    await typed($, CACHE) // Tab took it, Enter sent it
    await typed($, `${CHUNKS}  Keep each chunk under 1 MB.`)
    expect((await run($, 'queue', 'list')).text).toBe(`1. ${BENCH}`)
  })

  test("after an answer the box offers the next action, not the likeliest choice, and the engine's own guess gives way", async ($, on) => {
    const world = engine(on, ['terminal'])
    await answerTurn($, world)
    await queueCopy($, world, CHUNKS)

    await answerTurn($, world, 't2')
    expect(world.requests).toHaveLength(2) // the choices are still asked for
    expect(world.offered).toEqual([CHOICES[0], CHUNKS, CHUNKS])
    await $.prompt.suggest({ text: 'engine guess', origin: { kind: 'suggestion' } })
    expect(world.offered.at(-1)).toBe(CHUNKS)
  })

  test('the footer counts the queue and the notes while the keys are on, and nothing that is empty', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    expect(await footerLine($)).toBe('focus')
    await answerTurn($, world)
    for (const text of [CACHE, CHUNKS, BENCH]) await queueCopy($, world, text)
    await run($, 'note', 'Keep the cache under 10 MB')
    expect(await footerLine($)).toBe('focus & 3 queued & 1 note')
    expect(footerCounts(0, 2)).toEqual(['2 notes'])
    expect(footerCounts(1, 0)).toEqual(['1 queued'])
  })

  test('with the keys switched off the footer counts nothing', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { noteButton: false }, queue: [{ id: 'a', text: 'Ship it', at: 1, root: '/work/parser' }] })
    await answerTurn($, world)
    expect(await footerLine($)).toBe('focus')
  })

  test('each project keeps its own queue, read from the store, where junk is passed over', async ($, on) => {
    const AT = 1_700_000_000_000
    const world = engine(on, ['terminal'], {
      showsSuggestions: false,
      stored: { suggest: false },
      queue: [1, 'x', null, { id: 'a', text: 'Ship the release notes', at: AT, root: '/work/parser' }, { id: 'b', text: 'Fix the boss wave', at: AT, root: '/work/game' }],
    })
    await answerTurn($, world) // the answer's end reads the queue afresh
    expect(await footerLine($)).toBe('focus & 1 queued')
    expect((await run($, 'queue', 'list')).text).toBe('1. Ship the release notes')

    expect((await run($, 'queue', CACHE)).text).toBe(`Queued: ${CACHE} (2 in the queue, 8 to view)`)
    world.root = '/work/game'
    expect((await run($, 'queue', 'list')).text).toBe('1. Fix the boss wave')
    world.root = '/work/parser'
    expect((await run($, 'queue', 'list')).text).toBe(`1. Ship the release notes\n2. ${CACHE}`)
  })

  test('/queue <text> queues it, once; /queue clear empties this project’s queue; a full one says so', async ($, on) => {
    engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    expect((await run($, 'queue', 'list')).text).toBe(EMPTY)
    expect((await run($, 'queue', 'Ship it')).text).toBe('Queued: Ship it (1 in the queue, 8 to view)')
    expect((await run($, 'queue', '  Ship   it ')).text).toBe('Already queued: Ship it (1 in the queue, 8 to view)')
    expect((await run($, 'queue', 'clear')).text).toBe('Took 1 action off the queue.')
    expect((await run($, 'queue', 'clear')).text).toBe('Nothing queued to clear.')

    for (let n = 1; n <= 20; n += 1) await run($, 'queue', `Action ${n}`)
    expect((await run($, 'queue', 'One too many')).text).toBe('The queue is full (20 for this project): send one or take one off first.')
  })

  test('/queue list answers with the queue as lines, where no surface draws as well', async ($, on) => {
    engine(on, NOTHING_DRAWS, { showsSuggestions: false, stored: { suggest: false } })
    await run($, 'queue', CACHE)
    await run($, 'queue', BENCH)
    expect((await run($, 'queue', 'list')).text).toBe(`1. ${CACHE}\n2. ${BENCH}`)
  })
})

describe('the setup', () => {
  const SETUP = 'companion-setup'
  const NUDGE = 'new here? /companion-setup'
  const KEYBINDINGS = '/Users/dev/.claude/keybindings.json' // the mock's path: slashes, no drive
  const BOTH = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'alt+q': 'command:queue', 'alt+n': 'command:note' } }] })
  const FULLSCREEN = { columns: 100, rows: 30, isFullscreen: true }
  const setup = ($: Engine, isFullscreen = false) =>
    $.command.run({ command: 'companion-setup', args: '', origin: { kind: 'composer' }, presentation: { ...PRESENTATION, isFullscreen } })
  const mountSetup = ($: Engine) => $.ui.mount({ ...SETTINGS_MOUNT, requestId: SETUP, surface: 'terminal' })
  const label = async (pane: Drawn, key: string) => {
    const found = await pane.find({ key })
    return typeof found?.props.label === 'string' ? found.props.label : undefined
  }

  test('the hint line under the prompt box invites to /companion-setup until it is opened once', async ($, on) => {
    engine(on, ['terminal'], { showsSuggestions: false })
    await typed($, 'speed up the parser')
    expect(await hintLine($)).toBe(NUDGE)
    await setup($)
    expect(await hintLine($)).toBeUndefined()
  })

  test('the hint line invites to nothing once both keys are bound and fullscreen is on', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, keybindings: BOTH })
    await typed($, 'speed up the parser')
    await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    expect((await hintLine($, IDLE, 'terminal', FULLSCREEN)) ?? '').not.toContain(NUDGE)
    expect(await hintLine($)).toContain(NUDGE) // the main screen: fullscreen is still to turn on
  })

  test('/companion-setup opens a pane with both steps ticked; Enter unticks one, and a applies the rest', async ($, on) => {
    const world = engine(on, ['terminal'])
    expect((await setup($)).text).toBe('Companion setup opened.')
    expect(world.openedWith).toEqual([{ id: SETUP, title: 'Companion setup', focus: true, closeOnEscape: true, holdToasts: true, rows: 9 }])

    const pane = await mountSetup($)
    expect((await pane.find({ key: 'title' }))?.text).toBe('Companion setup · ↑↓ to move · Enter ticks · a applies · Esc closes')
    expect(await label(pane, 'fullscreen')).toMatch(/^\[x\] Fullscreen: click suggestions/)
    expect(await label(pane, 'keys')).toMatch(/^\[x\] Alt\+Q queues, Alt\+N keeps what you copied/)
    expect((await pane.find({ key: 'apply' }))?.props).toMatchObject({ plain: true, hotkey: 'a' })
    await pane.press({ key: 'keys' })
    await pane.redraw()
    expect(await label(pane, 'keys')).toMatch(/^\[ \] Alt\+Q/)

    await pane.press({ key: 'apply' })
    await pane.unmount()
    expect(world.written).toEqual([]) // the keys were unticked
    expect(world.closed).toEqual([SETUP])
    expect(world.toasts.at(-1)).toBe('Switching to fullscreen…')
    expect(world.commands).toEqual(['/tui fullscreen'])
  })

  test('applying binds Alt+Q and Alt+N in a new keybindings file, and the hints name them', async ($, on) => {
    const world = engine(on, ['terminal'])
    await setup($)
    const pane = await mountSetup($)
    await pane.press({ key: 'apply' })
    await pane.unmount()

    expect(world.written.map(file => file.path)).toEqual([KEYBINDINGS])
    expect(JSON.parse(world.written[0]?.text ?? '')).toEqual({
      $schema: 'https://www.schemastore.org/claude-code-keybindings.json',
      $docs: 'https://code.claude.com/docs/en/keybindings',
      bindings: [{ context: 'Chat', bindings: { 'alt+q': 'command:queue', 'alt+n': 'command:note' } }],
    })
    expect(world.toasts.at(-1)).toBe('Bound Alt+Q and Alt+N. Switching to fullscreen…')
    expect((await $.command.run({ command: 'queue', args: 'list', origin: { kind: 'composer' }, presentation: PRESENTATION })).text).toContain('press Alt+Q')
  })

  test('applying keeps the person’s own bindings and leaves a key they use for something else alone', async ($, on) => {
    const own = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor', 'alt+q': 'chat:stash' } }] })
    const world = engine(on, ['terminal'], { keybindings: own })
    await setup($)
    const pane = await mountSetup($)
    await pane.press({ key: 'apply' })
    await pane.unmount()

    expect(JSON.parse(world.written[0]?.text ?? '')).toEqual({
      bindings: [{ context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor', 'alt+q': 'chat:stash', 'alt+n': 'command:note' } }],
    })
    expect(world.toasts.at(-1)).toBe(
      'Bound Alt+N. Alt+Q does something else for you already: bind /queue or /note to another key in keybindings.json. Switching to fullscreen…',
    )
  })

  test('a keybindings file that is not JSON is left alone', async ($, on) => {
    const world = engine(on, ['terminal'], { keybindings: '{ nope' })
    await setup($)
    const pane = await mountSetup($)
    await pane.press({ key: 'apply' })
    await pane.unmount()
    expect(world.written).toEqual([])
    expect(world.toasts.at(-1)).toBe('keybindings.json is not a keybindings file Companion can read, so it was left alone. Switching to fullscreen…')
  })

  test('in fullscreen with both keys bound, the pane says so and applying changes nothing', async ($, on) => {
    const world = engine(on, ['terminal'], { keybindings: BOTH })
    await setup($, true)
    const pane = await mountSetup($)
    expect((await pane.find({ key: 'fullscreenDone' }))?.text).toBe('✓ Fullscreen is on: click suggestions, the queue and notes, and select words to queue them')
    expect((await pane.find({ key: 'keysDone' }))?.text).toBe('✓ Alt+Q queues and Alt+N keeps what you copied')
    expect(await pane.find({ key: 'fullscreen' })).toBeUndefined()
    await pane.press({ key: 'apply' })
    await pane.unmount()
    expect(world.toasts.at(-1)).toBe('Nothing to change: Companion is set up.')
    expect(world.written).toEqual([])
    expect(world.commands).toEqual([])
  })

  test('outside the terminal the setup says it belongs to the CLI', async ($, on) => {
    const world = engine(on, ['vscode'])
    expect((await setup($)).text).toBe('Companion’s setup is for the Claude Code CLI in a terminal, where fullscreen and the Alt keys live.')
    expect(world.opened).toEqual([])
  })

  test('the keys are added only where their action has no key yet', () => {
    const queueOnW = JSON.stringify({ bindings: [{ context: 'Global', bindings: { 'alt+w': 'command:queue' } }] })
    expect(withCompanionKeys(queueOnW)?.added).toEqual(['Alt+N'])
    expect(withCompanionKeys(BOTH)?.added).toEqual([])
    expect(withCompanionKeys('[1, 2]')).toBeNull()
  })
})

describe('the meters', () => {
  const DAY = 86_400_000
  const USAGE = { model: 'claude-opus-5-5', input_tokens: 2_000, output_tokens: 300, cache_read_input_tokens: 96_000, cache_creation_input_tokens: 2_000 }
  /** The engine measures the session: the context's fill, and the windows a subscription reports, the week's if given. */
  const measure = ($: Engine, percent: number, tokens: number, week?: { percentUsed: number; resetsAt?: string }) =>
    $.session.measure({
      context: { tokens, percent, window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 12 }, ...(week === undefined ? [] : [{ kind: 'seven_day', ...week }])],
      changed: ['context', 'rateLimits'],
    })

  test('the bottom line reads the context and the week, and says when the week resets once it is mostly used', async ($, on) => {
    engine(on, ['terminal'], { showsSuggestions: false })
    expect(await meterLine($)).toBeUndefined()
    await measure($, 42, 84_000, { percentUsed: 31.5, resetsAt: new Date(1_000 + 3 * DAY).toISOString() })
    // Five cells each, filled as far as used, in the theme's success colour while under 60%; the footer keeps its own.
    expect(await meterLine($)).toBe('ctx ▰▰▱▱▱ 42% & week ▰▰▱▱▱ 32%')
    expect(await meterColorOf($, 'ctxMeter')).toBe('success')
    expect(await footerLine($)).toBe('focus')
    // The meters are the hint site's last line, under the tips.
    const hint = await $.ui.mount({ plugin: PLUGIN, component: 'PromptHint', surface: 'terminal', props: { ...IDLE, hint: '? for shortcuts' }, viewport: WIDE })
    const boxes = (await hint.findAll({ type: 'Box' })).map(box => box.props.key)
    expect(boxes.indexOf('meters')).toBeGreaterThan(boxes.indexOf('tips'))
    expect(boxes.indexOf('tips')).toBeGreaterThan(boxes.indexOf('keys'))
    expect((await hint.find({ key: 'tips' }))?.props.width).toBe(120 - 6)
    await hint.unmount()
    await measure($, 64, 128_000, { percentUsed: 84, resetsAt: new Date(1_000 + 2 * DAY).toISOString() })
    expect(await meterLine($)).toBe('ctx ▰▰▰▱▱ 64% & week ▰▰▰▰▱ 84% resets in 2 d')
    expect(await meterColorOf($, 'ctxMeter')).toBe('warning')
    expect(await meterColorOf($, 'weekMeter')).toBe('error')
    // Off a subscription there is no week, and the five-hour window never shows.
    await measure($, 3, 6_000)
    expect(await meterLine($)).toBe('ctx ▰▱▱▱▱ 3%')
    expect(meterCells(0)).toBe(0)
    expect(meterCells(100)).toBe(5)
    expect(await meterLine($, 'desktop')).toBeUndefined()
    expect(resetsIn(new Date(1_000 + 5 * 3_600_000).toISOString(), 1_000)).toBe('in 5 h')
    expect(resetsIn(new Date(1_000 + 40 * 60_000).toISOString(), 1_000)).toBe('in 40 min')
    expect(resetsIn('not a date', 1_000)).toBeNull()
  })

  test('past 60% the line under the prompt says what each message sends again, and past 80% a toast says it once', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    await measure($, 55, 110_000)
    expect(await hintLine($)).not.toMatch(/^context/)
    await measure($, 64, 128_000)
    // A line of its own, over the other tips.
    expect(await hintLine($)).toBe('context 64%: each message sends 128k tokens again · /compact keeps the gist, /clear starts fresh\nnew here? /companion-setup')
    const CONTEXT = 'context 74%: each message sends 738k tokens again · /compact keeps the gist, /clear starts fresh'
    const facts = { context: CONTEXT, choices: 0, hasKept: true, isSetUp: false, keys: { queue: null, note: null } }
    expect(tipLines({ numberKeys: true, onPress: 'send', noteButton: true }, facts)).toEqual([CONTEXT, 'new here? /companion-setup', 'Copy text, then /queue to queue or /note to note'])
    expect(world.toasts).toEqual([])
    await measure($, 82, 164_000)
    await measure($, 85, 170_000)
    expect(world.toasts).toEqual(['Context 82% full: each message sends 164k tokens again. /compact keeps the gist, /clear starts fresh.'])
    // Compacted under 60%, the toast may come again.
    await measure($, 40, 80_000)
    expect(await hintLine($)).not.toMatch(/^context/)
    await measure($, 81, 162_000)
    expect(world.toasts).toHaveLength(2)
  })

  test('each end line adds what its turn cost and how much came from the cache, after what it ran on', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { route: true }, grades: { [QUESTION]: 'easy' } })
    world.usd = 1.2
    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...OPUS_MAX })
    world.usd = 1.24
    await $.turn.complete({ answer: REPLY, durationMs: 4_200, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE })
    expect(await endWords($, 4_200)).toBe('Easy task · Haiku 5.5 at low effort · $0.04 · 96% cached')
    // The cache share in colour: the theme's success when most came from the cache.
    const end = await $.ui.mount({ plugin: PLUGIN, component: 'TurnDuration', surface: 'terminal', props: { word: 'Baked', durationMs: 4_200 }, viewport: WIDE })
    expect((await end.find({ type: 'Text', text: '96% cached' }))?.props.color).toBe('success')
    await end.unmount()
    expect([cacheColor('written'), cacheColor(60), cacheColor(20)]).toEqual(['warning', 'warning', 'error'])
    // Cut to a narrow row, the line is drawn dim alone.
    expect(await endWords($, 4_200, 80)).toBe('Easy task · Haiku 5.5 at low effo…')
    expect(turnCost(0.004, undefined)).toBe('<$0.01')
    // A first message writes the cache it then reads from.
    expect(turnCost(0.26, { ...USAGE, input_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 20_000 })).toBe('$0.26 · cache written')
    expect(turnCost(null, { ...USAGE, input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBeNull()
  })

  test('with the meters off the footer, the tips and the end lines read nothing of them', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { meters: false } })
    world.usd = 1.2
    await measure($, 64, 128_000, { percentUsed: 31 })
    expect(await footerLine($)).toBe('focus')
    expect(await hintLine($)).not.toMatch(/^context/)
    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    world.usd = 1.24
    await $.turn.complete({ answer: REPLY, durationMs: 4_200, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE })
    expect(await endWords($, 4_200)).toBeUndefined()
  })

  test('idle an hour after an answer, the line under the prompt says the next message reads it all again at full price', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, contextTokens: 128_000 })
    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    await world.clock.advance(59 * 60_000)
    expect(await hintLine($)).not.toMatch(/^idle/)
    await world.clock.advance(60_000)
    expect(await hintLine($)).toMatch(/^idle 1 h: the cache has likely expired, so your next message reads 128k tokens again at full price\n/)
    // A turn warms it again.
    await $.turn.start({ text: 'and then?', turnId: 't2' })
    expect(await hintLine($)).not.toMatch(/^idle/)
  })

  test('the cold cache warning follows the time picked', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, contextTokens: 128_000, stored: { coldAfter: '5' } })
    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    await world.clock.advance(5 * 60_000)
    expect(await hintLine($)).toMatch(/^idle 5 min: /)
  })

  test('switched off, the cold cache warning never comes', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, contextTokens: 128_000, stored: { coldAfter: 'off' } })
    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    await world.clock.advance(3 * 3_600_000)
    expect(await hintLine($)).not.toMatch(/^idle/)
  })

  test('a small conversation gets no cold cache warning: reading it again costs little', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, contextTokens: 8_000 })
    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    await world.clock.advance(3 * 3_600_000)
    expect(await hintLine($)).not.toMatch(/^idle/)
  })

  test('auto-compact runs /compact once past the fill picked, and again only after the fill dropped under it', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { compactAt: '80' } })
    await measure($, 75, 150_000)
    await world.clock.advance(1)
    expect(world.compacted).toBe(0)
    await measure($, 85, 170_000)
    await world.clock.advance(1)
    expect(world.compacted).toBe(1)
    expect(world.toasts).toContain('Context 85% full: compacting, as /companion is set to.')
    // Still past it after compacting: not again and again.
    await measure($, 83, 166_000)
    await world.clock.advance(1)
    expect(world.compacted).toBe(1)
    await measure($, 30, 60_000)
    await measure($, 81, 162_000)
    await world.clock.advance(1)
    expect(world.compacted).toBe(2)
  })

  test('auto-compact waits while an answer runs', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { compactAt: '80' } })
    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await measure($, 85, 170_000)
    await world.clock.advance(1)
    expect(world.compacted).toBe(0)
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await measure($, 85, 170_000)
    await world.clock.advance(1)
    expect(world.compacted).toBe(1)
  })

  test('auto-compact is off unless picked', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    await measure($, 95, 190_000)
    await world.clock.advance(1)
    expect(world.compacted).toBe(0)
  })
})

describe('a fresh start, the done alert and the context X-ray', () => {
  const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })
  const CONVERSATION: SessionMessage[] = [
    { role: 'user', text: 'speed up the parser for big files', toolUses: [] },
    {
      role: 'assistant',
      text: 'Big files now stream; the tests pass.',
      toolUses: [
        { tool_use_id: 'a', tool: 'Read', input: { file_path: '/work/parser/src/parser.ts' }, text: 'x'.repeat(48_000) },
        { tool_use_id: 'b', tool: 'Edit', input: { file_path: '/work/parser/src/parser.ts', old_string: 'a', new_string: 'b' }, text: 'ok' },
        { tool_use_id: 'c', tool: 'Bash', input: { command: 'npm test' }, text: 'y'.repeat(32_000) },
        { tool_use_id: 'd', tool: 'Write', input: { file_path: '/work/parser/bench/big.test.ts', content: '' }, text: 'ok' },
        { tool_use_id: 'e', tool: 'Edit', input: { file_path: '/work/parser/src/parser.ts', old_string: 'b', new_string: 'c' }, text: 'ok' },
      ],
    },
  ]
  const HANDOFF = 'Task: speed up the parser for big files.\n\nDone: streaming, tests pass.\nNext: cache tokens by hash.\nNotes: none'

  test('/fresh writes a handoff from the conversation, clears it, and puts the handoff in the prompt box with the files changed', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    world.messages = CONVERSATION
    world.handoff = HANDOFF
    expect((await run($, 'fresh')).text).toBe('Writing a handoff, then starting fresh.')
    await world.clock.advance(1)

    expect(world.handedOver).toEqual(['Person: speed up the parser for big files\n\nClaude: Big files now stream; the tests pass.'])
    expect(world.commands).toEqual(['/clear'])
    expect(world.box).toBe(
      [
        'Picking up from an earlier conversation, cleared to save tokens:',
        'Task: speed up the parser for big files.',
        'Done: streaming, tests pass.',
        'Next: cache tokens by hash.',
        'Notes: none',
        'Files changed: bench/big.test.ts, src/parser.ts',
      ].join('\n'),
    )
    expect(world.toasts.at(-1)).toBe('Cleared. The handoff is in the prompt box: edit it, or press Enter.')
  })

  test('/fresh clears nothing where the handoff could not be written', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    world.messages = CONVERSATION
    await run($, 'fresh')
    await world.clock.advance(1)
    expect(world.commands).toEqual([])
    expect(world.toasts.at(-1)).toBe('Could not write the handoff, so nothing was cleared.')
  })

  test('/fresh waits for a running answer, and an empty conversation has nothing to hand over', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    world.handoff = HANDOFF
    await run($, 'fresh')
    await world.clock.advance(1)
    expect(world.toasts.at(-1)).toBe('Nothing to hand over yet: this conversation is empty.')
    world.messages = CONVERSATION
    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await run($, 'fresh')
    await world.clock.advance(1)
    expect(world.toasts.at(-1)).toBe('An answer is still running: /fresh once it ends.')
    expect(world.commands).toEqual([])
  })

  test('where the conversation will not clear, the handoff is copied to paste after a /clear', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, commandsFail: true })
    world.messages = CONVERSATION
    world.handoff = HANDOFF
    await run($, 'fresh')
    await world.clock.advance(1)
    expect(world.copied.at(-1)).toMatch(/^Picking up from an earlier conversation/)
    expect(world.toasts.at(-1)).toBe('Could not clear the conversation: type /clear, then paste the handoff, which is copied.')
  })

  test('an answer that ran past a minute raises a notification; a shorter one does not', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false } })
    await typed($, QUESTION)
    await $.turn.complete({ answer: 'Tests pass.\n\nDetails follow.', durationMs: 75_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.notified).toEqual(['Done after 1m 15s: Tests pass. Details follow.'])
    await $.turn.complete({ answer: 'Quick one.', durationMs: 20_000, isAborted: false, turnId: 't2', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.notified).toHaveLength(1)
    expect(world.ran).toEqual([])

    // A terminal with no notification channel on Windows: the system's sound instead.
    world.notifyResult = { isSent: false, reason: 'no-channel' }
    await $.turn.complete({ answer: 'Done.', durationMs: 90_000, isAborted: false, turnId: 't3', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.ran.at(-1)?.[0]).toBe('powershell.exe')
    expect(world.ran.at(-1)?.join(' ')).toContain('Windows Notify System Generic.wav')
    // Notifications the person switched off stay off: no sound either.
    world.notifyResult = { isSent: false, reason: 'disabled' }
    const sounds = world.ran.length
    await $.turn.complete({ answer: 'Done.', durationMs: 90_000, isAborted: false, turnId: 't4', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.ran).toHaveLength(sounds)
    expect(durationText(45_000)).toBe('45s')
  })

  test('after /clear, what the footer and the hint lines draw from is read again: no session.start follows a clear', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, queue: [{ id: 'a', text: 'Ship it', at: 1, root: '/work/parser' }] })
    on('session.end', (_, e) => ({ sessionId: e.sessionId }))
    expect(await footerLine($)).toBe('focus') // nothing read yet
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.advance(250)
    expect(await footerLine($)).toBe('focus & 1 queued')
  })

  test('the done alert follows its setting, and an interrupted answer raises none', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false, stored: { suggest: false, doneAfter: 'off' } })
    await typed($, QUESTION)
    await $.turn.complete({ answer: 'Done.', durationMs: 600_000, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)
    expect(world.notified).toEqual([])
  })

  test('/ctx opens the X-ray: each category a bar in its colour, the biggest outputs, the MCP servers, the memory files and a tip', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    world.messages = CONVERSATION
    world.breakdown = {
      categories: [
        { name: 'System prompt', tokens: 3_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'MCP tools', tokens: 30_000, color: 'warning', isDeferred: false, kind: 'used' },
        { name: 'MCP tools (deferred)', tokens: 9_000, color: 'inactive', isDeferred: true, kind: 'deferred' },
        { name: 'Memory files', tokens: 6_000, color: 'claude', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 61_000, color: 'suggestion', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 100_000, color: 'inactive', isDeferred: false, kind: 'free' },
      ],
      totalTokens: 100_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'model-default',
      percentage: 50,
      gridRows: [],
      model: 'Opus 5.5',
      memoryFiles: [
        { path: 'C:/Users/dev/.claude/CLAUDE.md', type: 'User', tokens: 2_000 },
        { path: '/work/parser/CLAUDE.md', type: 'Project', tokens: 4_000 },
      ],
      mcpTools: [
        { name: 'manage', serverName: 'github', tokens: 20_000, isLoaded: true },
        { name: 'navigate', serverName: 'chrome', tokens: 10_000, isLoaded: true },
        { name: 'send', serverName: 'gmail', tokens: 9_000, isLoaded: false },
      ],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null,
    }

    expect((await run($, 'ctx')).text).toBe('Context X-ray opened.')
    expect(world.openedWith.at(-1)).toEqual({ id: 'companion-xray', title: 'Context X-ray', focus: true, closeOnEscape: true, holdToasts: true, rows: 5 + 7 })
    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, requestId: 'companion-xray', surface: 'terminal' })
    expect((await pane.find({ key: 'title' }))?.text).toBe('Context X-ray · 100k of 200k (50%) · Esc closes')
    expect((await pane.find({ key: 'row-4' }))?.text).toBe(`${'Messages'.padEnd(22)}▰▰▰▱▱▱▱▱▱▱ 61k`)
    expect(await pane.find({ type: 'Text', text: '▰▰▰' })).toMatchObject({ props: { color: 'suggestion' } })
    expect((await pane.find({ key: 'row-5' }))?.text).toBe(`${'Free space'.padEnd(22)}▰▰▰▰▰▱▱▱▱▱ 100k`) // dim: room, not a cost
    expect((await pane.find({ key: 'outputs' }))?.text).toBe('Biggest tool outputs: Read src/parser.ts 12k · Bash npm test 8k')
    expect((await pane.find({ key: 'servers' }))?.text).toBe('MCP servers: github 20k · chrome 10k')
    expect((await pane.find({ key: 'memory' }))?.text).toBe('Memory files: CLAUDE.md 4k · .claude/CLAUDE.md 2k')
    expect((await pane.find({ key: 'tip' }))?.text).toBe('MCP tool lists take 30k of every message: turn off the servers you do not use in /mcp.')
    await pane.unmount()

    expect(xrayTip({ window: 200_000, percent: 50, mcp: 0, memory: 12_000, biggestMemory: 'CLAUDE.md' })).toBe('Memory files take 12k of every message: trim the biggest, CLAUDE.md.')
    expect(xrayTip({ window: 200_000, percent: 50, mcp: 0, memory: 0 })).toBe('Most of it is the conversation: /compact keeps the gist, /fresh starts over with a handoff.')
    expect(xrayTip({ window: 200_000, percent: 10, mcp: 0, memory: 0 })).toBe('Plenty of room: nothing to cut yet.')
  })

  test('/ctx before any measure says so, and where no pane is placed answers as text', async ($, on) => {
    const world = engine(on, ['terminal'], { showsSuggestions: false })
    expect((await run($, 'ctx')).text).toBe('No measure of the context yet: send a message first.')
    world.breakdown = {
      categories: [{ name: 'Messages', tokens: 20_000, color: 'suggestion', isDeferred: false, kind: 'used' }],
      totalTokens: 20_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'model-default',
      percentage: 10,
      gridRows: [],
      model: 'Opus 5.5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null,
    }
    expect(xrayText(xrayOf(world.breakdown, [], '/work/parser'))).toBe('Context X-ray: 20k of 200k (10%)\nMessages: 20k\nPlenty of room: nothing to cut yet.')
  })
})
