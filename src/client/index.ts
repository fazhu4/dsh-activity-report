import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createActivityClient } from './api.ts'
import { ActivitySection } from './Section.tsx'
import type { ActivitySectionInjected } from './Section.tsx'
import { en, NS, zh } from './locales.ts'
import { adoptStyles } from './styles.ts'

type ActivityClientContext = Omit<ClientContext, 'sessions'> & {
  sessions: { open(id: SessionId): void }
}

/** Browser services required for settings registration and session navigation. */
export const inject = ['slots', 'locale', 'sessions']

/** Register the local activity settings section. */
export function apply(ctx: ActivityClientContext): void {
  ctx.effect(() => adoptStyles(), 'dsh-activity-report: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-activity-report: dictionaries')
  const t = ctx.locale.bind(NS)
  const api = createActivityClient()
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'activity-report',
    order: 90,
    label: () => t('nav'),
    locale: NS,
    inject: (): ActivitySectionInjected => ({
      api,
      openSession: (id: SessionId) => { ctx.sessions.open(id) },
    }),
  }, ActivitySection))
}
