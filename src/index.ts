import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { ActivityRuntime } from './host.ts'

/** Cordis plugin name. */
export const name = 'dsh-activity-report'

/** Services required for ingestion, persistence, queries, and the browser API. */
export const inject = ['webServer', 'sessionQuery', 'sessions', 'storageDomain']

/** Deployment-level activity report configuration. */
export interface Config {
  persistDebounceMs?: number
  backfillConcurrency?: number
  defaultPageSize?: number
}

/** Fully resolved plugin configuration. */
export interface ResolvedConfig {
  persistDebounceMs: number
  backfillConcurrency: number
  defaultPageSize: number
}

/** Validate and resolve deployment choices at plugin load. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved = {
    persistDebounceMs: config.persistDebounceMs ?? 1_000,
    backfillConcurrency: config.backfillConcurrency ?? 4,
    defaultPageSize: config.defaultPageSize ?? 25,
  }
  if (!Number.isSafeInteger(resolved.persistDebounceMs) || resolved.persistDebounceMs < 0) {
    throw new Error('persistDebounceMs must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(resolved.backfillConcurrency) || resolved.backfillConcurrency < 1 || resolved.backfillConcurrency > 32) {
    throw new Error('backfillConcurrency must be an integer between 1 and 32')
  }
  if (!Number.isSafeInteger(resolved.defaultPageSize) || resolved.defaultPageSize < 1 || resolved.defaultPageSize > 200) {
    throw new Error('defaultPageSize must be an integer between 1 and 200')
  }
  return resolved
}

/** Mount replay-safe activity ingestion and storage lifecycle. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const resolved = resolveConfig(config)
  const runtime = new ActivityRuntime({
    storageDomain: ctx.storageDomain,
    sessionQuery: ctx.sessionQuery,
    onError: (error, sessionId) => {
      const target = sessionId === undefined ? '' : ` for session '${sessionId}'`
      ctx.logger.warn(`dsh-activity-report${target}: ${String(error)}`)
    },
  }, resolved)

  const offEvent = ctx.on('session/event', (session, event) => {
    runtime.acceptLive(session.id, event)
  })
  const offFlush = ctx.on('session/flush', () => runtime.flush())
  ctx.effect(() => async () => {
    offEvent()
    offFlush()
    await runtime.dispose()
  }, 'dsh-activity-report:runtime')

  await runtime.start()
}
