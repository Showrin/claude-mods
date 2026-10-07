import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { EngineInterface } from 'claude-code'

import type { Category, Context, Limit, Tokens } from '../types'

const limits = atom({ plugin: 'cockpit', key: 'limits' } as const, [])
const costUsd = atom({ plugin: 'cockpit', key: 'costUsd' } as const, null)
const minute = atom({ plugin: 'cockpit', key: 'minute' } as const, 0)
const tokens = atom({ plugin: 'cockpit', key: 'tokens' } as const, null)
const context = atom({ plugin: 'cockpit', key: 'context' } as const, null)

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'Week',
  spend_limit: 'On-demand',
}
const ORDER = ['five_hour', 'seven_day', 'spend_limit']
const BAR_WIDTH = 10
const DAY = 24 * 60 * 60 * 1000
const BORDER = '#b5664a'
const ZERO = { read: 0, write: 0, cacheRead: 0, cacheWrite: 0 }

export const label = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')

// The used part and the rest of a thin line bar, drawn in two colours.
export const bar = (percent: number) => {
  const filled = Math.min(BAR_WIDTH, Math.max(0, Math.round((percent / 100) * BAR_WIDTH)))

  // Both centred on the text's midline: a thick bar over a thin track.
  return { used: '▬'.repeat(filled), rest: '─'.repeat(BAR_WIDTH - filled) }
}

// A valid IANA name, or undefined for the system's own timezone.
export const zone = (setting: unknown) => {
  if (typeof setting !== 'string' || setting.trim() === '' || setting.trim().toLowerCase() === 'system') {
    return undefined
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: setting.trim() })

    return setting.trim()
  } catch {
    return undefined
  }
}

// 8 -> "8", 3_000 -> "3k", 3_240 -> "3.2k", 1_250_000 -> "1.3M"
export const count = (n: number) => {
  const short = (v: number, unit: string) => `${Number(v.toFixed(1))}${unit}`

  return n >= 1e6 ? short(n / 1e6, 'M') : n >= 1e3 ? short(n / 1e3, 'k') : `${n}`
}

// Pads each text on the left to the widest one's length.
export const pad = (...texts: string[]) => {
  const width = Math.max(...texts.map(t => t.length))

  return texts.map(t => t.padStart(width))
}

export const usd = (amount: number) => `$${amount.toFixed(2)}`

export const color = (percent: number) => (percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green')

export const countdown = (at: number, now: number) => {
  const minutes = Math.max(0, Math.round((at - now) / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

// "⏳ 03:31 PM (2h 30m)"; a reset more than a day out leads with its weekday.
export const resetLabel = (resetsAt: string | undefined, now: number, timeZone?: string) => {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (Number.isNaN(at)) {
    return ''
  }
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: at - now > DAY ? 'short' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(at)

  return `⏳ ${time} (${countdown(at, now)})`
}

const TOP = 4

// The biggest rows that occupy the window, largest first.
export const topCategories = (rows: readonly { name: string; tokens: number; color: string; kind: string }[]): Category[] =>
  rows
    .filter(r => r.kind === 'used' && r.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, TOP)
    .map(r => ({ name: r.name, tokens: r.tokens, color: r.color }))

// The window's fill and, as /context counts it (the local estimate, no requests), its biggest rows.
const measureContext = async ($: EngineInterface): Promise<Context> => {
  const { context: c } = await $.session.usage({ breakdown: 'summary' })

  return { window: c.window, tokens: c.tokens, percent: c.percent, top: topCategories(c.breakdown?.categories ?? []) }
}

type Counts = typeof ZERO

// Sums the usage of every reply in a transcript (JSONL). A reply is written
// once per content block, each line repeating its usage, so each message id counts once.
export const sumTranscript = (text: string): Counts => {
  const replies = new Map<string, Counts>()
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) {
      continue
    }
    try {
      const entry = JSON.parse(line)
      const u = entry?.message?.usage
      if (entry?.type !== 'assistant' || !u) {
        continue
      }
      replies.set(entry.message.id ?? entry.uuid, {
        read: u.input_tokens ?? 0,
        write: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      })
    } catch {
      // A line cut short while being written: skip it.
    }
  }
  const sum = { ...ZERO }
  for (const r of replies.values()) {
    sum.read += r.read
    sum.write += r.write
    sum.cacheRead += r.cacheRead
    sum.cacheWrite += r.cacheWrite
  }

  return sum
}

// The conversation's transcript, and its subagents', counted; null when it cannot be read.
const countTranscript = async ($: EngineInterface, cwd: string): Promise<Counts | null> => {
  try {
    const id = await $.session.id()
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const dir = `${config}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}`
    const sum = sumTranscript(await $.fs.read(`${dir}/${id}.jsonl`))
    try {
      for (const f of await $.fs.list(`${dir}/${id}/subagents`)) {
        if (f.name.endsWith('.jsonl')) {
          const sub = sumTranscript(await $.fs.read(`${dir}/${id}/subagents/${f.name}`))
          sum.read += sub.read
          sum.write += sub.write
          sum.cacheRead += sub.cacheRead
          sum.cacheWrite += sub.cacheWrite
        }
      }
    } catch {
      // No subagents ran.
    }

    return sum
  } catch {
    return null
  }
}

const sorted = (list: readonly Limit[]) =>
  [...list].sort((a, b) => {
    const ia = ORDER.indexOf(a.kind)
    const ib = ORDER.indexOf(b.kind)

    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

export const register: Register = (on, options) => {
  const timeZone = zone(options.timezone)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    await update($, limits, () => usage.rateLimits.map(l => ({ ...l })))
    await update($, costUsd, () => usage.cost?.usd ?? null)
    const measured = await measureContext($)
    await update($, context, () => measured)
    // A reload keeps the running totals; a new session (or /clear) counts its
    // transcript once, then each turn adds to that.
    const current = await read($, tokens)
    if (!(current?.startedAt === usage.startedAt && current.isFull)) {
      const counted = await countTranscript($, e.cwd)
      await update($, tokens, () =>
        counted
          ? { startedAt: usage.startedAt, isFull: true, ...counted }
          : { startedAt: usage.startedAt, isFull: false, ...ZERO },
      )
    }
    // One cheap redraw a minute keeps the reset countdowns current.
    $.clock.every(60000, () => update($, minute, n => n + 1))

    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => e.rateLimits.map(l => ({ ...l })))
    }
    if (e.changed.includes('cost')) {
      await update($, costUsd, () => e.cost?.usd ?? null)
    }
    if (e.changed.includes('context')) {
      const measured = await measureContext($)
      await update($, context, () => measured)
    }

    return next(e)
  })

  // Read: uncached input; Write: generated output; Cache Read / Cache Write:
  // input served from and written to the prompt cache. Subagents' turns count too.
  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      await update($, tokens, t =>
        t
          ? {
              ...t,
              read: t.read + u.input_tokens,
              write: t.write + u.output_tokens,
              cacheRead: t.cacheRead + u.cache_read_input_tokens,
              cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
            }
          : t,
      )
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const list = sorted(await read($, limits))
    const cost = await read($, costUsd)
    const used = await read($, tokens)
    const ctx = await read($, context)
    await read($, minute)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    const total = used ? used.read + used.write + used.cacheRead + used.cacheWrite : 0

    if (list.length === 0 && cost === null && total === 0 && ctx === null) {
      return (
        <Box>
          <Text dimColor>Usage: waiting for the first reply to report limits…</Text>
        </Box>
      )
    }

    const divider = (key: string) => (
      <Box key={key} flexDirection="column" marginX={2}>
        <Text color={BORDER}>│</Text>
        <Text color={BORDER}>│</Text>
      </Box>
    )

    const sections = list.map(l => {
      const left = Math.max(0, 100 - Math.round(l.percentUsed))
      const name = label(l.kind)
      const tone = color(l.percentUsed)
      const { used, rest } = bar(l.percentUsed)
      const reset = resetLabel(l.resetsAt, now, timeZone)

      // Two rows: the bar, then the reset time under it, both left-aligned.
      return (
        <Box key={l.kind} flexDirection="column">
          <Box key="bar">
            <Text dimColor>{name} </Text>
            <Text color={tone}>{used}</Text>
            <Text color="#3a3a3a">
              {rest}
            </Text>
            <Text color={tone} bold>
              {' '}
              {left}%
            </Text>
            <Text dimColor> left</Text>
          </Box>
          <Box key="reset">
            <Text color="#777777">{reset}</Text>
          </Box>
        </Box>
      )
    })

    if (used !== null) {
      // "Read/Write 8/3.2k" over "Cache R/W 3k/5k", the pairs right-aligned.
      const [io, cache] = pad(
        `${count(used.read)}/${count(used.write)}`,
        `${count(used.cacheRead)}/${count(used.cacheWrite)}`,
      )

      sections.push(
        <Box key="breakdown" flexDirection="column">
          <Box key="io">
            <Text dimColor>Read/Write </Text>
            <Text bold>{io}</Text>
          </Box>
          <Box key="cache">
            <Text dimColor>Cache R/W  </Text>
            <Text bold>{cache}</Text>
          </Box>
        </Box>,
      )
    }

    if (used !== null || cost !== null) {
      // Pad both rows to one width so the numbers line up on the right.
      const [tokensText, costText] = pad(count(total), cost === null ? '—' : usd(cost))

      sections.push(
        <Box key="totals" flexDirection="column">
          <Box key="tokens">
            <Text dimColor>Tokens </Text>
            <Text bold>{tokensText}</Text>
          </Box>
          <Box key="cost">
            <Text dimColor>Cost   </Text>
            <Text bold>{costText}</Text>
          </Box>
        </Box>,
      )
    }

    const usageRow = (
      <Box key="usage" flexDirection="row" flexWrap="wrap">
        {sections.flatMap((section, i) => (i === 0 ? [section] : [divider(`divider-${i}`), section]))}
      </Box>
    )

    // One bordered box: the context window on top, a rule, then the usage sections.
    const contextRow = (() => {
      if (ctx === null) {
        return null
      }
      const percent = ctx.percent ?? (ctx.tokens === undefined ? undefined : (ctx.tokens / ctx.window) * 100)
      const { used: filled, rest } = bar(percent ?? 0)
      const tone = color(percent ?? 0)

      return (
        <Box key="context" flexWrap="wrap">
          <Text dimColor>Context </Text>
          <Text color={tone}>{filled}</Text>
          <Text color="#3a3a3a">{rest}</Text>
          <Text color={tone} bold>
            {' '}
            {percent === undefined ? '—' : `${Math.round(percent)}%`}
          </Text>
          <Text dimColor> used  </Text>
          <Text bold>{ctx.tokens === undefined ? '—' : count(ctx.tokens)}</Text>
          <Text dimColor>/{count(ctx.window)}</Text>
          {ctx.top.length === 0 ? null : (
            // Hungry frogs, eating what fills the context.
            <Box key="top-divider" marginX={2}>
              <Text>🐸🐸🐸</Text>
            </Box>
          )}
          {ctx.top.map((c, i) => (
            <Box key={`top-${c.name}`} marginLeft={i === 0 ? 0 : 3}>
              <Text color={c.color}>■ </Text>
              <Text color="#777777">{c.name} </Text>
              <Text color="#aaaaaa">{count(c.tokens)}</Text>
            </Box>
          ))}
        </Box>
      )
    })()

    // The band's width less the border and padding on each side.
    const ruleWidth = Math.max(1, e.props.bodyColumns - 4)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={BORDER} paddingX={1}>
        {contextRow}
        {contextRow === null ? null : <Text color={BORDER}>{'─'.repeat(ruleWidth)}</Text>}
        {usageRow}
      </Box>
    )
  })
}
