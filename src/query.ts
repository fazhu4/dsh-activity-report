import { createHash } from 'node:crypto'
import type {
  ActivityCoverage,
  ActivityFilterOptions,
  ActivityFilters,
  ActivitySummary,
  BreakdownPage,
  BreakdownQuery,
  BreakdownRow,
  DayFacts,
  MetricGroup,
  RequestOrigin,
  SessionRecord,
} from './contract.ts'
import type { Metrics } from './metrics.ts'
import { addMetrics, emptyMetrics, isMetricsEmpty, totalTokens } from './metrics.ts'
import { dayKey } from './fold.ts'

const UNKNOWN = '(unknown)'

/** Invalid or stale caller input detected by the activity query layer. */
export class ActivityQueryError extends Error {}

function copyMetrics(source: Metrics): Metrics {
  const result = emptyMetrics()
  addMetrics(result, source)
  return result
}

function shiftDay(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(year, month - 1, date + amount))
  return shifted.toISOString().slice(0, 10)
}

function daysBetween(start: string, endExclusive: string): string[] {
  const result: string[] = []
  for (let current = start; current < endExclusive; current = shiftDay(current, 1)) result.push(current)
  return result
}

function includes(values: readonly string[] | undefined, value: string): boolean {
  return values === undefined || values.length === 0 || values.includes(value)
}

function workspace(record: SessionRecord): string {
  return record.metadata.cwd ?? UNKNOWN
}

function selectedRecords(records: readonly SessionRecord[], filters: ActivityFilters): SessionRecord[] {
  return records.filter((record) => includes(filters.workspaces, workspace(record)))
}

function matchingRoutes(day: DayFacts, filters: ActivityFilters) {
  return Object.values(day.byRoute).filter((route) =>
    includes(filters.providers, route.provider) && includes(filters.models, route.model))
}

function hasRouteFilter(filters: ActivityFilters): boolean {
  return (filters.providers?.length ?? 0) > 0 || (filters.models?.length ?? 0) > 0
}

function selectedDayMetrics(day: DayFacts, filters: ActivityFilters): Metrics {
  if (!hasRouteFilter(filters)) return copyMetrics(day.totals)
  const result = emptyMetrics()
  for (const route of matchingRoutes(day, filters)) addMetrics(result, route.metrics)
  return result
}

interface Bounds {
  startDay: string
  endDayExclusive: string
}

function resolveBounds(records: readonly SessionRecord[], filters: ActivityFilters): Bounds {
  const today = dayKey(filters.now, filters.timezone)
  const endDayExclusive = shiftDay(today, 1)
  switch (filters.range) {
    case 'today':
      return { startDay: today, endDayExclusive }
    case '7d':
      return { startDay: shiftDay(today, -6), endDayExclusive }
    case '30d':
      return { startDay: shiftDay(today, -29), endDayExclusive }
    case 'all': {
      let startDay = today
      for (const record of selectedRecords(records, filters)) {
        for (const [dayName, day] of Object.entries(record.days)) {
          if (dayName < endDayExclusive && !isMetricsEmpty(selectedDayMetrics(day, filters)) && dayName < startDay) {
            startDay = dayName
          }
        }
      }
      return { startDay, endDayExclusive }
    }
  }
}

function inBounds(day: string, bounds: Bounds): boolean {
  return day >= bounds.startDay && day < bounds.endDayExclusive
}

function addGroup(groups: Map<string, Metrics>, key: string, metrics: Metrics): void {
  const target = groups.get(key) ?? emptyMetrics()
  addMetrics(target, metrics)
  groups.set(key, target)
}

function metricGroups(groups: Map<string, Metrics>): MetricGroup[] {
  return [...groups].map(([key, metrics]) => ({ key, metrics })).sort((left, right) => left.key.localeCompare(right.key))
}

function coverage(totals: Metrics, origins: readonly MetricGroup[]): ActivityCoverage {
  const agentSamples = origins.find((group) => group.key === 'agent')?.metrics.usage.requests ?? 0
  return {
    agentUsage: { samples: agentSamples, total: totals.activity.steps },
    modelTiming: { samples: totals.performance.messageSamples, total: totals.activity.steps },
    ttft: { samples: totals.performance.ttftSamples, total: totals.performance.messageSamples },
    toolTiming: { samples: totals.activity.toolResults, total: totals.activity.toolCalls },
  }
}

/** Aggregate cards, daily series, and route groups from the exact same selected facts. */
export function querySummary(records: readonly SessionRecord[], filters: ActivityFilters): ActivitySummary {
  const selected = selectedRecords(records, filters)
  const bounds = resolveBounds(selected, filters)
  const totals = emptyMetrics()
  const daily = new Map(daysBetween(bounds.startDay, bounds.endDayExclusive).map((day) => [day, emptyMetrics()]))
  const providers = new Map<string, Metrics>()
  const models = new Map<string, Metrics>()
  const origins = new Map<string, Metrics>()
  const activeSessionIds = new Set<string>()
  const activeWorkspaces = new Set<string>()

  for (const record of selected) {
    let sessionActive = false
    for (const [dayName, day] of Object.entries(record.days)) {
      if (!inBounds(dayName, bounds)) continue
      const selectedMetrics = selectedDayMetrics(day, filters)
      if (!isMetricsEmpty(selectedMetrics)) {
        addMetrics(totals, selectedMetrics)
        addMetrics(daily.get(dayName) ?? (() => { const value = emptyMetrics(); daily.set(dayName, value); return value })(), selectedMetrics)
        sessionActive = true
      }
      for (const route of matchingRoutes(day, filters)) {
        addGroup(providers, route.provider, route.metrics)
        addGroup(models, route.model, route.metrics)
        if (hasRouteFilter(filters)) {
          for (const [origin, metrics] of Object.entries(route.byOrigin) as Array<[RequestOrigin, Metrics]>) {
            addGroup(origins, origin, metrics)
          }
        }
      }
      if (!hasRouteFilter(filters)) {
        for (const [origin, metrics] of Object.entries(day.byOrigin) as Array<[RequestOrigin, Metrics]>) {
          addGroup(origins, origin, metrics)
        }
      }
    }
    if (sessionActive) {
      activeSessionIds.add(record.sessionId)
      activeWorkspaces.add(workspace(record))
    }
  }

  const byOrigin = metricGroups(origins)
  return {
    range: filters.range,
    timezone: filters.timezone,
    startDay: bounds.startDay,
    endDayExclusive: bounds.endDayExclusive,
    totals,
    series: [...daily].sort(([left], [right]) => left.localeCompare(right)).map(([day, metrics]) => ({ day, metrics })),
    byProvider: metricGroups(providers),
    byModel: metricGroups(models),
    byOrigin,
    coverage: coverage(totals, byOrigin),
    activeSessions: activeSessionIds.size,
    activeWorkspaces: activeWorkspaces.size,
  }
}

function sortValue(row: BreakdownRow, sort: BreakdownQuery['sort']): string | number {
  switch (sort) {
    case 'key': return row.key
    case 'tokens': return totalTokens(row.metrics.usage)
    case 'requests': return row.metrics.usage.requests
    case 'turns': return row.metrics.activity.turns
    case 'steps': return row.metrics.activity.steps
    case 'toolCalls': return row.metrics.activity.toolCalls
    case 'toolErrors': return row.metrics.activity.toolErrors
    case 'modelMs': return row.metrics.performance.modelMs
    case 'toolMs': return row.metrics.performance.toolMs
  }
}

interface CursorValue {
  dimension: BreakdownQuery['dimension']
  sort: BreakdownQuery['sort']
  direction: BreakdownQuery['direction']
  value: string | number
  key: string
  scope: string
  revision: string
}

function projectionRevision(records: readonly SessionRecord[]): string {
  const source = [...records]
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
    .map((record) => [record.sessionId, record.watermark, record.timezone, record.metadata])
  return createHash('sha256').update(JSON.stringify(source)).digest('base64url')
}

function normalizedValues(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort()
}

function cursorScope(query: BreakdownQuery, bounds: Bounds): string {
  return JSON.stringify({
    range: query.range,
    timezone: query.timezone,
    startDay: bounds.startDay,
    endDayExclusive: bounds.endDayExclusive,
    workspaces: normalizedValues(query.workspaces),
    providers: normalizedValues(query.providers),
    models: normalizedValues(query.models),
    search: query.search?.trim().toLocaleLowerCase() ?? '',
  })
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string, query: BreakdownQuery, scope: string, revision: string): CursorValue {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new ActivityQueryError('invalid cursor encoding')
  }
  if (typeof value !== 'object' || value === null) throw new ActivityQueryError('invalid cursor value')
  const candidate = value as Partial<CursorValue>
  if (candidate.dimension !== query.dimension || candidate.sort !== query.sort || candidate.direction !== query.direction || candidate.scope !== scope
    || (typeof candidate.value !== 'number' && typeof candidate.value !== 'string') || typeof candidate.key !== 'string') {
    throw new ActivityQueryError('cursor does not match this query')
  }
  if (candidate.revision !== revision) throw new ActivityQueryError('activity data changed; reload the first page')
  return candidate as CursorValue
}

function collectRows(records: readonly SessionRecord[], query: BreakdownQuery, bounds: Bounds): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>()
  const rowOrigins = new Map<string, Map<string, Metrics>>()
  const selected = selectedRecords(records, query)
  const rowAt = (key: string, fields: Omit<BreakdownRow, 'key' | 'metrics'> = {}): BreakdownRow => {
    const row = rows.get(key) ?? { key, metrics: emptyMetrics(), ...fields }
    rows.set(key, row)
    return row
  }
  const addOrigins = (key: string, origins: Partial<Record<RequestOrigin, Metrics>>): void => {
    const target = rowOrigins.get(key) ?? new Map<string, Metrics>()
    for (const [origin, metrics] of Object.entries(origins) as Array<[RequestOrigin, Metrics]>) {
      addGroup(target, origin, metrics)
    }
    rowOrigins.set(key, target)
  }
  const addSelectedOrigins = (key: string, day: DayFacts): void => {
    if (!hasRouteFilter(query)) {
      addOrigins(key, day.byOrigin)
      return
    }
    for (const route of matchingRoutes(day, query)) addOrigins(key, route.byOrigin)
  }

  for (const record of selected) {
    for (const [dayName, day] of Object.entries(record.days)) {
      if (!inBounds(dayName, bounds)) continue
      switch (query.dimension) {
        case 'workspace':
          addMetrics(rowAt(workspace(record)).metrics, selectedDayMetrics(day, query))
          addSelectedOrigins(workspace(record), day)
          break
        case 'session':
          addMetrics(rowAt(record.sessionId, {
            sessionId: record.sessionId,
            ...(record.metadata.title === undefined ? {} : { title: record.metadata.title }),
            ...(record.metadata.cwd === undefined ? {} : { cwd: record.metadata.cwd }),
          }).metrics, selectedDayMetrics(day, query))
          addSelectedOrigins(record.sessionId, day)
          break
        case 'provider':
          for (const route of matchingRoutes(day, query)) {
            addMetrics(rowAt(route.provider).metrics, route.metrics)
            addOrigins(route.provider, route.byOrigin)
          }
          break
        case 'model':
          for (const route of matchingRoutes(day, query)) {
            addMetrics(rowAt(route.model).metrics, route.metrics)
            addOrigins(route.model, route.byOrigin)
          }
          break
        case 'tool':
          if (!hasRouteFilter(query)) {
            for (const [name, metrics] of Object.entries(day.byTool)) addMetrics(rowAt(name).metrics, metrics)
          }
          break
      }
    }
  }
  return [...rows.values()].filter((row) => !isMetricsEmpty(row.metrics)).map((row) => ({
    ...row,
    byOrigin: metricGroups(rowOrigins.get(row.key) ?? new Map()),
  }))
}

/** Return one stable cursor-paginated analysis table. */
export function queryBreakdown(records: readonly SessionRecord[], query: BreakdownQuery): BreakdownPage {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) throw new ActivityQueryError('limit must be between 1 and 200')
  if (query.dimension === 'tool' && hasRouteFilter(query)) {
    throw new ActivityQueryError('provider and model filters are not supported for the tool dimension')
  }
  const bounds = resolveBounds(records, query)
  const scope = cursorScope(query, bounds)
  const revision = projectionRevision(records)
  const search = query.search?.trim().toLocaleLowerCase()
  const rows = collectRows(records, query, bounds)
    .filter((row) => search === undefined || search === '' || `${row.key} ${row.title ?? ''} ${row.cwd ?? ''}`.toLocaleLowerCase().includes(search))
    .sort((left, right) => {
      const a = sortValue(left, query.sort)
      const b = sortValue(right, query.sort)
      const comparison = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
      return comparison === 0 ? left.key.localeCompare(right.key) : comparison * (query.direction === 'asc' ? 1 : -1)
    })

  let start = 0
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor, query, scope, revision)
    const index = rows.findIndex((row) => row.key === cursor.key && sortValue(row, query.sort) === cursor.value)
    if (index < 0) throw new ActivityQueryError('cursor row is no longer available')
    start = index + 1
  }
  const pageRows = rows.slice(start, start + query.limit)
  const last = pageRows.at(-1)
  const nextCursor = start + pageRows.length < rows.length && last !== undefined
    ? encodeCursor({
        dimension: query.dimension,
        sort: query.sort,
        direction: query.direction,
        value: sortValue(last, query.sort),
        key: last.key,
        scope,
        revision,
      })
    : undefined
  return {
    dimension: query.dimension,
    revision,
    rows: pageRows,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  }
}

/** Return range- and filter-scoped values for the browser selectors. */
export function queryFilterOptions(records: readonly SessionRecord[], filters: ActivityFilters): ActivityFilterOptions {
  const summary = querySummary(records, filters)
  const bounds = { startDay: summary.startDay, endDayExclusive: summary.endDayExclusive }
  const workspaces = new Set<string>()
  const providers = new Set<string>()
  const models = new Set<string>()
  const routeFilters: ActivityFilters = { ...filters, workspaces: undefined }

  for (const record of records) {
    const workspaceSelected = includes(filters.workspaces, workspace(record))
    for (const [dayName, day] of Object.entries(record.days)) {
      if (!inBounds(dayName, bounds)) continue
      if (!isMetricsEmpty(selectedDayMetrics(day, routeFilters))) workspaces.add(workspace(record))
      if (!workspaceSelected) continue
      for (const route of Object.values(day.byRoute)) {
        if (includes(filters.models, route.model)) providers.add(route.provider)
        if (includes(filters.providers, route.provider)) models.add(route.model)
      }
    }
  }
  return {
    workspaces: [...workspaces].sort(),
    providers: [...providers].sort(),
    models: [...models].sort(),
  }
}
