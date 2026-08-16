import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { createFoldState, foldEvents } from '../src/fold.ts'
import { queryBreakdown, queryFilterOptions, querySummary } from '../src/query.ts'
import { addMetrics, emptyMetrics, totalTokens } from '../src/metrics.ts'
import type { Metrics } from '../src/metrics.ts'

const NOW = Date.parse('2026-08-16T12:00:00+08:00')

function event(seq: number, time: number, type: string, data: unknown): SessionEvent {
  return { seq, time, type, data } as SessionEvent
}

function record(id: string, cwd: string, samples: Array<{ day: string; provider: string; model: string; input: number }>) {
  const state = createFoldState(id as SessionId, { cwd, title: id })
  let seq = 0
  for (const sample of samples) {
    const time = Date.parse(`${sample.day}T10:00:00+08:00`)
    foldEvents(state, [
      event(seq++, time - 100, 'step/start', { turn: seq, step: 1 }),
      event(seq++, time - 90, 'request/context', { provider: sample.provider, model: sample.model }),
      event(seq++, time, 'assistant/message', {
        turn: seq - 2,
        step: 1,
        message: { source: { kind: 'model', provider: sample.provider, model: sample.model } },
        usage: { inputTokens: sample.input, outputTokens: 2 },
      }),
      event(seq++, time + 10, 'step/end', { turn: seq - 3, step: 1 }),
    ], 'Asia/Shanghai')
  }
  return state.record
}

function sum(values: readonly Metrics[]): Metrics {
  const result = emptyMetrics()
  for (const value of values) addMetrics(result, value)
  return result
}

const records = [
  record('session-a', 'G:/alpha', [
    { day: '2026-08-16', provider: 'p1', model: 'm1', input: 10 },
    { day: '2026-08-15', provider: 'p1', model: 'm2', input: 20 },
  ]),
  record('session-b', 'G:/beta', [
    { day: '2026-08-16', provider: 'p2', model: 'm1', input: 30 },
  ]),
]

describe('reconciled activity queries', () => {
  it('uses the same day buckets for cards, trend, and model rows', () => {
    const result = querySummary(records, {
      range: '7d', timezone: 'Asia/Shanghai', now: NOW,
    })
    expect(result.startDay).toBe('2026-08-10')
    expect(result.endDayExclusive).toBe('2026-08-17')
    expect(result.totals.usage).toEqual(sum(result.series.map((item) => item.metrics)).usage)
    expect(result.totals.usage).toEqual(sum(result.byModel.map((item) => item.metrics)).usage)
    expect(result.activeSessions).toBe(2)
    expect(result.activeWorkspaces).toBe(2)
  })

  it('applies provider and model filters as an exact intersection', () => {
    const result = querySummary(records, {
      range: '7d', timezone: 'Asia/Shanghai', now: NOW, providers: ['p1'], models: ['m1'],
    })
    expect(result.totals.usage.requests).toBe(1)
    expect(result.totals.usage.input).toBe(10)
  })

  it('uses natural calendar days for today', () => {
    const result = querySummary(records, { range: 'today', timezone: 'Asia/Shanghai', now: NOW })
    expect(result.series.map((item) => item.day)).toEqual(['2026-08-16'])
    expect(result.totals.usage.requests).toBe(2)
  })

  it('scopes selector values to the range and active route filters', () => {
    const options = queryFilterOptions(records, {
      range: 'today', timezone: 'Asia/Shanghai', now: NOW, providers: ['p1'], models: ['m1'],
    })

    expect(options.workspaces).toEqual(['G:/alpha'])
    expect(options.providers).toEqual(['p1', 'p2'])
    expect(options.models).toEqual(['m1'])
  })

  it('paginates a stable token-descending session list', () => {
    const filters = { range: '7d' as const, timezone: 'Asia/Shanghai', now: NOW }
    const first = queryBreakdown(records, {
      ...filters, dimension: 'session', sort: 'tokens', direction: 'desc', limit: 1,
    })
    const second = queryBreakdown(records, {
      ...filters, dimension: 'session', sort: 'tokens', direction: 'desc', limit: 1,
      cursor: first.nextCursor,
    })
    expect(first.rows).toHaveLength(1)
    expect(second.rows).toHaveLength(1)
    expect(first.rows[0]?.key).not.toBe(second.rows[0]?.key)
    expect(totalTokens(first.rows[0]!.metrics.usage)).toBeGreaterThanOrEqual(totalTokens(second.rows[0]!.metrics.usage))
  })

  it('preserves request-origin aggregates in model rows', () => {
    const page = queryBreakdown(records, {
      range: '7d', timezone: 'Asia/Shanghai', now: NOW,
      dimension: 'model', sort: 'tokens', direction: 'desc', limit: 25,
    })
    const model = page.rows.find((row) => row.key === 'm1')

    expect(model?.byOrigin?.find((group) => group.key === 'agent')?.metrics.usage.requests).toBe(2)
    expect(model?.metrics.activity.steps).toBe(2)
  })

  it('rejects a cursor created for another sort', () => {
    const filters = { range: 'all' as const, timezone: 'Asia/Shanghai', now: NOW }
    const first = queryBreakdown(records, {
      ...filters, dimension: 'session', sort: 'tokens', direction: 'desc', limit: 1,
    })
    expect(() => queryBreakdown(records, {
      ...filters, dimension: 'session', sort: 'requests', direction: 'desc', limit: 1,
      cursor: first.nextCursor,
    })).toThrow(/cursor/i)
  })

  it('rejects a cursor created for another normalized filter scope', () => {
    const filters = { range: '7d' as const, timezone: 'Asia/Shanghai', now: NOW }
    const first = queryBreakdown(records, {
      ...filters, dimension: 'session', sort: 'tokens', direction: 'desc', limit: 1,
    })

    expect(() => queryBreakdown(records, {
      ...filters,
      workspaces: ['G:/beta'],
      dimension: 'session', sort: 'tokens', direction: 'desc', limit: 1,
      cursor: first.nextCursor,
    })).toThrow('cursor does not match this query')
  })

  it('rejects pagination after the underlying projection changes', () => {
    const filters = { range: '7d' as const, timezone: 'Asia/Shanghai', now: NOW }
    const first = queryBreakdown(records, {
      ...filters, dimension: 'session', sort: 'tokens', direction: 'desc', limit: 1,
    })
    const changed = structuredClone(records)
    changed[0]!.watermark += 1

    expect(() => queryBreakdown(changed, {
      ...filters, dimension: 'session', sort: 'tokens', direction: 'desc', limit: 1,
      cursor: first.nextCursor,
    })).toThrow('activity data changed')
  })

  it('rejects route filters for unattributed tool facts', () => {
    expect(() => queryBreakdown(records, {
      range: 'today', timezone: 'Asia/Shanghai', now: NOW,
      dimension: 'tool', sort: 'toolCalls', direction: 'desc', limit: 25,
      providers: ['p1'],
    })).toThrow(/not supported/i)
  })
})
