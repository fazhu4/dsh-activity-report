// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { adoptStyles, cssText } from '../src/client/styles.ts'

afterEach(() => {
  document.getElementById('dsh-activity-report-styles')?.remove()
})

describe('activity stylesheet lifecycle', () => {
  it('defines separate shell, toolbar, and status layers', () => {
    expect(cssText).toContain('.dsh_activity_hero')
    expect(cssText).toContain('.dsh_activity_toolbar')
    expect(cssText).toContain('.dsh_activity_statusMeta')
  })

  it('removes the shared stylesheet after the final effect releases it', () => {
    const releaseFirst = adoptStyles()
    const releaseSecond = adoptStyles()

    expect(document.querySelectorAll('#dsh-activity-report-styles')).toHaveLength(1)
    releaseFirst()
    expect(document.querySelectorAll('#dsh-activity-report-styles')).toHaveLength(1)
    releaseSecond()
    expect(document.querySelectorAll('#dsh-activity-report-styles')).toHaveLength(0)
  })
})
