import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Turn } from '../types'

const last = atom({ plugin: 'turn-memo', key: 'last' } as const, null)
const pending = atom({ plugin: 'turn-memo', key: 'pending' } as const, [] as Turn[])

// 8 -> "8", 3_000 -> "3k", 3_240 -> "3.2k", 1_250_000 -> "1.3M"
export const count = (n: number) => {
  const short = (v: number, unit: string) => `${Number(v.toFixed(1))}${unit}`

  return n >= 1e6 ? short(n / 1e6, 'M') : n >= 1e3 ? short(n / 1e3, 'k') : `${n}`
}

export const usd = (amount: number) => `$${amount.toFixed(2)}`

// The memo's parts, formatted, plus the plain line's length (for the
// dashed rule above and below it, since a Box border has no top/bottom-only mode).
export const format = (turn: Turn) => {
  const tokens = count(turn.total)
  const readWrite = `${count(turn.read)}/${count(turn.write)}`
  const cacheRW = `${count(turn.cacheRead)}/${count(turn.cacheWrite)}`
  const cost = turn.costUsd === null ? '—' : usd(turn.costUsd)
  const width = `Tokens ${tokens} · Read/Write ${readWrite} · Cache R/W ${cacheRW} · Cost ${cost}`.length

  return { tokens, readWrite, cacheRW, cost, width }
}

export const register: Register = on => {
  // Read: uncached input; Write: generated output; Cache Read / Cache Write:
  // input served from and written to the prompt cache. Cost is the session's
  // running total (the API gives no per-turn price).
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || !e.usage) {
      return result
    }

    const u = e.usage
    const { cost } = await $.session.usage()
    const turn: Turn = {
      total: u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
      read: u.input_tokens,
      write: u.output_tokens,
      cacheRead: u.cache_read_input_tokens,
      cacheWrite: u.cache_creation_input_tokens,
      costUsd: cost?.usd ?? null,
    }
    // Queued, not written straight to `last`: this turn's own TurnDuration
    // row doesn't exist yet (turnId and that row's requestId are unrelated
    // ids, minted separately), so there is nothing to key the write by yet.
    await update($, pending, list => [...list, turn])

    return result
  })

  // The "Baked for 3s" row is appended as a notice right when the turn
  // closes; claiming the oldest queued turn here, in append order, is what
  // ties a turn's usage to that exact row's id, which ui.render then reads by.
  on('session.append', { door: 'notice' }, async ($, e, next) => {
    const result = await next(e)
    if (e.message.name === 'turn_duration') {
      const [turn, ...rest] = await read($, pending)
      if (turn) {
        await update($, pending, () => rest)
        await update($, { plugin: 'turn-memo', key: 'last', id: e.uuid } as const, () => turn)
      }
    }

    return result
  })

  // TurnDuration is the "Baked for 3s" line that closes a turn in the
  // terminal transcript; a memo follows it, the cost in a bright color.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const below = await next(e)
    const turn = await read($, memberOf(last, e))
    if (!turn) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const { tokens, readWrite, cacheRW, cost, width } = format(turn)
    const dashes = '╌'.repeat(width)

    return (
      <Box flexDirection="column">
        {below}
        <Box key="rule-top">
          <Text dimColor>{dashes}</Text>
        </Box>
        <Box>
          <Text color="claude">Tokens </Text>
          <Text color="white">{tokens} · </Text>
          <Text color="claude">Read/Write </Text>
          <Text color="white">{readWrite} · </Text>
          <Text color="claude">Cache R/W </Text>
          <Text color="white">{cacheRW} · </Text>
          <Text color="claude">Cost </Text>
          <Text color="greenBright" bold>
            {cost}
          </Text>
        </Box>
        <Box key="rule-bottom">
          <Text dimColor>{dashes}</Text>
        </Box>
      </Box>
    )
  })
}
