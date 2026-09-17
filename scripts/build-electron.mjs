import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { invalidateBuild } from './package-build-stamp.mjs'
import { assertElectronBuildArtifacts } from './electron-build-artifacts.mjs'
import { writeIntakeConfig } from './write-intake-config.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
invalidateBuild(repoRoot)
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
// 反馈回路的出厂配置随构建产物一起生成（W-01）。写在 tsc 之后：tsc 不会清空 outDir，
// 但顺序写清楚更难被下一个人挪错。
writeIntakeConfig(repoRoot)
assertElectronBuildArtifacts(repoRoot)
