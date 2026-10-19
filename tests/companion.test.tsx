import { describe, expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { ModelUsage, On, RenderSurface } from 'claude-code'

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
}

/** What the engine did beneath the plugins, as the tests read it back. */
type World = {
  clock: MockClock
  requests: { model: string; effort: string | undefined; maxTokens: number | undefined; prompt: string }[]
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
  const { answer = CHOICES.join('\n'), lateMs = 0, showsSuggestions = true, declinedBy = [], stored } = setup
  mock.store(on, stored === undefined ? {} : { settings: stored })
  const world: World = {
    clock: mock.clock(on, { now: 1_000 }),
    requests: [],
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
  on('env.get', (_, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('process.run', (_, e) => {
    world.ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return world
}

type Found = { text: string; props: Record<string, unknown> }

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
