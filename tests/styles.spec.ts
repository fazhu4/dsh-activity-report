// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { adoptStyles, cssText } from '../src/client/styles.ts'

afterEach(() => {
  document.getElementById('dsh-usage-insights-styles')?.remove()
})

describe('activity stylesheet lifecycle', () => {
  it('defines separate shell, toolbar, and status layers', () => {
    expect(cssText).toContain('.dsh_usage_hero')
    expect(cssText).toContain('.dsh_usage_toolbar')
    expect(cssText).toContain('.dsh_usage_statusMeta')
  })

  it('defines a featured overview card and a distinct trend panel', () => {
    expect(cssText).toContain('.dsh_usage_overview')
    expect(cssText).toContain('.dsh_usage_kpiFeatured')
    expect(cssText).toContain('.dsh_usage_trendPanel')
  })

  it('defines analysis, metric, and empty-state presentation layers', () => {
    expect(cssText).toContain('.dsh_usage_analysisHeader')
    expect(cssText).toContain('.dsh_usage_metricPanel')
    expect(cssText).toContain('.dsh_usage_emptyState')
  })

  it('removes the shared stylesheet after the final effect releases it', () => {
    const releaseFirst = adoptStyles()
    const releaseSecond = adoptStyles()

    expect(document.querySelectorAll('#dsh-usage-insights-styles')).toHaveLength(1)
    releaseFirst()
    expect(document.querySelectorAll('#dsh-usage-insights-styles')).toHaveLength(1)
    releaseSecond()
    expect(document.querySelectorAll('#dsh-usage-insights-styles')).toHaveLength(0)
  })
})
