import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type { RequestOrigin, RouteRef } from './contract.ts'
import type { UsageMetrics } from './metrics.ts'

interface BaseActivityEvent {
  seq: number
  time: number
}

/** Minimal typed facts consumed by the activity fold. */
export type ActivityEvent = BaseActivityEvent & (
  | { kind: 'route'; route: RouteRef }
  | { kind: 'step-start'; turn: number; step: number }
  | { kind: 'first-token'; turn: number; step: number }
  | { kind: 'usage'; turn: number; step: number; usage: UsageMetrics; origin: 'agent' }
  | { kind: 'message'; turn: number; step: number; route: RouteRef; usage?: UsageMetrics }
  | { kind: 'step-end'; turn: number; step: number }
  | { kind: 'turn-end'; turn: number; outcome: string }
  | { kind: 'tool-call'; callId: string; name: string }
  | { kind: 'tool-result'; callId: string; failed: boolean }
  | { kind: 'aux-usage'; route: RouteRef; usage: UsageMetrics; origin: Extract<RequestOrigin, 'compaction'> }
  | { kind: 'ignored' }
)

function usageMetrics(usage: TokenUsage): UsageMetrics {
  return {
    requests: 1,
    input: usage.inputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    output: usage.outputTokens,
    reasoning: usage.reasoningTokens ?? 0,
  }
}

function carriesFirstToken(chunk: Extract<SessionEvent, { type: 'assistant/chunk' }>['data']['chunk']): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/** Adapt one validated DSH Session event into a small fold event. */
export function adaptEvent(event: SessionEvent): ActivityEvent {
  const base = { seq: event.seq, time: event.time }
  switch (event.type) {
    case 'request/context':
      return { ...base, kind: 'route', route: { provider: event.data.provider, model: event.data.model } }
    case 'step/start':
      return { ...base, kind: 'step-start', turn: event.data.turn, step: event.data.step }
    case 'assistant/chunk':
      if (event.data.chunk.type === 'usage') {
        return {
          ...base,
          kind: 'usage',
          turn: event.data.turn,
          step: event.data.step,
          usage: usageMetrics(event.data.chunk.usage),
          origin: 'agent',
        }
      }
      return carriesFirstToken(event.data.chunk)
        ? { ...base, kind: 'first-token', turn: event.data.turn, step: event.data.step }
        : { ...base, kind: 'ignored' }
    case 'assistant/message':
      return {
        ...base,
        kind: 'message',
        turn: event.data.turn,
        step: event.data.step,
        route: {
          provider: event.data.message.source.provider,
          model: event.data.message.source.model,
        },
        ...event.data.usage === undefined ? {} : { usage: usageMetrics(event.data.usage) },
      }
    case 'step/end':
      return { ...base, kind: 'step-end', turn: event.data.turn, step: event.data.step }
    case 'turn/end':
      return { ...base, kind: 'turn-end', turn: event.data.turn, outcome: event.data.reason.kind }
    case 'tool/call':
      return { ...base, kind: 'tool-call', callId: event.data.callId, name: event.data.name }
    case 'tool/result':
      return {
        ...base,
        kind: 'tool-result',
        callId: event.data.message.source.callId,
        failed: event.data.error !== undefined,
      }
    case 'compaction/summary':
      return event.data.usage === undefined
        ? { ...base, kind: 'ignored' }
        : {
            ...base,
            kind: 'aux-usage',
            route: { provider: event.data.provider, model: event.data.model },
            usage: usageMetrics(event.data.usage),
            origin: 'compaction',
          }
    default:
      return { ...base, kind: 'ignored' }
  }
}
