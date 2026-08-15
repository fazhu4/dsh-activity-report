# DSH Activity Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inaccurate prototype with a publishable, read-only DSH usage and activity dashboard whose cards, trends, breakdowns, persistence, and exports reconcile over the same natural-day buckets.

**Architecture:** A typed per-session event fold stores one atomic record per session in DSH `storageDomain`. Query code aggregates the persisted daily facts with validated filters and pagination. The browser renders an OpenAI-usage-inspired filter/trend/detail hierarchy while preserving DSH-specific token, activity, performance, and coverage semantics and never displaying money.

**Tech Stack:** TypeScript 6, Cordis, DSH Session/Session Query/Storage Domain/Web Server APIs, Zod 4, React 18, SVG, Vitest, Testing Library, esbuild, pnpm.

---

## File map

- Create `src/domain.ts`: Zod schemas and the versioned `activity-report` storage domain.
- Replace `src/contract.ts`: client-safe query and response types.
- Create `src/metrics.ts`: zero/add/subtract/ratio helpers and reconciliation invariants.
- Replace `src/adapt.ts`: typed DSH event adaptation, including usage chunks and compaction usage.
- Replace `src/fold.ts`: replay-safe per-session/day fold with step-sample replacement and performance timing.
- Create `src/query.ts`: natural-day ranges, filters, sorting, cursor pagination, and CSV projection.
- Create `src/http.ts`: route parameter validation and response helpers.
- Replace `src/index.ts`: storage-domain lifecycle, buffered startup backfill, dirty-write drain, and registered routes.
- Create `src/client/api.ts`: validated fetch functions with cancellation.
- Replace `src/client/Chart.tsx`: accessible stacked daily usage chart and tooltip.
- Replace `src/client/Section.tsx`: filter bar, status, cards, trend, breakdown tabs, and pagination.
- Replace `src/client/locales.ts` and `src/client/styles.ts`: complete bilingual copy and responsive visual system.
- Modify `src/client/index.ts`: inject sessions navigation and register the section.
- Add focused tests under `tests/` for every unit and assembled lifecycle.
- Modify `package.json`, `build.mjs`, `tsconfig.json`, `cordis.patch.yml`, `README.md`; create `LICENSE`.

### Task 1: Lock the metric and durable-record vocabulary

**Files:**
- Create: `src/metrics.ts`
- Replace: `src/contract.ts`
- Create: `src/domain.ts`
- Test: `tests/metrics.spec.ts`

- [ ] **Step 1: Write failing metric tests**

```ts
import { describe, expect, it } from 'vitest'
import { addMetrics, emptyMetrics, totalInputTokens, totalTokens } from '../src/metrics.ts'

describe('metric arithmetic', () => {
  it('keeps reasoning as an output subset', () => {
    const value = emptyMetrics()
    value.usage = { requests: 1, input: 10, cacheRead: 4, cacheWrite: 2, output: 8, reasoning: 3 }
    expect(totalInputTokens(value.usage)).toBe(16)
    expect(totalTokens(value.usage)).toBe(24)
  })

  it('adds every count and timing field symmetrically', () => {
    const total = emptyMetrics()
    addMetrics(total, { ...emptyMetrics(), usage: { requests: 1, input: 2, cacheRead: 3, cacheWrite: 4, output: 5, reasoning: 1 } })
    expect(total.usage).toEqual({ requests: 1, input: 2, cacheRead: 3, cacheWrite: 4, output: 5, reasoning: 1 })
  })
})
```

- [ ] **Step 2: Run `pnpm vitest run tests/metrics.spec.ts` and verify it fails because `src/metrics.ts` does not exist.**

- [ ] **Step 3: Implement the shared vocabulary and storage schema**

```ts
export interface UsageMetrics {
  requests: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning: number
}

export interface ActivityMetrics {
  turns: number
  steps: number
  toolCalls: number
  toolResults: number
  toolErrors: number
  outcomes: Record<string, number>
}

export interface PerformanceMetrics {
  modelMs: number
  toolMs: number
  ttftMs: number
  ttftSamples: number
  decodeMs: number
  decodeTokens: number
  messageSamples: number
}

export interface Metrics {
  usage: UsageMetrics
  activity: ActivityMetrics
  performance: PerformanceMetrics
}
```

Define `DayFacts` with totals plus `byProvider`, `byModel`, `byTool`, and request-origin maps. Define `SessionRecord` with metadata, watermark, fold state, and `days`. Use `defineDomain({ name: 'activity-report', version: 0, tables: { sessions: domainTable<SessionId, SessionRecord>(sessionRecordSchema) } })` so durable reads reject malformed records.

- [ ] **Step 4: Run `pnpm vitest run tests/metrics.spec.ts` and `pnpm run typecheck`; expect PASS.**

- [ ] **Step 5: Commit with `git commit -am "feat: define activity metric domain"` after adding the three new files.**

### Task 2: Build an exact typed event fold

**Files:**
- Replace: `src/adapt.ts`
- Replace: `src/fold.ts`
- Replace: `tests/adapt.spec.ts`
- Replace: `tests/fold.spec.ts`

- [ ] **Step 1: Write failing tests for replacement, route attribution, natural days, and timing**

```ts
it('replaces a usage chunk with final message usage for the same step', () => {
  const state = createSessionState('s1' as SessionId)
  foldEvents(state, [
    event(0, 100, 'request/context', { provider: 'deepseek', model: 'deepseek-chat' }),
    usageChunk(1, 200, 1, 1, { inputTokens: 10, outputTokens: 2 }),
    assistantMessage(2, 300, 1, 1, { inputTokens: 12, outputTokens: 4 }),
  ])
  expect(state.record.days['1970-01-01']!.totals.usage).toMatchObject({ requests: 1, input: 12, output: 4 })
})

it('keeps usage from a failed step whose final message never lands', () => {
  const state = createSessionState('s1' as SessionId)
  foldEvents(state, [usageChunk(0, 100, 1, 1, { inputTokens: 7, outputTokens: 1 }), event(1, 200, 'step/end', { turn: 1, step: 1 })])
  expect(sumDays(state.record).usage).toMatchObject({ requests: 1, input: 7, output: 1 })
})

it('counts compaction usage once under the compaction origin', () => {
  const state = createSessionState('s1' as SessionId)
  foldEvents(state, [compactionSummary(0, 100, { inputTokens: 20, outputTokens: 5 })])
  expect(state.record.days['1970-01-01']!.byOrigin.compaction.usage.requests).toBe(1)
})
```

- [ ] **Step 2: Run `pnpm vitest run tests/adapt.spec.ts tests/fold.spec.ts`; expect failures against the prototype fold.**

- [ ] **Step 3: Implement adaptation and folding**

Use the real `SessionEvent` discriminant. Track `request/context` as the current route, `step/start` as model timing start, first token chunk as TTFT, per-step usage samples as replaceable contributions, and tool calls by `callId`. Each replacement first subtracts the previous sample from its previous day/provider/model/origin buckets and then adds the final sample. Advance watermark for every valid event, including events that do not contribute metrics.

```ts
function replaceUsage(state: FoldState, key: StepKey, next: UsageSample): void {
  const previous = state.record.runtime.usageSamples[key]
  if (previous !== undefined) applyUsage(state.record, previous, -1)
  applyUsage(state.record, next, 1)
  state.record.runtime.usageSamples[key] = next
}
```

Count turns from distinct `turn` values seen at `step/end`; count outcomes separately at `turn/end`. Assign completed spans to their end-event local day. Keep missing provider/model/cwd in named unknown groups.

- [ ] **Step 4: Run the two focused suites and typecheck; expect PASS.**

- [ ] **Step 5: Commit with `git commit -am "feat: fold typed session usage and activity"`.**

### Task 3: Implement one query pipeline for cards, trends, and breakdowns

**Files:**
- Create: `src/query.ts`
- Test: `tests/query.spec.ts`

- [ ] **Step 1: Write failing reconciliation and pagination tests**

```ts
it('uses the same selected day buckets for summary, trend, and model rows', () => {
  const result = querySummary(records, { range: 'today', timezone: 'Asia/Shanghai', now: Date.parse('2026-08-16T12:00:00+08:00') })
  expect(result.totals.usage).toEqual(sumMetrics(result.series.map(item => item.metrics)).usage)
  expect(result.totals.usage).toEqual(sumMetrics(result.byModel.map(item => item.metrics)).usage)
})

it('paginates a stable token-descending session list', () => {
  const first = queryBreakdown(records, { ...filters, dimension: 'session', sort: 'tokens', direction: 'desc', limit: 2 })
  const second = queryBreakdown(records, { ...filters, dimension: 'session', sort: 'tokens', direction: 'desc', limit: 2, cursor: first.nextCursor })
  expect(new Set([...first.rows, ...second.rows].map(row => row.key)).size).toBe(4)
})
```

- [ ] **Step 2: Run `pnpm vitest run tests/query.spec.ts`; expect module-not-found failure.**

- [ ] **Step 3: Implement range resolution, filtering, aggregation, stable sorting, cursors, and CSV rows.**

`today`, `7d`, and `30d` resolve to local calendar-day keys with an exclusive next-day end. Filter before aggregation. Build summary cards, daily series, outcomes, performance, and coverage from the selected facts. Breakdown columns are dimension-specific; provider/model never receive turn or tool totals. Encode a cursor as base64url JSON `{ sortValue, key }` and reject schema mismatches.

- [ ] **Step 4: Run query tests and typecheck; expect PASS.**

- [ ] **Step 5: Commit with `git commit -am "feat: add reconciled activity queries"`.**

### Task 4: Replace file persistence with storage-domain lifecycle

**Files:**
- Replace: `src/index.ts`
- Create: `tests/host.spec.ts`
- Modify: `cordis.patch.yml`

- [ ] **Step 1: Write failing assembled lifecycle tests**

```ts
it('buffers live events until persisted backfill reaches the same session', async () => {
  const harness = await createHostHarness({ persistedWatermark: 2, backfillEvents: [event(3), event(4)] })
  harness.emitLive(event(5))
  await harness.ready()
  expect(harness.sessionRecord().watermark).toBe(5)
  expect(harness.sessionRecord().days[DAY]!.totals.usage.requests).toBe(3)
})

it('drains accepted writes and unregisters routes on dispose', async () => {
  const harness = await createHostHarness()
  harness.emitLive(usageEvent(0))
  await harness.dispose()
  expect(harness.domain.closed).toBe(true)
  expect(harness.webServer.routes).toHaveLength(0)
})
```

- [ ] **Step 2: Run `pnpm vitest run tests/host.spec.ts`; expect failure because the prototype uses `fs`.**

- [ ] **Step 3: Implement the host lifecycle**

Inject `webServer`, `sessionQuery`, `sessions`, and `storageDomain`. Register the live listener synchronously into per-session buffers, open the domain, hydrate records, backfill with validated concurrency, merge buffered events by sequence, persist dirty complete records, and expose `backfilling|ready|degraded` status. Store every disposer returned by `ctx.on` and `webServer.register` in `ctx.effect`. Use one `AbortController` and await the dirty-write chain before `domain.close()`.

Update the patch to use:

```yaml
inject: [webServer, sessionQuery, sessions, storageDomain]
config:
  persistDebounceMs: 1000
  backfillConcurrency: 4
  defaultPageSize: 25
```

- [ ] **Step 4: Run host tests and typecheck; expect PASS.**

- [ ] **Step 5: Commit with `git commit -am "fix: make activity persistence replay safe"`.**

### Task 5: Add validated HTTP queries and export

**Files:**
- Create: `src/http.ts`
- Test: `tests/http.spec.ts`

- [ ] **Step 1: Write failing request-validation tests**

```ts
it.each(['range=year', 'dimension=secret', 'limit=0', 'limit=9999', 'cursor=bad'])(
  'rejects invalid query %s', async (query) => {
    const response = await request(`/dsh-activity-report/breakdown?${query}`)
    expect(response.status).toBe(400)
  },
)

it('exports the same filtered rows as breakdown', async () => {
  const csv = await request('/dsh-activity-report/export.csv?range=today&dimension=model')
  expect(csv.headers.get('content-type')).toContain('text/csv')
  expect(await csv.text()).toContain('model,requests,input,cache_read,cache_write,output,total_tokens')
})
```

- [ ] **Step 2: Run `pnpm vitest run tests/http.spec.ts`; expect route/validation failures.**

- [ ] **Step 3: Implement strict parsers and the four routes.**

Return 400 JSON diagnostics for invalid range, dimension, sort, cursor, or limit. Escape CSV cells per RFC 4180, emit a UTF-8 BOM for spreadsheet compatibility, and set `Content-Disposition` with a deterministic date/dimension filename. Return actual timezone/day bounds, last successful persistence time, dirty count, and backfill progress in summary responses.

- [ ] **Step 4: Run HTTP, query, and host suites; expect PASS.**

- [ ] **Step 5: Commit with `git commit -am "feat: expose activity queries and export"`.**

### Task 6: Build the OpenAI-inspired usage interface

**Files:**
- Create: `src/client/api.ts`
- Replace: `src/client/Chart.tsx`
- Replace: `src/client/Section.tsx`
- Replace: `src/client/locales.ts`
- Replace: `src/client/styles.ts`
- Modify: `src/client/index.ts`
- Create: `tests/client.spec.tsx`

- [ ] **Step 1: Write failing client behavior tests**

```tsx
// @vitest-environment jsdom
it('cancels an obsolete range request and keeps the newest result', async () => {
  render(<ActivitySection api={deferredApi} openSession={openSession} t={t} />)
  fireEvent.click(screen.getByRole('tab', { name: '近 7 天' }))
  fireEvent.click(screen.getByRole('tab', { name: '近 30 天' }))
  resolve30d(summary30d)
  resolve7d(summary7d)
  expect(await screen.findByText('30 天数据')).toBeInTheDocument()
  expect(screen.queryByText('7 天数据')).toBeNull()
})

it('opens a session through the injected DSH navigation service', async () => {
  render(<ActivitySection api={apiWithSessionRow} openSession={openSession} t={t} />)
  fireEvent.click(await screen.findByRole('button', { name: '修复登录错误' }))
  expect(openSession).toHaveBeenCalledWith('session-1')
})
```

- [ ] **Step 2: Run `pnpm vitest run tests/client.spec.tsx`; expect failure against the prototype UI.**

- [ ] **Step 3: Implement the dashboard**

Use the screenshots only for hierarchy: compact natural-day navigation, model/workspace/provider filters, a large daily stacked usage plot with hover/focus tooltip, and a request/session detail table. Replace all cost labels with DSH metrics. Show status/coverage above the cards. Use tabs with `role=tab`, `aria-selected`, keyboard navigation, and dimension-specific columns. Fetch summary and breakdown separately with an `AbortController`; retain prior data under a loading overlay. Inject `openSession: (id: SessionId) => ctx.sessions.open(id)`.

- [ ] **Step 4: Run client tests, all unit tests, and typecheck; expect PASS.**

- [ ] **Step 5: Commit with `git commit -am "feat: redesign the activity usage dashboard"`.**

### Task 7: Make the package publishable

**Files:**
- Modify: `package.json`
- Modify: `build.mjs`
- Modify: `tsconfig.json`
- Replace: `README.md`
- Create: `LICENSE`
- Create: `scripts/verify-package.mjs`

- [ ] **Step 1: Write a failing package smoke script**

```js
import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const required = ['lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts']
await Promise.all(required.map(path => access(new URL(`../${path}`, import.meta.url))))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packed = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json'], {
  cwd: new URL('..', import.meta.url), encoding: 'utf8',
}))[0]
const names = new Set(packed.files.map(file => file.path))
for (const path of ['LICENSE', 'README.md', ...required]) {
  if (!names.has(path)) throw new Error(`packed artifact is missing ${path}`)
}
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (pkg.exports['.'].types !== './lib/types/index.d.ts') throw new Error('host declaration export is incorrect')
```

- [ ] **Step 2: Run `pnpm vitest run tests/package.spec.ts`; expect failure for missing LICENSE/runtime dependency/declarations.**

- [ ] **Step 3: Fix package metadata and build gates.**

Add runtime peers for storage-domain and all imported DSH packages, Zod as a dependency, client-test dependencies as dev-only, `engines.node`, keywords, `prepack`, and `verify:package`. Repository/bugs/homepage fields remain absent until Task 8 obtains the authenticated GitHub owner and creates the real repository. Keep `strict: true`, remove `noImplicitAny: false`, target supported Node, and let declaration emission fail the build. Document installation, metric formulas, coverage limits, local-only privacy, filters, export, development, and pre-release status. Add the MIT license text.

- [ ] **Step 4: Run `pnpm install`, `pnpm run check`, and `pnpm run verify:package`; expect PASS and no `node_modules`/source test files in the tarball.**

- [ ] **Step 5: Commit with `git commit -am "chore: prepare activity report for publishing"` after adding new files.**

### Task 8: Verify the real Web product and publish the repository

**Files:**
- Update only files revealed by verification defects.
- Create a product GIF on the dedicated assets branch as required by the GUI workflow.

- [ ] **Step 1: Run `pnpm run build`, then `dsh plugin --profile web add link:G:\项目\git\demo\dsh-activity-report` and restart the real `dsh web` process; expect the “工作活动” settings entry to load from the new bundle.**
- [ ] **Step 2: Verify persistence by creating activity, waiting for the configured debounce, restarting Web, and confirming cards/trend/detail are unchanged.**
- [ ] **Step 3: Reconcile `today` totals against the sum of returned daily buckets and model rows using a deterministic PowerShell script; every equality must pass.**
- [ ] **Step 4: Exercise today/7d/30d/all, every dimension, multi-filtering, pagination, CSV download, session navigation, degraded state, keyboard tabs, and narrow viewport in the real browser.**
- [ ] **Step 5: Record an optimized GIF from the real server showing filters, stacked trend, model/session detail, and navigation; publish it to the PR assets branch.**
- [ ] **Step 6: Run final `pnpm run check`, `pnpm run verify:package`, `git diff --check`, and `git status --short`; require clean passing output.**
- [ ] **Step 7: Resolve the authenticated owner with `$owner = gh api user --jq .login`, create the repository with `gh repo create "$owner/dsh-activity-report" --public --source . --remote origin`, add the resulting repository/bugs/homepage URLs to `package.json`, commit them, push the feature branch, and open a draft PR with audit findings, metric definitions, verification commands, and the GIF. Do not publish a stable release.**

## Plan self-review

- The plan covers every approved spec area: no cost, typed token semantics, compaction usage, natural-day ranges, valid dimensions, storage-domain persistence, buffered backfill, validated/paginated APIs, CSV, OpenAI-inspired hierarchy, coverage visibility, accessibility, packaging, real-browser verification, and GitHub publication.
- No compatibility migration is planned for the never-written prototype JSON store; the versioned domain rejects incompatible records as required.
- `Metrics`, `UsageMetrics`, `SessionRecord`, `DayFacts`, `querySummary`, `queryBreakdown`, and the four HTTP routes use consistent names throughout the tasks.
