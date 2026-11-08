import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, Register, SessionMessage, SessionRateLimit, Timer } from 'claude-code'

import type { Pause, Settings, Spend, Thread, Trip } from '../types'

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
// Past the reset, a thread that did not pause waits this long for the one that did
// (it may be closed), then takes the resume over.
const TAKEOVER_MS = 2 * 60_000
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
    handoffDir: typeof options.handoffDir === 'string' ? options.handoffDir.trim() : '',
  }
}

const FIELDS = ['fiveHourThreshold', 'weeklyThreshold', 'onDemandBudgetUsd', 'handoffDir'] as const

// The plugin's /config rows laid over the options it loaded with. A row keyed by
// plugin id (two copies of the same name loaded) is not ours to read, so it is left out;
// a missing row (one a config.describe hook hid) keeps the loaded value.
export const liveOptions = (rows: readonly ConfigRow[], name: string, options: Record<string, unknown>) => {
  const live = { ...options }
  for (const field of FIELDS) {
    const row = rows.find(r => r.key === `${name}.${field}`)
    if (row) {
      live[field] = row.value
    }
  }

  return live
}

// Where a handoff is saved: the setting's folder (`~` the home folder, a relative
// one under the project), else the project's .claude/handoffs. Named by project
// and time, so a shared folder keeps every one apart and nothing is overwritten.
export const handoffFile = (dir: string, cwd: string, home: string | undefined, now: number) => {
  const trim = (path: string) => path.replace(/[\\/]+$/, '')
  const root = trim(cwd)
  const folder =
    dir === ''
      ? `${root}/.claude/handoffs`
      : /^~([\\/]|$)/.test(dir) && home
        ? trim(home) + dir.slice(1)
        : /^([a-zA-Z]:)?[\\/]/.test(dir)
          ? dir
          : `${root}/${dir}`
  const project = root.split(/[\\/]/).pop() || 'project'

  return `${trim(folder)}/handoff-${project}-${stamp(now)}.md`
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
let loaded: Record<string, unknown> = {}
let turnId: string | undefined
let poll: Timer | undefined
let isPausing = false

// The settings as /config holds them now: a save there does not always reload the plugin.
async function current($: EngineInterface) {
  const rows = await $.config.list().catch(() => [] as ConfigRow[])

  return settings(liveOptions(rows, $.plugin.name, loaded))
}

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

// A thread's own switches, kept under its session id so a reload or --resume keeps them.
// A key outlives its thread (a /clear starts a new id); it holds two flags, so it stays.
async function threadKey($: EngineInterface) {
  return `thread:${await $.session.id()}`
}

async function getThread($: EngineInterface) {
  return ((await $.store.get(await threadKey($))) ?? {}) as Thread
}

async function setThread($: EngineInterface, patch: Thread) {
  const next = { ...(await getThread($)), ...patch }
  if (next.isOff || next.isHandoffOff) {
    await $.store.set(await threadKey($), next)
  } else {
    await $.store.delete(await threadKey($))
  }
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

// The pause in force: enabled, on in this thread, and its window not yet reset.
async function active($: EngineInterface) {
  const pause = await getPause($)
  if (!pause || !(await isEnabled($)) || (await getThread($)).isOff) {
    return undefined
  }

  return (await $.clock.now()) < resumesAt(pause) ? pause : undefined
}

function stopPoll() {
  poll?.cancel()
  poll = undefined
}

// Shows a pause in force in this thread: the band, the wait for the reset, the handoff.
async function showPause($: EngineInterface, pause: Pause) {
  await update($, pauseState, () => pause)
  arm($)
  const doc = pause.handoffPath ? await $.fs.read(pause.handoffPath).catch(() => undefined) : undefined
  if (doc) {
    await showHandoff($, doc)
  }
}

// Hides a pause from this thread only; the store keeps it for the others.
async function hidePause($: EngineInterface) {
  stopPoll()
  await update($, pauseState, () => null)
  await closeHandoff($)
}

// Whether this thread tripped the pause; one from an older version has no owner.
async function isOwner($: EngineInterface, pause: Pause) {
  return !pause.sessionId || pause.sessionId === (await $.session.id())
}

// A resume before the reset ('early', the person's choice) also quiets the
// checks on that window until it resets: its readings stay past the threshold.
async function resume($: EngineInterface, isEarly = false) {
  const pause = await getPause($)
  stopPoll()
  // Gone already (another thread resumed it): only this thread's band is left.
  if (!pause) {
    await hidePause($)

    return
  }
  if (isEarly) {
    await $.store.set(await quietKey($), resumesAt(pause))
  }
  await savePause($, undefined)
  await closeHandoff($)
  const doc = pause.handoffPath ? await $.fs.read(pause.handoffPath).catch(() => undefined) : undefined
  // Off this dispatch: a command.run hook may not wait on a turn of its own.
  $.clock.after(0, () => void $.prompt.submit({ text: resumePrompt(pause.handoffPath, doc) }))
}

function arm($: EngineInterface) {
  if (poll) {
    return
  }
  poll = $.clock.every(POLL_MS, async () => {
    const pause = await getPause($)
    if (!pause || !(await isEnabled($)) || (await getThread($)).isOff) {
      await hidePause($)
    } else if ((await $.clock.now()) >= resumesAt(pause) + ((await isOwner($, pause)) ? 0 : TAKEOVER_MS)) {
      await resume($)
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
    const paused: Pause = { ...trip, pausedAt: now, sessionId: await $.session.id() }
    await savePause($, paused)
    if (turnId) {
      await $.turn.abort({ turnId }).catch(() => undefined)
    }
    // No handoff in this thread: the pause alone, and the plain prompt at the reset.
    if ((await getThread($)).isHandoffOff) {
      if (await getPause($)) {
        arm($)
      }

      return
    }

    const reply = await $.model.fork({ prompt: handoffPrompt(paused) })
    const doc = reply.isAnswered ? reply.text : transcriptHandoff(await $.session.messages().catch(() => []))
    const { handoffDir } = await current($)
    const home = handoffDir.startsWith('~')
      ? ((await $.env.get('USERPROFILE').catch(() => undefined)) ?? (await $.env.get('HOME').catch(() => undefined)))
      : undefined
    const handoffPath = handoffFile(handoffDir, await $.session.cwd(), home, now)
    // A failed write still keeps the pause, so it still ends at the reset.
    const isSaved = await $.fs.write(handoffPath, doc).then(() => true, () => false)

    // `/savior off` or `resume` while the handoff was being written wins.
    if (!(await getPause($))) {
      return
    }
    await savePause($, isSaved ? { ...paused, handoffPath } : paused)
    arm($)
    await showHandoff($, doc)
  } finally {
    isPausing = false
  }
}

// With a budget, the windows run full and on into on-demand usage, counted per
// session from its cost when one first read full until every full window reset.
async function spentTrip($: EngineInterface, limits: readonly SessionRateLimit[], costUsd: number | undefined, now: number, budgetUsd: number) {
  const full = spilled(limits, now)
  if (!full || costUsd === undefined) {
    return undefined
  }
  const { startedAt } = await $.session.usage()
  const spendKey = `spend:${await $.session.cwd()}`
  const stored = await $.store.get(spendKey)
  const spends = (Array.isArray(stored) ? stored : []) as Spend[]
  const others = spends.filter(s => s.startedAt !== startedAt && Date.parse(s.resetsAt) > now)
  const mine = spends.find(s => s.startedAt === startedAt && Date.parse(s.resetsAt) > now)
  const resetsAt = mine && Date.parse(mine.resetsAt) > Date.parse(full.resetsAt!) ? mine.resetsAt : full.resetsAt!
  if (!mine || mine.resetsAt !== resetsAt) {
    await $.store.set(spendKey, [...others, { resetsAt, startedAt, baseUsd: mine?.baseUsd ?? costUsd }])
  }

  return mine && overBudget(full, mine, costUsd, budgetUsd)
}

async function check($: EngineInterface, limits: readonly SessionRateLimit[], costUsd: number | undefined) {
  if (isPausing || !(await isEnabled($)) || (await getThread($)).isOff || (await getPause($))) {
    return
  }
  const now = await $.clock.now()
  // An early resume quiets only the windows it pushed past: those resetting before the quiet ends.
  const quiet = await quietUntil($)
  const watched = limits.filter(l => !l.resetsAt || Date.parse(l.resetsAt) >= quiet)
  const s = await current($)
  const hit = s.budgetUsd > 0 ? await spentTrip($, watched, costUsd, now, s.budgetUsd) : tripped(watched, s, now)
  if (hit) {
    // Off this dispatch: the pause aborts the turn and waits on the model.
    $.clock.after(0, () => void pauseSession($, hit))
  }
}

// What this thread does differently, for the status line.
async function threadNote($: EngineInterface) {
  return (await getThread($)).isHandoffOff ? ' This thread writes no handoff doc (/savior handoff on to write one).' : ''
}

// Guarding again: show a pause in force, wait out one past its reset, or check the last reading.
async function guard($: EngineInterface) {
  const pause = await getPause($)
  if (pause && (await active($))) {
    await showPause($, pause)
  } else if (pause) {
    arm($)
  } else {
    const usage = await $.session.usage()
    await check($, usage.rateLimits, usage.cost?.usd)
  }
}

async function status($: EngineInterface) {
  if (!(await isEnabled($))) {
    return 'on-demand-savior is off: at the limit, Claude goes on into on-demand usage. /savior on to guard again.'
  }
  if ((await getThread($)).isOff) {
    return 'on-demand-savior is off in this thread: at the limit, it goes on into on-demand usage; other threads stay guarded. /savior thread on to guard it again.'
  }
  const pause = await active($)
  if (pause) {
    const handoff = pause.handoffPath ? ` Handoff: ${pause.handoffPath}.` : ''

    return `${pausedLine(pause, await $.clock.now())}.${handoff} /savior resume to go on now (may use on-demand usage).${await threadNote($)}`
  }

  const now = await $.clock.now()
  const quiet = await quietUntil($)
  if (now < quiet) {
    return `on-demand-savior is on, but resumed early: the paused limit's checks are off until ${clockTime(quiet, now)}, when it resets. /savior on to check again now.${await threadNote($)}`
  }
  const { fiveHour, weekly, budgetUsd } = await current($)
  const guard = budgetUsd > 0
    ? `on-demand-savior is on: lets ${usd(budgetUsd)} of on-demand usage through once a limit is used up, then pauses.`
    : `on-demand-savior is on: pauses at 5-hour ${fiveHour}% or weekly ${weekly}%.`

  return guard + (await threadNote($))
}

export const register: Register = (on, options) => {
  loaded = options

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // The band above the prompt says it all; clear a status line an older version left.
    $.ui.status(undefined)
    await $.command.register({
      name: COMMAND,
      description: 'Guard against on-demand usage: on, off, status, resume now, the handoff, or this thread alone',
      argumentHint: '[on|off|status|resume|handoff [on|off]|thread on|off]',
      immediate: true,
    })
    // A pause from an earlier session in this project: wait it out, or resume
    // from its handoff right away if the window already reset.
    const pause = await getPause($)
    if (pause && (await isEnabled($)) && !(await getThread($)).isOff) {
      await showPause($, pause)
    }

    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const action = e.args.trim().toLowerCase().replace(/\s+/g, ' ')
    if (action === 'thread off') {
      await setThread($, { isOff: true })
      const pause = await getPause($)
      // A pause this thread tripped ends with it; one from another thread stays for that thread.
      if (pause && pause.sessionId === (await $.session.id())) {
        await savePause($, undefined)
      }
      await hidePause($)
    } else if (action === 'thread on') {
      await setThread($, { isOff: false })
      await guard($)
    } else if (action === 'handoff off' || action === 'handoff on') {
      await setThread($, { isHandoffOff: action === 'handoff off' })
    } else if (action === 'off') {
      await $.store.set('enabled', false)
      await savePause($, undefined)
      await closeHandoff($)
      stopPoll()
    } else if (action === 'on') {
      await $.store.set('enabled', true)
      await $.store.delete(await quietKey($))
      // The last reading may already be past the threshold; no new point may come.
      await guard($)
    } else if (action === 'resume') {
      if ((await getThread($)).isOff) {
        return { text: 'on-demand-savior is off in this thread, so nothing is paused here.' }
      }
      if (!(await getPause($))) {
        return { text: 'on-demand-savior: nothing is paused.' }
      }
      await resume($, true)

      return { text: 'on-demand-savior: resumed from the handoff before the reset; checks on that limit are off until it, so this may use on-demand usage.' }
    } else if (action === 'handoff') {
      const pause = await getPause($)
      const doc = pause?.handoffPath ? await $.fs.read(pause.handoffPath).catch(() => undefined) : undefined
      if (!doc) {
        return { text: 'on-demand-savior: no handoff to show.' }
      }
      await showHandoff($, doc)

      return { text: `on-demand-savior: showing the handoff from ${pause!.handoffPath}.` }
    } else if (action !== '' && action !== 'status') {
      return { text: `on-demand-savior: unknown "${action}". Use /savior on, off, status, resume, handoff, handoff on|off or thread on|off.` }
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
            onPress={() => resume($, true)}
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
              onPress={() => resume($, true)}
            />
          </Box>
        )}
        <Markdown key="handoff" text={doc ?? '_No handoff yet._'} />
      </Box>
    )
  })
}
