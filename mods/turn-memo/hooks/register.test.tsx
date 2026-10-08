import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { count, format, usd } from './register'

test('helpers format numbers', () => {
  expect(count(950)).toBe('950')
  expect(count(3000)).toBe('3k')
  expect(count(3240)).toBe('3.2k')
  expect(count(1250000)).toBe('1.3M')
  expect(usd(1.234)).toBe('$1.23')
})

test('format sizes the dashed rule to the line it frames', () => {
  const turn = { total: 11000, read: 500, write: 1000, cacheRead: 9000, cacheWrite: 500, costUsd: 4.567 }
  expect(format(turn)).toEqual({
    tokens: '11k',
    readWrite: '500/1k',
    cacheRW: '9k/500',
    cost: '$4.57',
    width: 'Tokens 11k · Read/Write 500/1k · Cache R/W 9k/500 · Cost $4.57'.length,
  })
  expect(format({ ...turn, costUsd: null }).cost).toBe('—')
})

const engine = (on: On, costUsd: number | null = 4.567) => {
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))
  on('session.usage', () => ({
    value: { startedAt: 1, context: { window: 0 }, rateLimits: [], cost: costUsd === null ? undefined : { usd: costUsd } },
  }))
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box key="duration">
        <Text>Baked for 3s</Text>
      </Box>
    )
  })
}

const USAGE = { model: 'm', input_tokens: 500, output_tokens: 1000, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 }
const TURN_PROPS = { word: 'Baked', durationMs: 3000 }

// The engine appends a "turn_duration" notice as its own row right when a
// turn closes; that row's own uuid becomes the TurnDuration draw's requestId.
const bakedRow = ($: Parameters<Parameters<typeof test>[1]>[0], uuid: string) =>
  $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice', origin: { kind: 'model', model: 'm' }, uuid })

test('draws a memo beneath the turn-duration line, cost in a bright color', async ($, on) => {
  engine(on)
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'a', usage: USAGE })
  await bakedRow($, 'a')

  const ui = await $.ui.mount({ plugin: 'turn-memo', surface: 'terminal', component: 'TurnDuration', props: TURN_PROPS, requestId: 'a' })

  expect((await ui.find({ key: 'duration' }))?.text).toBe('Baked for 3s')
  expect((await ui.find({ text: /^Tokens/ }))?.text).toBe('Tokens 11k · Read/Write 500/1k · Cache R/W 9k/500 · Cost $4.57')

  const amount = await ui.find({ text: /^\$4\.57$/ })
  expect(amount?.text).toBe('$4.57')
  expect(amount?.props).toMatchObject({ color: 'greenBright', bold: true })

  for (const label of ['Tokens ', 'Read/Write ', 'Cache R/W ', 'Cost ']) {
    const found = await ui.find({ text: new RegExp(`^${label.replace('/', '\\/')}$`) })
    expect(found?.props).toMatchObject({ color: 'claude' })
  }

  for (const value of ['11k · ', '500/1k · ', '9k/500 · ']) {
    const found = await ui.find({ text: new RegExp(`^${value.replace(/[/.]/g, '\\$&')}$`) })
    expect(found?.props).toMatchObject({ color: 'white' })
  }

  const dashes = '╌'.repeat('Tokens 11k · Read/Write 500/1k · Cache R/W 9k/500 · Cost $4.57'.length)
  expect((await ui.find({ key: 'rule-top' }))?.text).toBe(dashes)
  expect((await ui.find({ key: 'rule-bottom' }))?.text).toBe(dashes)
})

test('shows "—" with no cost ledger', async ($, on) => {
  engine(on, null)
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'a', usage: USAGE })
  await bakedRow($, 'a')

  const ui = await $.ui.mount({ plugin: 'turn-memo', surface: 'terminal', component: 'TurnDuration', props: TURN_PROPS, requestId: 'a' })

  expect((await ui.find({ text: /^—$/ }))?.text).toBe('—')
})

test("keeps each turn's own memo, not overridden by a later turn", async ($, on) => {
  engine(on)
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'a', usage: USAGE })
  await bakedRow($, 'a')
  const a = await $.ui.mount({ plugin: 'turn-memo', surface: 'terminal', component: 'TurnDuration', props: TURN_PROPS, requestId: 'a' })
  expect((await a.find({ text: /^Tokens/ }))?.text).toBe('Tokens 11k · Read/Write 500/1k · Cache R/W 9k/500 · Cost $4.57')

  const laterUsage = { model: 'm', input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }
  await $.turn.complete({ answer: 'bye', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'b', usage: laterUsage })
  await bakedRow($, 'b')
  const b = await $.ui.mount({ plugin: 'turn-memo', surface: 'terminal', component: 'TurnDuration', props: TURN_PROPS, requestId: 'b' })
  expect((await b.find({ text: /^Tokens/ }))?.text).toBe('Tokens 10 · Read/Write 1/2 · Cache R/W 3/4 · Cost $4.57')

  // The earlier row must still show its own turn's numbers, not the later turn's.
  expect((await a.find({ text: /^Tokens/ }))?.text).toBe('Tokens 11k · Read/Write 500/1k · Cache R/W 9k/500 · Cost $4.57')
})

test('leaves the line untouched with no turn yet, a subagent turn, or no usage', async ($, on) => {
  engine(on)

  await bakedRow($, 'a')
  const ui = await $.ui.mount({ plugin: 'turn-memo', surface: 'terminal', component: 'TurnDuration', props: TURN_PROPS, requestId: 'a' })
  expect((await ui.find({ key: 'duration' }))?.text).toBe('Baked for 3s')
  expect(await ui.find({ text: /Tokens/ })).toBeUndefined()

  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'a' })
  await bakedRow($, 'b')
  expect(await ui.find({ text: /Tokens/ })).toBeUndefined()

  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'a', agentId: 'sub_1', usage: USAGE })
  await bakedRow($, 'c')
  expect(await ui.find({ text: /Tokens/ })).toBeUndefined()
})
