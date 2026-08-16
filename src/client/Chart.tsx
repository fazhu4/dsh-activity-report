import { useState } from 'react'
import type { DailyMetricPoint } from '../contract.ts'
import { totalTokens } from '../metrics.ts'
import { compact, int } from './format.ts'

export interface UsageChartLabels {
  chart: string
  input: string
  cacheRead: string
  cacheWrite: string
  output: string
  reasoning: string
  tokens: string
  requests: string
}

export interface UsageChartProps {
  points: DailyMetricPoint[]
  labels: UsageChartLabels
  mode: 'tokens' | 'requests'
}

const WIDTH = 960
const HEIGHT = 300
const PAD = { top: 24, right: 18, bottom: 38, left: 58 }
const COLORS = {
  input: '#6c8cff',
  cacheRead: '#55b89a',
  cacheWrite: '#d69b44',
  output: '#a475e8',
  requests: '#6c8cff',
}

/** Accessible stacked natural-day usage chart with hover and keyboard detail. */
export function UsageChart({ points, labels, mode }: UsageChartProps): JSX.Element {
  const [active, setActive] = useState<number | null>(null)
  const innerWidth = WIDTH - PAD.left - PAD.right
  const innerHeight = HEIGHT - PAD.top - PAD.bottom
  const maximum = Math.max(1, ...points.map((point) => mode === 'requests' ? point.metrics.usage.requests : totalTokens(point.metrics.usage)))
  const slot = innerWidth / Math.max(1, points.length)
  const barWidth = Math.max(3, Math.min(34, slot * 0.68))
  const ticks = 4
  const selected = active === null ? undefined : points[active]

  return (
    <div className="dsh_activity_chartFrame">
      <div className="dsh_activity_chartScroller">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={labels.chart}>
          {Array.from({ length: ticks + 1 }, (_, index) => {
            const value = maximum * index / ticks
            const y = PAD.top + innerHeight - innerHeight * index / ticks
            return <g key={index}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="dsh_activity_grid" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="dsh_activity_axis">{compact(value)}</text>
            </g>
          })}
          {points.map((point, index) => {
            const values: Array<[keyof typeof COLORS, number, string]> = mode === 'requests'
              ? [['requests', point.metrics.usage.requests, labels.requests]]
              : [
                  ['input', point.metrics.usage.input, labels.input],
                  ['cacheRead', point.metrics.usage.cacheRead, labels.cacheRead],
                  ['cacheWrite', point.metrics.usage.cacheWrite, labels.cacheWrite],
                  ['output', point.metrics.usage.output, labels.output],
                ]
            const x = PAD.left + slot * index + (slot - barWidth) / 2
            let offset = 0
            const labelEvery = Math.max(1, Math.ceil(points.length / 14))
            const description = `${point.day}, ${values.map(([, value, label]) => `${label} ${int(value)}`).join(', ')}`
            return <g
              key={point.day}
              tabIndex={0}
              role="graphics-symbol"
              aria-label={description}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              {values.map(([key, value], valueIndex) => {
                const height = innerHeight * value / maximum
                const y = PAD.top + innerHeight - offset - height
                offset += height
                return <rect
                  key={key}
                  className={`dsh_activity_chartBar dsh_activity_chartBar_${key}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  fill={COLORS[key]}
                  rx={valueIndex === values.length - 1 ? 2 : 0}
                />
              })}
              <rect x={x - 2} y={PAD.top} width={barWidth + 4} height={innerHeight} fill="transparent" />
              {(points.length <= 14 || index % labelEvery === 0) && <text
                x={x + barWidth / 2}
                y={HEIGHT - 12}
                textAnchor="middle"
                className="dsh_activity_axis"
              >{point.day.slice(5)}</text>}
            </g>
          })}
        </svg>
      </div>
      {selected !== undefined && <div className="dsh_activity_tooltip" role="status">
        <strong>{selected.day}</strong>
        {mode === 'requests'
          ? <span>{labels.requests}: {int(selected.metrics.usage.requests)}</span>
          : <>
              <span>{labels.input}: {int(selected.metrics.usage.input)}</span>
              <span>{labels.cacheRead}: {int(selected.metrics.usage.cacheRead)}</span>
              <span>{labels.cacheWrite}: {int(selected.metrics.usage.cacheWrite)}</span>
              <span>{labels.output}: {int(selected.metrics.usage.output)}</span>
              <span>{labels.reasoning}: {int(selected.metrics.usage.reasoning)}</span>
            </>}
      </div>}
      <div className="dsh_activity_legend" aria-label={mode === 'requests' ? labels.requests : labels.tokens}>
        {(mode === 'requests'
          ? [['requests', labels.requests]] as const
          : [['input', labels.input], ['cacheRead', labels.cacheRead], ['cacheWrite', labels.cacheWrite], ['output', labels.output]] as const
        ).map(([key, label]) => <span key={key}><i style={{ background: COLORS[key] }} />{label}</span>)}
      </div>
    </div>
  )
}
