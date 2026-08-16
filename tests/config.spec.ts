import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/index.ts'

describe('activity report configuration', () => {
  it('canonicalizes a valid IANA timezone', () => {
    expect(resolveConfig({ timezone: 'asia/shanghai' }).timezone).toBe('Asia/Shanghai')
  })

  it('rejects an invalid IANA timezone at plugin load', () => {
    expect(() => resolveConfig({ timezone: 'local-office-time' })).toThrow(
      'timezone must be a valid IANA time zone',
    )
  })
})
