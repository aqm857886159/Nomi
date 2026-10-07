#!/usr/bin/env node
// `pnpm run typecheck` 的执行体：把四份类型检查**并发**跑完再汇总。
//
// 2026-10-01 用户按门岗账本（docs/audit/2026-10-01-gate-ledger.md）拍板「`check:test-types` 与 `typecheck`
// 合成一次 tsc」。账本数据：这两项是 Contracts 里最贵的两项（55 秒 + 50 秒，各自串行，约占单次 394 秒的 27%），
// 而且两个都在编译同一批 src 文件。
//
// 为什么合不成**一个 TS program**：app（Vite 打包面）、electron（CommonJS 主进程，`noEmit:false` 会产出
// dist-electron）、pi（ESM / NodeNext）、测试（ESM + 顶层 await）四份 tsconfig 的 module / moduleResolution / types
// 互不兼容——强合只会炸出一批纯配置形状错（tsconfig.test.json 抬头里记过 112 个）。
// 所以「合成一次」做在**调度**这一层：只有一个入口、一次汇总，四份检查**并发**跑，墙钟取最慢的那份，
// 而不是四份加起来。判据一份没动：同样的 tsconfig、同样的棘轮基线、同样的失败即红。
//
// check:test-types 仍可单独跑（`pnpm run check:test-types`），它自己也把两份测试工程并发；
// 这里只是把它和三份生产类型检查一起拉起来，所以它不再单列进 gates:contracts。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** 四份检查。顺序只影响输出顺序；少一份就是静默少查一块，scripts/typecheck.node-test.mjs 钉死名单。 */
export const TYPECHECK_JOBS = Object.freeze([
  Object.freeze({ name: 'tsc app', kind: 'tsc', args: ['-p', 'tsconfig.app.json'] }),
  Object.freeze({ name: 'tsc electron', kind: 'tsc', args: ['-p', 'electron/tsconfig.json'] }),
  Object.freeze({ name: 'tsc electron-pi', kind: 'tsc', args: ['-p', 'electron/tsconfig.pi.json', '--noEmit'] }),
  Object.freeze({ name: 'check:test-types', kind: 'script', script: 'scripts/check-test-types.mjs' }),
])

function commandOf(job) {
  if (job.kind === 'tsc') return [process.execPath, [require.resolve('typescript/bin/tsc'), ...job.args]]
  return [process.execPath, [path.join(repoRoot, job.script)]]
}

function spawnJob(job) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const [command, args] = commandOf(job)
    const child = spawn(command, args, { cwd: repoRoot })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => resolve({ name: job.name, code: 1, output: `${output}\n${error.message}`, ms: Date.now() - startedAt }))
    child.on('close', (code) => resolve({ name: job.name, code: code ?? 1, output, ms: Date.now() - startedAt }))
  })
}

/**
 * 并发跑完所有 job（不早退）。`run(job)` 可注入（测试）。返回 { results, failed, wallMs, sumMs }。
 * 任何一份失败、或根本没跑起来 = failed：失败方向只有一个——红。
 */
export async function runTypecheckJobs(jobs, { run = spawnJob, now = Date.now } = {}) {
  const startedAt = now()
  const results = await Promise.all(jobs.map((job) => run(job)))
  return {
    results,
    failed: results.filter((result) => result.code !== 0),
    wallMs: now() - startedAt,
    sumMs: results.reduce((total, result) => total + (result.ms ?? 0), 0),
  }
}

async function main() {
  const { results, failed, wallMs, sumMs } = await runTypecheckJobs(TYPECHECK_JOBS)
  for (const result of results) {
    const mark = result.code === 0 ? '✅' : '✖'
    console.log(`${mark} ${result.name}（${(result.ms / 1000).toFixed(1)}s）`)
    if (result.code !== 0 || result.name === 'check:test-types') {
      const text = result.output.trim()
      if (text) console.log(text.split('\n').map((line) => `    ${line}`).join('\n'))
    }
  }
  console.log(`scanned=${results.length}`)
  console.log(`\ntypecheck：${results.length} 份并发，墙钟 ${(wallMs / 1000).toFixed(1)}s（串行相加 ${(sumMs / 1000).toFixed(1)}s）`)
  if (failed.length > 0) {
    console.error(`✖ ${failed.length} 份类型检查未通过：${failed.map((result) => result.name).join('、')}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
