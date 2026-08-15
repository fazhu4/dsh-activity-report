// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ActivitySummaryResponse, BreakdownPage } from '../src/contract.ts'
import { emptyMetrics } from '../src/metrics.ts'
import type { ActivityClient } from '../src/client/api.ts'
import { ActivitySection } from '../src/client/Section.tsx'
import type { ActivityT } from '../src/client/Section.tsx'
import { zh } from '../src/client/locales.ts'

function summary(input: number): ActivitySummaryResponse {
  const totals = emptyMetrics()
  totals.usage = { requests: 1, input, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }
  totals.activity.steps = 1
  return {
    range: 'today', timezone: 'Asia/Shanghai', startDay: '2026-08-16', endDayExclusive: '2026-08-17',
    totals, series: [{ day: '2026-08-16', metrics: totals }], byProvider: [], byModel: [],
    byOrigin: [{ key: 'agent', metrics: totals }], activeSessions: 1, activeWorkspaces: 1,
    status: { phase: 'ready', processedSessions: 1, totalSessions: 1, failedSessions: 0, dirtyCount: 0 },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const t = ((key: keyof typeof zh) => zh[key]) as ActivityT
const emptyPage: BreakdownPage = { dimension: 'model', rows: [] }

afterEach(cleanup)

describe('activity report client', () => {
  it('keeps the newest range result when an older request resolves later', async () => {
    const seven = deferred<ActivitySummaryResponse>()
    const thirty = deferred<ActivitySummaryResponse>()
    const api: ActivityClient = {
      summary: (query) => query.range === '7d' ? seven.promise : query.range === '30d' ? thirty.promise : Promise.resolve(summary(1)),
      breakdown: async () => emptyPage,
      filters: async () => ({ workspaces: [], providers: [], models: [] }),
      exportUrl: () => '#',
    }
    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)

    fireEvent.click(screen.getByRole('tab', { name: '近 7 天' }))
    fireEvent.click(screen.getByRole('tab', { name: '近 30 天' }))
    thirty.resolve(summary(30_000))
    expect((await screen.findAllByText('30K')).length).toBeGreaterThan(0)
    seven.resolve(summary(7_000))
    await Promise.resolve()
    expect(screen.queryByText('7K')).not.toBeInTheDocument()
  })

  it('opens a session through the injected DSH navigation service', async () => {
    const rowMetrics = emptyMetrics()
    rowMetrics.usage.input = 10
    const page: BreakdownPage = {
      dimension: 'session',
      rows: [{
        key: 'session-1', sessionId: 'session-1' as SessionId, title: '修复登录错误', cwd: 'G:/project', metrics: rowMetrics,
      }],
    }
    const api: ActivityClient = {
      summary: async () => summary(10),
      breakdown: async (query) => query.dimension === 'session' ? page : emptyPage,
      filters: async () => ({ workspaces: [], providers: [], models: [] }),
      exportUrl: () => '#',
    }
    const openSession = vi.fn()
    const close = vi.fn()
    render(<ActivitySection api={api} openSession={openSession} close={close} t={t} />)

    await screen.findByText('总处理 Token')
    fireEvent.click(screen.getByRole('tab', { name: '会话' }))
    fireEvent.click(await screen.findByRole('button', { name: '修复登录错误' }))
    expect(close).toHaveBeenCalledOnce()
    expect(openSession).toHaveBeenCalledWith('session-1')
  })

  it('marks tabs with the selected state', async () => {
    const api: ActivityClient = {
      summary: async () => summary(10),
      breakdown: async () => emptyPage,
      filters: async () => ({ workspaces: [], providers: [], models: [] }),
      exportUrl: () => '#',
    }
    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)
    await screen.findByText('总处理 Token')
    const model = screen.getByRole('tab', { name: '模型' })
    expect(model).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: '工具' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '工具' })).toHaveAttribute('aria-selected', 'true'))
  })
})
