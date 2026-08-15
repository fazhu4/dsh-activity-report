import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {
  DayFacts,
  RequestOrigin,
  RouteRef,
  SessionMetadata,
  SessionRecord,
  UsageSample,
} from './contract.ts'
import { adaptEvent } from './adapt.ts'
import { createSessionRecord } from './domain.ts'
import { addMetrics, emptyMetrics, isMetricsEmpty, scaleMetrics } from './metrics.ts'
import type { Metrics, UsageMetrics } from './metrics.ts'

const UNKNOWN = '(unknown)'

/** Mutable incremental fold wrapper used by replay and live ingestion. */
export interface FoldState {
  record: SessionRecord
}

/** Create an empty fold for one Session. */
export function createFoldState(sessionId: SessionId, metadata: SessionMetadata = {}): FoldState {
  return { record: createSessionRecord(sessionId, metadata) }
}

/** Resume a fold from a validated storage-domain record without mutating the caller's object. */
export function hydrateFoldState(record: SessionRecord): FoldState {
  return { record: structuredClone(record) }
}

/** Format one event timestamp as a natural local calendar day. */
export function dayKey(time: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(time)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function emptyDayFacts(): DayFacts {
  return {
    totals: emptyMetrics(),
    byProvider: {},
    byModel: {},
    byRoute: {},
    byTool: {},
    byOrigin: {},
  }
}

function dayAt(record: SessionRecord, day: string): DayFacts {
  return record.days[day] ??= emptyDayFacts()
}

function metricsAt(values: Record<string, Metrics>, key: string): Metrics {
  return values[key] ??= emptyMetrics()
}

function originMetrics(day: DayFacts, origin: RequestOrigin): Metrics {
  return day.byOrigin[origin] ??= emptyMetrics()
}

function removeEmpty(values: Record<string, Metrics>): void {
  for (const [key, metrics] of Object.entries(values)) {
    if (isMetricsEmpty(metrics)) delete values[key]
  }
}

function removeEmptyDay(record: SessionRecord, dayName: string): void {
  const day = record.days[dayName]
  if (day === undefined) return
  removeEmpty(day.byProvider)
  removeEmpty(day.byModel)
  for (const [key, route] of Object.entries(day.byRoute)) {
    if (isMetricsEmpty(route.metrics)) delete day.byRoute[key]
  }
  removeEmpty(day.byTool)
  for (const origin of ['agent', 'compaction'] as const) {
    if (day.byOrigin[origin] !== undefined && isMetricsEmpty(day.byOrigin[origin])) {
      delete day.byOrigin[origin]
    }
  }
  if (isMetricsEmpty(day.totals)
    && Object.keys(day.byProvider).length === 0
    && Object.keys(day.byModel).length === 0
    && Object.keys(day.byRoute).length === 0
    && Object.keys(day.byTool).length === 0
    && Object.keys(day.byOrigin).length === 0) {
    delete record.days[dayName]
  }
}

function usageMetrics(usage: UsageMetrics): Metrics {
  const metrics = emptyMetrics()
  metrics.usage = { ...usage }
  return metrics
}

function routeFacts(day: DayFacts, route: RouteRef): DayFacts['byRoute'][string] {
  const key = JSON.stringify([route.provider, route.model])
  return day.byRoute[key] ??= { ...route, metrics: emptyMetrics(), byOrigin: {} }
}

function applyUsage(record: SessionRecord, sample: UsageSample, factor: 1 | -1): void {
  const day = dayAt(record, sample.day)
  const metrics = scaleMetrics(usageMetrics(sample.usage), factor)
  addMetrics(day.totals, metrics)
  addMetrics(metricsAt(day.byProvider, sample.provider), metrics)
  addMetrics(metricsAt(day.byModel, sample.model), metrics)
  const route = routeFacts(day, sample)
  addMetrics(route.metrics, metrics)
  addMetrics(route.byOrigin[sample.origin] ??= emptyMetrics(), metrics)
  addMetrics(originMetrics(day, sample.origin), metrics)
  if (factor === -1) removeEmptyDay(record, sample.day)
}

function addRoutedMetrics(record: SessionRecord, dayName: string, route: RouteRef, metrics: Metrics): void {
  const day = dayAt(record, dayName)
  addMetrics(day.totals, metrics)
  addMetrics(metricsAt(day.byProvider, route.provider), metrics)
  addMetrics(metricsAt(day.byModel, route.model), metrics)
  addMetrics(routeFacts(day, route).metrics, metrics)
}

function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

function replaceUsage(
  record: SessionRecord,
  time: number,
  turn: number,
  step: number,
  usage: UsageMetrics,
  origin: RequestOrigin,
  route?: RouteRef,
  timeZone?: string,
): void {
  const key = stepKey(turn, step)
  if (record.runtime.openUsage?.stepKey === key) applyUsage(record, record.runtime.openUsage, -1)
  const resolved = route ?? record.runtime.openStep?.route ?? record.runtime.currentRoute
    ?? { provider: UNKNOWN, model: UNKNOWN }
  const sample: UsageSample = {
    stepKey: key,
    day: dayKey(time, timeZone),
    provider: resolved.provider,
    model: resolved.model,
    origin,
    usage,
  }
  applyUsage(record, sample, 1)
  record.runtime.openUsage = sample
}

function addActivity(record: SessionRecord, dayName: string, route: RouteRef, change: (metrics: Metrics) => void): void {
  const metrics = emptyMetrics()
  change(metrics)
  addRoutedMetrics(record, dayName, route, metrics)
}

/** Fold one ordered event. Events already represented by the watermark are ignored. */
export function foldEvent(state: FoldState, event: SessionEvent, timeZone?: string): void {
  const record = state.record
  if (event.seq <= record.watermark) return
  const adapted = adaptEvent(event)
  const eventDay = dayKey(adapted.time, timeZone)

  switch (adapted.kind) {
    case 'route':
      record.runtime.currentRoute = adapted.route
      if (record.runtime.openStep !== undefined) record.runtime.openStep.route = adapted.route
      break
    case 'step-start':
      record.runtime.openStep = {
        turn: adapted.turn,
        step: adapted.step,
        startTime: adapted.time,
        ...(record.runtime.currentRoute === undefined ? {} : { route: record.runtime.currentRoute }),
      }
      delete record.runtime.openUsage
      break
    case 'first-token': {
      const open = record.runtime.openStep
      if (open?.turn === adapted.turn && open.step === adapted.step && open.firstTokenTime === undefined) {
        open.firstTokenTime = adapted.time
      }
      break
    }
    case 'usage':
      replaceUsage(record, adapted.time, adapted.turn, adapted.step, adapted.usage, adapted.origin, undefined, timeZone)
      break
    case 'message': {
      record.runtime.currentRoute = adapted.route
      const open = record.runtime.openStep
      if (open !== undefined) open.route = adapted.route
      if (adapted.usage !== undefined) {
        replaceUsage(record, adapted.time, adapted.turn, adapted.step, adapted.usage, 'agent', adapted.route, timeZone)
      }
      if (open?.turn === adapted.turn && open.step === adapted.step && open.messageRecorded !== true) {
        addActivity(record, eventDay, adapted.route, (metrics) => {
          metrics.performance.modelMs = Math.max(0, adapted.time - open.startTime)
          metrics.performance.messageSamples = 1
          if (open.firstTokenTime !== undefined) {
            metrics.performance.ttftMs = Math.max(0, open.firstTokenTime - open.startTime)
            metrics.performance.ttftSamples = 1
            metrics.performance.decodeMs = Math.max(0, adapted.time - open.firstTokenTime)
            metrics.performance.decodeTokens = adapted.usage?.output ?? 0
          }
        })
        open.messageRecorded = true
      }
      break
    }
    case 'step-end': {
      const route = record.runtime.openStep?.route ?? record.runtime.currentRoute
        ?? { provider: UNKNOWN, model: UNKNOWN }
      addActivity(record, eventDay, route, (metrics) => {
        metrics.activity.steps = 1
        if (record.runtime.lastCountedTurn !== adapted.turn) metrics.activity.turns = 1
      })
      record.runtime.lastCountedTurn = adapted.turn
      delete record.runtime.openStep
      delete record.runtime.openUsage
      break
    }
    case 'turn-end': {
      const metrics = emptyMetrics()
      metrics.activity.outcomes[adapted.outcome] = 1
      addMetrics(dayAt(record, eventDay).totals, metrics)
      record.runtime.pendingTools = {}
      break
    }
    case 'tool-call': {
      record.runtime.pendingTools[adapted.callId] = { name: adapted.name, startTime: adapted.time }
      const metrics = emptyMetrics()
      metrics.activity.toolCalls = 1
      const day = dayAt(record, eventDay)
      addMetrics(day.totals, metrics)
      addMetrics(metricsAt(day.byTool, adapted.name), metrics)
      break
    }
    case 'tool-result': {
      const pending = record.runtime.pendingTools[adapted.callId]
      if (pending === undefined) break
      const metrics = emptyMetrics()
      metrics.activity.toolResults = 1
      metrics.activity.toolErrors = adapted.failed ? 1 : 0
      metrics.performance.toolMs = Math.max(0, adapted.time - pending.startTime)
      const day = dayAt(record, eventDay)
      addMetrics(day.totals, metrics)
      addMetrics(metricsAt(day.byTool, pending.name), metrics)
      delete record.runtime.pendingTools[adapted.callId]
      break
    }
    case 'aux-usage': {
      const sample: UsageSample = {
        stepKey: `aux:${adapted.seq}`,
        day: eventDay,
        provider: adapted.route.provider,
        model: adapted.route.model,
        origin: adapted.origin,
        usage: adapted.usage,
      }
      applyUsage(record, sample, 1)
      break
    }
    case 'ignored':
      break
  }
  record.watermark = event.seq
}

/** Fold ordered Session events into the supplied state. */
export function foldEvents(state: FoldState, events: readonly SessionEvent[], timeZone?: string): void {
  for (const event of events) foldEvent(state, event, timeZone)
}
