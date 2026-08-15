import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { adaptEvent } from '../src/adapt.ts'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq * 10, type, data } as SessionEvent
}

describe('typed Session event adaptation', () => {
  it('maps the provider route and all provider usage buckets', () => {
    expect(adaptEvent(event(1, 'assistant/message', {
      turn: 2,
      step: 3,
      message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4' } },
      usage: {
        inputTokens: 10,
        cacheReadTokens: 4,
        cacheWriteTokens: 2,
        outputTokens: 8,
        reasoningTokens: 3,
      },
    }))).toMatchObject({
      kind: 'message',
      turn: 2,
      step: 3,
      route: { provider: 'deepseek', model: 'deepseek-v4' },
      usage: { requests: 1, input: 10, cacheRead: 4, cacheWrite: 2, output: 8, reasoning: 3 },
    })
  })

  it('does not treat an empty streaming delta as the first token', () => {
    expect(adaptEvent(event(1, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: '' },
    })).kind).toBe('ignored')
    expect(adaptEvent(event(2, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'tool-call-delta', index: 0, id: 'c1', argumentsDelta: '', name: 'bash' },
    })).kind).toBe('first-token')
  })

  it('keeps compaction usage separate from agent requests', () => {
    expect(adaptEvent(event(1, 'compaction/summary', {
      provider: 'deepseek',
      model: 'summary',
      usage: { inputTokens: 20, outputTokens: 5 },
    }))).toMatchObject({
      kind: 'aux-usage',
      origin: 'compaction',
      route: { provider: 'deepseek', model: 'summary' },
    })
  })
})
