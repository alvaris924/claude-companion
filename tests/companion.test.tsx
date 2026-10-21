import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { ModelUsage, On, RenderSurface, TurnStepInput } from 'claude-code'

import { gradeTask, isOrder, nextLevel } from '../hooks/register'

const PLUGIN = 'companion'
const PANE = 'last-prompt'
const SETTINGS = 'companion-settings'
const SCROLL = { offset: 0, bodyRows: 4 }
const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: SCROLL, view: {} },
} as const
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
const HAIKU_LOW = { model: 'claude-haiku-5-5', effort: 'low' } as const
const QUESTION = 'what does the config loader do?'

/** How the engine beneath the plugins behaves in one test. */
type Setup = {
  /** The model's reply text. */
  answer?: string
  /** How long the model takes, on the mocked clock. */
  lateMs?: number
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
}

/** What the engine did beneath the plugins, as the tests read it back. */
type World = {
  clock: MockClock
  requests: { model: string; effort: string | undefined; maxTokens: number | undefined; prompt: string }[]
  /** The model and effort each request of a turn went with, as the engine beneath the plugins received it. */
  steps: { model: string; effort: TurnStepInput['effort'] }[]
  box: string
  opened: string[]
  submitted: string[]
  offered: string[]
  filled: string[]
  copied: string[]
  toasts: string[]
  ran: (readonly string[])[]
}

/**
 * What the engine does beneath the plugins in these tests: its clock, the plugin's store, the surfaces, prompt entry,
 * the models, the prompt box (what it holds, its dim suggestion, a fill), the clipboard, toasts, an empty drawing, pane
 * opening (placed wherever a surface attaches), and a Windows host whose processes all succeed.
 */
function engine(on: On, surfaces: readonly RenderSurface[], setup: Setup = {}): World {
  const { answer = CHOICES.join('\n'), lateMs = 0, showsSuggestions = true, declinedBy = [], stored, contextTokens, refused } = setup
  mock.store(on, stored === undefined ? {} : { settings: stored })
  const world: World = {
    clock: mock.clock(on, { now: 1_000 }),
    requests: [],
    steps: [],
    box: '',
    opened: [],
    submitted: [],
    offered: [],
    filled: [],
    copied: [],
    toasts: [],
    ran: [],
  }

  on('session.surfaces', () => ({ value: surfaces }))
  on('prompt.submit', (_, e) => {
    world.submitted.push(e.text)
    if (e.origin.kind === 'composer') world.box = '' // the composer empties as it sends
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('model.complete', async (_, e) => {
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
    world.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.open', (_, e) => {
    world.opened.push(e.id)
    return { value: surfaces.length > 0 ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no surface draws it' } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: contextTokens, window: 1_000_000 }, rateLimits: [] } }))
  on('turn.step', async function* (_, e) {
    world.steps.push({ model: e.model, effort: e.effort })
    if (refused?.model === e.model && refused.how === 'throws') throw new Error('this model is not available here')
    const isRefused = refused?.model === e.model
    return { turnId: e.turnId, index: e.index, answer: isRefused ? '' : 'done', toolUses: [], stopReason: isRefused ? null : ('end_turn' as const), usage: null }
  })
  on('env.get', (_, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('process.run', (_, e) => {
    world.ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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

/** The texts of the choices a mounted band or pane draws, in order: a terminal Button's label, elsewhere its Text. */
async function choicesDrawn(mounted: { find: (query: { key: string }) => Promise<Found | undefined> }): Promise<string[]> {
  const texts: string[] = []
  for (const key of ['choice-1', 'choice-2', 'choice-3', 'choice-4', 'choice-5']) {
    const found = await mounted.find({ key })
    if (found !== undefined) texts.push(found.text.length > 0 ? found.text : String(found.props.label ?? ''))
  }
  return texts
}

describe('companion', () => {
  test('the band shows the last prompt the person typed, on one line', async ($, on) => {
    engine(on, ['terminal'])

    const empty = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await empty.find({ key: 'prompt' })).toBeUndefined()
    await empty.unmount()

    await $.prompt.submit({ text: 'rename the\nconfig loader   please', wait: false, origin: { kind: 'composer' } })

    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect((await band.find({ key: 'prompt' }))?.text).toBe('rename the config loader please')
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
    expect((await band.find({ key: 'prompt' }))?.text).toBe('my real prompt')
    await band.unmount()
  })

  test('a long prompt is cut to the band width, room left for the ⚙', async ($, on) => {
    engine(on, ['terminal'])

    await $.prompt.submit({ text: 'x'.repeat(500), wait: false, origin: { kind: 'composer' } })

    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await band.find({ key: 'prompt' }))?.text ?? ''
    expect(text.length).toBe(80 - 'Last: '.length - 2)
    expect(text.endsWith('…')).toBe(true)
    await band.unmount()
  })

  test('where a surface without the band attaches (the mobile app), a pane opens, follows the latest prompt, and /last-prompt opens it again', async ($, on) => {
    const world = engine(on, ['mobile'])

    await $.prompt.submit({ text: 'first prompt', wait: false, origin: { kind: 'bridge' } })
    expect(world.opened).toEqual([PANE])

    const pane = await $.ui.mount({ ...PANE_MOUNT, surface: 'mobile' })
    expect((await pane.find({ key: 'prompt' }))?.text).toBe('first prompt')

    await $.prompt.submit({ text: 'second prompt', wait: false, origin: { kind: 'unclassified' } })
    await pane.redraw()
    expect((await pane.find({ key: 'prompt' }))?.text).toBe('second prompt')
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
    expect((await band.find({ key: 'prompt' }))?.text).toBe('merge the parser work')
    expect(await choicesDrawn(band)).toEqual([...CHOICES])
    expect((await band.find({ key: 'choice-1' }))?.props.variant).toBe('primary')
    expect((await band.find({ key: 'choice-2' }))?.props.variant).toBeUndefined()
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
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { suggest: false } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(10)

    expect(world.requests).toEqual([])
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect((await band.find({ key: 'prompt' }))?.text).toBe('merge the parser work')
    expect(await choicesDrawn(band)).toEqual([])
    await band.unmount()
  })

  test('/companion opens the settings pane, and so does the ⚙ in the band', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false })

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

    for (const surface of ['vscode', 'terminal'] as const) {
      const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface })
      expect((await pane.find({ key: 'suggest' }))?.props.value).toBe('on')
      expect((await pane.find({ key: 'model' }))?.props.value).toBe('claude-opus-5-5')
      expect((await pane.find({ key: 'effort' }))?.props.value).toBe('high')
      expect((await pane.find({ key: 'choices' }))?.props.value).toBe('2')
      expect((await pane.find({ key: 'onPress' }))?.props.value).toBe('box')
      await pane.unmount()
    }
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
    expect((await pane.find({ key: 'summary' }))?.text).toContain('Model: Sonnet 5.5')
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
    const world = engine(on, ['vscode'], { answer: long.join('\n'), showsSuggestions: false })
    const narrow = { ...BAND, props: { ...BAND.props, bodyColumns: 42 } } // what VS Code 2.1.300 reported

    const typed = 'the band looks great, but it does not show the full messages, so check the cut again please'
    await $.prompt.submit({ text: typed, wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...narrow, surface: 'vscode' })
    expect(await choicesDrawn(band)).toEqual(long)
    expect((await band.find({ key: 'prompt' }))?.text).toBe(typed)
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
    expect(cut).toBe(`${long.slice(0, 42 - 'Next: '.length - 4 - 1)}…`)
    await band.unmount()
  })

  test('the last prompt leaves out the blocks a host wraps around what the person typed', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false })
    const sent =
      '<browser_instruction>\nInstructions a browser extension adds.\n</browser_instruction>' +
      'looks great but not showing full messages\n[Image: source: /tmp/screenshot.png]\ncheck again'

    await $.prompt.submit({ text: sent, wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect((await band.find({ key: 'prompt' }))?.text).toBe('looks great but not showing full messages [image] check again')
    await band.unmount()
    expect(world.requests[0]?.prompt).toContain('looks great but not showing full messages')
    expect(world.requests[0]?.prompt).not.toContain('browser_instruction')

    // A prompt that is nothing but such a block is no prompt of the person's.
    await $.prompt.submit({ text: '<system-reminder>a reminder</system-reminder>', wait: false, origin: { kind: 'composer' } })
    const after = await $.ui.mount({ ...BAND, surface: 'vscode' })
    expect((await after.find({ key: 'prompt' }))?.text).toBe('looks great but not showing full messages [image] check again')
    await after.unmount()
  })

  test('pressing a choice sends it as the person, it becomes the last prompt, and the choices go', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await band.press({ key: 'choice-2' })
    expect(world.submitted).toEqual(['merge the parser work', CHOICES[1]])

    await band.redraw()
    expect((await band.find({ key: 'prompt' }))?.text).toBe(CHOICES[1])
    expect(await choicesDrawn(band)).toEqual([])
    await band.unmount()
  })

  test('set to "box", a click puts the choice in the prompt box: over an earlier choice, beside what the person typed', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { onPress: 'box' } })

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await band.press({ key: 'choice-2' })
    expect(world.box).toBe(CHOICES[1])
    await band.press({ key: 'choice-1' })
    expect(world.box).toBe(CHOICES[0]) // an earlier choice is replaced

    world.box = 'and then'
    await band.press({ key: 'choice-3' })
    expect(world.box).toBe(`and then ${CHOICES[2]}`) // what the person typed stays
    await band.unmount()

    expect(world.submitted).toEqual(['merge the parser work']) // nothing was sent
  })

  test('in the mobile pane the choices are buttons, and pressing one sends it', async ($, on) => {
    const world = engine(on, ['mobile'])

    await $.prompt.submit({ text: 'merge the parser work', wait: false, origin: { kind: 'bridge' } })
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.advance(1)

    const pane = await $.ui.mount({ ...PANE_MOUNT, surface: 'mobile' })
    expect(await choicesDrawn(pane)).toEqual([...CHOICES])

    await pane.press({ key: 'choice-3' })
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

describe('task routing', () => {
  test('is off by default: requests go as the engine made them, and the band shows no task', async ($, on) => {
    const world = engine(on, ['terminal'])

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(world.steps).toEqual([SONNET_HIGH])
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'task' })).toBeUndefined()
    await band.unmount()
  })

  test('a light question goes to Haiku 5.5 at low effort for every request of its turn, and the band says so', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH, 2)

    expect(world.steps).toEqual([HAIKU_LOW, HAIKU_LOW])
    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect((await band.find({ key: 'task' }))?.text).toBe('Light task: Haiku 5.5 at low effort')
      expect((await band.find({ key: 'redo' }))?.props.label).toBe('Redo on Sonnet 5.5')
      await band.unmount()
    }
  })

  test('while the turn runs the band offers no redo; after it, the redo asks the prompt again as usual', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true } })

    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...SONNET_HIGH })
    const working = await $.ui.mount({ ...BAND, surface: 'vscode', props: { ...BAND.props, isWorking: true } })
    expect((await working.find({ key: 'task' }))?.text).toBe('Light task: Haiku 5.5 at low effort')
    expect(await working.find({ key: 'redo' })).toBeUndefined()
    await working.unmount()
    await $.turn.complete({ answer: REPLY, durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await band.press({ key: 'redo' })
    expect(world.submitted).toEqual([QUESTION, QUESTION])
    await runTurn($, 't2', QUESTION, SONNET_HIGH)
    expect(world.steps).toEqual([HAIKU_LOW, SONNET_HIGH])

    await band.redraw()
    expect(await band.find({ key: 'task' })).toBeUndefined()
    await band.unmount()
  })

  test('a heavy task runs one effort level up, its follow-ups stay heavy, and a new task is graded afresh', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true } })

    const heavy = 'refactor the config loader into one module per source'
    await typed($, heavy)
    await runTurn($, 't1', heavy, SONNET_HIGH)
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await band.find({ key: 'task' }))?.text).toBe('Heavy task: Sonnet 5.5 at xhigh effort')
    expect(await band.find({ key: 'redo' })).toBeUndefined()
    await band.unmount()

    const followUp = 'also update the docs and the changelog for it please'
    await typed($, followUp)
    await runTurn($, 't2', followUp, SONNET_HIGH)

    const fresh =
      'Next I would like a short note in the README that explains where the settings live, who can change them, ' +
      'how other open sessions pick a change up, and what happens to a value that is no longer one of the options ' +
      'a picker offers, in plain words for people who have never opened the settings pane.'
    await typed($, fresh)
    await runTurn($, 't3', fresh, SONNET_HIGH)

    expect(world.steps).toEqual([{ ...SONNET_HIGH, effort: 'xhigh' }, { ...SONNET_HIGH, effort: 'xhigh' }, SONNET_HIGH])
  })

  test('with one model up picked, a heavy task moves up a model too; at the top, at max effort, it stays', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true, heavy: 'model' } })

    const heavy = 'implement the export command for the settings'
    await typed($, heavy)
    await runTurn($, 't1', heavy, SONNET_HIGH)
    const next = 'migrate the store to the new key format'
    await typed($, next)
    await runTurn($, 't2', next, { model: 'claude-fable-5-1', effort: 'max' })

    expect(world.steps).toEqual([
      { model: 'claude-opus-5-5', effort: 'xhigh' },
      { model: 'claude-fable-5-1', effort: 'max' },
    ])
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'task' })).toBeUndefined()
    await band.unmount()
  })

  test('past 100,000 tokens of conversation a task keeps the session model and effort', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true }, contextTokens: 150_000 })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    const heavy = 'rewrite the settings pane from scratch'
    await typed($, heavy)
    await runTurn($, 't2', heavy, SONNET_HIGH)

    expect(world.steps).toEqual([SONNET_HIGH, SONNET_HIGH])
  })

  test('a reply keeps a light task on Haiku; a request for work ends it', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    await typed($, 'and the tests?')
    await runTurn($, 't2', 'and the tests?', SONNET_HIGH)
    const work = 'fix the failing parser test in the loader please'
    await typed($, work)
    await runTurn($, 't3', work, SONNET_HIGH)

    expect(world.steps).toEqual([HAIKU_LOW, HAIKU_LOW, SONNET_HIGH])
  })

  test('after a light question a short order runs as usual: the work does not stay on Haiku', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    await typed($, 'add that to the docs')
    await runTurn($, 't2', 'add that to the docs', SONNET_HIGH)

    expect(world.steps).toEqual([HAIKU_LOW, SONNET_HIGH])
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'task' })).toBeUndefined()
    await band.unmount()
  })

  test('a pressed choice that asks continues a light task; one that orders work runs as usual', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true } })

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, SONNET_HIGH)
    for (const [turnId, key, text] of [['t2', 'choice-2', CHOICES[1]], ['t3', 'choice-1', CHOICES[0]]] as const) {
      await world.clock.advance(1)
      const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
      await band.press({ key })
      await band.unmount()
      await runTurn($, turnId, text, SONNET_HIGH)
    }

    expect(world.submitted).toEqual([QUESTION, CHOICES[1], CHOICES[0]])
    expect(world.steps).toEqual([HAIKU_LOW, HAIKU_LOW, SONNET_HIGH])
  })

  test('a pressed choice continues the task it answers', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true } })

    const heavy = 'refactor the config loader into one module per source'
    await typed($, heavy)
    await runTurn($, 't1', heavy, SONNET_HIGH)
    await world.clock.advance(1)
    const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await band.press({ key: 'choice-1' })
    await band.unmount()
    await runTurn($, 't2', CHOICES[0], SONNET_HIGH)

    expect(world.steps).toEqual([{ ...SONNET_HIGH, effort: 'xhigh' }, { ...SONNET_HIGH, effort: 'xhigh' }])
  })

  test('subagents, slash commands and models the plugin cannot read keep their requests', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true } })

    // A subagent's turn.
    await typed($, QUESTION)
    await $.turn.start({ text: 'look around', turnId: 'a1-t1', agentId: 'a1' })
    await step($, { turnId: 'a1-t1', index: 0, messageCount: 1, agentId: 'a1', ...SONNET_HIGH })
    // A slash command.
    const review = '/review the parser'
    await $.prompt.submit({ text: review, command: { name: 'review', args: 'the parser' }, wait: false, origin: { kind: 'composer' } })
    await runTurn($, 't1', review, SONNET_HIGH)
    // A provider's own spelling of a model, then Haiku already.
    await typed($, QUESTION)
    await runTurn($, 't3', QUESTION, { model: 'anthropic.claude-sonnet-5-5', effort: 'high' })
    await typed($, 'what does the store keep?')
    await runTurn($, 't4', 'what does the store keep?', { model: 'claude-haiku-5-5', effort: 'medium' })

    expect(world.steps).toEqual([
      SONNET_HIGH,
      SONNET_HIGH,
      { model: 'anthropic.claude-sonnet-5-5', effort: 'high' },
      { model: 'claude-haiku-5-5', effort: 'medium' },
    ])
  })

  test("an SDK host's prompt with a surface attached, as from the Claude app, is the person's and is fitted", async ($, on) => {
    const world = engine(on, ['mobile'], { stored: { route: true } })

    await $.prompt.submit({ text: QUESTION, wait: false, origin: { kind: 'sdk' } })
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(world.steps).toEqual([HAIKU_LOW])
  })

  test("a program's prompt where nothing is drawn (claude -p, the Agent SDK) keeps its model and effort", async ($, on) => {
    const world = engine(on, NOTHING_DRAWS, { stored: { route: true } })

    await $.prompt.submit({ text: QUESTION, wait: false, origin: { kind: 'sdk' } })
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(world.steps).toEqual([SONNET_HIGH])
  })

  test('a request the engine sends on another model mid-turn, a fallback, keeps that model', async ($, on) => {
    const world = engine(on, ['terminal'], { stored: { route: true } })

    await typed($, QUESTION)
    await $.turn.start({ text: QUESTION, turnId: 't1' })
    await step($, { turnId: 't1', index: 0, messageCount: 1, ...SONNET_HIGH })
    await step($, { turnId: 't1', index: 1, messageCount: 2, model: 'claude-opus-5-5', effort: 'high' })

    expect(world.steps).toEqual([HAIKU_LOW, { model: 'claude-opus-5-5', effort: 'high' }])
  })

  for (const how of ['throws', 'no-response'] as const) {
    test(`a fitted request that fails before it answers (${how}) goes again as the engine made it, and fitting stops`, async ($, on) => {
      const world = engine(on, ['terminal'], { stored: { route: true }, refused: { model: 'claude-haiku-5-5', how } })

      await typed($, QUESTION)
      await runTurn($, 't1', QUESTION, SONNET_HIGH)
      const heavy = 'refactor the config loader into one module per source'
      await typed($, heavy)
      await runTurn($, 't2', heavy, SONNET_HIGH)

      expect(world.steps).toEqual([HAIKU_LOW, SONNET_HIGH, SONNET_HIGH])
      expect(world.toasts).toEqual(['Could not send this task to Haiku 5.5, so the session runs on its own model and effort from here.'])
      const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
      expect(await band.find({ key: 'task' })).toBeUndefined()
      await band.unmount()
    })
  }

  test('where no surface attaches, the line beneath the answer says what a fitted turn ran on', async ($, on) => {
    engine(on, NOTHING_DRAWS, { stored: { route: true } })

    await typed($, QUESTION)
    const done = await runTurn($, 't1', QUESTION, SONNET_HIGH)

    expect(done.text).toBe(`Light task: Haiku 5.5 at low effort\n${ALL_THREE}`)
  })

  test('in the mobile pane a fitted turn shows with its redo', async ($, on) => {
    const world = engine(on, ['mobile'], { stored: { route: true } })

    await $.prompt.submit({ text: QUESTION, wait: false, origin: { kind: 'bridge' } })
    await runTurn($, 't1', QUESTION, SONNET_HIGH)

    const pane = await $.ui.mount({ ...PANE_MOUNT, surface: 'mobile' })
    expect((await pane.find({ key: 'task' }))?.text).toBe('Light task: Haiku 5.5 at low effort')
    await pane.press({ key: 'redo' })
    expect(world.submitted).toEqual([QUESTION, QUESTION])
    await pane.unmount()
  })

  test('the settings pane shows the routing settings and saves a pick for the next turn', async ($, on) => {
    const world = engine(on, ['vscode'], { showsSuggestions: false })

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect((await pane.find({ key: 'route' }))?.props.value).toBe('off')
    expect((await pane.find({ key: 'light' }))?.props.value).toBe('haiku')
    expect((await pane.find({ key: 'heavy' }))?.props.value).toBe('effort')
    await pane.select({ key: 'route', value: 'on' })
    await pane.select({ key: 'heavy', value: 'model' })
    await pane.redraw()
    expect((await pane.find({ key: 'route' }))?.props.value).toBe('on')
    expect((await pane.find({ key: 'heavy' }))?.props.value).toBe('model')
    await pane.unmount()

    const heavy = 'implement the export command for the settings'
    await typed($, heavy)
    await runTurn($, 't1', heavy, SONNET_HIGH)
    expect(world.steps).toEqual([{ model: 'claude-opus-5-5', effort: 'xhigh' }])
  })

  test('the settings say when the session already stands as high as the heavy pick goes', async ($, on) => {
    engine(on, ['vscode'], { showsSuggestions: false, stored: { route: true } })
    const atMax = 'Heavy tasks run as usual here: this session already runs on Opus 5.5 at max effort.'

    const pane = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'vscode' })
    expect(await pane.find({ key: 'heavyNote' })).toBeUndefined()
    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, { model: 'claude-opus-5-5', effort: 'max' })
    await pane.redraw()
    expect((await pane.find({ key: 'heavyNote' }))?.text).toBe(atMax)
    const mobile = await $.ui.mount({ ...SETTINGS_MOUNT, surface: 'mobile' })
    expect((await mobile.find({ key: 'heavyNote' }))?.text).toBe(atMax)
    await mobile.unmount()

    // One model up still has somewhere to go from Opus; from Fable at max effort it has not.
    await pane.select({ key: 'heavy', value: 'model' })
    await pane.redraw()
    expect(await pane.find({ key: 'heavyNote' })).toBeUndefined()
    await typed($, 'and the tests?')
    await runTurn($, 't2', 'and the tests?', { model: 'claude-fable-5-1', effort: 'max' })
    await pane.redraw()
    expect((await pane.find({ key: 'heavyNote' }))?.text).toBe(
      'Heavy tasks run as usual here: this session already runs on Fable 5.1 at max effort.',
    )
    await pane.unmount()
  })

  test('where no panel draws, /companion says how tasks are fitted', async ($, on) => {
    engine(on, NOTHING_DRAWS, { stored: { route: true, light: 'keep' } })
    const run = () => $.command.run({ command: 'companion', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })

    const ran = await run()
    expect(ran.text).toContain(
      'Clicking a choice: Sends it as my message · Fit to the task: on (light tasks: My model and effort; heavy tasks: My model, one effort level up)',
    )
    expect(ran.text).not.toContain('Heavy tasks run as usual')

    await typed($, QUESTION)
    await runTurn($, 't1', QUESTION, { model: 'claude-opus-5-5', effort: 'max' })
    expect((await run()).text).toContain('Heavy tasks run as usual here: this session already runs on Opus 5.5 at max effort.')
  })

  test('grading: work verbs, long prompts and many paths are heavy; plain questions light; the rest standard', () => {
    const heavy = [
      'refactor the parser into a state machine',
      'Please implement the export command',
      'migrate the store to the new key format',
      'rewrite the band from scratch',
      'review the whole codebase for dead code',
      'update src/a.ts, src/b.ts, src/c.ts and docs/index.md to the new names',
      'word '.repeat(260),
    ]
    const light = [
      QUESTION,
      'how does the cache work',
      'can you explain the settings pane?',
      'where is the band drawn?',
      'does it handle tabs?',
      'show me the diff',
      'ok, so which model writes the suggestions?',
    ]
    const standard = [
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

    expect(heavy.map(gradeTask)).toEqual(heavy.map(() => 'heavy'))
    expect(light.map(gradeTask)).toEqual(light.map(() => 'light'))
    expect(standard.map(gradeTask)).toEqual(standard.map(() => 'standard'))
  })

  test('a reply or a follow-up of heavy work continues the running task; anything else starts one', () => {
    const typedChoice = 'How does the loader pick a source for each key'
    const orderChoice = 'Run the tests before opening the parser PR'

    expect(nextLevel(QUESTION, null, [])).toEqual({ level: 'light', isNew: true })
    expect(nextLevel('yes, go ahead', 'heavy', [])).toEqual({ level: 'heavy', isNew: false })
    expect(nextLevel(`${typedChoice}?`, 'light', [typedChoice])).toEqual({ level: 'light', isNew: false })
    expect(nextLevel(`${orderChoice}.`, 'light', [orderChoice])).toEqual({ level: 'standard', isNew: true })
    expect(nextLevel(`${orderChoice}.`, 'heavy', [orderChoice])).toEqual({ level: 'heavy', isNew: false })
    expect(nextLevel('now refactor the parser', 'light', [])).toEqual({ level: 'heavy', isNew: true })
    expect(nextLevel('ok and now also update the readme and the changelog too', 'heavy', [])).toEqual({ level: 'heavy', isNew: false })
    expect(nextLevel('add a test for the parser and run the whole suite again', 'light', [])).toEqual({ level: 'standard', isNew: true })
  })

  test('after a light question an order starts a task of its own; a question or thanks continues it', () => {
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
    const replies = ['why?', 'ok thanks', 'and the tests?', 'yes, but why?', 'makes sense', 'do you know why?', 'go on']

    expect(orders.map(isOrder)).toEqual(orders.map(() => true))
    expect(replies.map(isOrder)).toEqual(replies.map(() => false))
    for (const order of orders) expect(nextLevel(order, 'light', [])).toEqual({ level: 'standard', isNew: true })
    for (const reply of replies) expect(nextLevel(reply, 'light', [])).toEqual({ level: 'light', isNew: false })
    expect(nextLevel('push the change', 'heavy', [])).toEqual({ level: 'heavy', isNew: false })
  })
})
