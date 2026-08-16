import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ActivityFilterOptions,
  ActivityRange,
  ActivitySummaryResponse,
  BreakdownDimension,
  BreakdownPage,
  BreakdownRow,
  BreakdownSort,
} from '../contract.ts'
import type { Metrics } from '../metrics.ts'
import { totalInputTokens, totalTokens } from '../metrics.ts'
import type { ActivityClient, ClientBreakdownQuery, ClientFilters } from './api.ts'
import { UsageChart } from './Chart.tsx'
import { compact, duration, int, percent } from './format.ts'
import { NS } from './locales.ts'

export interface ActivitySectionInjected {
  api: ActivityClient
  openSession: (id: SessionId) => void
}

export type ActivityT = TranslateNS<typeof NS>

export interface ActivitySectionProps extends ActivitySectionInjected {
  close: () => void
  t: ActivityT
}

const ranges: Array<{ id: ActivityRange; key: 'today' | 'last7d' | 'last30d' | 'all' }> = [
  { id: 'today', key: 'today' },
  { id: '7d', key: 'last7d' },
  { id: '30d', key: 'last30d' },
  { id: 'all', key: 'all' },
]
const dimensions: Array<{ id: BreakdownDimension; key: 'workspace' | 'provider' | 'model' | 'session' | 'tool' }> = [
  { id: 'workspace', key: 'workspace' },
  { id: 'provider', key: 'provider' },
  { id: 'model', key: 'model' },
  { id: 'session', key: 'session' },
  { id: 'tool', key: 'tool' },
]

function defaultSort(dimension: BreakdownDimension): BreakdownSort {
  return dimension === 'tool' ? 'toolCalls' : 'tokens'
}

function filtersQuery(range: ActivityRange, workspace: string, provider: string, model: string): ClientFilters {
  return {
    range,
    ...(workspace === '' ? {} : { workspace }),
    ...(provider === '' ? {} : { provider }),
    ...(model === '' ? {} : { model }),
  }
}

function breakdownQuery(
  filters: ClientFilters,
  dimension: BreakdownDimension,
  sort: BreakdownSort,
  direction: 'asc' | 'desc',
  search: string,
  cursor?: string,
): ClientBreakdownQuery {
  return {
    ...filters,
    dimension,
    sort,
    direction,
    limit: 25,
    ...(search.trim() === '' ? {} : { search: search.trim() }),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

function statusLabel(data: ActivitySummaryResponse, t: ActivityT): string {
  switch (data.status.phase) {
    case 'ready': return t('statusReady')
    case 'backfilling': return t('statusBackfilling')
    case 'degraded': return t('statusDegraded')
    case 'disposed': return t('statusDegraded')
  }
}

function inclusiveDayRange(startDay: string, endDayExclusive: string): string {
  const [year, month, day] = endDayExclusive.split('-').map(Number) as [number, number, number]
  const endDay = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
  return startDay === endDay ? startDay : `${startDay} – ${endDay}`
}

function tabKeys<T>(event: KeyboardEvent<HTMLButtonElement>, current: T, values: readonly T[], select: (value: T) => void): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const index = values.indexOf(current)
  const offset = event.key === 'ArrowRight' ? 1 : -1
  const next = values[(index + offset + values.length) % values.length]!
  select(next)
  event.currentTarget.parentElement
    ?.querySelector<HTMLButtonElement>(`[role="tab"][data-tab-value="${String(next)}"]`)
    ?.focus()
}

/** OpenAI-usage-inspired local activity dashboard with DSH-specific semantics. */
export function ActivitySection({ api, openSession, close, t }: ActivitySectionProps): JSX.Element {
  const [range, setRange] = useState<ActivityRange>('today')
  const [workspace, setWorkspace] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [options, setOptions] = useState<ActivityFilterOptions>({ workspaces: [], providers: [], models: [] })
  const [summary, setSummary] = useState<ActivitySummaryResponse | null>(null)
  const [dimension, setDimension] = useState<BreakdownDimension>('model')
  const [sort, setSort] = useState<BreakdownSort>('tokens')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState<BreakdownPage | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingRows, setLoadingRows] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const summaryRequest = useRef(0)
  const breakdownRequest = useRef(0)
  const paginationController = useRef<AbortController | null>(null)

  const selectedFilters = useMemo(
    () => filtersQuery(range, workspace, provider, model),
    [range, workspace, provider, model],
  )
  const selectedBreakdown = useMemo(
    () => breakdownQuery(selectedFilters, dimension, sort, direction, search),
    [selectedFilters, dimension, sort, direction, search],
  )
  const routeFilterActive = provider !== '' || model !== ''

  const retryAndRefresh = (): void => {
    void api.retry().then(() => {
      setRefresh((value) => value + 1)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    void api.filters(selectedFilters, controller.signal).then(setOptions).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { controller.abort() }
  }, [api, selectedFilters, refresh])

  useEffect(() => {
    const controller = new AbortController()
    const request = ++summaryRequest.current
    setLoadingSummary(true)
    void api.summary(selectedFilters, controller.signal).then((value) => {
      if (!controller.signal.aborted && request === summaryRequest.current) {
        setSummary(value)
        setError(null)
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && request === summaryRequest.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }).finally(() => {
      if (!controller.signal.aborted && request === summaryRequest.current) setLoadingSummary(false)
    })
    return () => { controller.abort() }
  }, [api, selectedFilters, refresh])

  useEffect(() => {
    const controller = new AbortController()
    const request = ++breakdownRequest.current
    setLoadingRows(true)
    void api.breakdown(selectedBreakdown, controller.signal).then((value) => {
      if (!controller.signal.aborted && request === breakdownRequest.current) {
        setPage(value)
        setError(null)
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && request === breakdownRequest.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }).finally(() => {
      if (!controller.signal.aborted && request === breakdownRequest.current) setLoadingRows(false)
    })
    return () => {
      controller.abort()
      paginationController.current?.abort()
      paginationController.current = null
    }
  }, [api, selectedBreakdown, refresh])

  const changeDimension = (next: BreakdownDimension): void => {
    setDimension(next)
    setSort(defaultSort(next))
    setSearch('')
    setPage(null)
  }

  const loadMore = (): void => {
    if (page?.nextCursor === undefined || loadingRows) return
    const controller = new AbortController()
    paginationController.current?.abort()
    paginationController.current = controller
    const request = breakdownRequest.current
    setLoadingRows(true)
    void api.breakdown({ ...selectedBreakdown, cursor: page.nextCursor }, controller.signal).then((next) => {
      if (!controller.signal.aborted && request === breakdownRequest.current) {
        setPage({ ...next, rows: [...page.rows, ...next.rows] })
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && request === breakdownRequest.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }).finally(() => {
      if (!controller.signal.aborted && request === breakdownRequest.current) setLoadingRows(false)
      if (paginationController.current === controller) paginationController.current = null
    })
  }

  const totals = summary?.totals
  const agentRequests = summary?.byOrigin.find((item) => item.key === 'agent')?.metrics.usage.requests ?? 0
  const usageCoverage = totals !== undefined && totals.activity.steps > 0 ? percent(agentRequests, totals.activity.steps) : t('notReported')
  const promptTokens = totals === undefined ? 0 : totalInputTokens(totals.usage)
  const cacheReuse = promptTokens > 0 && totals !== undefined ? percent(totals.usage.cacheRead, promptTokens) : t('notReported')

  return <div className="dsh_activity_section">
    <header className="dsh_activity_heading">
      <div><h2 className="dsh_activity_title">{t('nav')}</h2><p>{t('subtitle')}</p></div>
      <p className="dsh_activity_privacy">{t('privacy')}</p>
    </header>

    <div className="dsh_activity_filters">
      <div className="dsh_activity_ranges" role="tablist" aria-label={t('localDays')}>
        {ranges.map((item) => <button
          key={item.id}
          type="button"
          role="tab"
          id={`dsh_activity_range_tab_${item.id}`}
          aria-controls="dsh_activity_range_panel"
          aria-selected={range === item.id}
          tabIndex={range === item.id ? 0 : -1}
          data-tab-value={item.id}
          className={range === item.id ? 'is-active' : ''}
          onClick={() => setRange(item.id)}
          onKeyDown={(event) => tabKeys(event, range, ranges.map((value) => value.id), setRange)}
        >{t(item.key)}</button>)}
      </div>
      <FilterSelect value={workspace} onChange={setWorkspace} all={t('allWorkspaces')} values={options.workspaces} />
      <FilterSelect value={provider} onChange={setProvider} all={t('allProviders')} values={options.providers} disabled={dimension === 'tool'} />
      <FilterSelect value={model} onChange={setModel} all={t('allModels')} values={options.models} disabled={dimension === 'tool'} />
      <button type="button" className="dsh_activity_button" onClick={retryAndRefresh}>{t('refresh')}</button>
      <a className="dsh_activity_button" href={api.exportUrl(selectedBreakdown)} download>{t('export')}</a>
    </div>

    <div role="tabpanel" id="dsh_activity_range_panel" aria-labelledby={`dsh_activity_range_tab_${range}`}>
    {summary !== null && <div className={`dsh_activity_status is-${summary.status.phase}`}>
      <strong>{statusLabel(summary, t)}</strong>
      <span>{t('processed')}: {int(summary.status.processedSessions)} / {int(summary.status.totalSessions)}</span>
      {summary.status.failedSessions > 0 && <span>{t('failedSessions')}: {int(summary.status.failedSessions)}</span>}
      {summary.status.dirtyCount > 0 && <span>{t('dirtyRecords')}: {int(summary.status.dirtyCount)}</span>}
      <span>{t('localDays')}: {inclusiveDayRange(summary.startDay, summary.endDayExclusive)}</span>
      {summary.status.lastPersistedAt !== undefined && <span>{t('persisted')}: {new Date(summary.status.lastPersistedAt).toLocaleString()}</span>}
    </div>}

    {error !== null && <div className="dsh_activity_error" role="alert">{t('loadError')}: {error}</div>}
    {summary === null && loadingSummary ? <div className="dsh_activity_empty">{t('loading')}</div> : totals !== undefined && <>
      <div className="dsh_activity_cards">
        <MetricCard label={t('totalTokens')} value={compact(totalTokens(totals.usage))} detail={int(totalTokens(totals.usage))} />
        <MetricCard label={t('requests')} value={int(totals.usage.requests)} />
        <MetricCard label={t('activeWorkspaces')} value={int(summary?.activeWorkspaces ?? 0)} />
        <MetricCard label={t('activeSessions')} value={int(summary?.activeSessions ?? 0)} />
        <MetricCard label={t('usageCoverage')} value={usageCoverage} />
        <MetricCard label={t('cacheReuse')} value={cacheReuse} />
      </div>

      <section className="dsh_activity_panel">
        <div className="dsh_activity_panelHeading"><div><h3>{t('trend')}</h3><p>{t('reasoningHint')}</p></div>{loadingSummary && <span>{t('loading')}</span>}</div>
        <UsageChart points={summary?.series ?? []} labels={{
          chart: t('trend'), input: t('input'), cacheRead: t('cacheRead'), cacheWrite: t('cacheWrite'),
          output: t('output'), reasoning: t('reasoning'), tokens: t('tokens'),
        }} />
      </section>

      <section className="dsh_activity_panel">
        <div className="dsh_activity_dimensionTabs" role="tablist" aria-label={t('sort')}>
          {dimensions.map((item) => <button
            key={item.id}
            type="button"
            role="tab"
            id={`dsh_activity_dimension_tab_${item.id}`}
            aria-controls="dsh_activity_dimension_panel"
            aria-selected={dimension === item.id}
            tabIndex={dimension === item.id ? 0 : -1}
            data-tab-value={item.id}
            className={dimension === item.id ? 'is-active' : ''}
            disabled={item.id === 'tool' && routeFilterActive}
            title={item.id === 'tool' && routeFilterActive ? t('toolFilterHint') : undefined}
            onClick={() => changeDimension(item.id)}
            onKeyDown={(event) => tabKeys(
              event,
              dimension,
              dimensions.filter((value) => value.id !== 'tool' || !routeFilterActive).map((value) => value.id),
              changeDimension,
            )}
          >{t(item.key)}</button>)}
        </div>
        {routeFilterActive && <p className="dsh_activity_privacy">{t('toolFilterHint')}</p>}
        <div role="tabpanel" id="dsh_activity_dimension_panel" aria-labelledby={`dsh_activity_dimension_tab_${dimension}`}>
        <div className="dsh_activity_tableTools">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('search')} aria-label={t('search')} />
          <select value={sort} onChange={(event) => setSort(event.target.value as BreakdownSort)} aria-label={t('sort')}>
            {sortOptions(dimension).map((value) => <option key={value} value={value}>{sortLabel(value, t)}</option>)}
          </select>
          <button type="button" className="dsh_activity_button" onClick={() => setDirection((value) => value === 'desc' ? 'asc' : 'desc')}>
            {direction === 'desc' ? t('descending') : t('ascending')}
          </button>
        </div>
        <BreakdownTable
          dimension={dimension}
          rows={page?.rows ?? []}
          openSession={(id) => { close(); openSession(id) }}
          t={t}
        />
        {loadingRows && <div className="dsh_activity_loadingOverlay">{t('loading')}</div>}
        {!loadingRows && (page?.rows.length ?? 0) === 0 && <div className="dsh_activity_empty">{t('noData')}</div>}
        {page?.nextCursor !== undefined && <button type="button" className="dsh_activity_more" onClick={loadMore}>{t('loadMore')}</button>}
        </div>
      </section>

      <Performance metrics={totals} t={t} />
      <details className="dsh_activity_notes"><summary>{t('metricNotes')}</summary><p>{t('metricNotesBody')}</p></details>
    </>}
    </div>
  </div>
}

function FilterSelect({ value, onChange, all, values, disabled = false }: { value: string; onChange: (value: string) => void; all: string; values: string[]; disabled?: boolean }): JSX.Element {
  return <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={all} disabled={disabled}>
    <option value="">{all}</option>
    {values.map((item) => <option key={item} value={item}>{item}</option>)}
  </select>
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }): JSX.Element {
  return <div className="dsh_activity_card"><span>{label}</span><strong>{value}</strong>{detail !== undefined && <small>{detail}</small>}</div>
}

function sortOptions(dimension: BreakdownDimension): BreakdownSort[] {
  if (dimension === 'tool') return ['toolCalls', 'toolErrors', 'toolMs', 'key']
  if (dimension === 'provider' || dimension === 'model') return ['tokens', 'requests', 'modelMs', 'key']
  return ['tokens', 'requests', 'turns', 'steps', 'toolCalls', 'toolErrors', 'modelMs', 'toolMs', 'key']
}

function sortLabel(sort: BreakdownSort, t: ActivityT): string {
  const labels: Record<BreakdownSort, string> = {
    key: t('sort'), tokens: t('tokens'), requests: t('requests'), turns: t('turns'), steps: t('steps'),
    toolCalls: t('calls'), toolErrors: t('errors'), modelMs: t('modelTime'), toolMs: t('toolTime'),
  }
  return labels[sort]
}

function BreakdownTable({ dimension, rows, openSession, t }: {
  dimension: BreakdownDimension
  rows: BreakdownRow[]
  openSession: (id: SessionId) => void
  t: ActivityT
}): JSX.Element | null {
  if (rows.length === 0) return null
  const providerLike = dimension === 'provider' || dimension === 'model'
  const tool = dimension === 'tool'
  return <div className="dsh_activity_tableWrap"><table className="dsh_activity_table">
    <thead><tr>
      <th>{t(dimension)}</th>
      {tool ? <>
        <th>{t('calls')}</th><th>{t('results')}</th><th>{t('errors')}</th><th>{t('errorRate')}</th><th>{t('toolTime')}</th><th>{t('average')}</th>
      </> : <>
        <th>{t('requests')}</th><th>{t('input')}</th><th>{t('cacheRead')}</th><th>{t('cacheWrite')}</th><th>{t('output')}</th><th>{t('tokens')}</th>
        {!providerLike && <><th>{t('turns')}</th><th>{t('steps')}</th><th>{t('calls')}</th><th>{t('errors')}</th></>}
        <th>{t('modelTime')}</th>{!providerLike && <th>{t('toolTime')}</th>}<th>{t('avgTtft')}</th><th>{t('outputSpeed')}</th>
      </>}
    </tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}>
      <td>{dimension === 'session' && row.sessionId !== undefined
        ? <button type="button" className="dsh_activity_sessionButton" onClick={() => openSession(row.sessionId!)}>{row.title ?? row.key}</button>
        : row.key}{row.cwd !== undefined && <small>{row.cwd}</small>}</td>
      {tool ? <ToolCells metrics={row.metrics} t={t} /> : <MetricCells metrics={row.metrics} providerLike={providerLike} t={t} />}
    </tr>)}</tbody>
  </table></div>
}

function MetricCells({ metrics, providerLike, t }: { metrics: Metrics; providerLike: boolean; t: ActivityT }): JSX.Element {
  const ttft = metrics.performance.ttftSamples === 0 ? t('notReported') : duration(metrics.performance.ttftMs / metrics.performance.ttftSamples)
  const speed = metrics.performance.decodeMs === 0 ? t('notReported') : `${(metrics.performance.decodeTokens / metrics.performance.decodeMs * 1_000).toFixed(1)}/s`
  return <>
    <td>{int(metrics.usage.requests)}</td><td>{int(metrics.usage.input)}</td><td>{int(metrics.usage.cacheRead)}</td><td>{int(metrics.usage.cacheWrite)}</td><td>{int(metrics.usage.output)}</td><td>{int(totalTokens(metrics.usage))}</td>
    {!providerLike && <><td>{int(metrics.activity.turns)}</td><td>{int(metrics.activity.steps)}</td><td>{int(metrics.activity.toolCalls)}</td><td>{int(metrics.activity.toolErrors)}</td></>}
    <td>{duration(metrics.performance.modelMs)}</td>{!providerLike && <td>{duration(metrics.performance.toolMs)}</td>}<td>{ttft}</td><td>{speed}</td>
  </>
}

function ToolCells({ metrics, t }: { metrics: Metrics; t: ActivityT }): JSX.Element {
  const returned = metrics.activity.toolResults
  return <>
    <td>{int(metrics.activity.toolCalls)}</td><td>{int(returned)}</td><td>{int(metrics.activity.toolErrors)}</td>
    <td>{returned === 0 ? t('notReported') : percent(metrics.activity.toolErrors, returned)}</td>
    <td>{duration(metrics.performance.toolMs)}</td><td>{returned === 0 ? t('notReported') : duration(metrics.performance.toolMs / returned)}</td>
  </>
}

function Performance({ metrics, t }: { metrics: Metrics; t: ActivityT }): JSX.Element {
  const ttft = metrics.performance.ttftSamples === 0 ? t('notReported') : duration(metrics.performance.ttftMs / metrics.performance.ttftSamples)
  const speed = metrics.performance.decodeMs === 0 ? t('notReported') : `${(metrics.performance.decodeTokens / metrics.performance.decodeMs * 1_000).toFixed(1)} ${t('tokens')}/s`
  return <section className="dsh_activity_panel"><h3>{t('performance')}</h3>
    <div className="dsh_activity_performance">
      <MetricCard label={t('avgTtft')} value={ttft} />
      <MetricCard label={t('outputSpeed')} value={speed} />
      <MetricCard label={t('modelTime')} value={duration(metrics.performance.modelMs)} />
      <MetricCard label={t('toolTime')} value={duration(metrics.performance.toolMs)} />
    </div>
    {Object.keys(metrics.activity.outcomes).length > 0 && <div className="dsh_activity_outcomes"><strong>{t('outcomes')}</strong>{Object.entries(metrics.activity.outcomes).map(([key, value]) => <span key={key}>{key}: {int(value)}</span>)}</div>}
  </section>
}
