import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  ActivityFilters,
  ActivityRange,
  BreakdownDimension,
  BreakdownQuery,
  BreakdownRow,
  BreakdownSort,
  SessionRecord,
} from './contract.ts'
import type { ActivityRuntimeStatus } from './host.ts'
import { dayKey } from './fold.ts'
import { ActivityQueryError, queryBreakdown, queryFilterOptions, querySummary } from './query.ts'
import { totalTokens } from './metrics.ts'

/** Web server route registration format used by DSH. */
export interface WebRoute {
  kind: 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** Minimal DSH Web server registration face. */
export interface WebServerFace {
  register(route: WebRoute): () => void
}

/** Live data and status source served through the activity API. */
export interface ActivityHttpSource {
  records(): SessionRecord[]
  status(): ActivityRuntimeStatus
  now(): number
  timezone(): string
  retryPersistence(): Promise<void>
  onError?(error: unknown): void
}

/** HTTP-level defaults that remain configurable by the deployment. */
export interface ActivityHttpConfig {
  defaultPageSize: number
}

class RequestError extends Error {}

function one(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name)
  if (values.length > 1) throw new RequestError(`${name} must appear at most once`)
  return values[0]
}

function repeated(params: URLSearchParams, name: string): string[] | undefined {
  const values = params.getAll(name)
  if (values.some((value) => value.trim() === '')) throw new RequestError(`${name} must not be empty`)
  const unique = [...new Set(values)]
  return unique.length === 0 ? undefined : unique
}

function enumValue<T extends string>(value: string | undefined, values: readonly T[], fallback: T, name: string): T {
  if (value === undefined) return fallback
  if (!(values as readonly string[]).includes(value)) throw new RequestError(`invalid ${name}: ${value}`)
  return value as T
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!/^\d+$/.test(value)) throw new RequestError(`${name} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new RequestError(`${name} is outside the safe integer range`)
  return parsed
}

function filters(params: URLSearchParams, source: ActivityHttpSource): ActivityFilters {
  return {
    range: enumValue(one(params, 'range'), ['today', '7d', '30d', 'all'], '30d', 'range') as ActivityRange,
    timezone: source.timezone(),
    now: source.now(),
    ...(repeated(params, 'workspace') === undefined ? {} : { workspaces: repeated(params, 'workspace') }),
    ...(repeated(params, 'provider') === undefined ? {} : { providers: repeated(params, 'provider') }),
    ...(repeated(params, 'model') === undefined ? {} : { models: repeated(params, 'model') }),
  }
}

const dimensions = ['workspace', 'provider', 'model', 'session', 'tool'] as const
const sorts = ['key', 'tokens', 'requests', 'turns', 'steps', 'toolCalls', 'toolErrors', 'modelMs', 'toolMs'] as const
const legalSorts: Record<BreakdownDimension, readonly BreakdownSort[]> = {
  workspace: sorts,
  provider: ['key', 'tokens', 'requests', 'modelMs'],
  model: ['key', 'tokens', 'requests', 'modelMs'],
  session: sorts,
  tool: ['key', 'toolCalls', 'toolErrors', 'toolMs'],
}

function breakdownQuery(params: URLSearchParams, source: ActivityHttpSource, config: ActivityHttpConfig): BreakdownQuery {
  const dimension = enumValue(one(params, 'dimension'), dimensions, 'model', 'dimension')
  const sort = enumValue(one(params, 'sort'), sorts, dimension === 'tool' ? 'toolCalls' : 'tokens', 'sort')
  if (!legalSorts[dimension].includes(sort)) throw new RequestError(`sort ${sort} is not valid for ${dimension}`)
  const limit = positiveInteger(one(params, 'limit'), config.defaultPageSize, 'limit')
  if (limit < 1 || limit > 200) throw new RequestError('limit must be between 1 and 200')
  const cursor = one(params, 'cursor')
  const search = one(params, 'search')
  const selectedFilters = filters(params, source)
  if (dimension === 'tool'
    && ((selectedFilters.providers?.length ?? 0) > 0 || (selectedFilters.models?.length ?? 0) > 0)) {
    throw new RequestError('provider and model filters are not supported for the tool dimension')
  }
  return {
    ...selectedFilters,
    dimension,
    sort,
    direction: enumValue(one(params, 'direction'), ['asc', 'desc'], 'desc', 'direction'),
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(search === undefined ? {} : { search }),
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function csvCell(value: string | number): string {
  let text = String(value)
  if (/^[\t\r\n]|^\s*[=+\-@]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

async function allBreakdownRows(
  records: readonly SessionRecord[],
  query: BreakdownQuery,
) {
  const rows: BreakdownRow[] = []
  let cursor: string | undefined
  do {
    const page = queryBreakdown(records, { ...query, limit: 200, ...(cursor === undefined ? {} : { cursor }) })
    rows.push(...page.rows)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return rows
}

function csvRows(dimension: BreakdownDimension, rows: Awaited<ReturnType<typeof allBreakdownRows>>): string {
  type Column = readonly [header: string, value: (row: BreakdownRow) => string | number]
  const originRequests = (row: BreakdownRow, origin: 'agent' | 'compaction'): number =>
    row.byOrigin?.find((group) => group.key === origin)?.metrics.usage.requests ?? 0
  const usage: Column[] = [
    ['requests', row => row.metrics.usage.requests],
    ['input', row => row.metrics.usage.input],
    ['cache_read', row => row.metrics.usage.cacheRead],
    ['cache_write', row => row.metrics.usage.cacheWrite],
    ['output', row => row.metrics.usage.output],
    ['reasoning', row => row.metrics.usage.reasoning],
    ['total_tokens', row => totalTokens(row.metrics.usage)],
  ]
  const columns: Column[] = dimension === 'tool'
    ? [
        ['tool', row => row.key],
        ['tool_calls', row => row.metrics.activity.toolCalls],
        ['tool_results', row => row.metrics.activity.toolResults],
        ['tool_errors', row => row.metrics.activity.toolErrors],
        ['tool_ms', row => row.metrics.performance.toolMs],
      ]
    : dimension === 'provider' || dimension === 'model'
      ? [
          [dimension, row => row.key],
          ['requests', row => row.metrics.usage.requests],
          ['agent_requests', row => originRequests(row, 'agent')],
          ['compaction_requests', row => originRequests(row, 'compaction')],
          ['steps', row => row.metrics.activity.steps],
          ['message_samples', row => row.metrics.performance.messageSamples],
          ...usage.slice(1),
          ['model_ms', row => row.metrics.performance.modelMs],
          ['ttft_ms', row => row.metrics.performance.ttftMs],
          ['ttft_samples', row => row.metrics.performance.ttftSamples],
          ['decode_ms', row => row.metrics.performance.decodeMs],
          ['decode_tokens', row => row.metrics.performance.decodeTokens],
        ]
      : dimension === 'workspace'
        ? [
            ['workspace', row => row.key], ...usage,
            ['turns', row => row.metrics.activity.turns],
            ['steps', row => row.metrics.activity.steps],
            ['tool_calls', row => row.metrics.activity.toolCalls],
            ['tool_results', row => row.metrics.activity.toolResults],
            ['tool_errors', row => row.metrics.activity.toolErrors],
            ['model_ms', row => row.metrics.performance.modelMs],
            ['tool_ms', row => row.metrics.performance.toolMs],
            ['ttft_ms', row => row.metrics.performance.ttftMs],
            ['ttft_samples', row => row.metrics.performance.ttftSamples],
            ['decode_ms', row => row.metrics.performance.decodeMs],
            ['decode_tokens', row => row.metrics.performance.decodeTokens],
          ]
        : [
          [dimension, row => row.key], ...usage,
          ['turns', row => row.metrics.activity.turns],
          ['steps', row => row.metrics.activity.steps],
          ['tool_calls', row => row.metrics.activity.toolCalls],
          ['tool_results', row => row.metrics.activity.toolResults],
          ['tool_errors', row => row.metrics.activity.toolErrors],
          ['model_ms', row => row.metrics.performance.modelMs],
          ['tool_ms', row => row.metrics.performance.toolMs],
          ['ttft_ms', row => row.metrics.performance.ttftMs],
          ['ttft_samples', row => row.metrics.performance.ttftSamples],
          ['decode_ms', row => row.metrics.performance.decodeMs],
          ['decode_tokens', row => row.metrics.performance.decodeTokens],
          ['title', row => row.title ?? ''],
          ['workspace', row => row.cwd ?? ''],
        ]
  const lines = [columns.map(([header]) => header).join(',')]
  for (const row of rows) {
    lines.push(columns.map(([, value]) => csvCell(value(row))).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

function context(summary: ReturnType<typeof querySummary>, source: ActivityHttpSource) {
  return {
    timezone: summary.timezone,
    startDay: summary.startDay,
    endDayExclusive: summary.endDayExclusive,
    status: source.status(),
    coverage: summary.coverage,
  }
}

function handler(
  endpoint: 'summary' | 'breakdown' | 'filters' | 'export' | 'retry',
  source: ActivityHttpSource,
  config: ActivityHttpConfig,
): WebRoute['handler'] {
  return async (req, res) => {
    const expectedMethod = endpoint === 'retry' ? 'POST' : 'GET'
    if (req.method !== expectedMethod) {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    try {
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams
      const records = source.records()
      switch (endpoint) {
        case 'retry':
          await source.retryPersistence()
          json(res, 200, { status: source.status() })
          return
        case 'summary':
          json(res, 200, { ...querySummary(records, filters(params, source)), status: source.status() })
          return
        case 'breakdown': {
          const query = breakdownQuery(params, source, config)
          const summary = querySummary(records, query)
          json(res, 200, { ...queryBreakdown(records, query), ...context(summary, source) })
          return
        }
        case 'filters': {
          const query = filters(params, source)
          const summary = querySummary(records, query)
          json(res, 200, { ...queryFilterOptions(records, query), ...context(summary, source) })
          return
        }
        case 'export': {
          const query = breakdownQuery(params, source, config)
          const body = csvRows(query.dimension, await allBreakdownRows(records, query))
          const date = dayKey(source.now(), source.timezone())
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="dsh-activity-${query.dimension}-${date}.csv"`,
            'Cache-Control': 'no-store',
          })
          res.end(body)
          return
        }
      }
    } catch (error) {
      if (error instanceof RequestError || error instanceof ActivityQueryError) {
        json(res, 400, { error: error.message })
        return
      }
      source.onError?.(error)
      json(res, 500, { error: 'internal server error' })
    }
  }
}

/** Register all activity API routes and return one idempotent group disposer. */
export function registerActivityRoutes(
  webServer: WebServerFace,
  source: ActivityHttpSource,
  config: ActivityHttpConfig,
): () => void {
  const registrations: Array<[WebRoute['path'], Parameters<typeof handler>[0]]> = [
    ['/dsh-activity-report/summary', 'summary'],
    ['/dsh-activity-report/breakdown', 'breakdown'],
    ['/dsh-activity-report/filters', 'filters'],
    ['/dsh-activity-report/export.csv', 'export'],
    ['/dsh-activity-report/retry', 'retry'],
  ]
  const disposers = registrations.map(([path, endpoint]) => webServer.register({
    kind: 'exact',
    path,
    handler: handler(endpoint, source, config),
  }))
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const dispose of disposers.reverse()) dispose()
  }
}
