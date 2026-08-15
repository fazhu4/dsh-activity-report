/**
 * dsh-activity-report contract: shared types between the host fold, the
 * persisted store, and the browser panel. Keep this file dependency-free so
 * both the Node half and the client bundle can import it.
 */

/** Token accounting for one model call (mirrors the session log's TokenUsage). */
export interface TokenCounts {
  /** Uncached input tokens. */
  input: number
  /** Output tokens (reasoning already included when the provider reports it). */
  output: number
  /** Cache-hit input tokens. */
  cacheRead: number
  /** Cache-write input tokens. */
  cacheWrite: number
}

/** Aggregated statistics for one grouping key (provider / model / session / day). */
export interface ActivityStats {
  /** Successful model requests (assistant/message with usage). */
  requests: number
  /** Completed turns (turn/end events). */
  turns: number
  /** Model steps (step/end events). Compaction strips turn boundaries from the
   * persisted log, so this is the durable fallback for compressed sessions. */
  steps: number
  tokens: TokenCounts
  /** Tool call counts by tool name. */
  toolCalls: Record<string, number>
  /** Failed tool executions. */
  toolErrors: number
  /** Sum of turn durations in milliseconds. */
  durationMs: number
  /** Turn end reasons: completed / error / aborted / max-tokens / interrupted / blocked / canceled. */
  outcomes: Record<string, number>
}

/** Per-day activity distribution within one session (local calendar day key YYYY-MM-DD). */
export interface DayStats {
  /** Successful model requests that day. */
  requests: number
  tokens: TokenCounts
}

/** The per-session materialized fold persisted to disk. */
export interface SessionFold {
  /** Last event seq folded into `stats`. The log is append-only, so everything before this is permanent. */
  watermark: number
  /** Workspace (cwd) the session belongs to, when known. */
  cwd?: string
  /** Session title, when the log has one. */
  title?: string
  /** Session creation epoch ms (from the header). */
  createdAt?: number
  /** Last activity epoch ms (max folded event time), for range bucketing across restarts. */
  lastActivityMs?: number
  /** Folded totals for the session. */
  stats: ActivityStats
  /** Per-provider subtotals within this session. */
  byProvider: Record<string, ActivityStats>
  /** Per-model subtotals within this session. */
  byModel: Record<string, ActivityStats>
  /** Per-local-day token/request distribution (assistant/message events only). */
  byDay: Record<string, DayStats>
}

/** The persisted store shape. */
export interface ActivityStore {
  version: 1
  sessions: Record<string, SessionFold>
}

/** Empty per-day stats. */
export function emptyDayStats(): DayStats {
  return { requests: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
}

/** Empty stats factory. */
export function emptyStats(): ActivityStats {
  return {
    requests: 0,
    turns: 0,
    steps: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    toolCalls: {},
    toolErrors: 0,
    durationMs: 0,
    outcomes: {},
  }
}

/** Merge `b` into `a` in place (a += b). */
export function mergeStats(a: ActivityStats, b: ActivityStats): void {
  a.requests += b.requests
  a.turns += b.turns
  a.steps += b.steps
  a.tokens.input += b.tokens.input
  a.tokens.output += b.tokens.output
  a.tokens.cacheRead += b.tokens.cacheRead
  a.tokens.cacheWrite += b.tokens.cacheWrite
  a.toolErrors += b.toolErrors
  a.durationMs += b.durationMs
  for (const [name, n] of Object.entries(b.toolCalls)) {
    a.toolCalls[name] = (a.toolCalls[name] ?? 0) + n
  }
  for (const [reason, n] of Object.entries(b.outcomes)) {
    a.outcomes[reason] = (a.outcomes[reason] ?? 0) + n
  }
}

/** Add one stat into a nested map under `key`, creating the entry when missing. */
export function addTo(map: Record<string, ActivityStats>, key: string, stat: ActivityStats): void {
  const target = (map[key] ??= emptyStats())
  mergeStats(target, stat)
}

/** Whether a stats object is completely empty (nothing to persist). */
export function isStatsEmpty(s: ActivityStats): boolean {
  return s.requests === 0 && s.turns === 0 && s.steps === 0 && s.tokens.input === 0
    && s.tokens.output === 0 && s.tokens.cacheRead === 0 && s.tokens.cacheWrite === 0
    && s.toolErrors === 0 && s.durationMs === 0
    && Object.keys(s.toolCalls).length === 0 && Object.keys(s.outcomes).length === 0
}

/** The HTTP summary view served to the browser. */
export interface SummaryResponse {
  /** Epoch ms of the last persisted write. */
  updatedAt: number
  /** Requested range. */
  range: 'today' | '7d' | '30d' | 'all'
  /** Grand totals over the range. */
  totals: ActivityStats
  /** Per-provider aggregation over the range. */
  byProvider: Record<string, ActivityStats>
  /** Per-model aggregation over the range. */
  byModel: Record<string, ActivityStats>
  /** Per-session aggregation over the range (id → fold + stats). */
  bySession: Record<string, { cwd?: string; title?: string; createdAt?: number; stats: ActivityStats }>
  /** Per-day series over the range (label YYYY-MM-DD → totals). */
  series: Array<{ label: string; stats: ActivityStats }>
}

/** One session row in the sessions endpoint. */
export interface SessionRow {
  sessionId: string
  title?: string
  cwd?: string
  stats: ActivityStats
}
