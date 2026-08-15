import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { createFoldState, foldEvents } from '../src/fold.ts'
import { ActivityRuntime } from '../src/host.ts'
import type { ActivityDomain, ActivityRuntimeDeps } from '../src/host.ts'
import type { SessionRecord } from '../src/contract.ts'

const SESSION_ID = 'session-1' as SessionId

function event(seq: number, type = 'compaction/summary'): SessionEvent {
  return {
    seq,
    time: 100 + seq,
    type,
    data: type === 'compaction/summary'
      ? { provider: 'p', model: 'm', usage: { inputTokens: 1, outputTokens: 1 } }
      : {},
  } as SessionEvent
}

function header(id = SESSION_ID): SessionHeader {
  return { version: 0, id, createdAt: 1, cwd: 'G:/project' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function fakeDomain(initial?: SessionRecord): ActivityDomain & { closed: boolean; puts: SessionRecord[] } {
  const records = new Map<SessionId, SessionRecord>()
  if (initial !== undefined) records.set(initial.sessionId, structuredClone(initial))
  const domain = {
    closed: false,
    puts: [] as SessionRecord[],
    table: () => ({
      entries: () => new Map(records).entries(),
      put: async (id: SessionId, record: SessionRecord) => {
        const copy = structuredClone(record)
        records.set(id, copy)
        domain.puts.push(copy)
      },
    }),
    close: async () => { domain.closed = true },
  }
  return domain
}

function dependencies(domain: ActivityDomain, readSession: ActivityRuntimeDeps['sessionQuery']['readSession']): ActivityRuntimeDeps {
  return {
    storageDomain: { open: async () => domain },
    sessionQuery: {
      listSessions: async () => [{ header: header() }],
      readSession,
      readTitle: async () => ({ title: 'Usage session' }),
    },
    now: () => 1_000,
  }
}

describe('activity host lifecycle', () => {
  it('buffers live events until persisted backfill reaches the same session', async () => {
    const persisted = createFoldState(SESSION_ID, { cwd: 'G:/project' })
    foldEvents(persisted, [event(0, 'ignored'), event(1, 'ignored'), event(2, 'ignored')])
    const domain = fakeDomain(persisted.record)
    const read = deferred<{ session: SessionHeader; events: SessionEvent[] }>()
    const runtime = new ActivityRuntime(dependencies(domain, async () => read.promise), {
      persistDebounceMs: 1,
      backfillConcurrency: 2,
    })

    const starting = runtime.start()
    runtime.acceptLive(header(), event(5))
    read.resolve({ session: header(), events: [event(3), event(4)] })
    await starting

    expect(runtime.status().phase).toBe('ready')
    expect(runtime.records()[0]?.watermark).toBe(5)
    expect(runtime.records()[0]?.days['1970-01-01']?.totals.usage.requests).toBe(3)
    expect(domain.puts.at(-1)?.watermark).toBe(5)
    await runtime.dispose()
  })

  it('drains accepted writes before closing the domain', async () => {
    const domain = fakeDomain()
    const runtime = new ActivityRuntime(dependencies(domain, async () => ({ session: header(), events: [] })), {
      persistDebounceMs: 60_000,
      backfillConcurrency: 1,
    })
    await runtime.start()
    runtime.acceptLive(header(), event(0))
    await runtime.dispose()

    expect(domain.puts.at(-1)?.days['1970-01-01']?.totals.usage.requests).toBe(1)
    expect(domain.closed).toBe(true)
  })

  it('persists discovered metadata even when the log is empty', async () => {
    const domain = fakeDomain()
    const runtime = new ActivityRuntime(dependencies(domain, async () => ({ session: header(), events: [] })), {
      persistDebounceMs: 10,
      backfillConcurrency: 1,
    })
    await runtime.start()

    expect(domain.puts.at(-1)?.metadata).toEqual({ cwd: 'G:/project', title: 'Usage session', createdAt: 1 })
    await runtime.dispose()
  })

  it('tracks metadata and progress for a session created after backfill', async () => {
    const domain = fakeDomain()
    const runtime = new ActivityRuntime({
      ...dependencies(domain, async () => ({ session: header(), events: [] })),
      sessionQuery: {
        listSessions: async () => [],
        readSession: async () => ({ session: header(), events: [] }),
        readTitle: async () => undefined,
      },
    }, {
      persistDebounceMs: 0,
      backfillConcurrency: 1,
    })
    await runtime.start()

    runtime.acceptLive(header(), event(0))
    await runtime.flush()

    expect(runtime.status()).toMatchObject({ processedSessions: 1, totalSessions: 1 })
    expect(runtime.records()[0]?.metadata).toEqual({ cwd: 'G:/project', createdAt: 1 })
    expect(domain.puts.at(-1)?.metadata).toEqual({ cwd: 'G:/project', createdAt: 1 })
    await runtime.dispose()
  })
})
