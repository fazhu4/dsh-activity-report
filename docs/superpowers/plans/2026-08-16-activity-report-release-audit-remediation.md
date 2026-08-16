# Activity Report Release Audit Remediation Plan

> **For Codex:** Execute this plan task-by-task with test-driven development. Keep every change inside the isolated `codex/activity-report-v1` worktree.

**Goal:** Make `dsh-activity-report` an accurate, recoverable, locally verifiable usage dashboard that exposes data provenance and missing-data coverage without displaying money.

**Architecture:** Keep the event log as source of truth and the plugin storage as a rebuildable projection. Add an explicit configured IANA timezone to the projection identity, make fold operations idempotent by both event sequence and tool call ID, expose a common response context from every read endpoint, and let the UI distinguish unavailable data from measured zero. Persistence failures remain visible and retryable without restarting DSH.

**Tech Stack:** TypeScript, Cordis, Zod, React, Vitest, esbuild, PowerShell verification scripts.

---

### Task 1: Pin timezone identity and rebuild incompatible projections

**Files:**
- Modify: `src/contract.ts`
- Modify: `src/domain.ts`
- Modify: `src/fold.ts`
- Modify: `src/host.ts`
- Modify: `src/index.ts`
- Test: `tests/host.spec.ts`
- Test: `tests/index.spec.ts`

1. Add failing tests proving configured timezones determine day buckets and persisted records with a missing or different timezone are rebuilt from session events.
2. Add and validate a configurable IANA timezone, persist it with each derived session record, and pass it into every fold operation.
3. Keep old cache rows readable only long enough to identify and replace them; never mix rows generated under different timezones.
4. Run the focused host and plugin tests.

### Task 2: Make tool folding idempotent by call ID

**Files:**
- Modify: `src/contract.ts`
- Modify: `src/domain.ts`
- Modify: `src/fold.ts`
- Test: `tests/fold-v2.spec.ts`

1. Add a failing test where two distinct event sequence numbers repeat the same tool call ID.
2. Persist the set of counted tool call IDs and ignore duplicate calls without replacing the original start time.
3. Verify duplicate results remain harmless and restart hydration preserves deduplication.
4. Run the fold and domain tests.

### Task 3: Recover cleanly from projection write failures

**Files:**
- Modify: `src/host.ts`
- Modify: `src/http.ts`
- Modify: `src/index.ts`
- Modify: `src/client/api.ts`
- Modify: `src/client/Section.tsx`
- Test: `tests/host.spec.ts`
- Test: `tests/http.spec.ts`
- Test: `tests/client.spec.tsx`

1. Add failing tests for an initial write failure, visible dirty/failed status, and a successful explicit retry returning the runtime to ready.
2. Track current write failures independently from backfill failures and do not announce ready before the initial flush completes.
3. Add an explicit retry endpoint and wire the refresh action to retry persistence before refetching.
4. Show failed-session and dirty-record counts in the status line.
5. Run focused host, HTTP, and client tests.

### Task 4: Complete and harden the HTTP and CSV contracts

**Files:**
- Modify: `src/contract.ts`
- Modify: `src/query.ts`
- Modify: `src/http.ts`
- Modify: `src/client/api.ts`
- Test: `tests/query.spec.ts`
- Test: `tests/http.spec.ts`

1. Add failing tests showing invalid filter queries are rejected, breakdown/filter responses lack common context, cursors can be reused across different queries, workspace CSV duplicates columns, and internal errors leak as 400 responses.
2. Return timezone, inclusive start day, exclusive end day, data status, and coverage counts from summary, breakdown, and filter endpoints.
3. Scope available filter values to the requested date range and active filters.
4. Bind cursors to the normalized query scope and reject mismatches.
5. Give every CSV dimension an intentional schema; include request-origin and coverage fields where relevant.
6. Map request/query errors to 400 and unexpected failures to a generic 500 response while logging the cause.
7. Run query and HTTP tests.

### Task 5: Separate request state and represent unavailable measurements honestly

**Files:**
- Modify: `src/client/Section.tsx`
- Modify: `src/client/format.ts`
- Modify: `src/client/styles.ts`
- Modify: `src/client/index.ts`
- Test: `tests/client.spec.tsx`
- Create: `tests/format.spec.ts`

1. Add failing tests for simultaneous request failures, stale data with a visible error, missing timing samples, subsecond duration formatting, and style disposal.
2. Give filters, summary, breakdown, and pagination independent loading/error state.
3. Render missing TTFT, model duration, and tool duration as unavailable with sample coverage; render subsecond measurements in milliseconds.
4. Make injected styles effect-owned and removable.
5. Run client and formatting tests.

### Task 6: Finish the approved analysis surfaces

**Files:**
- Modify: `src/contract.ts`
- Modify: `src/query.ts`
- Modify: `src/client/api.ts`
- Modify: `src/client/Chart.tsx`
- Modify: `src/client/Section.tsx`
- Modify: `src/client/locales.ts`
- Modify: `src/client/styles.ts`
- Test: `tests/query.spec.ts`
- Test: `tests/client.spec.tsx`

1. Add failing tests for token/request trend switching, TTFT coverage, provider/model request origins and agent-usage coverage, tool failure daily trend, and workspace/session outcome visibility.
2. Preserve request-origin aggregates in breakdown rows and expose coverage as sample/total counts.
3. Add the trend mode control, coverage labels, origin columns, reliability trend, and outcome summary without any cost fields.
4. Run query and client tests.

### Task 7: Document, package, and verify the real plugin

**Files:**
- Modify: `README.md`
- Modify: `cordis.patch.yml`
- Modify: `docs/superpowers/specs/2026-08-16-activity-report-design.md`
- Modify: `package.json` only if verification reveals incorrect publishing metadata

1. Document timezone identity, rebuild behavior, retry semantics, response context, coverage semantics, CSV columns, and the final visible analysis surfaces.
2. Run `pnpm run check`, `pnpm run verify:package`, `pnpm audit --prod --registry=https://registry.npmjs.org`, and `git diff --check`.
3. Install the packed tarball into a temporary profile, boot the real DSH web profile, reconcile summary totals against series and breakdowns, restart to confirm canonical persistence equality, and inspect the UI at desktop and narrow widths.
4. Request an independent final code review and address every actionable finding.
5. Create/publish the GitHub repository only when authenticated repository creation is available; otherwise report that single external blocker with the prepared branch and package artifact.
