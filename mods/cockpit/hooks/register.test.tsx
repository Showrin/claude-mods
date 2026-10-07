import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { bar, color, count, label, resetLabel, sumTranscript, topCategories, usd, zone } from './register'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

test('helpers format limits', () => {
  expect(label('five_hour')).toBe('5h')
  expect(label('seven_day')).toBe('Week')
  expect(label('spend_limit')).toBe('On-demand')
  expect(usd(1.234)).toBe('$1.23')
  expect(count(950)).toBe('950')
  expect(count(3000)).toBe('3k')
  expect(count(3240)).toBe('3.2k')
  expect(count(1250000)).toBe('1.3M')
  expect(color(95)).toBe('red')
  expect(color(75)).toBe('yellow')
  expect(color(10)).toBe('green')
  const now = Date.parse('2026-10-07T10:00:00Z')
  expect(bar(50)).toEqual({ used: '▬▬▬▬▬', rest: '─────' })
  expect(resetLabel('2026-10-07T12:30:00Z', now, 'Asia/Dhaka')).toBe('⏳ 06:30 PM (2h 30m)')
  expect(resetLabel('2026-10-07T12:30:00Z', now, 'UTC')).toBe('⏳ 12:30 PM (2h 30m)')
  expect(resetLabel('2026-10-10T12:00:00Z', now, 'UTC')).toBe('⏳ Sat 12:00 PM (3d 2h)')
  expect(resetLabel(undefined, now)).toBe('')
  expect(
    topCategories([
      { name: 'Free space', tokens: 100000, color: 'inactive', kind: 'free' },
      { name: 'System prompt', tokens: 3000, color: 'promptBorder', kind: 'used' },
      { name: 'Messages', tokens: 60000, color: 'permission', kind: 'used' },
      { name: 'MCP tools', tokens: 9000, color: 'ide', kind: 'used' },
      { name: 'System tools', tokens: 18000, color: 'inactive', kind: 'used' },
      { name: 'Memory files', tokens: 1000, color: 'claude', kind: 'used' },
      { name: 'Deferred', tokens: 5000, color: 'inactive', kind: 'deferred' },
    ]).map(c => c.name),
  ).toEqual(['Messages', 'System tools', 'MCP tools', 'System prompt'])
  const usage = (i: number, o: number) =>
    JSON.stringify({
      type: 'assistant',
      message: { id: `m${i}`, usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } },
    })
  const transcript = [usage(1, 5), usage(1, 50), '{"type":"user"}', usage(2, 7), '{"type":"assis'].join('\n')
  expect(sumTranscript(transcript)).toEqual({ read: 3, write: 57, cacheRead: 200, cacheWrite: 20 })
  expect(zone('system')).toBeUndefined()
  expect(zone('Not/AZone')).toBeUndefined()
  expect(zone(' Asia/Dhaka ')).toBe('Asia/Dhaka')
})

const CONTEXT = {
  window: 200000,
  tokens: 90000,
  percent: 45,
  breakdown: {
    categories: [
      { name: 'Messages', tokens: 60000, color: 'permission', isDeferred: false, kind: 'used' },
      { name: 'System tools', tokens: 18000, color: 'inactive', isDeferred: false, kind: 'used' },
      { name: 'Free space', tokens: 110000, color: 'inactive', isDeferred: false, kind: 'free' },
    ],
  },
} as never

const engine = (on: On) => {
  on('clock.now', () => ({ value: Date.parse('2026-10-07T10:00:00Z') }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 1, context: CONTEXT, rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band shows used and left on ${surface}`, { options: { timezone: 'UTC' } }, async ($, on) => {
    engine(on)
    await $.session.measure({
      context: { window: 200000, tokens: 90000, percent: 45 },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 18 },
        { kind: 'five_hour', percentUsed: 62.4, resetsAt: '2026-10-07T12:30:00Z' },
      ],
      cost: { usd: 4.567 },
      changed: ['rateLimits', 'cost', 'context'],
    })

    const ui = await $.ui.mount({ plugin: 'cockpit', surface, component: 'AbovePrompt', props: PROPS })

    expect((await ui.find({ key: 'bar', text: /^5h/ }))?.text).toContain('5h ▬▬▬▬▬▬──── 38% left')
    expect((await ui.find({ key: 'reset', text: /12:30/ }))?.text).toContain('⏳ 12:30 PM (2h 30m)')
    expect((await ui.find({ key: 'seven_day' }))?.text).toContain('82% left')
    expect((await ui.find({ key: 'tokens' }))?.text).toBe('Tokens     0')
    expect((await ui.find({ key: 'context' }))?.text).toBe(
      'Context ▬▬▬▬▬───── 45% used  90k/200k🐸🐸🐸■ Messages 60k■ System tools 18k',
    )
    expect((await ui.find({ key: 'cost' }))?.text).toBe('Cost   $4.57')
  })

  test(`band sums tokens over turns on ${surface}`, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const usage = { model: 'm', cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }
    const turn = { answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as const
    await $.turn.complete({ ...turn, turnId: 'a', usage: { ...usage, input_tokens: 500, output_tokens: 1000 } })
    await $.turn.complete({ ...turn, turnId: 'b', usage: { ...usage, input_tokens: 0, output_tokens: 234 } })

    const ui = await $.ui.mount({ plugin: 'cockpit', surface, component: 'AbovePrompt', props: PROPS })
    expect((await ui.find({ key: 'io' }))?.text).toBe('Read/Write 500/1.2k')
    expect((await ui.find({ key: 'cache' }))?.text).toBe('Cache R/W    18k/1k')
    expect((await ui.find({ key: 'tokens' }))?.text).toBe('Tokens 20.7k')
  })

  test(`band waits before any reading on ${surface}`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ plugin: 'cockpit', surface, component: 'AbovePrompt', props: PROPS })

    expect(await ui.find({ text: /waiting for the first reply/ })).toBeDefined()
  })
}
