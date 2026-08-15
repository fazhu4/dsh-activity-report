/**
 * dsh-activity-report client plugin: the browser half. Registers a settings
 * section ("工作活动 / Activity") that fetches the host summary over the
 * loopback HTTP route and renders DeepSeek-portal-style stats.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.locale Context merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings.section SlotMap entry.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SummaryResponse } from '../contract.ts'
import { ActivitySection } from './Section.tsx'
import { NS, en, zh } from './locales.ts'
import { adoptStyles } from './styles.ts'

/** Required services: slots and locale. */
export const inject = ['slots', 'locale']

/** Range union shared with the section. */
export type Range = 'today' | '7d' | '30d' | 'all'

/**
 * Fetch the summary from the host route (loopback-only by design).
 * @param range - aggregation window.
 * @returns the parsed summary, or null on any failure.
 */
export async function fetchSummary(range: Range): Promise<SummaryResponse | null> {
  try {
    const res = await globalThis.fetch(`/dsh-activity-report/summary?range=${range}`)
    if (!res.ok) return null
    return await res.json() as SummaryResponse
  } catch {
    return null
  }
}

/**
 * Compose the activity surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  adoptStyles()
  console.info('[dsh-activity-report] bundle loaded')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-activity-report: dictionaries')

  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'activity-report',
    order: 90,
    label: () => t('nav'),
    locale: NS,
    inject: (): { fetchSummary: typeof fetchSummary } => ({ fetchSummary }),
  }, ActivitySection))
}
