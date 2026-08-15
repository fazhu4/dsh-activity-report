/**
 * List session titles + cwd for all sessions in the store, from the raw logs.
 * Run with tsx: tsx scripts/list-titles.mjs
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { createZstdFrameDecoder, scanZstdFrames } from '../../../deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts'

const root = dshHomePath('sessions')
for (const ws of await readdir(root, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue
  for (const d of await readdir(join(root, ws.name), { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue
    const f = join(root, ws.name, d.name, 'session.jsonl.zstd')
    let buf
    try { buf = await readFile(f) } catch { continue }
    let text
    try {
      const scan = scanZstdFrames(buf)
      const dec = createZstdFrameDecoder()
      const chunks = []
      for (const c of dec.decode(buf, scan.frames)) chunks.push(c)
      text = Buffer.concat(chunks).toString('utf8')
    } catch { continue }
    let title
    let firstUser = ''
    let firstTime = 0
    for (const line of text.split('\n')) {
      try {
        const e = JSON.parse(line)
        if (e.type === 'session/title' && !title) title = JSON.stringify(e.data).slice(0, 120)
        if (e.type === 'user/message' && !firstUser && e.data?.content) {
          firstUser = JSON.stringify(e.data.content).slice(0, 100)
        }
        if (!firstTime && e.time) firstTime = e.time
      } catch { }
    }
    console.log(`${d.name.slice(0, 30)} | cwd=${ws.name} | title=${title ?? '-'} | firstPrompt=${firstUser.slice(0, 80) ?? '-'}`)
  }
}
