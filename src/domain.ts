import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DayFacts, SessionMetadata, SessionRecord } from './contract.ts'

const count = z.number().int().nonnegative()
const duration = z.number().nonnegative()

const usageSchema = z.object({
  requests: count,
  input: count,
  cacheRead: count,
  cacheWrite: count,
  output: count,
  reasoning: count,
}).strict()

const metricsSchema = z.object({
  usage: usageSchema,
  activity: z.object({
    turns: count,
    steps: count,
    toolCalls: count,
    toolResults: count,
    toolErrors: count,
    outcomes: z.record(z.string(), count),
  }).strict(),
  performance: z.object({
    modelMs: duration,
    toolMs: duration,
    ttftMs: duration,
    ttftSamples: count,
    decodeMs: duration,
    decodeTokens: count,
    messageSamples: count,
  }).strict(),
}).strict()

const dayFactsSchema: z.ZodType<DayFacts> = z.object({
  totals: metricsSchema,
  byProvider: z.record(z.string(), metricsSchema),
  byModel: z.record(z.string(), metricsSchema),
  byRoute: z.record(z.string(), z.object({
    provider: z.string(),
    model: z.string(),
    metrics: metricsSchema,
    byOrigin: z.object({ agent: metricsSchema.optional(), compaction: metricsSchema.optional() }).strict(),
  }).strict()),
  byTool: z.record(z.string(), metricsSchema),
  byOrigin: z.object({ agent: metricsSchema.optional(), compaction: metricsSchema.optional() }).strict(),
}).strict()

const routeSchema = z.object({ provider: z.string(), model: z.string() }).strict()

const sessionRecordSchema = z.object({
  sessionId: z.string(),
  timezone: z.string().optional(),
  watermark: z.number().int().min(-1),
  metadata: z.object({
    cwd: z.string().optional(),
    title: z.string().optional(),
    createdAt: z.number().nonnegative().optional(),
  }).strict(),
  runtime: z.object({
    currentRoute: routeSchema.optional(),
    openStep: z.object({
      turn: count,
      step: count,
      startTime: z.number(),
      firstTokenTime: z.number().optional(),
      messageRecorded: z.boolean().optional(),
      route: routeSchema.optional(),
    }).strict().optional(),
    openUsage: z.object({
      stepKey: z.string(),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      provider: z.string(),
      model: z.string(),
      origin: z.enum(['agent', 'compaction']),
      usage: usageSchema,
    }).strict().optional(),
    lastCountedTurn: z.number().int().nonnegative().nullable(),
    pendingTools: z.record(z.string(), z.object({ name: z.string(), startTime: z.number() }).strict()),
  }).strict(),
  days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dayFactsSchema),
}).strict() as unknown as z.ZodType<SessionRecord>

/** Versioned storage-domain declaration for activity folds. */
export const activityReportDomainSpec = defineDomain({
  name: 'activity_report',
  version: 0,
  tables: {
    sessions: domainTable<SessionId, SessionRecord>(sessionRecordSchema),
  },
})

/** Create an empty durable fold for one Session. */
export function createSessionRecord(sessionId: SessionId, metadata: SessionMetadata = {}, timezone?: string): SessionRecord {
  return {
    sessionId,
    ...(timezone === undefined ? {} : { timezone }),
    watermark: -1,
    metadata: { ...metadata },
    runtime: { lastCountedTurn: null, pendingTools: {} },
    days: {},
  }
}
