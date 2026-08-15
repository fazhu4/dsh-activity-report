/**
 * Verification script: decode one session log with DSH's own zstd decoder and
 * count the events that drive the activity stats, to cross-check the plugin's
 * backfill against the raw log. Run: node scripts/verify-session.mjs <sessionId>
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sessionId = process.argv[2]
if (!sessionId) {
  console.error('usage: node scripts/verify-session.mjs <sessionId>')
  process.exit(1)
}

// Use the source module via tsx (the script must be run with tsx so the .ts
// import and its internal dependencies resolve).
const { createZstdFrameDecoder, scanZstdFrames } = await import(
  '../../../deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts'
)

// Locate the session file under DSH_HOME/sessions
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const sessionsRoot = dshHomePath('sessions')
let found
for (const ws of await readdir(sessionsRoot, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue
  const sessionDir = join(sessionsRoot, ws.name, sessionId)
  const file = join(sessionDir, 'session.jsonl.zstd')
  const plain = join(sessionDir, 'session.jsonl')
  if (found) break
  try {
    if (await fileExists(file)) { found = file; break }
    if (await fileExists(plain)) { found = plain; break }
  } catch { /* keep looking */ }
}
if (!found) {
  console.error(`session ${sessionId} not found under ${sessionsRoot}`)
  process.exit(1)
}
console.log('file:', found)

const buf = await readFile(found)
let text
if (found.endsWith('.zstd')) {
  const scan = scanZstdFrames(buf)
  const decoder = createZstdFrameDecoder()
  const chunks = []
  for (const chunk of decoder.decode(buf, scan.frames)) chunks.push(chunk)
  text = Buffer.concat(chunks).toString('utf8')
} else {
  text = buf.toString('utf8')
}

const lines = text.split('\n').filter(l => l.trim())
let assistant = 0
let withUsage = 0
let turnEnd = 0
let toolCalls = 0
let toolErrors = 0
let provider = new Map()
let model = new Map()
let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0
let firstTime = Infinity, lastTime = 0

for (const line of lines) {
  try {
    const ev = JSON.parse(line)
    if (ev.type === 'assistant/message') {
      assistant++
      const msg = ev.message ?? ev.data?.message ?? {}
      const src = msg.source ?? ev.data?.source
      if (ev.usage || msg.usage) {
        withUsage++
        const u = ev.usage ?? msg.usage
        inputTokens += u.inputTokens ?? 0
        outputTokens += u.outputTokens ?? 0
        cacheRead += u.cacheReadTokens ?? 0
        cacheWrite += u.cacheWriteTokens ?? 0
        const p = src?.provider ?? '?'
        const m = src?.model ?? '?'
        provider.set(p, (provider.get(p) ?? 0) + 1)
        model.set(m, (model.get(m) ?? 0) + 1)
      }
    } else if (ev.type === 'turn/end') {
      turnEnd++
    } else if (ev.type === 'tool/call') {
      toolCalls++
    } else if (ev.type === 'tool/result' && ev.error) {
      toolErrors++
    }
    const t = ev.time ?? 0
    if (t) { if (t < firstTime) firstTime = t; if (t > lastTime) lastTime = t }
  } catch { /* skip malformed line */ }
}

console.log('=== raw log counts ===')
console.log('events:', lines.length)
console.log('assistant/message:', assistant, '(with usage:', withUsage + ')')
console.log('turn/end:', turnEnd)
console.log('tool/call:', toolCalls, 'tool errors:', toolErrors)
console.log('tokens:', { input: inputTokens, output: outputTokens, cacheRead, cacheWrite })
console.log('byProvider:', Object.fromEntries(provider))
console.log('byModel:', Object.fromEntries(model))
console.log('firstTime:', new Date(firstTime).toISOString(), 'lastTime:', new Date(lastTime).toISOString())
console.log('seq range: first line seq =', (() => { try { return JSON.parse(lines[0]).seq } catch { return '?' } })(),
  'last line seq =', (() => { try { return JSON.parse(lines[lines.length - 1]).seq } catch { return '?' } })())

async function fileExists(p) {
  try { await readFile(p, { length: 0 }); return true } catch { return false }
}
