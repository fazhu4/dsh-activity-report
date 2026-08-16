import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const output = join(root, 'lib')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(output, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-compaction',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-query',
    '@deepseek-ai/dsh-storage-domain',
  ],
  logLevel: 'info',
})

await build({
  entryPoints: [join(root, 'src/client/index.ts')],
  outfile: join(output, 'client.js'),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  sourcemap: true,
  jsx: 'automatic',
  jsxDev: false,
  external: ['react', 'react-dom'],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-activity-report", factory: (require) => {\n'
      + 'var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})

const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], {
  cwd: root,
  stdio: 'inherit',
})

writeFileSync(
  join(output, 'manifest.json'),
  `${JSON.stringify({ name: 'dsh-activity-report', host: 'lib/index.js', client: 'lib/client.js' }, null, 2)}\n`,
)
