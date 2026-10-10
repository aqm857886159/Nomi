import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { invalidateBuild } from './package-build-stamp.mjs'
import { assertElectronBuildArtifacts, plainCjsSources } from './electron-build-artifacts.mjs'
import { writeIntakeConfig } from './write-intake-config.mjs'
import { writeFeatureFlags } from './write-feature-flags.mjs'

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
// tsc 不处理手写的 electron/**/*.cjs（例如走查放行名单的唯一正本 shared/walkAllowlist.cjs）：按同一相对路径原样拷进产物。
for (const file of plainCjsSources(path.join(repoRoot, 'electron'))) {
  const target = path.join(repoRoot, 'dist-electron', path.relative(path.join(repoRoot, 'electron'), file))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(file, target)
}
// 反馈回路的出厂配置随构建产物一起生成（W-01）。写在 tsc 之后：tsc 不会清空 outDir，
// 但顺序写清楚更难被下一个人挪错。
writeIntakeConfig(repoRoot)
writeFeatureFlags(repoRoot)
assertElectronBuildArtifacts(repoRoot)
