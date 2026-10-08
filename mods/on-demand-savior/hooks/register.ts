import type { EngineInterface, Register, SessionMessage, SessionRateLimit, Timer } from 'claude-code'

/** A pause in one project: the window that tripped it and the handoff written for it. */
export type Pause = {
  kind: string
  percent: number
  resetsAt: string
  pausedAt: number
  handoffPath?: string
}

const COMMAND = 'savior'
const WATCHED = ['five_hour', 'seven_day']
const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly' }
const DEFAULT_THRESHOLD = 96
// Resume a minute after the reset, so the first request lands in the new window.
const GRACE_MS = 60_000
const POLL_MS = 30_000
const DAY = 24 * 60 * 60 * 1000

export const label = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')

export const threshold = (setting: unknown) => {
  const n = Number(setting)

  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_THRESHOLD
}

// The watched window at or past the threshold that resets last (the one to
// wait out); a window whose reset has passed is stale and never trips.
export const tripped = (limits: readonly SessionRateLimit[], at: number, now: number) =>
  limits
    .filter(l => WATCHED.includes(l.kind) && l.percentUsed >= at && l.resetsAt && Date.parse(l.resetsAt) > now)
    .sort((a, b) => Date.parse(b.resetsAt!) - Date.parse(a.resetsAt!))[0]

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
    `You are being paused: the ${label(pause.kind)} usage limit is at ${pause.percent}%, and going on would spill into on-demand usage.`,
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
  `🛟 Paused at ${label(pause.kind)} ${pause.percent}% · resumes ${clockTime(resumesAt(pause), now)}`

// Module variables: a reload starts them over, the store keeps the pause itself.
let at = DEFAULT_THRESHOLD
let turnId: string | undefined
let poll: Timer | undefined
let isPausing = false

// One pause per project, so a session elsewhere neither resumes nor clears it.
async function key($: EngineInterface) {
  return `pause:${await $.session.cwd()}`
}

async function isEnabled($: EngineInterface) {
  return (await $.store.get('enabled')) !== false
}

async function getPause($: EngineInterface) {
  return (await $.store.get(await key($))) as Pause | undefined
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

async function resume($: EngineInterface) {
  const pause = await getPause($)
  stopPoll()
  $.ui.status(undefined)
  if (!pause) {
    return
  }
  await $.store.delete(await key($))
  const doc = pause.handoffPath ? await $.fs.read(pause.handoffPath).catch(() => undefined) : undefined
  $.ui.toast('🛟 Limit reset: resuming from the handoff')
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
      await resume($)
    }
  })
}

async function pauseSession($: EngineInterface, limit: SessionRateLimit) {
  if (isPausing || (await getPause($))) {
    return
  }
  isPausing = true
  try {
    const now = await $.clock.now()
    const paused: Pause = { kind: limit.kind, percent: limit.percentUsed, resetsAt: limit.resetsAt!, pausedAt: now }
    await $.store.set(await key($), paused)
    $.ui.status(pausedLine(paused, now))
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
    await $.store.set(await key($), { ...paused, handoffPath })
    $.ui.toast(`🛟 ${label(paused.kind)} limit at ${paused.percent}%: paused, handoff saved to ${handoffPath}`)
    arm($)
  } finally {
    isPausing = false
  }
}

async function check($: EngineInterface, limits: readonly SessionRateLimit[]) {
  if (isPausing || !(await isEnabled($)) || (await getPause($))) {
    return
  }
  const hit = tripped(limits, at, await $.clock.now())
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

  return `on-demand-savior is on: pauses at ${at}% of the 5-hour or weekly limit.`
}

export const register: Register = (on, options) => {
  at = threshold(options.threshold)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Guard against on-demand usage: on, off, status, or resume now',
      argumentHint: '[on|off|status|resume]',
      immediate: true,
    })
    // A pause from an earlier session in this project: wait it out, or resume
    // from its handoff right away if the window already reset.
    const paused = await getPause($)
    if (paused && (await isEnabled($))) {
      $.ui.status(pausedLine(paused, await $.clock.now()))
      arm($)
    }

    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const action = e.args.trim().toLowerCase()
    if (action === 'off') {
      await $.store.set('enabled', false)
      await $.store.delete(await key($))
      stopPoll()
      $.ui.status(undefined)
    } else if (action === 'on') {
      await $.store.set('enabled', true)
      // The last reading may already be past the threshold; no new point may come.
      await check($, (await $.session.usage()).rateLimits)
    } else if (action === 'resume') {
      if (!(await getPause($))) {
        return { text: 'on-demand-savior: nothing is paused.' }
      }
      await resume($)

      return { text: 'on-demand-savior: resumed from the handoff before the reset; this may use on-demand usage.' }
    } else if (action !== '' && action !== 'status') {
      return { text: `on-demand-savior: unknown "${action}". Use /savior on, off, status or resume.` }
    }

    return { text: await status($) }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await check($, e.rateLimits)
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
}
