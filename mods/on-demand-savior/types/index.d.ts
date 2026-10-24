/** What trips a pause: the window to wait out, and why, as the status line says it. */
export type Trip = { kind: string; resetsAt: string; reason: string }

/** A pause in one project: what tripped it and the handoff written for it. */
export type Pause = Trip & { pausedAt: number; handoffPath?: string }

/** The settings: each window's threshold, the on-demand budget (0: none) and the handoff folder ('' : the project's). */
export type Settings = { fiveHour: number; weekly: number; budgetUsd: number; handoffDir: string }

/** On-demand spend so far: the session's cost when a window first read full. */
export type Spend = { resetsAt: string; startedAt: number; baseUsd: number }

declare module 'claude-code' {
  interface PluginState {
    'on-demand-savior': { pause: Pause | null; handoff: string | null }
  }
}
