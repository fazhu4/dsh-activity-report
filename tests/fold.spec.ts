/**
 * Pure fold unit tests: token accounting, tool grouping, turn durations,
 * outcome distribution, per-provider/model subtotals, and watermark increment.
 */
import { describe, expect, it } from 'vitest'
import type { FoldEvent } from '../src/fold.ts'
import { createFoldState, foldEvent, foldEvents } from '../src/fold.ts'

function msg(seq: number, time: number, usage: FoldEvent['usage'], provider = 'deepseek-official', model = 'deepseek-v4-flash'): FoldEvent {
  return { seq, time, type: 'assistant/message', provider, model, usage }
}

describe('fold: token accounting', () => {
  it('sums request counts and four token buckets', () => {
    const st = createFoldState()
    foldEvents(st, [
      msg(0, 1000, { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 5 }),
      msg(1, 2000, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }),
    ])
    expect(st.fold.stats.requests).toBe(2)
    expect(st.fold.stats.tokens).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 9 })
  })

  it('skips assistant messages without usage', () => {
    const st = createFoldState()
    foldEvent(st, { seq: 0, time: 0, type: 'assistant/message' })
    expect(st.fold.stats.requests).toBe(0)
  })
})

describe('fold: provider / model subtotals', () => {
  it('splits requests and tokens by provider and model', () => {
    const st = createFoldState()
    foldEvents(st, [
      msg(0, 0, { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'deepseek-official', 'deepseek-v4-flash'),
      msg(1, 0, { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'opencode-go', 'deepseek-v4-flash'),
      msg(2, 0, { inputTokens: 30, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'deepseek-official', 'deepseek-v4-pro'),
    ])
    expect(st.fold.byProvider['deepseek-official'].requests).toBe(2)
    expect(st.fold.byProvider['deepseek-official'].tokens.input).toBe(40)
    expect(st.fold.byProvider['opencode-go'].requests).toBe(1)
    expect(st.fold.byModel['deepseek-v4-flash'].requests).toBe(2)
    expect(st.fold.byModel['deepseek-v4-pro'].requests).toBe(1)
  })
})

describe('fold: turns and durations', () => {
  it('counts turns and their end reasons', () => {
    const st = createFoldState()
    foldEvents(st, [
      { seq: 0, time: 1000, type: 'turn/start', turn: 1 },
      { seq: 1, time: 5000, type: 'turn/end', turn: 1, reason: 'completed' },
      { seq: 2, time: 6000, type: 'turn/start', turn: 2 },
      { seq: 3, time: 9000, type: 'turn/end', turn: 2, reason: 'error' },
    ])
    expect(st.fold.stats.turns).toBe(2)
    expect(st.fold.stats.outcomes).toEqual({ completed: 1, error: 1 })
  })

  it('computes durations from turn/start to turn/end', () => {
    const st = createFoldState()
    foldEvents(st, [
      { seq: 0, time: 1000, type: 'turn/start', turn: 1 },
      { seq: 1, time: 5100, type: 'turn/end', turn: 1, reason: 'completed' },
    ])
    expect(st.fold.stats.durationMs).toBe(4100)
  })

  it('ignores a turn/end with no matching start', () => {
    const st = createFoldState()
    foldEvent(st, { seq: 0, time: 1000, type: 'turn/end', turn: 9, reason: 'aborted' })
    expect(st.fold.stats.turns).toBe(1)
    expect(st.fold.stats.durationMs).toBe(0)
  })
})

describe('fold: tool calls', () => {
  it('groups tool calls by name and counts errors', () => {
    const st = createFoldState()
    foldEvents(st, [
      { seq: 0, time: 0, type: 'tool/call', toolName: 'bash' },
      { seq: 1, time: 0, type: 'tool/call', toolName: 'bash' },
      { seq: 2, time: 0, type: 'tool/call', toolName: 'read' },
      { seq: 3, time: 0, type: 'tool/result', toolError: true },
      { seq: 4, time: 0, type: 'tool/result' },
    ])
    expect(st.fold.stats.toolCalls).toEqual({ bash: 2, read: 1 })
    expect(st.fold.stats.toolErrors).toBe(1)
  })
})

describe('fold: steps fallback (compacted logs)', () => {
  it('counts step/end events as activity steps', () => {
    const st = createFoldState()
    foldEvents(st, [
      { seq: 0, time: 0, type: 'step/end', turn: 1 },
      { seq: 1, time: 0, type: 'step/end', turn: 1 },
    ])
    expect(st.fold.stats.steps).toBe(2)
    expect(st.fold.stats.turns).toBe(0)
  })
})

describe('fold: per-day distribution', () => {
  it('buckets assistant messages by local day key', () => {
    const st = createFoldState()
    // 2026-08-15T10:00:00 local
    const day1 = new Date(2026, 7, 15, 10, 0, 0).getTime()
    // 2026-08-16T01:00:00 local (crossing midnight)
    const day2 = new Date(2026, 7, 16, 1, 0, 0).getTime()
    foldEvents(st, [
      msg(0, day1, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 1 }),
      msg(1, day2, { inputTokens: 20, outputTokens: 6, cacheReadTokens: 200, cacheWriteTokens: 2 }),
    ])
    const keys = Object.keys(st.fold.byDay).sort()
    expect(keys.length).toBe(2)
    const first = st.fold.byDay[keys[0]]
    expect(first.requests).toBe(1)
    expect(first.tokens.input).toBe(10)
    expect(first.tokens.cacheRead).toBe(100)
    const second = st.fold.byDay[keys[1]]
    expect(second.requests).toBe(1)
    expect(second.tokens.output).toBe(6)
  })

  it('uses local calendar dates (not UTC)', () => {
    const st = createFoldState()
    // 2026-08-16 01:00 local in UTC+8 == 2026-08-15 17:00 UTC.
    // If the key were UTC it would be 08-15; local must be 08-16.
    const late = new Date(2026, 7, 16, 1, 0, 0).getTime()
    foldEvent(st, msg(0, late, { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    const keys = Object.keys(st.fold.byDay)
    expect(keys).toEqual(['2026-08-16'])
  })
})

describe('fold: watermark increment', () => {
  it('skips events at or below the watermark', () => {
    const st = createFoldState()
    foldEvents(st, [
      msg(0, 0, { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      msg(1, 0, { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ])
    expect(st.fold.watermark).toBe(1)
    expect(st.fold.stats.requests).toBe(2)

    // Re-fold the same events (simulating a re-read of a full log): no double count.
    foldEvents(st, [
      msg(0, 0, { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      msg(1, 0, { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ])
    expect(st.fold.stats.requests).toBe(2)

    // A genuinely new event past the watermark counts.
    foldEvents(st, [msg(2, 0, { inputTokens: 30, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })])
    expect(st.fold.stats.requests).toBe(3)
    expect(st.fold.stats.tokens.input).toBe(60)
  })

  it('is idempotent across incremental folds with out-of-order input', () => {
    const st = createFoldState()
    foldEvents(st, [
      msg(2, 0, { inputTokens: 30, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      msg(0, 0, { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      msg(1, 0, { inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ])
    // seq 0/1 fold in order; seq 2 folded when first seen (watermark 2), the
    // later arrival of seq 0/1 is skipped because 0 <= 2, 1 <= 2.
    expect(st.fold.stats.requests).toBe(1)
    expect(st.fold.stats.tokens.input).toBe(30)
    expect(st.fold.watermark).toBe(2)
  })
})

describe('fold: cwd and title', () => {
  it('keeps cwd and title on the fold', () => {
    const st = createFoldState('G:/proj', 'Fix the build')
    expect(st.fold.cwd).toBe('G:/proj')
    expect(st.fold.title).toBe('Fix the build')
  })
})
