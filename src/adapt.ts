/**
 * Event adaptation: map raw session event shapes (either `{ seq, time, type,
 * ...data }` or `{ seq, time, type, data: {...} }`) to the minimal FoldEvent.
 * Extracted from the host plugin so it can be unit-tested without a runtime.
 */
import type { FoldEvent } from './fold.ts'

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Map a raw session event to the minimal FoldEvent.
 * @param raw - one session event with `seq`, `time`, `type`, and payload.
 * @returns the fold view.
 */
export function toFoldEvent(raw: Record<string, unknown>): FoldEvent {
  const d = (raw.data ?? raw) as Record<string, unknown>
  const ev: FoldEvent = {
    seq: num(raw.seq),
    time: num(raw.time) || Date.now(),
    type: typeof raw.type === 'string' ? raw.type : '',
  }
  switch (ev.type) {
    case 'assistant/message': {
      const msg = d.message as Record<string, unknown> | undefined
      const src = (msg?.source ?? d.source) as Record<string, unknown> | undefined
      if (typeof src?.provider === 'string') ev.provider = src.provider
      if (typeof src?.model === 'string') ev.model = src.model
      const usage = (d.usage ?? msg?.usage) as Record<string, unknown> | undefined
      if (usage && typeof usage === 'object') {
        ev.usage = {
          inputTokens: num(usage.inputTokens),
          outputTokens: num(usage.outputTokens),
          cacheReadTokens: num(usage.cacheReadTokens),
          cacheWriteTokens: num(usage.cacheWriteTokens),
        }
      }
      break
    }
    case 'turn/start':
    case 'turn/end': {
      ev.turn = num(d.turn)
      if (ev.type === 'turn/end') {
        const reason = d.reason as Record<string, unknown> | undefined
        ev.reason = typeof reason?.kind === 'string' ? reason.kind
          : typeof d.reason === 'string' ? d.reason : undefined
      }
      break
    }
    case 'tool/call':
      ev.toolName = typeof d.name === 'string' ? d.name : undefined
      break
    case 'tool/result':
      ev.toolError = d.error !== undefined && d.error !== null
      break
    default:
      break
  }
  return ev
}
