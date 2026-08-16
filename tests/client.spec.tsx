// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ActivityFilterResponse, ActivitySummaryResponse, BreakdownPage, BreakdownResponse } from '../src/contract.ts'
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
    coverage: {
      agentUsage: { samples: 1, total: 1 }, modelTiming: { samples: 0, total: 1 },
      ttft: { samples: 0, total: 0 }, toolTiming: { samples: 0, total: 0 },
    },
    status: { phase: 'ready', processedSessions: 1, totalSessions: 1, failedSessions: 0, dirtyCount: 0 },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const t = ((key: keyof typeof zh) => zh[key]) as ActivityT

function responseContext() {
  return {
    timezone: 'Asia/Shanghai', startDay: '2026-08-16', endDayExclusive: '2026-08-17',
    status: summary(1).status,
    coverage: summary(1).coverage,
  }
}

function pageResponse(page: BreakdownPage): BreakdownResponse {
  return { ...page, ...responseContext() }
}

function filterResponse(values: Pick<ActivityFilterResponse, 'workspaces' | 'providers' | 'models'>): ActivityFilterResponse {
  return { ...values, ...responseContext() }
}

const emptyPage: BreakdownResponse = pageResponse({ dimension: 'model', rows: [] })

afterEach(cleanup)

describe('activity report client', () => {
  it('keeps a filter failure visible when summary and breakdown requests succeed', async () => {
    const nextSummary = deferred<ActivitySummaryResponse>()
    const nextPage = deferred<BreakdownResponse>()
    const api: ActivityClient = {
      summary: async () => nextSummary.promise,
      breakdown: async () => nextPage.promise,
      filters: async () => { throw new Error('filter request failed') },
      retry: async () => summary(1).status,
      exportUrl: () => '#',
    }

    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('filter request failed')
    await act(async () => {
      nextSummary.resolve(summary(10))
      nextPage.resolve(emptyPage)
      await Promise.resolve()
    })
    expect(screen.getByText('总处理 Token')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('filter request failed')
  })

  it('renders missing timing samples as unavailable instead of zero', async () => {
    const api: ActivityClient = {
      summary: async () => summary(10),
      breakdown: async () => emptyPage,
      filters: async () => filterResponse({ workspaces: [], providers: [], models: [] }),
      retry: async () => summary(1).status,
      exportUrl: () => '#',
    }

    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)

    await screen.findByText('性能与结果')
    const modelTime = screen.getAllByText('模型耗时').find((node) => node.tagName === 'SPAN')
    const toolTime = screen.getAllByText('工具耗时').find((node) => node.tagName === 'SPAN')
    expect(modelTime?.parentElement).toHaveTextContent('未报告')
    expect(toolTime?.parentElement).toHaveTextContent('未报告')
  })

  it('shows degraded durability counts and retries persistence before refresh', async () => {
    const degraded = summary(10)
    degraded.status = {
      phase: 'degraded', processedSessions: 3, totalSessions: 5, failedSessions: 2, dirtyCount: 1,
    }
    const retry = vi.fn(async () => degraded.status)
    const api = {
      summary: async () => degraded,
      breakdown: async () => emptyPage,
      filters: async () => filterResponse({ workspaces: [], providers: [], models: [] }),
      retry,
      exportUrl: () => '#',
    } satisfies ActivityClient

    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)

    expect(await screen.findByText('失败会话: 2')).toBeInTheDocument()
    expect(screen.getByText('待固化记录: 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(retry).toHaveBeenCalledOnce())
  })

  it('keeps the newest range result when an older request resolves later', async () => {
    const seven = deferred<ActivitySummaryResponse>()
    const thirty = deferred<ActivitySummaryResponse>()
    const api: ActivityClient = {
      summary: (query) => query.range === '7d' ? seven.promise : query.range === '30d' ? thirty.promise : Promise.resolve(summary(1)),
      breakdown: async () => emptyPage,
      filters: async () => filterResponse({ workspaces: [], providers: [], models: [] }),
      retry: async () => summary(1).status,
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
    const page = pageResponse({
      dimension: 'session',
      rows: [{
        key: 'session-1', sessionId: 'session-1' as SessionId, title: '修复登录错误', cwd: 'G:/project', metrics: rowMetrics,
      }],
    })
    const api: ActivityClient = {
      summary: async () => summary(10),
      breakdown: async (query) => query.dimension === 'session' ? page : emptyPage,
      filters: async () => filterResponse({ workspaces: [], providers: [], models: [] }),
      retry: async () => summary(1).status,
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
      filters: async () => filterResponse({ workspaces: [], providers: [], models: [] }),
      retry: async () => summary(1).status,
      exportUrl: () => '#',
    }
    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)
    await screen.findByText('总处理 Token')
    const model = screen.getByRole('tab', { name: '模型' })
    expect(model).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: '工具' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '工具' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('displays the inclusive natural-day range', async () => {
    const api: ActivityClient = {
      summary: async () => summary(10),
      breakdown: async () => emptyPage,
      filters: async () => filterResponse({ workspaces: [], providers: [], models: [] }),
      retry: async () => summary(1).status,
      exportUrl: () => '#',
    }
    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)

    expect(await screen.findByText('自然日: 2026-08-16')).toBeInTheDocument()
    expect(screen.queryByText(/2026-08-17/)).not.toBeInTheDocument()
  })

  it('discards pagination that resolves after the analysis query changes', async () => {
    const metrics = emptyMetrics()
    metrics.usage.input = 10
    const more = deferred<BreakdownResponse>()
    const api: ActivityClient = {
      summary: async () => summary(10),
      breakdown: async (query) => {
        if (query.cursor !== undefined) return more.promise
        if (query.dimension === 'session') {
          return pageResponse({
            dimension: 'session',
            rows: [{ key: 'session-1', sessionId: 'session-1' as SessionId, title: 'Current session', metrics }],
          })
        }
        return pageResponse({ dimension: 'model', rows: [{ key: 'initial-model', metrics }], nextCursor: 'next' })
      },
      filters: async () => filterResponse({ workspaces: [], providers: [], models: [] }),
      retry: async () => summary(1).status,
      exportUrl: () => '#',
    }
    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)

    await screen.findByText('initial-model')
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    fireEvent.click(screen.getByRole('tab', { name: '会话' }))
    await screen.findByRole('button', { name: 'Current session' })
    await act(async () => {
      more.resolve(pageResponse({ dimension: 'model', rows: [{ key: 'stale-model', metrics }] }))
      await Promise.resolve()
    })

    expect(screen.queryByText('stale-model')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Current session' })).toBeInTheDocument()
  })

  it('uses roving focus and linked tab panels', async () => {
    const api: ActivityClient = {
      summary: async () => summary(10),
      breakdown: async () => emptyPage,
      filters: async () => filterResponse({ workspaces: [], providers: [], models: [] }),
      retry: async () => summary(1).status,
      exportUrl: () => '#',
    }
    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)
    await screen.findByText('总处理 Token')

    const today = screen.getByRole('tab', { name: '今天' })
    const seven = screen.getByRole('tab', { name: '近 7 天' })
    today.focus()
    fireEvent.keyDown(today, { key: 'ArrowRight' })
    expect(seven).toHaveFocus()
    expect(seven).toHaveAttribute('aria-selected', 'true')
    expect(seven).toHaveAttribute('tabindex', '0')
    expect(document.getElementById(seven.getAttribute('aria-controls')!)).toHaveAttribute('role', 'tabpanel')

    const model = screen.getByRole('tab', { name: '模型' })
    const session = screen.getByRole('tab', { name: '会话' })
    model.focus()
    fireEvent.keyDown(model, { key: 'ArrowRight' })
    expect(session).toHaveFocus()
    expect(session).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById(session.getAttribute('aria-controls')!)).toHaveAttribute('role', 'tabpanel')
  })

  it('explains and disables unsupported tool attribution filters', async () => {
    const api: ActivityClient = {
      summary: async () => summary(10),
      breakdown: async () => emptyPage,
      filters: async () => filterResponse({ workspaces: [], providers: ['deepseek'], models: [] }),
      retry: async () => summary(1).status,
      exportUrl: () => '#',
    }
    render(<ActivitySection api={api} openSession={vi.fn()} close={vi.fn()} t={t} />)
    const provider = await screen.findByRole('combobox', { name: '所有服务商' })
    fireEvent.change(provider, { target: { value: 'deepseek' } })

    expect(screen.getByRole('tab', { name: '工具' })).toBeDisabled()
    expect(screen.getByText(/工具事件不能精确归因/)).toBeInTheDocument()
  })
})
