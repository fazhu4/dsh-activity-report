/**
 * Event adaptation tests: verify real DSH event shapes (both the direct-payload
 * and `data:` envelope forms) map to the fold view correctly.
 */
import { describe, expect, it } from 'vitest'
import { toFoldEvent } from '../src/adapt.ts'

describe('toFoldEvent: assistant/message', () => {
  it('reads provider/model/usage from the direct payload shape', () => {
    const ev = toFoldEvent({
      seq: 5,
      time: 1234,
      type: 'assistant/message',
      turn: 1,
      step: 0,
      message: {
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        content: [],
      },
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
    })
    expect(ev).toMatchObject({
      seq: 5,
      time: 1234,
      type: 'assistant/message',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
    })
  })

  it('reads usage from the message when top-level usage is absent', () => {
    const ev = toFoldEvent({
      seq: 1,
      time: 1,
      type: 'assistant/message',
      message: {
        source: { provider: 'p', model: 'm' },
        usage: { inputTokens: 7, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    })
    expect(ev.usage?.inputTokens).toBe(7)
    expect(ev.usage?.outputTokens).toBe(8)
  })

  it('handles the data-envelope shape', () => {
    const ev = toFoldEvent({
      seq: 2,
      time: 2,
      type: 'assistant/message',
      data: {
        message: { source: { provider: 'p', model: 'm' } },
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
      },
    })
    expect(ev.provider).toBe('p')
    expect(ev.usage?.cacheReadTokens).toBe(3)
  })

  it('omits usage when absent', () => {
    const ev = toFoldEvent({ seq: 0, time: 0, type: 'assistant/message', message: { source: { provider: 'p', model: 'm' } } })
    expect(ev.usage).toBeUndefined()
  })
})

describe('toFoldEvent: turns', () => {
  it('reads turn number and reason kind', () => {
    const end = toFoldEvent({ seq: 3, time: 9, type: 'turn/end', turn: 2, reason: { kind: 'max-tokens' } })
    expect(end.turn).toBe(2)
    expect(end.reason).toBe('max-tokens')
    const start = toFoldEvent({ seq: 2, time: 8, type: 'turn/start', turn: 2 })
    expect(start.turn).toBe(2)
    expect(start.reason).toBeUndefined()
  })

  it('accepts a string reason', () => {
    const ev = toFoldEvent({ seq: 4, time: 10, type: 'turn/end', turn: 3, reason: 'completed' })
    expect(ev.reason).toBe('completed')
  })
})

describe('toFoldEvent: tools', () => {
  it('reads tool name and error flag', () => {
    const call = toFoldEvent({ seq: 5, time: 11, type: 'tool/call', name: 'bash', arguments: 'ls' })
    expect(call.toolName).toBe('bash')
    const ok = toFoldEvent({ seq: 6, time: 12, type: 'tool/result', message: { content: [] } })
    expect(ok.toolError).toBe(false)
    const fail = toFoldEvent({ seq: 7, time: 13, type: 'tool/result', message: { content: [] }, error: { name: 'E', code: 'FS_NOT_FOUND' } })
    expect(fail.toolError).toBe(true)
  })
})

describe('toFoldEvent: unknown', () => {
  it('maps unknown types to type-only fold events', () => {
    const ev = toFoldEvent({ seq: 8, time: 14, type: 'todo/write', todos: [] })
    expect(ev).toEqual({ seq: 8, time: 14, type: 'todo/write' })
  })
})
