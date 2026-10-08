import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { handoffPrompt, label, resumePrompt, stamp, threshold, transcriptHandoff, tripped } from './register'

const NOW = Date.parse('2026-10-09T10:00:00Z')
const RESET = '2026-10-09T12:00:00Z'
const CWD = 'C:/proj'
const HANDOFF = `${CWD}/.claude/handoffs/handoff-2026-10-09T10-00-00.md`
const CONTEXT = { window: 200000 } as never

test('helpers', () => {
  expect(label('five_hour')).toBe('5-hour')
  expect(label('seven_day')).toBe('weekly')
  expect(threshold(96)).toBe(96)
  expect(threshold('90')).toBe(90)
  expect(threshold(undefined)).toBe(96)
  expect(threshold(250)).toBe(96)
  expect(stamp(NOW)).toBe('2026-10-09T10-00-00')

  const week = { kind: 'seven_day', percentUsed: 97, resetsAt: '2026-10-12T00:00:00Z' }
  const hour = { kind: 'five_hour', percentUsed: 99, resetsAt: RESET }
  expect(tripped([hour], 96, NOW)).toEqual(hour)
  expect(tripped([{ ...hour, percentUsed: 95.9 }], 96, NOW)).toBeUndefined()
  // Both tripped: wait out the one that resets last.
  expect(tripped([hour, week], 96, NOW)).toEqual(week)
  // A window whose reset already passed is a stale reading.
  expect(tripped([{ ...hour, resetsAt: '2026-10-09T09:00:00Z' }], 96, NOW)).toBeUndefined()
  // The on-demand window itself is never the trigger.
  expect(tripped([{ kind: 'spend_limit', percentUsed: 100, resetsAt: RESET }], 96, NOW)).toBeUndefined()

  expect(handoffPrompt({ kind: 'five_hour', percent: 96, resetsAt: RESET, pausedAt: NOW })).toContain('5-hour usage limit is at 96%')
  expect(resumePrompt('h.md', '# Doc')).toContain('saved this handoff to h.md')
  expect(resumePrompt('h.md', '# Doc').endsWith('# Doc')).toBe(true)
  expect(resumePrompt(undefined, undefined)).toContain('where you left off')
  const tail = transcriptHandoff([{ role: 'user', text: 'fix the bug', toolUses: [] }])
  expect(tail).toContain('**user**: fix the bug')
})

// The engine hands paths on in the platform's own spelling.
const slashes = (path: string) => path.replace(/\\/g, '/')

// The engine beneath the mod: what it was asked to abort, write and submit.
const engine = (on: On, store: Record<string, unknown> = {}, percentUsed = 97) => {
  const seen = { aborted: [] as string[], files: {} as Record<string, string>, submitted: [] as string[], forks: 0 }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.usage', () => ({ value: { startedAt: 1, context: CONTEXT, rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: RESET }] } }))
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

  return { seen, clock }
}

// A prompt as the person types it.
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

const measure = (percentUsed: number) => ({
  context: CONTEXT,
  rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: RESET }],
  changed: ['rateLimits' as const],
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
