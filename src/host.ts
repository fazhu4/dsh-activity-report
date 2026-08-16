import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { ActivityDataStatus, SessionRecord } from './contract.ts'
import { activityReportDomainSpec } from './domain.ts'
import { createFoldState, foldEvents, hydrateFoldState } from './fold.ts'
import type { FoldState } from './fold.ts'

/** Minimal typed table surface used by the activity runtime. */
export interface ActivityTable {
  entries(): IterableIterator<[SessionId, SessionRecord]>
  put(id: SessionId, record: SessionRecord): Promise<void>
  delete(id: SessionId): Promise<boolean>
}

/** Open storage-domain handle owned by this plugin instance. */
export interface ActivityDomain {
  table(name: 'sessions'): ActivityTable
  close(): Promise<void>
}

/** Dependencies isolated from Cordis so startup races can be tested deterministically. */
export interface ActivityRuntimeDeps {
  storageDomain: { open(spec: typeof activityReportDomainSpec): Promise<ActivityDomain> }
  sessionQuery: {
    listSessions(signal?: AbortSignal): Promise<Array<{ header: SessionHeader }>>
    readSession(sessionId: SessionId): Promise<{ session: SessionHeader; events: SessionEvent[] }>
    readTitle(sessionId: SessionId, signal?: AbortSignal): Promise<{ title: string } | undefined>
  }
  now?: () => number
  onError?: (error: unknown, sessionId?: SessionId) => void
}

/** Validated deployment choices controlling durability and startup load. */
export interface ActivityRuntimeConfig {
  persistDebounceMs: number
  backfillConcurrency: number
  timezone?: string
}

/** Observable ingestion and durability state returned by the summary API. */
export type ActivityRuntimeStatus = ActivityDataStatus

function metadata(header: SessionHeader, title?: string) {
  return {
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(title === undefined || title === '' ? {} : { title }),
    createdAt: header.createdAt,
  }
}

/** Replay-safe owner of buffered ingestion, per-session folds, and durable writes. */
export class ActivityRuntime {
  private readonly states = new Map<SessionId, FoldState>()
  private readonly revisions = new Map<SessionId, number>()
  private readonly dirty = new Set<SessionId>()
  private readonly buffered = new Map<SessionId, SessionEvent[]>()
  private readonly bufferedHeaders = new Map<SessionId, SessionHeader>()
  private readonly countedSessions = new Set<SessionId>()
  private readonly abort = new AbortController()
  private domain?: ActivityDomain
  private table?: ActivityTable
  private timer?: ReturnType<typeof setTimeout>
  private writeTail: Promise<void> = Promise.resolve()
  private startup?: Promise<void>
  private started = false
  private accepting = true
  private phase: ActivityRuntimeStatus['phase'] = 'backfilling'
  private processedSessions = 0
  private totalSessions = 0
  private failedSessions = 0
  private lastPersistedAt?: number
  private readonly timezone: string

  constructor(
    private readonly deps: ActivityRuntimeDeps,
    private readonly config: ActivityRuntimeConfig,
  ) {
    this.timezone = config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  }

  /** Open storage, hydrate records, replay the logical corpus, and drain startup buffers. */
  start(): Promise<void> {
    if (this.started) throw new Error('activity runtime has already started')
    this.started = true
    this.startup = this.startInternal()
    return this.startup
  }

  private async startInternal(): Promise<void> {
    this.domain = await this.deps.storageDomain.open(activityReportDomainSpec)
    this.table = this.domain.table('sessions')
    const incompatible = new Set<SessionId>()
    for (const [id, record] of this.table.entries()) {
      if (record.timezone !== this.timezone) {
        incompatible.add(id)
        continue
      }
      this.states.set(id, hydrateFoldState(record))
      this.revisions.set(id, 0)
    }
    for (const id of incompatible) await this.table.delete(id)

    const sessions = await this.deps.sessionQuery.listSessions(this.abort.signal)
    for (const { header } of sessions) this.countedSessions.add(header.id)
    this.totalSessions = this.countedSessions.size
    for (const id of [...this.states.keys()]) {
      if (this.countedSessions.has(id) || this.buffered.has(id)) continue
      await this.table.delete(id)
      this.states.delete(id)
      this.revisions.delete(id)
      this.dirty.delete(id)
    }
    let cursor = 0
    const workers = Array.from({ length: Math.min(this.config.backfillConcurrency, Math.max(1, sessions.length)) }, async () => {
      while (!this.abort.signal.aborted) {
        const index = cursor++
        const session = sessions[index]
        if (session === undefined) return
        await this.backfill(session.header)
      }
    })
    await Promise.all(workers)

    for (const id of [...this.buffered.keys()]) this.drainBuffered(id)
    this.phase = this.failedSessions === 0 ? 'ready' : 'degraded'
    await this.flush()
  }

  /** Accept one post-commit live Session event without awaiting storage. */
  acceptLive(header: SessionHeader, event: SessionEvent): void {
    if (!this.accepting) return
    if (this.phase === 'backfilling') {
      const events = this.buffered.get(header.id) ?? []
      events.push(event)
      this.buffered.set(header.id, events)
      this.bufferedHeaders.set(header.id, header)
      return
    }
    const discovered = !this.countedSessions.has(header.id)
    if (discovered) {
      this.countedSessions.add(header.id)
      this.totalSessions += 1
      this.processedSessions += 1
    }
    this.mergeMetadata(header.id, metadata(header))
    this.fold(header.id, [event])
    this.schedulePersist()
  }

  /** Current immutable record snapshots used by queries. */
  records(): SessionRecord[] {
    return [...this.states.values()].map((state) => structuredClone(state.record))
  }

  /** Current startup, coverage, and persistence status. */
  status(): ActivityRuntimeStatus {
    return {
      phase: this.phase,
      processedSessions: this.processedSessions,
      totalSessions: this.totalSessions,
      failedSessions: this.failedSessions,
      dirtyCount: this.dirty.size,
      ...(this.lastPersistedAt === undefined ? {} : { lastPersistedAt: this.lastPersistedAt }),
    }
  }

  /** Persist every currently dirty complete record in write order. */
  flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const run = async () => {
      const table = this.table
      if (table === undefined) return
      for (const id of [...this.dirty]) {
        const state = this.states.get(id)
        if (state === undefined) continue
        const revision = this.revisions.get(id) ?? 0
        const snapshot = structuredClone(state.record)
        try {
          await table.put(id, snapshot)
          if ((this.revisions.get(id) ?? 0) === revision) this.dirty.delete(id)
          this.lastPersistedAt = (this.deps.now ?? Date.now)()
        } catch (error) {
          this.phase = 'degraded'
          this.deps.onError?.(error, id)
        }
      }
    }
    this.writeTail = this.writeTail.then(run, run)
    return this.writeTail
  }

  /** Stop ingestion, drain accepted writes, and close the owned domain. */
  async dispose(): Promise<void> {
    if (this.phase === 'disposed') return
    this.accepting = false
    this.abort.abort()
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    try {
      await this.startup
    } catch (error) {
      this.deps.onError?.(error)
    }
    await this.flush()
    await this.domain?.close()
    this.phase = 'disposed'
  }

  private async backfill(header: SessionHeader): Promise<void> {
    try {
      const snapshot = await this.deps.sessionQuery.readSession(header.id)
      let title: string | undefined
      try {
        title = (await this.deps.sessionQuery.readTitle(header.id, this.abort.signal))?.title
      } catch (error) {
        if (!this.abort.signal.aborted) this.deps.onError?.(error, header.id)
      }
      const existing = this.states.get(header.id)
      if (existing === undefined) {
        this.states.set(header.id, createFoldState(header.id, metadata(snapshot.session, title), this.timezone))
        this.markDirty(header.id)
      } else {
        const nextMetadata = { ...existing.record.metadata, ...metadata(snapshot.session, title) }
        if (JSON.stringify(existing.record.metadata) !== JSON.stringify(nextMetadata)) {
          existing.record.metadata = nextMetadata
          this.markDirty(header.id)
        }
      }
      this.fold(header.id, [...snapshot.events].sort((left, right) => left.seq - right.seq))
      this.drainBuffered(header.id)
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.failedSessions += 1
        this.deps.onError?.(error, header.id)
      }
    } finally {
      this.processedSessions += 1
    }
  }

  private drainBuffered(id: SessionId): void {
    const events = this.buffered.get(id)
    if (events === undefined) return
    this.buffered.delete(id)
    const header = this.bufferedHeaders.get(id)
    this.bufferedHeaders.delete(id)
    if (header !== undefined) this.mergeMetadata(id, metadata(header))
    if (!this.countedSessions.has(id)) {
      this.countedSessions.add(id)
      this.totalSessions += 1
      this.processedSessions += 1
    }
    this.fold(id, events.sort((left, right) => left.seq - right.seq))
  }

  private mergeMetadata(id: SessionId, next: SessionRecord['metadata']): void {
    const state = this.states.get(id)
    if (state === undefined) {
      this.states.set(id, createFoldState(id, next, this.timezone))
      this.markDirty(id)
      return
    }
    const merged = { ...state.record.metadata, ...next }
    if (JSON.stringify(state.record.metadata) === JSON.stringify(merged)) return
    state.record.metadata = merged
    this.markDirty(id)
  }

  private fold(id: SessionId, events: readonly SessionEvent[]): void {
    let state = this.states.get(id)
    if (state === undefined) {
      state = createFoldState(id, {}, this.timezone)
      this.states.set(id, state)
    }
    const before = state.record.watermark
    foldEvents(state, events, this.timezone)
    if (state.record.watermark !== before) this.markDirty(id)
  }

  private markDirty(id: SessionId): void {
    this.dirty.add(id)
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1)
  }

  private schedulePersist(): void {
    if (this.timer !== undefined || this.config.persistDebounceMs === 0) {
      if (this.config.persistDebounceMs === 0) void this.flush()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.config.persistDebounceMs)
  }
}
