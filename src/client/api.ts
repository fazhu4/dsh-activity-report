import { z } from 'zod'
import type {
  ActivityDataStatus,
  ActivityFilterResponse,
  ActivityRange,
  ActivitySummaryResponse,
  BreakdownDimension,
  BreakdownResponse,
  BreakdownSort,
} from '../contract.ts'

/** Browser-side filters encoded as repeated host query parameters. */
export interface ClientFilters {
  range: ActivityRange
  workspace?: string
  provider?: string
  model?: string
}

/** Browser-side breakdown request. */
export interface ClientBreakdownQuery extends ClientFilters {
  dimension: BreakdownDimension
  sort: BreakdownSort
  direction: 'asc' | 'desc'
  limit: number
  cursor?: string
  search?: string
}

/** Abortable validated API used by the settings section. */
export interface ActivityClient {
  summary(query: ClientFilters, signal?: AbortSignal): Promise<ActivitySummaryResponse>
  breakdown(query: ClientBreakdownQuery, signal?: AbortSignal): Promise<BreakdownResponse>
  filters(query: ClientFilters, signal?: AbortSignal): Promise<ActivityFilterResponse>
  retry(signal?: AbortSignal): Promise<ActivityDataStatus>
  exportUrl(query: ClientBreakdownQuery): string
}

const count = z.number().int().nonnegative()
const duration = z.number().nonnegative()
const usage = z.object({
  requests: count, input: count, cacheRead: count, cacheWrite: count, output: count, reasoning: count,
}).strict()
const metrics = z.object({
  usage,
  activity: z.object({
    turns: count, steps: count, toolCalls: count, toolResults: count, toolErrors: count,
    outcomes: z.record(z.string(), count),
  }).strict(),
  performance: z.object({
    modelMs: duration, toolMs: duration, ttftMs: duration, ttftSamples: count,
    decodeMs: duration, decodeTokens: count, messageSamples: count,
  }).strict(),
}).strict()
const group = z.object({ key: z.string(), metrics }).strict()
const coverageSchema = z.object({
  agentUsage: z.object({ samples: count, total: count }).strict(),
  modelTiming: z.object({ samples: count, total: count }).strict(),
  ttft: z.object({ samples: count, total: count }).strict(),
  toolTiming: z.object({ samples: count, total: count }).strict(),
}).strict()
const statusSchema = z.object({
  phase: z.enum(['backfilling', 'ready', 'degraded', 'disposed']),
  processedSessions: count,
  totalSessions: count,
  failedSessions: count,
  dirtyCount: count,
  lastPersistedAt: z.number().optional(),
}).strict()
const summarySchema = z.object({
  range: z.enum(['today', '7d', '30d', 'all']),
  timezone: z.string().min(1),
  startDay: z.string(),
  endDayExclusive: z.string(),
  totals: metrics,
  series: z.array(z.object({ day: z.string(), metrics }).strict()),
  byProvider: z.array(group),
  byModel: z.array(group),
  byOrigin: z.array(group),
  coverage: coverageSchema,
  activeSessions: count,
  activeWorkspaces: count,
  status: statusSchema,
}).strict()
const breakdownSchema = z.object({
  dimension: z.enum(['workspace', 'provider', 'model', 'session', 'tool']),
  rows: z.array(z.object({
    key: z.string(),
    metrics,
    byOrigin: z.array(group).optional(),
    sessionId: z.string().optional(),
    title: z.string().optional(),
    cwd: z.string().optional(),
  }).strict()),
  nextCursor: z.string().optional(),
  timezone: z.string().min(1),
  startDay: z.string(),
  endDayExclusive: z.string(),
  status: statusSchema,
  coverage: coverageSchema,
}).strict()
const filtersSchema = z.object({
  workspaces: z.array(z.string()),
  providers: z.array(z.string()),
  models: z.array(z.string()),
  timezone: z.string().min(1),
  startDay: z.string(),
  endDayExclusive: z.string(),
  status: statusSchema,
  coverage: coverageSchema,
}).strict()

function params(query: ClientFilters & Partial<ClientBreakdownQuery>): URLSearchParams {
  const result = new URLSearchParams({ range: query.range })
  if (query.workspace !== undefined) result.append('workspace', query.workspace)
  if (query.provider !== undefined) result.append('provider', query.provider)
  if (query.model !== undefined) result.append('model', query.model)
  if (query.dimension !== undefined) result.set('dimension', query.dimension)
  if (query.sort !== undefined) result.set('sort', query.sort)
  if (query.direction !== undefined) result.set('direction', query.direction)
  if (query.limit !== undefined) result.set('limit', String(query.limit))
  if (query.cursor !== undefined) result.set('cursor', query.cursor)
  if (query.search !== undefined && query.search !== '') result.set('search', query.search)
  return result
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown }
    throw new Error(typeof body.error === 'string' ? body.error : `activity request failed with ${response.status}`)
  }
  return response.json()
}

/** Create the production browser API over the current DSH Web origin. */
export function createActivityClient(fetcher: typeof globalThis.fetch = globalThis.fetch): ActivityClient {
  return {
    summary: async (query, signal) => summarySchema.parse(await json(await fetcher(
      `/dsh-activity-report/summary?${params(query)}`,
      { signal },
    ))) as ActivitySummaryResponse,
    breakdown: async (query, signal) => breakdownSchema.parse(await json(await fetcher(
      `/dsh-activity-report/breakdown?${params(query)}`,
      { signal },
    ))) as BreakdownResponse,
    filters: async (query, signal) => filtersSchema.parse(await json(await fetcher(
      `/dsh-activity-report/filters?${params(query)}`,
      { signal },
    ))) as ActivityFilterResponse,
    retry: async (signal) => {
      const response = await json(await fetcher('/dsh-activity-report/retry', { method: 'POST', signal }))
      return statusSchema.parse((response as { status?: unknown }).status) as ActivityDataStatus
    },
    exportUrl: (query) => `/dsh-activity-report/export.csv?${params(query)}`,
  }
}
