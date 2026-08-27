import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertElectronBuildArtifacts } from './electron-build-artifacts.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

// Keep the existing host CommonJS; only the private SDK island uses NodeNext.
// pnpm build:electron and the one-shot dev compiler both execute this file.
for (const project of ['electron/tsconfig.json', 'electron/tsconfig.pi.json']) {
  const result = spawnSync(process.execPath, [tscBin, '-p', project], { cwd: repoRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`Electron compiler interrupted by ${result.signal}: ${project}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}
assertElectronBuildArtifacts(repoRoot)
