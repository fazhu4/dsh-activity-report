/**
 * dsh-activity-report host plugin: backfills all local session logs into a
 * materialized per-session fold, listens for incremental `session/event`
 * writes, persists atomically to `$DSH_HOME/storages/activity-report.json`,
 * and serves the summary over a `webServer` HTTP route for the browser panel.
 *
 * Services injected: webServer, sessionQuery, sessions, fs.
 * Type-safe access is intentionally structural (duck-typed faces) so this
 * package does not need to import DSH internals at build time.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { toFoldEvent } from './adapt.ts'
import type { ActivityStore, DayStats, SessionFold, SummaryResponse } from './contract.ts'
import { addTo, emptyDayStats, emptyStats, mergeStats } from './contract.ts'
import { createFoldState, foldEvents, localDayKey, type FoldEvent } from './fold.ts'

/** Plugin metadata (Cordis). */
export const name = 'dsh-activity-report'

/** Declared service injections. */
export const inject = ['webServer', 'sessionQuery', 'sessions', 'fs']

/** Plugin configuration (schema-less: read as a plain object). */
export interface Config {
  /** Store file name under $DSH_HOME/storages/. */
  storeFile?: string
  /** Persist debounce in ms. */
  saveDebounceMs?: number
}

// --- structural service faces -------------------------------------------------

interface FsFace {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<{ targetKey: string; displayPath: string }>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
  writeText(target: unknown, content: string): Promise<void>
}
interface SessionQueryFace {
  listSessions(signal?: AbortSignal): Promise<Array<{ header: { id: string; cwd?: string | null; createdAt?: number } }>>
  readSession(sessionId: string): Promise<{
    session: { id: string; cwd?: string | null; createdAt?: number }
    events: Array<Record<string, unknown>>
  }>
  readTitle(sessionId: string, signal?: AbortSignal): Promise<{ text?: string } | undefined>
}

interface SessionsFace {
  get(id: string): { id: string; header: { cwd?: string | null } } | undefined
}

interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

interface SessionEventLike {
  seq?: number
  time?: number
  type?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

interface Ctx {
  webServer: WebServerFace
  sessionQuery: SessionQueryFace
  sessions: SessionsFace
  fs: FsFace
  on(event: string, listener: (session: { id: string }, event: SessionEventLike) => void): () => void
  effect<T>(fn: () => T, label?: string): T
}

// --- event adaptation (see adapt.ts for the pure mapping) ---------------------

// --- plugin state --------------------------------------------------------------

interface RunningState {
  /** Per-session fold state (watermark + stats + open turn starts). */
  states: Map<string, ReturnType<typeof createFoldState>>
  /** Last-activity epoch ms per session (for range bucketing). */
  lastActivity: Map<string, number>
  /** On-disk store mirror. */
  store: ActivityStore
  /** Resolved write target. */
  target?: { targetKey: string; displayPath: string }
  persistTimer?: NodeJS.Timeout
}

function newRunningState(): RunningState {
  return { states: new Map(), lastActivity: new Map(), store: { version: 1, sessions: {} } }
}

/**
 * Extract a short human-readable label from the first user prompt in a raw
 * event list. Compaction strips titles, but the first user message text is the
 * most stable identifier we can recover; falls back to undefined.
 */
function extractFirstUserText(rawEvents: Array<Record<string, unknown>>): string | undefined {
  for (const raw of rawEvents) {
    if (raw.type !== 'user/message') continue
    const d = (raw.data ?? raw) as Record<string, unknown>
    const content = d.content
    if (typeof content === 'string' && content.trim()) {
      const flat = content.replace(/\s+/g, ' ').trim()
      return flat.length > 60 ? flat.slice(0, 60) + '…' : flat
    }
    if (Array.isArray(content)) {
      const text = content
        .map((b) => {
          const block = b as Record<string, unknown>
          return typeof block?.text === 'string' ? block.text : ''
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text) return text.length > 60 ? text.slice(0, 60) + '…' : text
    }
  }
  return undefined
}

// --- host plugin body ----------------------------------------------------------

/**
 * Compose the plugin.
 * @param ctx - Cordis context.
 * @param config - plugin configuration.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  const webServer = ctx.webServer
  const sessionQuery = ctx.sessionQuery
  const fs = ctx.fs
  const storeFile = config.storeFile ?? 'activity-report.json'
  const debounceMs = config.saveDebounceMs ?? 2000

  const st = newRunningState()

  /** Fold one session's events; advance watermark and persist lazily. */
  function foldSession(sessionId: string, events: FoldEvent[], cwd?: string, title?: string, createdAt?: number): void {
    let state = st.states.get(sessionId)
    if (!state) {
      state = createFoldState(cwd, title)
      st.states.set(sessionId, state)
    } else if (cwd !== undefined && state.fold.cwd === undefined) {
      state.fold.cwd = cwd
    }
    if (title !== undefined && state.fold.title === undefined) {
      state.fold.title = title
    }
    if (createdAt !== undefined && state.fold.createdAt === undefined) {
      state.fold.createdAt = createdAt
    }
    foldEvents(state, events)
    for (const ev of events) {
      if (ev.time > (st.lastActivity.get(sessionId) ?? 0)) st.lastActivity.set(sessionId, ev.time)
    }
    // Mirror into the persisted store (including the last-activity timestamp so
    // range bucketing survives restarts).
    const f = state.fold
    st.store.sessions[sessionId] = {
      watermark: f.watermark,
      cwd: f.cwd,
      title: f.title,
      createdAt: f.createdAt,
      lastActivityMs: st.lastActivity.get(sessionId),
      stats: f.stats,
      byProvider: f.byProvider,
      byModel: f.byModel,
      byDay: f.byDay,
    }
    schedulePersist()
  }

  function schedulePersist(): void {
    if (st.persistTimer) return
    st.persistTimer = setTimeout(() => {
      st.persistTimer = undefined
      void persist()
    }, debounceMs)
  }

  async function persist(): Promise<void> {
    if (!st.target) return
    try {
      await fs.writeText(st.target.targetKey, JSON.stringify(st.store))
    } catch {
      // Non-fatal: keep in-memory state.
    }
  }

  /** Hydrate in-memory fold states from the persisted store. */
  function hydrateFromStore(): void {
    for (const [id, fold] of Object.entries(st.store.sessions)) {
      const state = createFoldState(fold.cwd, fold.title)
      state.fold.watermark = fold.watermark
      state.fold.stats = fold.stats
      state.fold.byProvider = fold.byProvider
      state.fold.byModel = fold.byModel
      state.fold.byDay = fold.byDay ?? {}
      if (fold.lastActivityMs !== undefined) st.lastActivity.set(id, fold.lastActivityMs)
      st.states.set(id, state)
    }
  }

  /** Load the store from disk (best-effort; corrupt/missing → fresh). */
  async function loadStore(): Promise<void> {
    // Absolute path under the harness home: ctx.fs.resolve with a relative
    // path resolves against an unspecified default, so always anchor at home.
    const abs = dshHomePath('storages', storeFile)
    try {
      st.target = await fs.resolve(abs)
    } catch {
      return
    }
    try {
      const text = await fs.readText(st.target.targetKey)
      const parsed = JSON.parse(text) as ActivityStore
      if (parsed && typeof parsed === 'object' && parsed.version === 1 && parsed.sessions) {
        st.store.sessions = parsed.sessions
      }
    } catch {
      // Missing or unreadable → start fresh.
    }
  }

  /** Backfill one persisted session's events after its watermark. */
  async function backfillSession(sessionId: string, cwd?: string, title?: string, createdAt?: number): Promise<void> {
    try {
      const snap = await sessionQuery.readSession(sessionId)
      const events = snap.events
        .map(toFoldEvent)
        .sort((a, b) => a.seq - b.seq)
      // Best-effort title: the live corpus may still hold the session/title
      // event even when the persisted log was compacted (title is log-backed).
      let resolvedTitle = title
      if (resolvedTitle === undefined) {
        try {
          const t = await sessionQuery.readTitle(sessionId)
          resolvedTitle = t?.text
        } catch {
          // Title is optional.
        }
      }
      // Fallback label: first user prompt text (compaction may strip titles).
      if (resolvedTitle === undefined || resolvedTitle === '') {
        resolvedTitle = extractFirstUserText(snap.events)
      }
      foldSession(sessionId, events, snap.session.cwd ?? cwd, resolvedTitle, snap.session.createdAt ?? createdAt)
    } catch {
      // Unreadable session → skip.
    }
  }

  /** Startup: load store, hydrate, then backfill the corpus in the background. */
  void (async () => {
    await loadStore()
    hydrateFromStore()
    try {
      const records = await sessionQuery.listSessions()
      for (const rec of records) {
        await backfillSession(rec.header.id, rec.header.cwd ?? undefined, undefined, rec.header.createdAt)
      }
      await persist()
    } catch {
      // Best-effort; live increments still work.
    }
  })()

  // Incremental: every new event on a live session advances its fold.
  const offEvent = ctx.on('session/event', (session, event) => {
    const ev = toFoldEvent(event)
    if (ev.type === '') return
    foldSession(session.id, [ev])
  })

  // Sessions created after startup get a fold so increments have a target.
  const offCreated = ctx.on('session/created' as never, (session: { id: string }) => {
    if (!st.states.has(session.id)) {
      st.states.set(session.id, createFoldState())
    }
  })

  ctx.effect(() => {
    return () => {
      offEvent()
      offCreated()
      if (st.persistTimer) clearTimeout(st.persistTimer)
      void persist()
    }
  }, 'dsh-activity-report: dispose')

  // --- HTTP routes -------------------------------------------------------------

  if (webServer !== undefined) {
    webServer.register({
      kind: 'exact',
      path: '/dsh-activity-report/summary',
      handler: (req, res) => { json(res, 200, buildSummary(parseRange(req))) },
    })
    webServer.register({
      kind: 'exact',
      path: '/dsh-activity-report/sessions',
      handler: (req, res) => {
        const summary = buildSummary(parseRange(req))
        const rows = Object.entries(summary.bySession).map(([sessionId, v]) => ({
          sessionId,
          title: v.title,
          cwd: v.cwd,
          stats: v.stats,
        }))
        json(res, 200, { updatedAt: summary.updatedAt, range: summary.range, sessions: rows })
      },
    })
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  /** Parse the range query param (today | 7d | 30d | all). */
  function parseRange(req: IncomingMessage): 'today' | '7d' | '30d' | 'all' {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const v = url.searchParams.get('range')
    return v === 'today' || v === '7d' || v === '30d' ? v : 'all'
  }

  /** Build the summary view for one range over all session folds. */
  function buildSummary(range: 'today' | '7d' | '30d' | 'all'): SummaryResponse {
    const now = Date.now()
    const today = new Date(now)
    const startMs = range === 'today'
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
      : range === '7d' ? now - 7 * 86_400_000
      : range === '30d' ? now - 30 * 86_400_000
      : 0
    // Inclusive local-day floor for series filtering (today → today; 7d/30d → start day).
    const startDay = range === 'all' ? '' : localDayKey(startMs)

    const totals = emptyStats()
    const byProvider: Record<string, ReturnType<typeof emptyStats>> = {}
    const byModel: Record<string, ReturnType<typeof emptyStats>> = {}
    const bySession: SummaryResponse['bySession'] = {}
    const dayTotals = new Map<string, DayStats>()

    for (const [id, state] of st.states) {
      const fold = state.fold
      // Prefer the persisted last-activity timestamp so range filtering is
      // stable across restarts; fall back to the in-memory map, then now.
      const last = fold.lastActivityMs ?? st.lastActivity.get(id) ?? now
      if (last < startMs) continue
      mergeStats(totals, fold.stats)
      for (const [p, s] of Object.entries(fold.byProvider)) addTo(byProvider, p, s)
      for (const [m, s] of Object.entries(fold.byModel)) addTo(byModel, m, s)
      bySession[id] = { cwd: fold.cwd, title: fold.title, createdAt: fold.createdAt, stats: fold.stats }
      // Per-local-day distribution from the materialized fold (exact timestamps).
      for (const [day, dayStat] of Object.entries(fold.byDay ?? {})) {
        if (startDay !== '' && day < startDay) continue
        let acc = dayTotals.get(day)
        if (!acc) {
          acc = emptyDayStats()
          dayTotals.set(day, acc)
        }        acc.requests += dayStat.requests
        acc.tokens.input += dayStat.tokens.input
        acc.tokens.output += dayStat.tokens.output
        acc.tokens.cacheRead += dayStat.tokens.cacheRead
        acc.tokens.cacheWrite += dayStat.tokens.cacheWrite
      }
    }

    return {
      updatedAt: now,
      range,
      totals,
      byProvider,
      byModel,
      bySession,
      series: [...dayTotals.entries()]
        .map(([label, stats]) => ({ label, stats: toStats(stats) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }
  }

  /** Convert a DayStats into a full ActivityStats for the series shape. */
  function toStats(d: DayStats): ReturnType<typeof emptyStats> {
    const s = emptyStats()
    s.requests = d.requests
    s.tokens = { ...d.tokens }
    return s
  }
}
