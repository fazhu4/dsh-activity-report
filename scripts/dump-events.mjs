/**
 * Dump sample events from a session log to inspect their real JSON shape.
 * Run with tsx: tsx scripts/dump-events.mjs <sessionId>
 */
import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { createZstdFrameDecoder, scanZstdFrames } from '../../../deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts'

const sessionId = process.argv[2]
const sessionsRoot = dshHomePath('sessions')
let found
for (const ws of await readdir(sessionsRoot, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue
  for (const d of await readdir(join(sessionsRoot, ws.name), { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || d.name !== sessionId) continue
    for (const f of ['session.jsonl.zstd', 'session.jsonl']) {
      try { await readFile(join(sessionsRoot, ws.name, d.name, f), { length: 0 }); found = join(sessionsRoot, ws.name, d.name, f); break } catch { }
    }
    if (found) break
  }
  if (found) break
}
if (!found) { console.error('not found'); process.exit(1) }
console.log('file:', found)
const buf = await readFile(found)
let text
if (found.endsWith('.zstd')) {
  const scan = scanZstdFrames(buf)
  const dec = createZstdFrameDecoder()
  const chunks = []
  for (const c of dec.decode(buf, scan.frames)) chunks.push(c)
  text = Buffer.concat(chunks).toString('utf8')
} else text = buf.toString('utf8')
const lines = text.split('\n').filter(l => l.trim())
console.log('total events:', lines.length)
console.log('\n=== event 0 ===')
console.log(lines[0].slice(0, 500))
console.log('\n=== event 1 ===')
console.log(lines[1].slice(0, 500))
for (const type of ['assistant/message', 'turn/start', 'turn/end', 'tool/call', 'tool/result']) {
  const line = lines.find(l => { try { return JSON.parse(l).type === type } catch { return false } })
  console.log(`\n=== first ${type} ===`)
  console.log(line ? line.slice(0, 900) : 'NONE')
}

// Type histogram + seq continuity
const types = {}
let minSeq = Infinity, maxSeq = 0
const seqs = []
for (const l of lines) {
  try {
    const e = JSON.parse(l)
    types[e.type] = (types[e.type] ?? 0) + 1
    if (typeof e.seq === 'number') {
      if (e.seq < minSeq) minSeq = e.seq
      if (e.seq > maxSeq) maxSeq = e.seq
      seqs.push(e.seq)
    }
  } catch { }
}
seqs.sort((a, b) => a - b)
console.log('\n=== type histogram ===')
console.log(JSON.stringify(types, null, 1))
console.log('seq range:', minSeq === Infinity ? 'none' : minSeq, '->', maxSeq)
console.log('first 5 seqs:', seqs.slice(0, 5))
let gapAt = -1
for (let i = 1; i < seqs.length; i++) {
  if (seqs[i] - seqs[i - 1] > 1) { gapAt = i; break }
}
console.log('first gap after index', gapAt, gapAt >= 0 ? '(prev=' + seqs[gapAt - 1] + ', next=' + seqs[gapAt] + ')' : 'none')
