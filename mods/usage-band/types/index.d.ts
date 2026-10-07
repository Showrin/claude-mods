export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * Tokens summed over the whole conversation; `startedAt` is the session they
 * belong to, `isFull` whether the transcript's earlier replies were counted in.
 */
export type Tokens = {
  startedAt: number
  isFull: boolean
  read: number
  write: number
  cacheRead: number
  cacheWrite: number
}

/** The live context window: its size, and its fill once a reply reported one. */
export type Context = { window: number; tokens?: number; percent?: number; top: Category[] }

/** One of the biggest rows /context lists (Messages, System tools, MCP tools...). */
export type Category = { name: string; tokens: number; color: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      limits: Limit[]; costUsd: number | null; minute: number; tokens: Tokens | null
      context: Context | null
    }
  }
}
