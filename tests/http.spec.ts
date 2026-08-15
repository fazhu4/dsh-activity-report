import { describe, expect, it } from 'vitest'
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
  }
}

function harness(model?: string) {
  const routes = new Map<string, WebRoute>()
  const dispose = registerActivityRoutes({
    register: (route) => {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  }, source(model), { defaultPageSize: 25 })
  async function request(path: string) {
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
    await route.handler({ url: path, method: 'GET' } as IncomingMessage, response)
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
      totals: { usage: { requests: 1, input: 20, output: 5 } },
    })
  })

  it('exports the same filtered model rows as breakdown', async () => {
    const response = await harness().request('/dsh-activity-report/export.csv?range=today&dimension=model')
    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toContain('text/csv')
    expect(response.headers['Content-Disposition']).toContain('dsh-activity-model-2026-08-16.csv')
    expect(response.body.split('\r\n')[0]).toBe('\uFEFFmodel,requests,input,cache_read,cache_write,output,reasoning,total_tokens,model_ms,ttft_ms,ttft_samples,decode_ms,decode_tokens')
    expect(response.body).toContain('summary-model,1,20,0,0,5,0,25')
    expect(response.body).not.toContain('tool_calls')
    expect(response.body).not.toContain('turns')
  })

  it('exports only tool-attributable columns for the tool dimension', async () => {
    const response = await harness().request('/dsh-activity-report/export.csv?range=today&dimension=tool')
    expect(response.body).toBe('\uFEFFtool,tool_calls,tool_results,tool_errors,tool_ms\r\n')
  })

  it('neutralizes whitespace-prefixed spreadsheet formulas', async () => {
    const response = await harness(' \t=2+2').request('/dsh-activity-report/export.csv?range=today&dimension=model')
    expect(response.body).toContain("' \t=2+2")
  })

  it('registers and disposes all four exact routes', () => {
    const api = harness()
    expect(api.routes.size).toBe(4)
    api.dispose()
    expect(api.routes.size).toBe(0)
  })
})
