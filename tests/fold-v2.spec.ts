import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction/types'
import { activityReportDomainSpec } from '../src/domain.ts'
import { createFoldState, foldEvents, hydrateFoldState } from '../src/fold.ts'
import { totalTokens } from '../src/metrics.ts'

const SESSION_ID = 'session-1' as SessionId
const DAY_1 = '1970-01-01'
const UNKNOWN = '(unknown)'

function event(seq: number, time: number, type: string, data: unknown): SessionEvent {
  return { seq, time, type, data } as SessionEvent
}

function usage(inputTokens: number, outputTokens: number, reasoningTokens = 0) {
  return { inputTokens, outputTokens, cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens }
}

describe('session activity fold', () => {
  it('replaces an early usage chunk with the final message sample', () => {
    const state = createFoldState(SESSION_ID, { cwd: 'G:/project' })
    foldEvents(state, [
      event(0, 100, 'step/start', { turn: 1, step: 1 }),
      event(1, 110, 'request/context', { provider: 'deepseek', model: 'deepseek-v4' }),
      event(2, 150, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }),
      event(3, 200, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: usage(10, 2, 1) } }),
      event(4, 300, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4' } },
        usage: usage(12, 4, 2),
      }),
      event(5, 310, 'step/end', { turn: 1, step: 1 }),
    ])

    const day = state.record.days[DAY_1]!
    expect(day.totals.usage).toEqual({
      requests: 1,
      input: 12,
      cacheRead: 3,
      cacheWrite: 2,
      output: 4,
      reasoning: 2,
    })
    expect(day.byProvider.deepseek?.usage.requests).toBe(1)
    expect(day.byModel['deepseek-v4']?.usage.requests).toBe(1)
    expect(day.byOrigin.agent?.usage.requests).toBe(1)
    expect(day.totals.activity).toMatchObject({ turns: 1, steps: 1 })
    expect(day.totals.performance).toMatchObject({
      modelMs: 200,
      ttftMs: 50,
      ttftSamples: 1,
      decodeMs: 150,
      decodeTokens: 4,
      messageSamples: 1,
    })
    expect(totalTokens(day.totals.usage)).toBe(21)
    expect(activityReportDomainSpec.tables.sessions.valueSchema.safeParse(state.record).success).toBe(true)
  })

  it('retains usage when a failed step never assembles a message', () => {
    const state = createFoldState(SESSION_ID)
    foldEvents(state, [
      event(0, 100, 'step/start', { turn: 1, step: 1 }),
      event(1, 110, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: usage(7, 1) } }),
      event(2, 120, 'step/end', { turn: 1, step: 1 }),
    ])

    expect(state.record.days[DAY_1]?.totals.usage).toMatchObject({ requests: 1, input: 7, output: 1 })
    expect(state.record.days[DAY_1]?.byProvider[UNKNOWN]?.usage.requests).toBe(1)
  })

  it('moves a replaced usage sample to the final message day', () => {
    const state = createFoldState(SESSION_ID)
    const beforeMidnight = Date.parse('2026-08-15T23:59:59+08:00')
    const afterMidnight = Date.parse('2026-08-16T00:00:01+08:00')
    foldEvents(state, [
      event(0, beforeMidnight - 100, 'step/start', { turn: 1, step: 1 }),
      event(1, beforeMidnight, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: usage(4, 1) } }),
      event(2, afterMidnight, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { source: { kind: 'model', provider: 'p', model: 'm' } },
        usage: usage(6, 2),
      }),
    ], 'Asia/Shanghai')

    expect(state.record.days['2026-08-15']).toBeUndefined()
    expect(state.record.days['2026-08-16']?.totals.usage).toMatchObject({ requests: 1, input: 6, output: 2 })
  })

  it('counts compaction usage once under its own origin', () => {
    const state = createFoldState(SESSION_ID)
    foldEvents(state, [
      event(0, 100, 'compaction/summary', {
        compactionId: 'c1',
        summary: [],
        shadowedRange: { start: 0, end: 0 },
        shadowedSeqs: [0],
        shadowedTokenCount: 1,
        provider: 'deepseek',
        model: 'summary-model',
        usage: usage(20, 5),
      }),
    ])

    const day = state.record.days[DAY_1]!
    expect(day.byOrigin.compaction?.usage.requests).toBe(1)
    expect(day.byProvider.deepseek?.usage.input).toBe(20)
    expect(day.totals.activity.steps).toBe(0)
  })

  it('pairs tool results by call id and counts failures', () => {
    const state = createFoldState(SESSION_ID)
    foldEvents(state, [
      event(0, 100, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' }),
      event(1, 160, 'tool/result', {
        turn: 1,
        step: 1,
        message: { source: { callId: 'call-1' } },
        error: { name: 'Error', code: 'FAILED' },
      }),
    ])

    expect(state.record.days[DAY_1]?.totals.activity).toMatchObject({ toolCalls: 1, toolResults: 1, toolErrors: 1 })
    expect(state.record.days[DAY_1]?.byTool.bash?.performance.toolMs).toBe(60)
  })

  it('does not recount or retime a repeated tool call id after hydration', () => {
    const first = createFoldState(SESSION_ID)
    foldEvents(first, [
      event(0, 100, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' }),
    ])
    const resumed = hydrateFoldState(first.record)

    foldEvents(resumed, [
      event(1, 150, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' }),
      event(2, 200, 'tool/result', {
        turn: 1,
        step: 1,
        message: { source: { callId: 'call-1' } },
      }),
    ])

    expect(resumed.record.days[DAY_1]?.totals.activity).toMatchObject({ toolCalls: 1, toolResults: 1 })
    expect(resumed.record.days[DAY_1]?.byTool.bash?.performance.toolMs).toBe(100)
  })

  it('ignores replayed events at or below the watermark', () => {
    const state = createFoldState(SESSION_ID)
    const events = [event(0, 100, 'step/end', { turn: 1, step: 1 })]
    foldEvents(state, events)
    foldEvents(state, events)
    expect(state.record.days[DAY_1]?.totals.activity).toMatchObject({ turns: 1, steps: 1 })
  })
})
