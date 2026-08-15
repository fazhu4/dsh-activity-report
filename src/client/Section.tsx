/**
 * The activity report settings section: summary cards, dimension tabs, a bar
 * chart that follows the selected dimension, and a sortable detail table.
 */
import { useEffect, useMemo, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActivityStats, SummaryResponse } from '../contract.ts'
import type { Range } from './index.ts'
import { NS } from './locales.ts'
import { BarChart, DayBarChart, type BarItem } from './Chart.tsx'
import { compact, duration, int, percent } from './format.ts'

/** Injected props from the section slot. */
export interface ActivitySectionInjected {
  fetchSummary: (range: Range) => Promise<SummaryResponse | null>
}

/** Translate function bound to our namespace (injected by the slot). */
export type ActivityT = TranslateNS<typeof NS>

/** Dimension tabs: provider / model / session / tool call counts. */
type Tab = 'provider' | 'model' | 'session' | 'tools'

const RANGES: Array<{ id: Range; key: TKey }> = [
  { id: 'today', key: 'today' },
  { id: '7d', key: 'last7d' },
  { id: '30d', key: 'last30d' },
  { id: 'all', key: 'all' },
]

const TABS: Array<{ id: Tab; key: TKey }> = [
  { id: 'provider', key: 'byProvider' },
  { id: 'model', key: 'byModel' },
  { id: 'session', key: 'bySession' },
  { id: 'tools', key: 'byTool' },
]

/** Outcome label lookup for known reasons (typed to our dictionary keys). */
type TKey = Parameters<ActivityT>[0]

function outcomeKey(reason: string): TKey {
  switch (reason) {
    case 'completed': return 'outcomeCompleted'
    case 'error': return 'outcomeError'
    case 'aborted': return 'outcomeAborted'
    case 'max-tokens': return 'outcomeMaxTokens'
    case 'interrupted': return 'outcomeInterrupted'
    case 'blocked': return 'outcomeBlocked'
    case 'canceled': return 'outcomeCanceled'
    default: return 'outcomeUnknown'
  }
}

function totalTokens(s: ActivityStats): number {
  return s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite
}

function toolCallTotal(s: ActivityStats): number {
  return Object.values(s.toolCalls).reduce((a, b) => a + b, 0)
}

/** Short human-readable session label: title, else compact id + creation time. */
function sessionLabel(title: string | undefined, createdAt: number | undefined, sessionId: string): string {
  if (title && title.trim()) return title.trim()
  const id = sessionId.replace(/^session-/, '').slice(0, 8)
  const when = createdAt !== undefined
    ? new Date(createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''
  return `会话 ${id}${when ? ` · ${when}` : ''}`
}

/**
 * The settings section component.
 * @param props - injected hooks + locale.
 */
export function ActivitySection(props: ActivitySectionInjected & { t: ActivityT }): JSX.Element {
  const { fetchSummary, t } = props
  const [range, setRange] = useState<Range>('today')
  const [tab, setTab] = useState<Tab>('provider')
  const [data, setData] = useState<SummaryResponse | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [error, setError] = useState(false)

  const load = (r: Range): void => {
    void fetchSummary(r).then((res) => {
      if (res) {
        setData(res)
        setUpdatedAt(res.updatedAt)
        setError(false)
      } else {
        setError(true)
      }
    })
  }

  useEffect(() => { load(range) }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Detail-table rows for the current dimension tab. */
  const rows = useMemo(() => {
    type Row = { key: string; stats: ActivityStats; title?: string; cwd?: string; createdAt?: number }
    if (!data) return [] as Row[]
    let list: Row[]
    if (tab === 'provider') {
      list = Object.entries(data.byProvider).map(([key, stats]) => ({ key, stats }))
    } else if (tab === 'model') {
      list = Object.entries(data.byModel).map(([key, stats]) => ({ key, stats }))
    } else if (tab === 'session') {
      list = Object.entries(data.bySession).map(([key, v]) => ({ key, stats: v.stats, title: v.title, cwd: v.cwd, createdAt: v.createdAt }))
    } else {
      // tools: one row per tool that was used at least once.
      list = Object.entries(data.totals.toolCalls)
        .filter(([, n]) => n > 0)
        .map(([key, n]) => {
          const stats: ActivityStats = {
            requests: 0, turns: 0, steps: 0,
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            toolCalls: { [key]: n },
            toolErrors: 0, durationMs: 0, outcomes: {},
          }
          return { key, stats }
        })
    }
    return list.sort((a, b) => totalTokens(b.stats) - totalTokens(a.stats))
  }, [data, tab])

  /** Bar-chart data for the current dimension tab. */
  const chartItems = useMemo<BarItem[]>(() => {
    if (!data) return []
    if (tab === 'tools') {
      return Object.entries(data.totals.toolCalls)
        .filter(([, n]) => n > 0)
        .map(([key, n]) => ({ key, label: key, value: n }))
    }
    const map = tab === 'provider' ? data.byProvider : tab === 'model' ? data.byModel : null
    if (map) {
      return Object.entries(map).map(([key, stats]) => ({ key, label: key, value: totalTokens(stats) }))
    }
    // session: chart by total tokens per session. Keys are unique session ids;
    // labels show title or a compact id + creation time so distinct sessions
    // never collapse into one bar.
    return Object.entries(data.bySession).map(([key, v]) => ({
      key,
      label: sessionLabel(v.title, v.createdAt, key),
      value: totalTokens(v.stats),
      hint: key,
    }))
  }, [data, tab])

  /** Per-day token series for the selected time range (top chart). */
  const daySeries = useMemo(() => {
    if (!data) return []
    return data.series.map(s => ({
      label: s.label,
      value: totalTokens(s.stats),
    }))
  }, [data])

  const totals = data?.totals
  const outcomes = totals ? Object.entries(totals.outcomes).sort((a, b) => b[1] - a[1]) : []
  const chartLabel = tab === 'tools' ? t('byTool') : tab === 'provider' ? t('byProvider') : tab === 'model' ? t('byModel') : t('bySession')

  return (
    <div className="dsh_activity_section">
      <div className="dsh_activity_heading">
        <h2 className="dsh_activity_title">{t('nav')}</h2>
        <p className="dsh_activity_subtitle">{t('subtitle')}</p>
      </div>

      <div className="dsh_activity_toolbar">
        <div className="dsh_activity_seg" role="tablist" aria-label="range">
          {RANGES.map(r => (
            <button
              key={r.id}
              type="button"
              className={`dsh_activity_segBtn${range === r.id ? ' dsh_activity_segBtnActive' : ''}`}
              onClick={() => setRange(r.id)}
            >{t(r.key)}</button>
          ))}
        </div>
        <button type="button" className="dsh_activity_segBtn dsh_activity_refresh" onClick={() => load(range)}>
          {t('refresh')}
        </button>
      </div>

      {error ? (
        <div className="dsh_activity_empty">{t('loadError')}</div>
      ) : !totals ? (
        <div className="dsh_activity_empty">{t('noData')}</div>
      ) : (
        <>
          <div className="dsh_activity_cards">
            <StatCard label={t('totalTokens')} value={compact(totalTokens(totals))} sub={int(totalTokens(totals))} />
            <StatCard label={t('requests')} value={int(totals.requests)} />
            <StatCard label={t('turns')} value={int(totals.turns > 0 ? totals.turns : totals.steps)}
              sub={totals.turns > 0 ? undefined : t('stepsFallback')} />
            <StatCard label={t('duration')} value={duration(totals.durationMs)} />
            <StatCard label={t('toolCalls')} value={int(toolCallTotal(totals))} />
            <StatCard label={t('toolErrors')} value={int(totals.toolErrors)} />
          </div>

          {outcomes.length > 0 && (
            <div className="dsh_activity_cards">
              {outcomes.map(([reason, n]) => (
                <StatCard key={reason} label={`${t(outcomeKey(reason))}`} value={int(n)}
                  sub={`${percent(n, totals.turns)}`} />
              ))}
            </div>
          )}

          <div className="dsh_activity_trend">
            <div className="dsh_activity_updated">{t('trend')}</div>
            <DayBarChart items={daySeries} />
          </div>

          <div className="dsh_activity_tabs" role="tablist" aria-label="dimension">
            {TABS.map(tb => (
              <button
                key={tb.id}
                type="button"
                className={`dsh_activity_tab${tab === tb.id ? ' dsh_activity_tabActive' : ''}`}
                onClick={() => setTab(tb.id)}
              >{t(tb.key)}</button>
            ))}
          </div>

          <div className="dsh_activity_chart">
            <div className="dsh_activity_updated">{chartLabel}</div>
            <BarChart items={chartItems} />
          </div>

          {rows.length === 0 ? (
            <div className="dsh_activity_empty">{t('noData')}</div>
          ) : (
            <div className="dsh_activity_tableWrap" key={tab}>
              {tab === 'tools' ? (
                <table className="dsh_activity_table">
                  <thead>
                    <tr>
                      <th>{t('byTool')}</th>
                      <th className="dsh_activity_num">{t('calls')}</th>
                      <th className="dsh_activity_num">{t('share')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const n = toolCallTotal(row.stats)
                      const share = totals && toolCallTotal(totals) > 0 ? percent(n, toolCallTotal(totals)) : '0%'
                      return (
                        <tr key={row.key}>
                          <td>{row.key}</td>
                          <td className="dsh_activity_num">{int(n)}</td>
                          <td className="dsh_activity_num">{share}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="dsh_activity_table">
                  <thead>
                    <tr>
                      <th>{tab === 'session' ? t('session') : tab === 'provider' ? t('byProvider') : t('byModel')}</th>
                      <th className="dsh_activity_num">{t('requests')}</th>
                      <th className="dsh_activity_num">{t('input')}</th>
                      <th className="dsh_activity_num">{t('output')}</th>
                      <th className="dsh_activity_num">{t('cacheRead')}</th>
                      <th className="dsh_activity_num">{t('totalTokens')}</th>
                      <th className="dsh_activity_num">{t('turns')}</th>
                      <th className="dsh_activity_num">{t('toolCalls')}</th>
                      <th className="dsh_activity_num">{t('duration')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.key}>
                        <td>
                          {tab === 'session'
                            ? <SessionCell title={row.title} cwd={row.cwd} createdAt={row.createdAt} sessionId={row.key} t={t} />
                            : row.key}
                        </td>
                        <td className="dsh_activity_num">{int(row.stats.requests)}</td>
                        <td className="dsh_activity_num">{int(row.stats.tokens.input)}</td>
                        <td className="dsh_activity_num">{int(row.stats.tokens.output)}</td>
                        <td className="dsh_activity_num">{int(row.stats.tokens.cacheRead)}</td>
                        <td className="dsh_activity_num">{int(totalTokens(row.stats))}</td>
                        <td className="dsh_activity_num">{int(row.stats.turns > 0 ? row.stats.turns : row.stats.steps)}</td>
                        <td className="dsh_activity_num">{int(toolCallTotal(row.stats))}</td>
                        <td className="dsh_activity_num">{duration(row.stats.durationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {updatedAt !== null && (
            <div className="dsh_activity_updated">
              {t('updated')} {new Date(updatedAt).toLocaleString()}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="dsh_activity_card">
      <span className="dsh_activity_cardLabel">{label}</span>
      <span className="dsh_activity_cardValue">{value}</span>
      {sub !== undefined && <span className="dsh_activity_updated">{sub}</span>}
    </div>
  )
}

function SessionCell({ title, cwd, createdAt, sessionId, t }: {
  title?: string
  cwd?: string
  createdAt?: number
  sessionId: string
  t: ActivityT
}): JSX.Element {
  const label = sessionLabel(title, createdAt, sessionId)
  return (
    <span title={sessionId}>
      <a className="dsh_activity_sessionLink" href={`/?session=${encodeURIComponent(sessionId)}`}>{label}</a>
      {cwd && <span className="dsh_activity_updated"> · {cwd}</span>}
    </span>
  )
}
