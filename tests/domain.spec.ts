import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { activityReportDomainSpec, createSessionRecord } from '../src/domain.ts'

const SESSION_ID = 'session-1' as SessionId

describe('activity report durable domain', () => {
  it('accepts a fresh session record', () => {
    const record = createSessionRecord(SESSION_ID, {
      cwd: 'G:/project',
      title: 'Inspect usage',
      createdAt: 123,
    })

    expect(activityReportDomainSpec.tables.sessions.valueSchema.safeParse(record).success).toBe(true)
    expect(record).toMatchObject({
      sessionId: SESSION_ID,
      watermark: -1,
      metadata: { cwd: 'G:/project', title: 'Inspect usage', createdAt: 123 },
      days: {},
    })
  })

  it('rejects a negative token count at the durable boundary', () => {
    const record = createSessionRecord(SESSION_ID)
    record.days['2026-08-16'] = {
      totals: {
        usage: { requests: 1, input: -1, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
        activity: { turns: 0, steps: 0, toolCalls: 0, toolResults: 0, toolErrors: 0, outcomes: {} },
        performance: { modelMs: 0, toolMs: 0, ttftMs: 0, ttftSamples: 0, decodeMs: 0, decodeTokens: 0, messageSamples: 0 },
      },
      byProvider: {},
      byModel: {},
      byTool: {},
      byOrigin: {},
    }

    expect(activityReportDomainSpec.tables.sessions.valueSchema.safeParse(record).success).toBe(false)
  })
})
