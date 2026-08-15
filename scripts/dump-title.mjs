/** Dump any session/title event + first user message raw, for one session. */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { createZstdFrameDecoder, scanZstdFrames } from '../../../deepseek-harness/packages/session/session-persistence-jsonl/src/zstd.ts'

const sid = process.argv[2]
const root = dshHomePath('sessions')
outer:
for (const ws of await readdir(root, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue
  for (const d of await readdir(join(root, ws.name), { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || d.name !== sid) continue
    const f = join(root, ws.name, d.name, 'session.jsonl.zstd')
    const buf = await readFile(f)
    const scan = scanZstdFrames(buf)
    const dec = createZstdFrameDecoder()
    const chunks = []
    for (const c of dec.decode(buf, scan.frames)) chunks.push(c)
    const text = Buffer.concat(chunks).toString('utf8')
    const types = {}
    let titleEv, userEv, msgEv
    for (const line of text.split('\n')) {
      try {
        const e = JSON.parse(line)
        types[e.type] = (types[e.type] ?? 0) + 1
        if (e.type === 'session/title' && !titleEv) titleEv = line.slice(0, 500)
        if (e.type === 'user/message' && !userEv) userEv = line.slice(0, 500)
        if (e.type === 'assistant/message' && !msgEv) msgEv = line.slice(0, 300)
      } catch { }
    }
    console.log('types:', JSON.stringify(types))
    console.log('\nfirst session/title:', titleEv ?? 'NONE')
    console.log('\nfirst user/message:', userEv ?? 'NONE')
    console.log('\nfirst assistant/message:', msgEv ?? 'NONE')
    break outer
  }
}
