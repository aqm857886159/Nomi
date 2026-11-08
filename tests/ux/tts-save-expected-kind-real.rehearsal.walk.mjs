#!/usr/bin/env node
// tts-save-expected-kind-real.paid.mjs 的零额度演练：同一条主进程路径（runTask → 同步配音 → 落盘关口），先测分类矩阵，再用隔离 Electron 走一遍真实确认和解码，不出公网。
// 本机假服务按内置目录里每一格同步回字节的音频任务回真 WAV / MP3 字节，结果必须落成项目里的音频文件；没项目时三个入口都不发请求；
// 再用 v0.24.0 真实落盘的老用户目录在项目里重新生成一次。vitest 经当前 node 启动（不靠裸 pnpm），Windows 上同样能跑。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { runDubbingSample } from './_ttsSaveSample.mjs'
import { repoRoot } from '../../scripts/lib/repoPaths.mjs'

const vitest = path.join(repoRoot, 'node_modules/vitest/vitest.mjs')
const result = spawnSync(process.execPath, [vitest, 'run',
  'electron/tasks/syncBytesResultLandsInProject.test.ts',
  'electron/catalog/oldUserDubbingLandsAfterUpgrade.test.ts',
], { cwd: repoRoot, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const walk = await createRuntimeWalk('tts-save-rehearsal', { generationProvider: 'apimart' })
let failure
try {
  await runDubbingSample(walk)
  assert.equal(walk.fixture.speeches.length, 1)
  assert.equal(walk.fixture.speeches[0].body.model, 'gpt-4o-mini-tts')
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
