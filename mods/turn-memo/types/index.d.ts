/** One turn's usage and the session's running cost at the moment it closed. */
export type Turn = {
  total: number
  read: number
  write: number
  cacheRead: number
  cacheWrite: number
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'turn-memo': { last: StateFamily<Turn | null>; pending: Turn[] }
  }
}
