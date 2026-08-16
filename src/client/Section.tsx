import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ActivityCoverage,
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
  const [trendMode, setTrendMode] = useState<'tokens' | 'requests'>('tokens')
  const [refresh, setRefresh] = useState(0)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingRows, setLoadingRows] = useState(true)
  const [filterError, setFilterError] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [breakdownError, setBreakdownError] = useState<string | null>(null)
  const [paginationError, setPaginationError] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const summaryRequest = useRef(0)
  const breakdownRequest = useRef(0)
  const paginationController = useRef<AbortController | null>(null)
  const retryController = useRef<AbortController | null>(null)

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
    retryController.current?.abort()
    const controller = new AbortController()
    retryController.current = controller
    void api.retry(controller.signal).then(() => {
      if (!controller.signal.aborted) {
        setRetryError(null)
        setRefresh((value) => value + 1)
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setRetryError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (retryController.current === controller) retryController.current = null
    })
  }

  useEffect(() => () => { retryController.current?.abort() }, [])

  useEffect(() => {
    const controller = new AbortController()
    void api.filters(selectedFilters, controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setOptions(value)
        setFilterError(null)
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setFilterError(cause instanceof Error ? cause.message : String(cause))
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
        setSummaryError(null)
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && request === summaryRequest.current) {
        setSummaryError(cause instanceof Error ? cause.message : String(cause))
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
        setBreakdownError(null)
        setPaginationError(null)
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && request === breakdownRequest.current) {
        setBreakdownError(cause instanceof Error ? cause.message : String(cause))
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
    setPaginationError(null)
    void api.breakdown({ ...selectedBreakdown, cursor: page.nextCursor }, controller.signal).then((next) => {
      if (!controller.signal.aborted && request === breakdownRequest.current) {
        setPage({ ...next, rows: [...page.rows, ...next.rows] })
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && request === breakdownRequest.current) {
        setPaginationError(cause instanceof Error ? cause.message : String(cause))
      }
    }).finally(() => {
      if (!controller.signal.aborted && request === breakdownRequest.current) setLoadingRows(false)
      if (paginationController.current === controller) paginationController.current = null
    })
  }

  const totals = summary?.totals
  const usageCoverage = summary !== null && summary.coverage.agentUsage.total > 0
    ? percent(summary.coverage.agentUsage.samples, summary.coverage.agentUsage.total)
    : t('notReported')
  const promptTokens = totals === undefined ? 0 : totalInputTokens(totals.usage)
  const cacheReuse = promptTokens > 0 && totals !== undefined ? percent(totals.usage.cacheRead, promptTokens) : t('notReported')
  const errors = [...new Set([filterError, summaryError, breakdownError, paginationError, retryError].filter((value): value is string => value !== null))]

  return <div className="dsh_activity_section">
    <header className="dsh_activity_hero">
      <div className="dsh_activity_heroCopy">
        <span className="dsh_activity_eyebrow">{t('nav')}</span>
        <h2 className="dsh_activity_title">{t('nav')}</h2>
        <p>{t('subtitle')}</p>
      </div>
      <div className="dsh_activity_privacy" role="note">
        <span className="dsh_activity_privacyMark" aria-hidden="true" />
        <span>{t('privacy')}</span>
      </div>
    </header>

    <div className="dsh_activity_toolbar">
      <div className="dsh_activity_toolbarGroup dsh_activity_toolbarRange">
        <span className="dsh_activity_toolbarLabel">{t('localDays')}</span>
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
      </div>
      <div className="dsh_activity_toolbarGroup dsh_activity_toolbarFilters">
        <FilterSelect value={workspace} onChange={setWorkspace} all={t('allWorkspaces')} values={options.workspaces} />
        <FilterSelect value={provider} onChange={setProvider} all={t('allProviders')} values={options.providers} disabled={dimension === 'tool'} />
        <FilterSelect value={model} onChange={setModel} all={t('allModels')} values={options.models} disabled={dimension === 'tool'} />
      </div>
      <div className="dsh_activity_toolbarActions">
        <button type="button" className="dsh_activity_button" onClick={retryAndRefresh}>{t('refresh')}</button>
        <a className="dsh_activity_button dsh_activity_buttonPrimary" href={api.exportUrl(selectedBreakdown)} download>{t('export')}</a>
      </div>
    </div>

    <div role="tabpanel" id="dsh_activity_range_panel" aria-labelledby={`dsh_activity_range_tab_${range}`}>
    {summary !== null && <div className={`dsh_activity_status is-${summary.status.phase}`}>
      <div className="dsh_activity_statusMain"><span className="dsh_activity_statusMark" aria-hidden="true" /><strong>{statusLabel(summary, t)}</strong></div>
      <div className="dsh_activity_statusMeta">
        <span>{t('processed')}: {int(summary.status.processedSessions)} / {int(summary.status.totalSessions)}</span>
        {summary.status.failedSessions > 0 && <span>{t('failedSessions')}: {int(summary.status.failedSessions)}</span>}
        {summary.status.dirtyCount > 0 && <span>{t('dirtyRecords')}: {int(summary.status.dirtyCount)}</span>}
        <span>{t('localDays')}: {inclusiveDayRange(summary.startDay, summary.endDayExclusive)}</span>
        {summary.status.lastPersistedAt !== undefined && <span>{t('persisted')}: {new Date(summary.status.lastPersistedAt).toLocaleString()}</span>}
      </div>
    </div>}

    {errors.map((error) => <div key={error} className="dsh_activity_error" role="alert">{t('loadError')}: {error}</div>)}
    {summary === null && loadingSummary ? <div className="dsh_activity_empty">{t('loading')}</div> : totals !== undefined && <>
      <div className="dsh_activity_overview">
        <section className="dsh_activity_kpiFeatured">
          <div className="dsh_activity_kpiFeaturedTop">
            <div>
              <span className="dsh_activity_kpiLabel">{t('totalTokens')}</span>
              <strong>{compact(totalTokens(totals.usage))}</strong>
              <small>{int(totalTokens(totals.usage))}</small>
            </div>
            <span className="dsh_activity_kpiBadge">{t('tokens')}</span>
          </div>
          <div className="dsh_activity_tokenBreakdown">
            <TokenMetric label={t('input')} value={totals.usage.input} tone="input" />
            <TokenMetric label={t('cacheRead')} value={totals.usage.cacheRead} tone="cacheRead" />
            <TokenMetric label={t('cacheWrite')} value={totals.usage.cacheWrite} tone="cacheWrite" />
            <TokenMetric label={t('output')} value={totals.usage.output} tone="output" />
          </div>
          <p className="dsh_activity_kpiHint">{t('reasoningHint')} · {t('reasoning')}: {int(totals.usage.reasoning)}</p>
        </section>
        <div className="dsh_activity_kpiGrid">
          <MetricCard label={t('requests')} value={int(totals.usage.requests)} />
          <MetricCard label={t('activeWorkspaces')} value={int(summary?.activeWorkspaces ?? 0)} />
          <MetricCard label={t('activeSessions')} value={int(summary?.activeSessions ?? 0)} />
          <MetricCard label={t('usageCoverage')} value={usageCoverage} />
          <MetricCard label={t('cacheReuse')} value={cacheReuse} />
        </div>
      </div>

      <section className="dsh_activity_panel dsh_activity_trendPanel">
        <div className="dsh_activity_panelHeading"><div><h3>{t('trend')}</h3><p>{t('reasoningHint')}</p></div><div className="dsh_activity_toggle">
          <button type="button" aria-pressed={trendMode === 'tokens'} className={trendMode === 'tokens' ? 'is-active' : ''} onClick={() => setTrendMode('tokens')}>{t('trendTokens')}</button>
          <button type="button" aria-pressed={trendMode === 'requests'} className={trendMode === 'requests' ? 'is-active' : ''} onClick={() => setTrendMode('requests')}>{t('trendRequests')}</button>
          {loadingSummary && <span>{t('loading')}</span>}
        </div></div>
        <UsageChart mode={trendMode} points={summary?.series ?? []} labels={{
          chart: t('trend'), input: t('input'), cacheRead: t('cacheRead'), cacheWrite: t('cacheWrite'),
          output: t('output'), reasoning: t('reasoning'), tokens: t('tokens'), requests: t('trendRequests'),
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

      <Performance metrics={totals} coverage={summary!.coverage} t={t} />
      <ReliabilityTrend points={summary!.series} t={t} />
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

function TokenMetric({ label, value, tone }: { label: string; value: number; tone: 'input' | 'cacheRead' | 'cacheWrite' | 'output' }): JSX.Element {
  return <div className={`dsh_activity_tokenMetric is-${tone}`}>
    <span><i aria-hidden="true" />{label}</span>
    <strong>{compact(value)}</strong>
  </div>
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
        <th>{t('requests')}</th>{providerLike && <><th>{t('agentRequests')}</th><th>{t('compactionRequests')}</th><th>{t('usageCoverage')}</th></>}<th>{t('input')}</th><th>{t('cacheRead')}</th><th>{t('cacheWrite')}</th><th>{t('output')}</th><th>{t('tokens')}</th>
        {!providerLike && <><th>{t('turns')}</th><th>{t('steps')}</th><th>{t('calls')}</th><th>{t('errors')}</th><th>{t('outcomes')}</th></>}
        <th>{t('modelTime')}</th><th>{t('modelTimingCoverage')}</th>{!providerLike && <><th>{t('toolTime')}</th><th>{t('toolTimingCoverage')}</th></>}<th>{t('avgTtft')}</th><th>{t('ttftCoverage')}</th><th>{t('outputSpeed')}</th>
      </>}
    </tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}>
      <td>{dimension === 'session' && row.sessionId !== undefined
        ? <button type="button" className="dsh_activity_sessionButton" onClick={() => openSession(row.sessionId!)}>{row.title ?? row.key}</button>
        : row.key}{row.cwd !== undefined && <small>{row.cwd}</small>}</td>
      {tool ? <ToolCells metrics={row.metrics} t={t} /> : <MetricCells row={row} providerLike={providerLike} t={t} />}
    </tr>)}</tbody>
  </table></div>
}

function MetricCells({ row, providerLike, t }: { row: BreakdownRow; providerLike: boolean; t: ActivityT }): JSX.Element {
  const { metrics } = row
  const agentRequests = row.byOrigin?.find((group) => group.key === 'agent')?.metrics.usage.requests ?? 0
  const compactionRequests = row.byOrigin?.find((group) => group.key === 'compaction')?.metrics.usage.requests ?? 0
  const agentCoverage = metrics.activity.steps === 0 ? t('notReported') : percent(agentRequests, metrics.activity.steps)
  const ttft = metrics.performance.ttftSamples === 0 ? t('notReported') : duration(metrics.performance.ttftMs / metrics.performance.ttftSamples)
  const ttftCoverage = metrics.performance.messageSamples === 0 ? t('notReported') : percent(metrics.performance.ttftSamples, metrics.performance.messageSamples)
  const modelTimingCoverage = metrics.activity.steps === 0 ? t('notReported') : percent(metrics.performance.messageSamples, metrics.activity.steps)
  const toolTimingCoverage = metrics.activity.toolCalls === 0 ? t('notReported') : percent(metrics.activity.toolResults, metrics.activity.toolCalls)
  const speed = metrics.performance.decodeMs === 0 || metrics.performance.decodeTokens === 0 ? t('notReported') : `${(metrics.performance.decodeTokens / metrics.performance.decodeMs * 1_000).toFixed(1)}/s`
  const outcomes = Object.entries(metrics.activity.outcomes).map(([key, value]) => `${key}: ${int(value)}`).join(', ')
  return <>
    <td>{int(metrics.usage.requests)}</td>{providerLike && <><td>{int(agentRequests)}</td><td>{int(compactionRequests)}</td><td>{agentCoverage}</td></>}<td>{int(metrics.usage.input)}</td><td>{int(metrics.usage.cacheRead)}</td><td>{int(metrics.usage.cacheWrite)}</td><td>{int(metrics.usage.output)}</td><td>{int(totalTokens(metrics.usage))}</td>
    {!providerLike && <><td>{int(metrics.activity.turns)}</td><td>{int(metrics.activity.steps)}</td><td>{int(metrics.activity.toolCalls)}</td><td>{int(metrics.activity.toolErrors)}</td><td>{outcomes === '' ? t('notReported') : outcomes}</td></>}
    <td>{metrics.performance.messageSamples === 0 ? t('notReported') : duration(metrics.performance.modelMs)}</td><td>{modelTimingCoverage}</td>{!providerLike && <><td>{metrics.activity.toolResults === 0 ? t('notReported') : duration(metrics.performance.toolMs)}</td><td>{toolTimingCoverage}</td></>}<td>{ttft}</td><td>{ttftCoverage}</td><td>{speed}</td>
  </>
}

function ToolCells({ metrics, t }: { metrics: Metrics; t: ActivityT }): JSX.Element {
  const returned = metrics.activity.toolResults
  return <>
    <td>{int(metrics.activity.toolCalls)}</td><td>{int(returned)}</td><td>{int(metrics.activity.toolErrors)}</td>
    <td>{returned === 0 ? t('notReported') : percent(metrics.activity.toolErrors, returned)}</td>
    <td>{returned === 0 ? t('notReported') : duration(metrics.performance.toolMs)}</td><td>{returned === 0 ? t('notReported') : duration(metrics.performance.toolMs / returned)}</td>
  </>
}

function Performance({ metrics, coverage, t }: { metrics: Metrics; coverage: ActivityCoverage; t: ActivityT }): JSX.Element {
  const ttft = metrics.performance.ttftSamples === 0 ? t('notReported') : duration(metrics.performance.ttftMs / metrics.performance.ttftSamples)
  const ttftCoverage = coverage.ttft.total === 0 ? t('notReported') : percent(coverage.ttft.samples, coverage.ttft.total)
  const modelTimingCoverage = coverage.modelTiming.total === 0 ? t('notReported') : percent(coverage.modelTiming.samples, coverage.modelTiming.total)
  const toolTimingCoverage = coverage.toolTiming.total === 0 ? t('notReported') : percent(coverage.toolTiming.samples, coverage.toolTiming.total)
  const speed = metrics.performance.decodeMs === 0 || metrics.performance.decodeTokens === 0 ? t('notReported') : `${(metrics.performance.decodeTokens / metrics.performance.decodeMs * 1_000).toFixed(1)} ${t('tokens')}/s`
  return <section className="dsh_activity_panel"><h3>{t('performance')}</h3>
    <div className="dsh_activity_performance">
      <MetricCard label={t('avgTtft')} value={ttft} />
      <MetricCard label={t('ttftCoverage')} value={ttftCoverage} detail={`${int(coverage.ttft.samples)} / ${int(coverage.ttft.total)}`} />
      <MetricCard label={t('modelTimingCoverage')} value={modelTimingCoverage} detail={`${int(coverage.modelTiming.samples)} / ${int(coverage.modelTiming.total)}`} />
      <MetricCard label={t('toolTimingCoverage')} value={toolTimingCoverage} detail={`${int(coverage.toolTiming.samples)} / ${int(coverage.toolTiming.total)}`} />
      <MetricCard label={t('outputSpeed')} value={speed} />
      <MetricCard label={t('modelTime')} value={metrics.performance.messageSamples === 0 ? t('notReported') : duration(metrics.performance.modelMs)} />
      <MetricCard label={t('toolTime')} value={metrics.activity.toolResults === 0 ? t('notReported') : duration(metrics.performance.toolMs)} />
    </div>
    {Object.keys(metrics.activity.outcomes).length > 0 && <div className="dsh_activity_outcomes"><strong>{t('outcomes')}</strong>{Object.entries(metrics.activity.outcomes).map(([key, value]) => <span key={key}>{key}: {int(value)}</span>)}</div>}
  </section>
}

function ReliabilityTrend({ points, t }: { points: ActivitySummaryResponse['series']; t: ActivityT }): JSX.Element {
  const observed = points.filter((point) => point.metrics.activity.toolResults > 0 || point.metrics.activity.toolCalls > 0)
  if (observed.length === 0) return <></>
  return <section className="dsh_activity_panel">
    <div className="dsh_activity_panelHeading"><div><h3>{t('toolFailureTrend')}</h3><p>{t('toolFailureHint')}</p></div></div>
    <div className="dsh_activity_reliability">{observed.map((point) => {
      const returned = point.metrics.activity.toolResults
      const errors = point.metrics.activity.toolErrors
      return <div key={point.day}>
        <span>{point.day}</span>
        <div><i style={{ width: returned === 0 ? '0%' : `${Math.min(100, errors / returned * 100)}%` }} /></div>
        <strong>{returned === 0 ? t('notReported') : `${int(errors)} / ${int(returned)}`}</strong>
      </div>
    })}</div>
  </section>
}
