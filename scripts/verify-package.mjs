import { execFileSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const required = [
  'lib/index.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'lib/types/client/index.d.ts',
  'lib/manifest.json',
]
await Promise.all(required.map((path) => access(join(root, path))))

execFileSync(process.execPath, ['--check', join(root, 'lib/index.js')], { stdio: 'inherit' })
execFileSync(process.execPath, ['--check', join(root, 'lib/client.js')], { stdio: 'inherit' })

const npm = process.platform === 'win32'
  ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --json --ignore-scripts']]
  : ['npm', ['pack', '--dry-run', '--json', '--ignore-scripts']]
const output = execFileSync(npm[0], npm[1], { cwd: root, encoding: 'utf8' })
const packed = JSON.parse(output)[0]
const names = new Set(packed.files.map((file) => file.path))
for (const path of ['LICENSE', 'README.md', 'cordis.patch.yml', ...required]) {
  if (!names.has(path)) throw new Error(`packed artifact is missing ${path}`)
}
for (const path of names) {
  if (path.startsWith('src/') || path.startsWith('tests/') || path.startsWith('node_modules/')) {
    throw new Error(`packed artifact contains development file ${path}`)
  }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (pkg.exports['.'].types !== './lib/types/index.d.ts') throw new Error('host declaration export is incorrect')
if (pkg.exports['./client'].types !== './lib/types/client/index.d.ts') throw new Error('client declaration export is incorrect')
if (pkg.dependencies?.zod === undefined) throw new Error('runtime schema dependency zod is missing')

console.log(`verified ${packed.files.length} packed files (${packed.size} bytes)`)
