/**
 * Zero-dependency horizontal bar chart for one dimension's stats.
 * Renders responsive CSS bars (label | track | value), sorted descending,
 * capped to the top N entries. Works for provider/model/session token totals
 * and for tool call counts alike.
 */
import { compact } from './format.ts'

export interface BarItem {
  /** Unique stable key for React reconciliation (e.g. session id / tool name). */
  key: string
  /** Display label (title / provider / model / tool name). */
  label: string
  /** Numeric value to chart. */
  value: number
  /** Optional secondary text (e.g. full session title). */
  hint?: string
}

export interface BarChartProps {
  /** Items to chart; sorted descending and capped at `max`. */
  items: BarItem[]
  /** Maximum bars to render. */
  max?: number
}

/** One day in the time-range series. */
export interface DaySeriesItem {
  /** Local date label (YYYY-MM-DD). */
  label: string
  /** Total tokens that day. */
  value: number
}

export interface DayBarChartProps {
  /** Per-day totals, already filtered to the selected range. */
  items: DaySeriesItem[]
}

const W = 720
const H = 170
const PAD = { top: 12, right: 8, bottom: 24, left: 46 }

/**
 * A vertical bar chart of tokens per day for the selected time range.
 * @param props - per-day totals.
 */
export function DayBarChart({ items }: DayBarChartProps): JSX.Element | null {
  if (!items.length) return null
  const maxVal = Math.max(1, ...items.map(i => i.value))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / items.length
  const barW = Math.max(2, Math.min(28, slot * 0.62))
  const ticks = 4

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="tokens per day"
      style={{ display: 'block', minWidth: 320 }}
    >
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = maxVal * i / ticks
        const y = PAD.top + innerH - (innerH * i / ticks)
        return (
          <g key={y}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
              stroke="var(--dsw-alias-border-l1)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={10}
              fill="var(--dsw-alias-label-tertiary)">{compact(v)}</text>
          </g>
        )
      })}
      {items.map((it, i) => {
        const h = Math.max(0, innerH * it.value / maxVal)
        const x = PAD.left + slot * i + (slot - barW) / 2
        const y = PAD.top + innerH - h
        const showLabel = items.length <= 16 || i % Math.ceil(items.length / 16) === 0
        return (
          <g key={it.label}>
            <rect x={x} y={y} width={barW} height={h} rx={2}
              fill="var(--dsw-alias-brand-primary)" opacity={0.85}>
              <title>{`${it.label}: ${compact(it.value)} tokens`}</title>
            </rect>
            {showLabel && (
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={9}
                fill="var(--dsw-alias-label-tertiary)">
                {it.label.slice(5)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * A minimal horizontal bar chart.
 * @param props - items and cap.
 */
export function BarChart({ items, max = 15 }: BarChartProps): JSX.Element | null {
  if (!items.length) return null
  const sorted = [...items].sort((a, b) => b.value - a.value)
  const shown = sorted.slice(0, max)
  const maxVal = Math.max(1, ...shown.map(i => i.value))
  const rest = sorted.length - shown.length

  return (
    <div className="dsh_activity_bars" role="img" aria-label="bar chart">
      {shown.map(item => (
        <div key={item.key} className="dsh_activity_barRow" title={item.hint}>
          <span className="dsh_activity_barLabel">{item.label}</span>
          <div className="dsh_activity_barTrack">
            <div
              className="dsh_activity_barFill"
              style={{ width: `${Math.max(1, item.value / maxVal * 100)}%` }}
            />
          </div>
          <span className="dsh_activity_barValue">{compact(item.value)}</span>
        </div>
      ))}
      {rest > 0 && (
        <div className="dsh_activity_updated">+{rest} more</div>
      )}
    </div>
  )
}
