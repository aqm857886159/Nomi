#!/usr/bin/env node
// 本地按 **CI 同序** 跑完那七条走查（2026-09-18）。入口：`pnpm run test:e2e:ci-chain`。
//
// 为什么要它：CI 的 desktop-linux job 跑的这七步，**本地 `pnpm run gates` 一步都不含**。
// 于是「本地五门全绿」和「CI 会不会红」是两件互不相干的事——2026-09-17 PR #804
// 本地连过五轮 gates，CI 仍然连红三轮，每轮红的还是另一条不同的走查。
// 那不是手滑，是流程缺口：**能在本地一次跑完的，不该靠一轮 40 分钟的 CI 去逐条发现**（R17）。
//
// 两条设计选择，理由都在上面那句：
//   · **红了继续跑**，最后出一张汇总表。第一条红就停 = 本地也变成「一轮学一件事」，
//     那就白抄了一遍 CI 的坑。判据与渲染和 CI 汇总步共用 scripts/lib/chainSummary.mjs。
//   · **只持一次 gates 锁**。七个 `test:*` 脚本各自套着 with-gates-lock.py，若本条链不套锁，
//     它们就要**逐个重新排队**（本机常有 20+ worktree，那是几十分钟的墙钟）。
//     套在最外层后，子命令靠 NOMI_GATES_LOCK_TOKEN 继承同一把锁，全程只排一次队
//     （package.json 里的 `gates` 就是这个写法）。
//
// CI 侧多出的 `xvfb-run -a`：Linux runner 没有显示器。本机 macOS 不需要；本机是 Linux
// 且装了 xvfb-run 时自动套上，保证「同序」不因平台变成「同序但跑不起来」。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { renderChainSummary } from './lib/chainSummary.mjs'
import { gitPaths } from './lib/gitPaths.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG_DIR = path.join(repoRoot, 'outputs', 'ci-e2e-chain')

/**
 * 顺序照抄 .github/workflows/quality-gate.yml 的 desktop-linux job。
 * 改那边的顺序/命令时，check:quality-gate-workflow 的回归测试会逼这份表跟上——
 * 两份清单各写各的，就是下一个「本地跑的和 CI 跑的不是同一套」。
 */
export const CI_E2E_CHAIN = Object.freeze([
  Object.freeze({ id: 'feel', script: 'test:feel:browser', display: false }),
  Object.freeze({ id: 'smoke', script: 'test:e2e', display: true }),
  Object.freeze({ id: 'journeys', script: 'test:journeys', display: true }),
  Object.freeze({ id: 'mcp-journey', script: 'test:mcp-journey', display: true }),
  Object.freeze({ id: 'mcp-elicitation', script: 'test:mcp-elicitation', display: true }),
  Object.freeze({ id: 'real-user-journeys', script: 'test:real-user-journeys:ci', display: true }),
  Object.freeze({ id: 'canvas-critical', script: 'test:canvas:critical', display: true }),
])

/**
 * 走查会把**已跟踪的证据文件**重写掉（canvas-critical 跑完 outputs/canvas-card-stack-20260827/*.png
 * 与 docs/plan/…-triage-board-evidence/*.png 会变，实测 677KB → 184KB）。
 * 这堆脏东西很容易被顺手 `git add -A` 带进提交，而它和本次改动毫无关系。
 * 所以跑完点名说出来——由人决定是留证据还是 `git checkout --`。
 */
function dirtiedTrackedFiles() {
  // 走 gitPaths（-z + NUL 分隔）而不是 `--name-only`：git 默认 core.quotePath=true，
  // 中文路径会变成 `"docs/\344\270\255…"`，而证据目录里恰好有中文名（check:git-path-quoting 守这条）。
  try {
    return gitPaths(['diff', '--name-only'], { cwd: repoRoot })
  } catch {
    return []
  }
}

function hasXvfb() {
  if (process.platform !== 'linux') return false
  return spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0
}

function ensureBuilt() {
  const missing = ['dist', 'dist-electron'].filter((dir) => !fs.existsSync(path.join(repoRoot, dir)))
  if (missing.length === 0) return null
  // CI 在这七步之前先 `pnpm run build`。本地缺构建产物时，失败会以「Electron 起不来」
  // 这种完全不像根因的样子出现——所以在这里就说清楚，不让人去查一条假线索。
  return `缺少构建产物（${missing.join(', ')}）。CI 在这七步之前先跑 \`pnpm run build\`，本机也要：`
    + '\n  pnpm run build && pnpm run test:e2e:ci-chain'
}

function runStep(step, { xvfb }) {
  const logPath = path.join(LOG_DIR, `${step.id}.log`)
  const command = step.display && xvfb
    ? ['xvfb-run', ['-a', 'pnpm', 'run', step.script]]
    : ['pnpm', ['run', step.script]]
  const started = Date.now()
  process.stderr.write(`\n▶ ${step.id}  (pnpm run ${step.script})\n`)
  const run = spawnSync(command[0], command[1], { cwd: repoRoot, encoding: 'utf8', env: process.env })
  const durationMs = Date.now() - started
  const output = `$ ${command[0]} ${command[1].join(' ')}\n${run.stdout ?? ''}${run.stderr ?? ''}`
  fs.writeFileSync(logPath, output)
  const status = run.status ?? 1
  if (status !== 0) process.stderr.write(output.split('\n').slice(-40).join('\n') + '\n')
  return {
    name: step.id,
    outcome: status === 0 ? 'success' : 'failure',
    durationMs,
    log: path.relative(repoRoot, logPath),
  }
}

function main() {
  const blocked = ensureBuilt()
  if (blocked) {
    console.error(`✖ E2E 链没开跑：${blocked}`)
    return 1
  }
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const xvfb = hasXvfb()
  console.error(`E2E 走查链：${CI_E2E_CHAIN.length} 步，按 CI 同序，红了继续跑`
    + `${xvfb ? '（Linux：带显示器的步骤套 xvfb-run）' : ''}`)

  const before = new Set(dirtiedTrackedFiles())
  const rows = CI_E2E_CHAIN.map((step) => runStep(step, { xvfb }))
  const summary = renderChainSummary(rows)
  console.log('\nE2E 走查链汇总（与 CI desktop-linux job 同序同命令）：')
  console.log(summary.text)

  const dirtied = dirtiedTrackedFiles().filter((file) => !before.has(file))
  if (dirtied.length > 0) {
    console.error(`\n⚠️ 走查重写了 ${dirtied.length} 个已跟踪文件（证据截图/报告），它们与本次改动无关：`)
    for (const file of dirtied.slice(0, 10)) console.error(`  ${file}`)
    if (dirtied.length > 10) console.error(`  …还有 ${dirtied.length - 10} 个`)
    console.error('  要留就单独提交，不要就 `git checkout --` 掉——别让 `git add -A` 把它们捎进本次提交。')
  }

  if (!summary.ok) {
    console.error('\n✖ 有红。全部红的条目都在上表里——一次修完再推，别一条一轮。')
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
