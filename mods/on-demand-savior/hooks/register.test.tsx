import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { handoffPrompt, label, overBudget, resumePrompt, settings, spilled, stamp, transcriptHandoff, tripped } from './register'

const NOW = Date.parse('2026-10-09T10:00:00Z')
const RESET = '2026-10-09T12:00:00Z'
const CWD = 'C:/proj'
const HANDOFF = `${CWD}/.claude/handoffs/handoff-2026-10-09T10-00-00.md`
const CONTEXT = { window: 200000 } as never

test('helpers', () => {
  expect(label('five_hour')).toBe('5-hour')
  expect(label('seven_day')).toBe('weekly')
  expect(settings({})).toEqual({ fiveHour: 96, weekly: 96, budgetUsd: 0 })
  expect(settings({ fiveHourThreshold: '90', weeklyThreshold: 250, onDemandBudgetUsd: 5 })).toEqual({ fiveHour: 90, weekly: 96, budgetUsd: 5 })
  expect(settings({ onDemandBudgetUsd: -1 }).budgetUsd).toBe(0)
  expect(stamp(NOW)).toBe('2026-10-09T10-00-00')

  const week = { kind: 'seven_day', percentUsed: 97, resetsAt: '2026-10-12T00:00:00Z' }
  const hour = { kind: 'five_hour', percentUsed: 99, resetsAt: RESET }
  const s = settings({})
  expect(tripped([hour], s, NOW)).toEqual({ kind: 'five_hour', resetsAt: RESET, reason: '5-hour 99%' })
  expect(tripped([{ ...hour, percentUsed: 95.9 }], s, NOW)).toBeUndefined()
  // Both tripped: wait out the one that resets last.
  expect(tripped([hour, week], s, NOW)?.kind).toBe('seven_day')
  // Each window answers to its own threshold.
  const split = settings({ fiveHourThreshold: 100, weeklyThreshold: 90 })
  expect(tripped([hour], split, NOW)).toBeUndefined()
  expect(tripped([{ ...week, percentUsed: 91 }], split, NOW)?.reason).toBe('weekly 91%')
  // A window whose reset already passed is a stale reading.
  expect(tripped([{ ...hour, resetsAt: '2026-10-09T09:00:00Z' }], s, NOW)).toBeUndefined()
  // The on-demand window itself is never the trigger.
  expect(tripped([{ kind: 'spend_limit', percentUsed: 100, resetsAt: RESET }], s, NOW)).toBeUndefined()

  const full = { ...hour, percentUsed: 100 }
  expect(spilled([hour, full], NOW)).toEqual(full)
  expect(spilled([hour], NOW)).toBeUndefined()
  const spend = { resetsAt: RESET, startedAt: 1, baseUsd: 10 }
  expect(overBudget(full, spend, 14.99, 5)).toBeUndefined()
  expect(overBudget(full, spend, 15.2, 5)).toEqual({ kind: 'five_hour', resetsAt: RESET, reason: '$5.20 of on-demand' })

  expect(handoffPrompt({ kind: 'five_hour', reason: '5-hour 96%', resetsAt: RESET, pausedAt: NOW })).toContain('(5-hour 96%; the 5-hour limit)')
  expect(resumePrompt('h.md', '# Doc')).toContain('saved this handoff to h.md')
  expect(resumePrompt('h.md', '# Doc').endsWith('# Doc')).toBe(true)
  expect(resumePrompt(undefined, undefined)).toContain('where you left off')
  const tail = transcriptHandoff([{ role: 'user', text: 'fix the bug', toolUses: [] }])
  expect(tail).toContain('**user**: fix the bug')
})

// The engine hands paths on in the platform's own spelling.
const slashes = (path: string) => path.replace(/\\/g, '/')

// The engine beneath the mod: what it was asked to abort, write and submit.
const engine = (on: On, store: Record<string, unknown> = {}, percentUsed = 97, costUsd = 0) => {
  const seen = { aborted: [] as string[], files: {} as Record<string, string>, submitted: [] as string[], forks: 0, opened: [] as string[], closed: [] as string[], status: [] as (string | undefined)[], toasts: 0 }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  on('ui.status', (_$, e) => {
    seen.status.push(e.text)

    return { value: undefined } as never
  })
  on('ui.toast', () => {
    seen.toasts++

    return { value: undefined } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.usage', () => ({ value: { startedAt: 1, context: CONTEXT, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: RESET }], cost: { usd: costUsd } } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('turn.abort', (_$, e) => {
    seen.aborted.push(e.turnId)

    return { value: undefined }
  })
  on('model.fork', () => {
    seen.forks++

    return { value: { isAnswered: true, text: '# Handoff\nGoal: ship it', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('fs.write', (_$, e) => {
    seen.files[slashes(e.path)] = e.text

    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = seen.files[slashes(e.path)]

    return text === undefined ? { deny: 'no such file' } : { value: text }
  })
  on('prompt.submit', (_$, e) => {
    seen.submitted.push(e.text)

    return { text: e.text }
  })
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)

    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_$, e) => {
    seen.closed.push(e.id)

    return { value: undefined } as never
  })
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box key="engine">
        <Text>engine</Text>
      </Box>
    )
  })

  return { seen, clock }
}

// A prompt as the person types it.
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

const measure = (percentUsed: number, usd?: number) => ({
  context: CONTEXT,
  rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: RESET }],
  ...(usd === undefined ? {} : { cost: { usd } }),
  changed: ['rateLimits' as const, 'cost' as const],
})

test('pauses at the threshold, writes a handoff, blocks work, then resumes from it after the reset', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  await $.turn.start({ text: 'build it', turnId: 't1' })

  await $.session.measure(measure(95))
  await clock.settle()
  expect(seen.forks).toBe(0)

  await $.session.measure(measure(97))
  await clock.settle()
  expect(seen.aborted).toEqual(['t1'])
  expect(seen.files[HANDOFF]).toBe('# Handoff\nGoal: ship it')

  const dropped = await $.prompt.submit(typed('keep going'))
  expect(dropped.drop).toContain('Paused at 5-hour 97%')
  expect(seen.submitted).toEqual([])
  const denied = await $.tool.call({ tool: 'Bash', input: { command: 'ls' } } as never)
  expect(denied.deny).toContain('paused this session')

  // A second reading in the same window does not pause twice.
  await $.session.measure(measure(98))
  await clock.settle()
  expect(seen.forks).toBe(1)

  await clock.set(Date.parse(RESET) + 90_000)
  expect(seen.submitted).toHaveLength(1)
  expect(seen.submitted[0]).toContain(`saved this handoff to ${HANDOFF}`)
  expect(seen.submitted[0]).toContain('Goal: ship it')

  const passed = await $.prompt.submit(typed('thanks'))
  expect(passed.drop).toBeUndefined()
})

test('/savior off stops guarding and clears the pause; /savior on guards again at once', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  await $.session.measure(measure(97))
  await clock.settle()
  expect((await $.prompt.submit(typed('hi'))).drop).toBeDefined()

  const off = await $.command.run({ command: 'savior', args: 'off' } as never)
  expect(off.text).toContain('is off')
  expect((await $.prompt.submit(typed('hi'))).drop).toBeUndefined()

  // Off: readings past the threshold are ignored.
  await $.session.measure(measure(99))
  await clock.settle()
  expect(seen.forks).toBe(1)

  // On again: the last reading is already past it, so it pauses right away.
  await $.command.run({ command: 'savior', args: 'on' } as never)
  await clock.settle()
  expect(seen.forks).toBe(2)
  expect((await $.command.run({ command: 'savior', args: '' } as never)).text).toContain('Paused at 5-hour 97%')
})

test('/savior resume goes on before the reset', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  await $.session.measure(measure(97))
  await clock.settle()

  const resumed = await $.command.run({ command: 'savior', args: 'resume' } as never)
  expect(resumed.text).toContain('resumed')
  await clock.settle()
  expect(seen.submitted[0]).toContain('Goal: ship it')
  expect((await $.command.run({ command: 'savior', args: 'resume' } as never)).text).toContain('nothing is paused')
})

test('a pause left by an earlier session resumes once its window resets', async ($, on) => {
  const { seen, clock } = engine(on, {
    [`pause:${CWD}`]: { kind: 'five_hour', percent: 97, resetsAt: RESET, pausedAt: NOW, handoffPath: `${CWD}/old.md` },
  })
  seen.files[`${CWD}/old.md`] = '# Old handoff'
  await $.session.start({ cwd: CWD } as never)
  expect((await $.prompt.submit(typed('hi'))).drop).toBeDefined()

  await clock.set(Date.parse(RESET) + 90_000)
  expect(seen.submitted[0]).toContain('# Old handoff')
})

test('uses its own threshold per window', { options: { fiveHourThreshold: 99 } }, async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  await $.session.measure(measure(98))
  await clock.settle()
  expect(seen.forks).toBe(0)

  await $.session.measure(measure(99))
  await clock.settle()
  expect(seen.forks).toBe(1)
})

test('with a budget, lets that much on-demand usage through, then pauses', { options: { onDemandBudgetUsd: 2 } }, async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  // Past the threshold: a budget lets the window run full.
  await $.session.measure(measure(99, 10))
  await clock.settle()
  expect(seen.forks).toBe(0)

  // Full: on-demand starts, counted from the cost right now.
  await $.session.measure(measure(100, 10))
  await $.session.measure(measure(100, 11.5))
  await clock.settle()
  expect(seen.forks).toBe(0)

  await $.session.measure(measure(100, 12.1))
  await clock.settle()
  expect(seen.forks).toBe(1)
  expect((await $.command.run({ command: 'savior', args: '' } as never)).text).toContain('Paused at $2.10 of on-demand')
})

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
}

test('while paused, the band above the prompt has a button that resumes the session', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'on-demand-savior', surface, ...BAND })
    expect(await ui.find({ key: 'resume' })).toBeUndefined()
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    await ui.unmount()
  }

  await $.session.measure(measure(97))
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'on-demand-savior', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'savior' }))?.text).toContain('Paused at 5-hour 97%')
  expect((await ui.find({ key: 'resume' }))?.props).toMatchObject({ label: 'Resume now' })
  // What sits beneath in the band still draws.
  expect(await ui.find({ key: 'engine' })).toBeDefined()

  await ui.press({ key: 'resume' })
  await clock.settle()
  expect(seen.submitted[0]).toContain('Goal: ship it')
  expect(await ui.find({ key: 'resume' })).toBeUndefined()
  expect((await $.prompt.submit(typed('hi'))).drop).toBeUndefined()
})

const PANE_PROPS = {
  component: 'Pane' as const,
  requestId: 'handoff',
  props: { title: 'Handoff', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

test('a pause opens the handoff in a side pane, with the resume button', async ($, on) => {
  const { seen, clock } = engine(on)
  const { opened, closed } = seen
  await $.session.start({ cwd: CWD } as never)
  await $.session.measure(measure(97))
  await clock.settle()
  expect(opened).toEqual(['handoff'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'on-demand-savior', surface, ...PANE_PROPS })
    expect((await ui.find({ key: 'handoff' }))?.text).toContain('Goal: ship it')
    expect((await ui.find({ key: 'pane' }))?.props).toMatchObject({ paddingX: 2 })
    expect(await ui.find({ key: 'resume' })).toBeDefined()
    await ui.unmount()
  }

  // Asked for by command, it opens again at any width.
  expect((await $.command.run({ command: 'savior', args: 'handoff' } as never)).text).toContain('showing the handoff')
  expect(opened).toEqual(['handoff', 'handoff'])

  const ui = await $.ui.mount({ plugin: 'on-demand-savior', surface: 'terminal', ...PANE_PROPS })
  await ui.press({ key: 'resume' })
  await clock.settle()
  expect(seen.submitted[0]).toContain('Goal: ship it')
  expect(closed).toEqual(['handoff'])
  expect((await $.command.run({ command: 'savior', args: 'handoff' } as never)).text).toContain('no handoff')
})

test('an early resume stops the checks until that window resets', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  await $.session.measure(measure(97))
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'on-demand-savior', surface: 'terminal', ...BAND })
  await ui.press({ key: 'resume' })
  await clock.settle()
  expect(seen.submitted).toHaveLength(1)

  // Still past the threshold, and on into on-demand: no second pause.
  for (const percent of [98, 100]) {
    await $.session.measure(measure(percent))
    await clock.settle()
  }
  expect(seen.forks).toBe(1)
  expect((await $.prompt.submit(typed('go on'))).drop).toBeUndefined()
  expect((await $.command.run({ command: 'savior', args: '' } as never)).text).toContain('limit checks are off until')

  // Once the window resets, a new one is guarded again.
  await clock.set(Date.parse(RESET) + 90_000)
  await $.session.measure({ ...measure(97), rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: '2026-10-09T17:00:00Z' }] })
  await clock.settle()
  expect(seen.forks).toBe(2)
})

test('/savior on after an early resume checks again at once', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  await $.session.measure(measure(97))
  await clock.settle()
  await $.command.run({ command: 'savior', args: 'resume' } as never)
  await clock.settle()
  await $.session.measure(measure(98))
  await clock.settle()
  expect(seen.forks).toBe(1)

  await $.command.run({ command: 'savior', args: 'on' } as never)
  await clock.settle()
  expect(seen.forks).toBe(2)
})

test('shows nothing under the prompt: clears an old status line, raises no toasts', async ($, on) => {
  const { seen, clock } = engine(on)
  await $.session.start({ cwd: CWD } as never)
  await $.session.measure(measure(97))
  await clock.settle()
  await $.command.run({ command: 'savior', args: 'resume' } as never)
  await clock.settle()
  expect(seen.status).toEqual([undefined])
  expect(seen.toasts).toBe(0)
})
