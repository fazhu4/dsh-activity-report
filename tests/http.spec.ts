import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { createFoldState, foldEvents } from '../src/fold.ts'
import { registerActivityRoutes } from '../src/http.ts'
import type { ActivityHttpSource, WebRoute } from '../src/http.ts'

const SESSION_ID = 'session-1' as SessionId

function source(model = 'summary-model'): ActivityHttpSource {
  const state = createFoldState(SESSION_ID, { cwd: 'G:/project', title: 'Inspect usage' })
  foldEvents(state, [{
    seq: 0,
    time: Date.parse('2026-08-16T10:00:00+08:00'),
    type: 'compaction/summary',
    data: { provider: 'deepseek', model, usage: { inputTokens: 20, outputTokens: 5 } },
  } as SessionEvent], 'Asia/Shanghai')
  return {
    records: () => [state.record],
    status: () => ({
      phase: 'ready', processedSessions: 1, totalSessions: 1, failedSessions: 0, dirtyCount: 0, lastPersistedAt: 123,
    }),
    now: () => Date.parse('2026-08-16T01:00:00+08:00'),
    timezone: () => 'Asia/Shanghai',
    retryPersistence: async () => {},
  }
}

function harness(model?: string, override: Partial<ActivityHttpSource> = {}) {
  const routes = new Map<string, WebRoute>()
  const dispose = registerActivityRoutes({
    register: (route) => {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  }, { ...source(model), ...override }, { defaultPageSize: 25 })
  async function request(path: string, method = 'GET') {
    const pathname = new URL(path, 'http://localhost').pathname
    const route = routes.get(pathname)
    if (route === undefined) throw new Error(`missing route ${pathname}`)
    let status = 0
    let headers: Record<string, string> = {}
    let body = ''
    const response = {
      writeHead: (nextStatus: number, nextHeaders: Record<string, string>) => { status = nextStatus; headers = nextHeaders },
      end: (chunk?: string) => { body = chunk ?? '' },
    } as unknown as ServerResponse
    await route.handler({ url: path, method } as IncomingMessage, response)
    return { status, headers, body, json: () => JSON.parse(body) as unknown }
  }
  return { routes, dispose, request }
}

describe('activity report HTTP API', () => {
  it.each([
    '/dsh-activity-report/summary?range=year',
    '/dsh-activity-report/breakdown?dimension=secret',
    '/dsh-activity-report/breakdown?dimension=model&limit=0',
    '/dsh-activity-report/breakdown?dimension=model&limit=9999',
    '/dsh-activity-report/breakdown?dimension=model&cursor=bad',
    '/dsh-activity-report/breakdown?dimension=tool&sort=requests',
    '/dsh-activity-report/breakdown?dimension=tool&provider=deepseek',
    '/dsh-activity-report/filters?range=year',
  ])('rejects invalid query %s', async (path) => {
    const response = await harness().request(path)
    expect(response.status).toBe(400)
    expect(response.json()).toMatchObject({ error: expect.any(String) })
  })

  it('returns summary data with actual day bounds and persistence state', async () => {
    const response = await harness().request('/dsh-activity-report/summary?range=today')
    expect(response.status).toBe(200)
    expect(response.json()).toMatchObject({
      timezone: 'Asia/Shanghai', startDay: '2026-08-16', endDayExclusive: '2026-08-17',
      status: { phase: 'ready', lastPersistedAt: 123 },
      coverage: {
        agentUsage: { samples: 0, total: 0 },
        ttft: { samples: 0, total: 0 },
      },
      totals: { usage: { requests: 1, input: 20, output: 5 } },
    })
  })

  it.each([
    '/dsh-activity-report/breakdown?range=today&dimension=model',
    '/dsh-activity-report/filters?range=today',
  ])('returns common response context from %s', async (path) => {
    const response = await harness().request(path)
    expect(response.status).toBe(200)
    expect(response.json()).toMatchObject({
      timezone: 'Asia/Shanghai',
      startDay: '2026-08-16',
      endDayExclusive: '2026-08-17',
      status: { phase: 'ready' },
      coverage: { agentUsage: { samples: 0, total: 0 } },
    })
  })

  it('exports the same filtered model rows as breakdown', async () => {
    const response = await harness().request('/dsh-activity-report/export.csv?range=today&dimension=model')
    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toContain('text/csv')
    expect(response.headers['Content-Disposition']).toContain('dsh-activity-model-2026-08-16.csv')
    expect(response.body.split('\r\n')[0]).toBe('\uFEFFmodel,requests,agent_requests,compaction_requests,steps,message_samples,input,cache_read,cache_write,output,reasoning,total_tokens,model_ms,ttft_ms,ttft_samples,decode_ms,decode_tokens')
    expect(response.body).toContain('summary-model,1,0,1,0,0,20,0,0,5,0,25')
    expect(response.body).not.toContain('tool_calls')
    expect(response.body).not.toContain('turns')
  })

  it('exports only tool-attributable columns for the tool dimension', async () => {
    const response = await harness().request('/dsh-activity-report/export.csv?range=today&dimension=tool')
    expect(response.body).toBe('\uFEFFtool,tool_calls,tool_results,tool_errors,tool_ms\r\n')
  })

  it('uses a workspace-specific CSV schema without duplicate workspace columns', async () => {
    const response = await harness().request('/dsh-activity-report/export.csv?range=today&dimension=workspace')
    const header = response.body.split('\r\n')[0]?.replace(/^\uFEFF/, '')

    expect(header?.split(',').filter((column) => column === 'workspace')).toHaveLength(1)
    expect(header).not.toContain(',title,workspace')
    expect(header).toContain('message_samples')
  })

  it('maps unexpected failures to a generic 500 response', async () => {
    const onError = vi.fn()
    const response = await harness(undefined, {
      records: () => { throw new Error('secret storage path') },
      onError,
    }).request('/dsh-activity-report/summary?range=today')

    expect(response.status).toBe(500)
    expect(response.json()).toEqual({ error: 'internal server error' })
    expect(response.body).not.toContain('secret storage path')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('validates generated JSON responses before sending them', async () => {
    const onError = vi.fn()
    const response = await harness(undefined, {
      status: () => ({ phase: 'invalid' } as never),
      onError,
    }).request('/dsh-activity-report/summary?range=today')

    expect(response.status).toBe(500)
    expect(response.json()).toEqual({ error: 'internal server error' })
    expect(onError).toHaveBeenCalledOnce()
  })

  it('neutralizes whitespace-prefixed spreadsheet formulas', async () => {
    const response = await harness(' \t=2+2').request('/dsh-activity-report/export.csv?range=today&dimension=model')
    expect(response.body).toContain("' \t=2+2")
  })

  it('retries dirty persistence through an explicit POST endpoint', async () => {
    const retryPersistence = vi.fn(async () => {})
    const api = harness(undefined, { retryPersistence })

    const response = await api.request('/dsh-activity-report/retry', 'POST')

    expect(response.status).toBe(200)
    expect(response.json()).toMatchObject({ status: { phase: 'ready', dirtyCount: 0 } })
    expect(retryPersistence).toHaveBeenCalledOnce()
    expect((await api.request('/dsh-activity-report/retry')).status).toBe(405)
  })

  it('registers and disposes all five exact routes', () => {
    const api = harness()
    expect(api.routes.size).toBe(5)
    api.dispose()
    expect(api.routes.size).toBe(0)
  })
})
