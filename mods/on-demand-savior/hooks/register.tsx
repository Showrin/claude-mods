import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage, SessionRateLimit, Timer } from 'claude-code'

import type { Pause, Settings, Spend, Trip } from '../types'

const COMMAND = 'savior'
// The pause in force, mirrored from the store for what the band draws.
const pauseState = atom({ plugin: 'on-demand-savior', key: 'pause' } as const, null)
// The handoff's text, for the side pane.
const handoffState = atom({ plugin: 'on-demand-savior', key: 'handoff' } as const, null)
const PANE = 'handoff'
const WATCHED = ['five_hour', 'seven_day']
const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly' }
const DEFAULT_THRESHOLD = 96
// Resume a minute after the reset, so the first request lands in the new window.
const GRACE_MS = 60_000
const POLL_MS = 30_000
const DAY = 24 * 60 * 60 * 1000

export const label = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')

export const usd = (amount: number) => `$${amount.toFixed(2)}`

export const settings = (options: Record<string, unknown>): Settings => {
  const percent = (setting: unknown) => {
    const n = Number(setting)

    return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_THRESHOLD
  }
  const budget = Number(options.onDemandBudgetUsd)

  return {
    fiveHour: percent(options.fiveHourThreshold),
    weekly: percent(options.weeklyThreshold),
    budgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 0,
  }
}

// The watched windows of a reading, a window whose reset has passed being stale.
const live = (limits: readonly SessionRateLimit[], now: number) =>
  limits.filter(l => WATCHED.includes(l.kind) && l.resetsAt && Date.parse(l.resetsAt) > now)

// Of several, the window that resets last: the one to wait out.
const latest = (limits: readonly SessionRateLimit[]) =>
  [...limits].sort((a, b) => Date.parse(b.resetsAt!) - Date.parse(a.resetsAt!))[0]

// A window at or past its own threshold.
export const tripped = (limits: readonly SessionRateLimit[], s: Settings, now: number): Trip | undefined => {
  const hit = latest(live(limits, now).filter(l => l.percentUsed >= (l.kind === 'five_hour' ? s.fiveHour : s.weekly)))

  return hit && { kind: hit.kind, resetsAt: hit.resetsAt!, reason: `${label(hit.kind)} ${hit.percentUsed}%` }
}

// A window used up: past it, requests are billed as on-demand usage.
export const spilled = (limits: readonly SessionRateLimit[], now: number) =>
  latest(live(limits, now).filter(l => l.percentUsed >= 100))

// The budget spent since the window read full; undefined while there is room.
export const overBudget = (full: SessionRateLimit, spend: Spend, costUsd: number, budgetUsd: number): Trip | undefined => {
  const spent = costUsd - spend.baseUsd

  return spent >= budgetUsd ? { kind: full.kind, resetsAt: full.resetsAt!, reason: `${usd(spent)} of on-demand` } : undefined
}

export const resumesAt = (pause: Pause) => Date.parse(pause.resetsAt) + GRACE_MS

// "3:31 PM", or "Sat 3:31 PM" when more than a day out.
export const clockTime = (at: number, now: number) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: at - now > DAY ? 'short' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  }).format(at)

// 2026-10-09T14:30:05.000Z -> "2026-10-09T14-30-05"
export const stamp = (now: number) => new Date(now).toISOString().slice(0, 19).replace(/:/g, '-')

export const handoffPrompt = (pause: Pause) =>
  [
    `You are being paused to keep usage in bounds (${pause.reason}; the ${label(pause.kind)} limit).`,
    'Write a handoff document that lets you pick this work up after the limit resets, with no other memory of this conversation.',
    'Use Markdown with these sections: Goal; Done so far; In progress (exactly where you stopped, including any half-finished edit);',
    'Next steps (in order); Key files and facts (paths, commands, decisions, gotchas); Open questions for the user.',
    'Be specific and concise. Reply with the document only.',
  ].join(' ')

// Used when the model could not write the handoff: the conversation's tail, as it stands.
export const transcriptHandoff = (messages: readonly SessionMessage[]) =>
  [
    '# Handoff (transcript excerpt)',
    'The model could not write a summary, so this is the end of the conversation as it stood.',
    ...messages.slice(-20).map(m => {
      const tools = m.toolUses.length ? `\n_tools: ${m.toolUses.map(u => u.tool).join(', ')}_` : ''

      return `**${m.role}**: ${m.text.slice(0, 2000)}${tools}`
    }),
  ].join('\n\n')

export const resumePrompt = (path: string | undefined, doc: string | undefined) =>
  doc
    ? `The usage limit has reset. on-demand-savior paused you before it ran into on-demand usage and saved this handoff to ${path}. Pick the work up from it:\n\n${doc}`
    : 'The usage limit has reset. on-demand-savior paused you before it ran into on-demand usage. Pick the work up where you left off.'

const pausedLine = (pause: Pause, now: number) =>
  `🛟 Paused at ${pause.reason} · resumes ${clockTime(resumesAt(pause), now)}`

// Module variables: a reload starts them over, the store keeps the pause itself.
let config = settings({})
let turnId: string | undefined
let poll: Timer | undefined
let isPausing = false

// One pause per project, so a session elsewhere neither resumes nor clears it.
async function key($: EngineInterface) {
  return `pause:${await $.session.cwd()}`
}

async function quietKey($: EngineInterface) {
  return `quiet:${await $.session.cwd()}`
}

// Until when an early resume keeps the checks quiet; 0 when it does not.
async function quietUntil($: EngineInterface) {
  return Number((await $.store.get(await quietKey($))) ?? 0)
}

async function isEnabled($: EngineInterface) {
  return (await $.store.get('enabled')) !== false
}

async function getPause($: EngineInterface) {
  return (await $.store.get(await key($))) as Pause | undefined
}

// Keeps the pause in the store (across sessions) and in state (for the band).
async function savePause($: EngineInterface, pause: Pause | undefined) {
  if (pause) {
    await $.store.set(await key($), pause)
  } else {
    await $.store.delete(await key($))
  }
  await update($, pauseState, () => pause ?? null)
}

// Opens the side pane on the handoff; unasked it waits for a wide enough terminal.
async function showHandoff($: EngineInterface, doc: string) {
  await update($, handoffState, () => doc)
  await $.ui.open({ id: PANE, title: 'Handoff' }).catch(() => undefined)
}

async function closeHandoff($: EngineInterface) {
  await update($, handoffState, () => null)
  await $.ui.close({ id: PANE }).catch(() => undefined)
}

// The pause in force: enabled, and its window not yet reset.
async function active($: EngineInterface) {
  const pause = await getPause($)
  if (!pause || !(await isEnabled($))) {
    return undefined
  }

  return (await $.clock.now()) < resumesAt(pause) ? pause : undefined
}

function stopPoll() {
  poll?.cancel()
  poll = undefined
}

// A resume before the reset ('early', the person's choice) also quiets the
// checks until that window resets: its readings stay past the threshold.
async function resume($: EngineInterface, toast: string, isEarly = false) {
  const pause = await getPause($)
  stopPoll()
  if (!pause) {
    return
  }
  if (isEarly) {
    await $.store.set(await quietKey($), resumesAt(pause))
  }
  await savePause($, undefined)
  await closeHandoff($)
  const doc = pause.handoffPath ? await $.fs.read(pause.handoffPath).catch(() => undefined) : undefined
  $.ui.toast(toast)
  // Off this dispatch: a command.run hook may not wait on a turn of its own.
  $.clock.after(0, () => void $.prompt.submit({ text: resumePrompt(pause.handoffPath, doc) }))
}

function arm($: EngineInterface) {
  if (poll) {
    return
  }
  poll = $.clock.every(POLL_MS, async () => {
    const pause = await getPause($)
    if (!pause || !(await isEnabled($))) {
      stopPoll()
    } else if ((await $.clock.now()) >= resumesAt(pause)) {
      await resume($, '🛟 Limit reset: resuming from the handoff')
    }
  })
}

async function pauseSession($: EngineInterface, trip: Trip) {
  if (isPausing || (await getPause($))) {
    return
  }
  isPausing = true
  try {
    const now = await $.clock.now()
    const paused: Pause = { ...trip, pausedAt: now }
    await savePause($, paused)
    if (turnId) {
      await $.turn.abort({ turnId }).catch(() => undefined)
    }

    const reply = await $.model.fork({ prompt: handoffPrompt(paused) })
    const doc = reply.isAnswered ? reply.text : transcriptHandoff(await $.session.messages().catch(() => []))
    const handoffPath = `${await $.session.cwd()}/.claude/handoffs/handoff-${stamp(now)}.md`
    await $.fs.write(handoffPath, doc)

    // `/savior off` or `resume` while the handoff was being written wins.
    if (!(await getPause($))) {
      return
    }
    await savePause($, { ...paused, handoffPath })
    $.ui.toast(`🛟 Paused at ${paused.reason}: handoff saved to ${handoffPath}`)
    arm($)
    await showHandoff($, doc)
  } finally {
    isPausing = false
  }
}

// With a budget, the windows run full and on into on-demand usage, counted
// from the session's cost when one first read full until the budget is spent.
async function spentTrip($: EngineInterface, limits: readonly SessionRateLimit[], costUsd: number | undefined, now: number) {
  const full = spilled(limits, now)
  if (!full || costUsd === undefined) {
    return undefined
  }
  const { startedAt } = await $.session.usage()
  const spendKey = `spend:${await $.session.cwd()}`
  const spend = (await $.store.get(spendKey)) as Spend | undefined
  if (!spend || spend.resetsAt !== full.resetsAt || spend.startedAt !== startedAt) {
    await $.store.set(spendKey, { resetsAt: full.resetsAt!, startedAt, baseUsd: costUsd })

    return undefined
  }

  return overBudget(full, spend, costUsd, config.budgetUsd)
}

async function check($: EngineInterface, limits: readonly SessionRateLimit[], costUsd: number | undefined) {
  if (isPausing || !(await isEnabled($)) || (await getPause($))) {
    return
  }
  const now = await $.clock.now()
  if (now < (await quietUntil($))) {
    return
  }
  const hit = config.budgetUsd > 0 ? await spentTrip($, limits, costUsd, now) : tripped(limits, config, now)
  if (hit) {
    // Off this dispatch: the pause aborts the turn and waits on the model.
    $.clock.after(0, () => void pauseSession($, hit))
  }
}

async function status($: EngineInterface) {
  if (!(await isEnabled($))) {
    return 'on-demand-savior is off: at the limit, Claude goes on into on-demand usage. /savior on to guard again.'
  }
  const pause = await active($)
  if (pause) {
    const handoff = pause.handoffPath ? ` Handoff: ${pause.handoffPath}.` : ''

    return `${pausedLine(pause, await $.clock.now())}.${handoff} /savior resume to go on now (may use on-demand usage).`
  }

  const now = await $.clock.now()
  const quiet = await quietUntil($)
  if (now < quiet) {
    return `on-demand-savior is on, but resumed early: limit checks are off until ${clockTime(quiet, now)}, when the window resets. /savior on to check again now.`
  }
  const { fiveHour, weekly, budgetUsd } = config

  return budgetUsd > 0
    ? `on-demand-savior is on: lets ${usd(budgetUsd)} of on-demand usage through once a limit is used up, then pauses.`
    : `on-demand-savior is on: pauses at 5-hour ${fiveHour}% or weekly ${weekly}%.`
}

export const register: Register = (on, options) => {
  config = settings(options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Guard against on-demand usage: on, off, status, resume now, or show the handoff',
      argumentHint: '[on|off|status|resume|handoff]',
      immediate: true,
    })
    // A pause from an earlier session in this project: wait it out, or resume
    // from its handoff right away if the window already reset.
    const pause = await getPause($)
    if (pause && (await isEnabled($))) {
      await update($, pauseState, () => pause)
      arm($)
      const doc = pause.handoffPath ? await $.fs.read(pause.handoffPath).catch(() => undefined) : undefined
      if (doc) {
        await showHandoff($, doc)
      }
    }

    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const action = e.args.trim().toLowerCase()
    if (action === 'off') {
      await $.store.set('enabled', false)
      await savePause($, undefined)
      await closeHandoff($)
      stopPoll()
    } else if (action === 'on') {
      await $.store.set('enabled', true)
      await $.store.delete(await quietKey($))
      // The last reading may already be past the threshold; no new point may come.
      const usage = await $.session.usage()
      await check($, usage.rateLimits, usage.cost?.usd)
    } else if (action === 'resume') {
      if (!(await getPause($))) {
        return { text: 'on-demand-savior: nothing is paused.' }
      }
      await resume($, '🛟 Resuming from the handoff; limit checks are off until the reset', true)

      return { text: 'on-demand-savior: resumed from the handoff before the reset; limit checks are off until it, so this may use on-demand usage.' }
    } else if (action === 'handoff') {
      const pause = await getPause($)
      const doc = pause?.handoffPath ? await $.fs.read(pause.handoffPath).catch(() => undefined) : undefined
      if (!doc) {
        return { text: 'on-demand-savior: no handoff to show.' }
      }
      await showHandoff($, doc)

      return { text: `on-demand-savior: showing the handoff from ${pause!.handoffPath}.` }
    } else if (action !== '' && action !== 'status') {
      return { text: `on-demand-savior: unknown "${action}". Use /savior on, off, status, resume or handoff.` }
    }

    return { text: await status($) }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) {
      await check($, e.rateLimits, e.cost?.usd)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    turnId = e.turnId
    const result = await next(e)
    // A turn that starts while paused (a continuation, a skill) ends at once.
    if (await active($)) {
      void $.turn.abort({ turnId: e.turnId }).catch(() => undefined)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.turnId === turnId) {
      turnId = undefined
    }

    return next(e)
  })

  // Slash commands pass, so /savior itself still answers while paused.
  on('prompt.submit', async ($, e, next) => {
    const pause = e.text.trimStart().startsWith('/') ? undefined : await active($)
    if (pause) {
      return { drop: `${pausedLine(pause, await $.clock.now())}. /savior resume to go on now (may use on-demand usage), /savior off to stop guarding.` }
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (await active($)) {
      return { deny: 'on-demand-savior paused this session at the usage limit; stop here, the work resumes when the limit resets.' }
    }

    return next(e)
  })

  // The pause, with the button that ends it, right above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const pause = await read($, pauseState)
    if (!pause || e.props.hasSurvey) {
      return next(e)
    }
    const below = await next(e)
    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box key="savior" flexDirection="row" flexWrap="wrap">
          <Text color="yellow">{pausedLine(pause, now)} </Text>
          <Button
            key="resume"
            label="Resume now"
            hotkey="r"
            variant="primary"
            onPress={() => resume($, '🛟 Resuming from the handoff; limit checks are off until the reset', true)}
          />
        </Box>
        {below}
      </Box>
    )
  })

  // The side pane: the handoff, and the same button.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const doc = await read($, handoffState)
    const pause = await read($, pauseState)
    const now = await $.clock.now()
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)

    return (
      // Two cells either side (about 16px) keep the text off the frame.
      <Box key="pane" flexDirection="column" paddingX={2}>
        {pause && (
          <Box key="paused" flexDirection="row" flexWrap="wrap">
            <Text color="yellow">{pausedLine(pause, now)} </Text>
            <Button
              key="resume"
              label="Resume now"
              hotkey="r"
              variant="primary"
              onPress={() => resume($, '🛟 Resuming from the handoff; limit checks are off until the reset', true)}
            />
          </Box>
        )}
        <Markdown key="handoff" text={doc ?? '_No handoff yet._'} />
      </Box>
    )
  })
}
