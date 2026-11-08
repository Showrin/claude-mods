/** What trips a pause: the window to wait out, and why, as the status line says it. */
export type Trip = { kind: string; resetsAt: string; reason: string }

/** A pause in one project: what tripped it, the thread it tripped in and the handoff written for it. */
export type Pause = Trip & { pausedAt: number; sessionId?: string; handoffPath?: string }

/** One thread's own switches: unguarded, or guarded with no handoff doc. */
export type Thread = { isOff?: boolean; isHandoffOff?: boolean }

/** The settings: each window's threshold, the on-demand budget (0: none) and the handoff folder ('' : the project's). */
export type Settings = { fiveHour: number; weekly: number; budgetUsd: number; handoffDir: string }

/** One session's on-demand spend: its cost when a window first read full, kept until the last full window resets. */
export type Spend = { resetsAt: string; startedAt: number; baseUsd: number }

declare module 'claude-code' {
  interface PluginState {
    'on-demand-savior': { pause: Pause | null; handoff: string | null }
  }
}
