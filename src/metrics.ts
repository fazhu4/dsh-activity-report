/** Provider-reported model usage. Reasoning is a subset of output. */
export interface UsageMetrics {
  requests: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning: number
}

/** Agent and tool lifecycle counts. */
export interface ActivityMetrics {
  turns: number
  steps: number
  toolCalls: number
  toolResults: number
  toolErrors: number
  outcomes: Record<string, number>
}

/** Accumulated timing samples. */
export interface PerformanceMetrics {
  modelMs: number
  toolMs: number
  ttftMs: number
  ttftSamples: number
  decodeMs: number
  decodeTokens: number
  messageSamples: number
}

/** Complete additive metric set used by every aggregation level. */
export interface Metrics {
  usage: UsageMetrics
  activity: ActivityMetrics
  performance: PerformanceMetrics
}

/** Create a mutable zero metric set. */
export function emptyMetrics(): Metrics {
  return {
    usage: { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    activity: { turns: 0, steps: 0, toolCalls: 0, toolResults: 0, toolErrors: 0, outcomes: {} },
    performance: {
      modelMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSamples: 0,
      decodeMs: 0,
      decodeTokens: 0,
      messageSamples: 0,
    },
  }
}

/** Total prompt-side tokens across the three disjoint DSH input buckets. */
export function totalInputTokens(usage: UsageMetrics): number {
  return usage.input + usage.cacheRead + usage.cacheWrite
}

/** Total provider-processed tokens; reasoning is already included in output. */
export function totalTokens(usage: UsageMetrics): number {
  return totalInputTokens(usage) + usage.output
}

/** Add one complete metric set into another in place. */
export function addMetrics(target: Metrics, source: Metrics): void {
  target.usage.requests += source.usage.requests
  target.usage.input += source.usage.input
  target.usage.cacheRead += source.usage.cacheRead
  target.usage.cacheWrite += source.usage.cacheWrite
  target.usage.output += source.usage.output
  target.usage.reasoning += source.usage.reasoning
  target.activity.turns += source.activity.turns
  target.activity.steps += source.activity.steps
  target.activity.toolCalls += source.activity.toolCalls
  target.activity.toolResults += source.activity.toolResults
  target.activity.toolErrors += source.activity.toolErrors
  target.performance.modelMs += source.performance.modelMs
  target.performance.toolMs += source.performance.toolMs
  target.performance.ttftMs += source.performance.ttftMs
  target.performance.ttftSamples += source.performance.ttftSamples
  target.performance.decodeMs += source.performance.decodeMs
  target.performance.decodeTokens += source.performance.decodeTokens
  target.performance.messageSamples += source.performance.messageSamples
  for (const [outcome, count] of Object.entries(source.activity.outcomes)) {
    const next = (target.activity.outcomes[outcome] ?? 0) + count
    if (next === 0) delete target.activity.outcomes[outcome]
    else target.activity.outcomes[outcome] = next
  }
}

/** Return a deep metric copy multiplied by an additive factor. */
export function scaleMetrics(source: Metrics, factor: number): Metrics {
  const result = emptyMetrics()
  result.usage.requests = source.usage.requests * factor
  result.usage.input = source.usage.input * factor
  result.usage.cacheRead = source.usage.cacheRead * factor
  result.usage.cacheWrite = source.usage.cacheWrite * factor
  result.usage.output = source.usage.output * factor
  result.usage.reasoning = source.usage.reasoning * factor
  result.activity.turns = source.activity.turns * factor
  result.activity.steps = source.activity.steps * factor
  result.activity.toolCalls = source.activity.toolCalls * factor
  result.activity.toolResults = source.activity.toolResults * factor
  result.activity.toolErrors = source.activity.toolErrors * factor
  result.activity.outcomes = Object.fromEntries(
    Object.entries(source.activity.outcomes).map(([key, value]) => [key, value * factor]),
  )
  result.performance.modelMs = source.performance.modelMs * factor
  result.performance.toolMs = source.performance.toolMs * factor
  result.performance.ttftMs = source.performance.ttftMs * factor
  result.performance.ttftSamples = source.performance.ttftSamples * factor
  result.performance.decodeMs = source.performance.decodeMs * factor
  result.performance.decodeTokens = source.performance.decodeTokens * factor
  result.performance.messageSamples = source.performance.messageSamples * factor
  return result
}

/** Whether a metric set contains no count, token, timing, or outcome. */
export function isMetricsEmpty(value: Metrics): boolean {
  return value.usage.requests === 0
    && value.usage.input === 0
    && value.usage.cacheRead === 0
    && value.usage.cacheWrite === 0
    && value.usage.output === 0
    && value.usage.reasoning === 0
    && value.activity.turns === 0
    && value.activity.steps === 0
    && value.activity.toolCalls === 0
    && value.activity.toolResults === 0
    && value.activity.toolErrors === 0
    && Object.keys(value.activity.outcomes).length === 0
    && value.performance.modelMs === 0
    && value.performance.toolMs === 0
    && value.performance.ttftMs === 0
    && value.performance.ttftSamples === 0
    && value.performance.decodeMs === 0
    && value.performance.decodeTokens === 0
    && value.performance.messageSamples === 0
}
