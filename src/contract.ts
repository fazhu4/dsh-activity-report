import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Metrics, UsageMetrics } from './metrics.ts'

/** Model-call origin shown separately in usage breakdowns. */
export type RequestOrigin = 'agent' | 'compaction'

/** Provider route attached to one model request. */
export interface RouteRef {
  provider: string
  model: string
}

/** Joint provider/model aggregate required for exact combined filtering. */
export interface RouteFacts extends RouteRef {
  metrics: Metrics
  byOrigin: Partial<Record<RequestOrigin, Metrics>>
}

/** One natural-day aggregate inside a session record. */
export interface DayFacts {
  totals: Metrics
  byProvider: Record<string, Metrics>
  byModel: Record<string, Metrics>
  byRoute: Record<string, RouteFacts>
  byTool: Record<string, Metrics>
  byOrigin: Partial<Record<RequestOrigin, Metrics>>
}

/** Replaceable provider usage sample for the currently open step. */
export interface UsageSample {
  stepKey: string
  day: string
  provider: string
  model: string
  origin: RequestOrigin
  usage: UsageMetrics
}

/** Incremental timing state for an open Agent step. */
export interface OpenStep {
  turn: number
  step: number
  startTime: number
  firstTokenTime?: number
  messageRecorded?: boolean
  route?: RouteRef
}

/** Tool call awaiting its durable result. */
export interface PendingTool {
  name: string
  startTime: number
}

/** Cross-event state required to continue an incremental fold after restart. */
export interface RuntimeFoldState {
  currentRoute?: RouteRef
  openStep?: OpenStep
  openUsage?: UsageSample
  lastCountedTurn: number | null
  pendingTools: Record<string, PendingTool>
  /** Tool call IDs already counted, including calls completed before restart. */
  seenToolCalls?: Record<string, true>
}

/** Metadata displayed for one local Session. */
export interface SessionMetadata {
  cwd?: string
  title?: string
  createdAt?: number
}

/** One atomically persisted per-session fold. */
export interface SessionRecord {
  sessionId: SessionId
  /** IANA timezone used to assign this derived projection's day buckets. */
  timezone?: string
  watermark: number
  metadata: SessionMetadata
  runtime: RuntimeFoldState
  days: Record<string, DayFacts>
}

/** Supported natural-day range presets. */
export type ActivityRange = 'today' | '7d' | '30d' | 'all'

/** Filters shared by summary, detail, and export queries. */
export interface ActivityFilters {
  range: ActivityRange
  timezone: string
  now: number
  workspaces?: readonly string[]
  providers?: readonly string[]
  models?: readonly string[]
}

/** One named metric group in a summary or detail response. */
export interface MetricGroup {
  key: string
  metrics: Metrics
}

/** Reported-sample coverage for one metric family. */
export interface CoverageCount {
  samples: number
  total: number
}

/** Coverage needed to distinguish unavailable measurements from measured zero. */
export interface ActivityCoverage {
  agentUsage: CoverageCount
  modelTiming: CoverageCount
  ttft: CoverageCount
  toolTiming: CoverageCount
}

/** One natural-day point in the usage trend. */
export interface DailyMetricPoint {
  day: string
  metrics: Metrics
}

/** Reconciled data used by cards, trends, and filter options. */
export interface ActivitySummary {
  range: ActivityRange
  timezone: string
  startDay: string
  endDayExclusive: string
  totals: Metrics
  series: DailyMetricPoint[]
  byProvider: MetricGroup[]
  byModel: MetricGroup[]
  byOrigin: MetricGroup[]
  coverage: ActivityCoverage
  activeSessions: number
  activeWorkspaces: number
}

/** Observable ingestion and durability state returned with summary data. */
export interface ActivityDataStatus {
  phase: 'backfilling' | 'ready' | 'degraded' | 'disposed'
  processedSessions: number
  totalSessions: number
  failedSessions: number
  dirtyCount: number
  lastPersistedAt?: number
}

/** Summary response served to the browser. */
export interface ActivitySummaryResponse extends ActivitySummary {
  status: ActivityDataStatus
}

/** Available server-derived filter values and observed day span. */
export interface ActivityFilterOptions {
  workspaces: string[]
  providers: string[]
  models: string[]
}

/** Context shared by every filtered JSON response. */
export interface ActivityResponseContext {
  timezone: string
  startDay: string
  endDayExclusive: string
  status: ActivityDataStatus
  coverage: ActivityCoverage
}

/** Scoped filter values with the exact query context that produced them. */
export interface ActivityFilterResponse extends ActivityFilterOptions, ActivityResponseContext {}

/** Supported analysis-table dimensions. */
export type BreakdownDimension = 'workspace' | 'provider' | 'model' | 'session' | 'tool'

/** Stable sortable metric columns supported by the query layer. */
export type BreakdownSort = 'key' | 'tokens' | 'requests' | 'turns' | 'steps' | 'toolCalls' | 'toolErrors' | 'modelMs' | 'toolMs'

/** One dimension row; session rows include navigation metadata. */
export interface BreakdownRow extends MetricGroup {
  sessionId?: SessionId
  title?: string
  cwd?: string
}

/** Cursor-paginated dimension response. */
export interface BreakdownPage {
  dimension: BreakdownDimension
  rows: BreakdownRow[]
  nextCursor?: string
}

/** Breakdown page with the exact query context that produced its rows. */
export interface BreakdownResponse extends BreakdownPage, ActivityResponseContext {}

/** Inputs for a stable breakdown query. */
export interface BreakdownQuery extends ActivityFilters {
  dimension: BreakdownDimension
  sort: BreakdownSort
  direction: 'asc' | 'desc'
  limit: number
  cursor?: string
  search?: string
}
