import { describe, expect, it } from 'vitest'
import { addMetrics, emptyMetrics, isMetricsEmpty, scaleMetrics, totalInputTokens, totalTokens } from '../src/metrics.ts'

describe('metric arithmetic', () => {
  it('keeps reasoning tokens as an output subset', () => {
    const value = emptyMetrics()
    value.usage = {
      requests: 1,
      input: 10,
      cacheRead: 4,
      cacheWrite: 2,
      output: 8,
      reasoning: 3,
    }

    expect(totalInputTokens(value.usage)).toBe(16)
    expect(totalTokens(value.usage)).toBe(24)
  })

  it('adds and subtracts every field symmetrically', () => {
    const contribution = emptyMetrics()
    contribution.usage = {
      requests: 1,
      input: 2,
      cacheRead: 3,
      cacheWrite: 4,
      output: 5,
      reasoning: 1,
    }
    contribution.activity = {
      turns: 1,
      steps: 2,
      toolCalls: 3,
      toolResults: 2,
      toolErrors: 1,
      outcomes: { completed: 1 },
    }
    contribution.performance = {
      modelMs: 10,
      toolMs: 20,
      ttftMs: 3,
      ttftSamples: 1,
      decodeMs: 7,
      decodeTokens: 5,
      messageSamples: 1,
    }

    const total = emptyMetrics()
    addMetrics(total, contribution)
    addMetrics(total, scaleMetrics(contribution, -1))

    expect(total).toEqual(emptyMetrics())
    expect(isMetricsEmpty(total)).toBe(true)
  })

  it('does not classify outcome-only metrics as empty', () => {
    const value = emptyMetrics()
    value.activity.outcomes.error = 1
    expect(isMetricsEmpty(value)).toBe(false)
  })
})
