/** Number formatting helpers for the activity panel (K/M/B compact + time). */

/** Compact integer: 1234 → "1.2K", 2_500_000 → "2.5M". */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return trim(n / 1_000_000_000) + 'B'
  if (abs >= 1_000_000) return trim(n / 1_000_000) + 'M'
  if (abs >= 1_000) return trim(n / 1_000) + 'K'
  return String(Math.round(n))
}

function trim(v: number): string {
  const s = v >= 100 ? v.toFixed(0) : v.toFixed(1)
  return s.replace(/\.0$/, '')
}

/** Full integer with thousand separators: 1234567 → "1,234,567". */
export function int(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Duration in ms → human string: 94_000 → "1m 34s", 3_700_000 → "1h 1m". */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** Percent string: 0.1234 → "12.3%". */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  return (part / whole * 100).toFixed(1) + '%'
}

/** ISO day label from epoch ms → YYYY-MM-DD (local time). */
export function dayLabel(ms: number): string {
  const d = new Date(ms)
  const pad = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse a YYYY-MM-DD label back to epoch ms at local midnight. */
export function dayStart(label: string): number {
  const [y, m, d] = label.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime()
}
