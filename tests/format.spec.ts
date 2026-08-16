import { describe, expect, it } from 'vitest'
import { duration } from '../src/client/format.ts'

describe('activity duration formatting', () => {
  it('keeps subsecond measurements visible in milliseconds', () => {
    expect(duration(1)).toBe('1ms')
    expect(duration(250)).toBe('250ms')
    expect(duration(999)).toBe('999ms')
    expect(duration(1_000)).toBe('1s')
  })
})
