/**
 * Pure fold logic: one session's event sequence → materialized statistics.
 *
 * Kept dependency-free (no DSH imports) so it can be unit-tested in isolation.
 * The host plugin adapts real `SessionEvent` objects into the minimal
 * `FoldEvent` shape below before folding.
 */
import type { ActivityStats, SessionFold } from './contract.ts'
import { addTo, emptyDayStats, emptyStats, mergeStats } from './contract.ts'

/**
 * The minimal event view the fold needs. The host adapter maps real DSH
 * `SessionEvent` union members onto these fields; unknown event types become
 * `{ type }` with no metrics.
 */
export interface FoldEvent {
  /** Durable sequence number (log position). */
  seq: number
  /** Epoch ms timestamp. */
  time: number
  /** Session event type discriminant. */
  type: string
  /** assistant/message: provider route. */
  provider?: string
  /** assistant/message: model id. */
  model?: string
  /** assistant/message: token accounting. */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  /** turn/start + turn/end: turn number. */
  turn?: number
  /** turn/end: reason kind ('completed' | 'error' | 'aborted' | 'max-tokens' | ...). */
  reason?: string
  /** tool/call: tool name. */
  toolName?: string
  /** tool/result: whether the tool execution failed. */
  toolError?: boolean
}

/** Create a fresh session fold with no stats and no watermark. */
export function createFold(cwd?: string, title?: string): SessionFold {
  // watermark: -1 = nothing folded yet; seq 0 is the first foldable event.
  return { watermark: -1, cwd, title, stats: emptyStats(), byProvider: {}, byModel: {}, byDay: {} }
}

/** Local calendar day key (YYYY-MM-DD) from epoch ms, matching the client's dayLabel. */
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The in-progress turn-start timestamp, kept on the fold to survive incremental folds. */
export interface FoldState {
  fold: SessionFold
  /** turn number → its start time (epoch ms), for duration accounting across folds. */
  turnStart: Map<number, number>
}

/** Create a fold state. */
export function createFoldState(cwd?: string, title?: string): FoldState {
  return { fold: createFold(cwd, title), turnStart: new Map() }
}

/**
 * Fold ONE event into the state. Pure: mutates `state` and returns nothing.
 * seq must be strictly greater than the fold's current watermark.
 */
export function foldEvent(state: FoldState, ev: FoldEvent): void {
  const { fold } = state
  if (ev.seq <= fold.watermark) return
  const s = fold.stats

  switch (ev.type) {
    case 'assistant/message': {
      if (ev.usage) {
        s.requests += 1
        const t = fold.stats.tokens
        t.input += ev.usage.inputTokens ?? 0
        t.output += ev.usage.outputTokens ?? 0
        t.cacheRead += ev.usage.cacheReadTokens ?? 0
        t.cacheWrite += ev.usage.cacheWriteTokens ?? 0
        // Per-provider and per-model subtotals: mirror the same request+token block.
        const stat: ActivityStats = emptyStats()
        stat.requests = 1
        stat.tokens = {
          input: ev.usage.inputTokens ?? 0,
          output: ev.usage.outputTokens ?? 0,
          cacheRead: ev.usage.cacheReadTokens ?? 0,
          cacheWrite: ev.usage.cacheWriteTokens ?? 0,
        }
        if (ev.provider) addTo(fold.byProvider, ev.provider, stat)
        if (ev.model) addTo(fold.byModel, ev.model, stat)
        // Per-local-day distribution (for the time-range bar chart on top).
        const dayKey = localDayKey(ev.time)
        const day = (fold.byDay[dayKey] ??= emptyDayStats())
        day.requests += 1
        day.tokens.input += ev.usage.inputTokens ?? 0
        day.tokens.output += ev.usage.outputTokens ?? 0
        day.tokens.cacheRead += ev.usage.cacheReadTokens ?? 0
        day.tokens.cacheWrite += ev.usage.cacheWriteTokens ?? 0
      }
      break
    }
    case 'turn/start': {
      if (ev.turn !== undefined) state.turnStart.set(ev.turn, ev.time)
      break
    }
    case 'turn/end': {
      s.turns += 1
      const reason = ev.reason ?? 'unknown'
      s.outcomes[reason] = (s.outcomes[reason] ?? 0) + 1
      const start = ev.turn !== undefined ? state.turnStart.get(ev.turn) : undefined
      if (start !== undefined) {
        const duration = ev.time - start
        if (duration > 0) s.durationMs += duration
        if (ev.turn !== undefined) state.turnStart.delete(ev.turn)
      }
      break
    }
    case 'step/end': {
      // Compaction strips turn/start+turn/end from the persisted log, so a
      // backfilled (compressed) session has no turn boundaries. Count steps as
      // the durable "activity units" fallback so the panel is not empty.
      s.steps += 1
      break
    }
    case 'tool/call': {
      if (ev.toolName) {
        s.toolCalls[ev.toolName] = (s.toolCalls[ev.toolName] ?? 0) + 1
      }
      break
    }
    case 'tool/result': {
      if (ev.toolError) s.toolErrors += 1
      break
    }
    default:
      // Unknown/structural events (chunks, headers, user/message, todos, ...)
      // carry no metrics. Per dsh-session's merge-extensible union, a
      // plugin-added event type is a valid unknown value — fall through.
      break
  }

  fold.watermark = ev.seq
}

/**
 * Fold a sequence of events (already ascending by seq) into the state.
 * Returns the state for chaining. Events at or below the watermark are skipped.
 */
export function foldEvents(state: FoldState, events: readonly FoldEvent[]): FoldState {
  for (const ev of events) foldEvent(state, ev)
  return state
}

/** Add a stats object into another (used to merge session folds upward). */
export { addTo, emptyStats, isStatsEmpty, mergeStats } from './contract.ts'

/** Merge one session fold's stats into a destination stat (for grand totals). */
export function mergeFoldInto(dest: ActivityStats, fold: SessionFold): void {
  mergeStats(dest, fold.stats)
}
