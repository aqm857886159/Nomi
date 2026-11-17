#!/usr/bin/env node
// 「生成这一组」共用主人的开销量具（设计卡 docs/plan/2026-11-17-generation-scope-one-home.md ★7）。
// 真函数：electron/shared/agentCapabilities/generationShotScope.ts 的 planGenerationScope / narrowGenerationScope / hasSelectableScopeRow。
// 不起窗口、不连网、零花费：只量主人自己算一次范围的 CPU。
//
// 最坏规模：一张 300 个节点的画布（60 张参考卡 + 240 个镜头，每个镜头连 2 张参考卡、每 4 个镜头串一条首帧链），
// 混着各种事实（已出图、已定稿、失败、生成中、可找回、缺必填）；框选其中 40 个点「生成整组」。
// 量什么：
//   · scopePlanMs（主指标）：group 意图规划 40 个（分行、默认勾、分波），一轮 200 次的平均单次耗时；
//   · scopeNarrowMs：卡上取消勾选一半再问主人（缩范围重算分波），一轮 200 次的平均单次耗时；
//   · scopeToolbarMs：浮条判断「这 300 个里还有没有能勾的」（hasSelectableScopeRow），一轮 200 次的平均单次耗时。
// 接口同 tests/perf/node-json-bench.mjs 的约定：--runs N --out 文件 → { runs, noisy, metrics: { 名字: number[] } }。
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { require as tsxRequire } from 'tsx/cjs/api'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')

const { planGenerationScope, narrowGenerationScope, hasSelectableScopeRow } = tsxRequire('../../electron/shared/agentCapabilities/generationShotScope.ts', import.meta.url)

const ANCHORS = 60
const SHOTS = 240
const SELECTED = 40
const LOOPS = 200

const item = (id, patch = {}) => ({ id, generatable: true, hasResult: false, frozen: false, recoverable: false, busy: false, failed: false, settled: false, visualAnchor: false, ...patch })
const shapeOf = (index) => [
  {}, {}, { hasResult: true }, { failed: true }, { hasResult: true, settled: true }, { busy: true }, { recoverable: true }, { missingRequired: true },
][index % 8]

const items = []
const edges = []
for (let a = 0; a < ANCHORS; a += 1) items.push(item(`anchor-${a}`, { visualAnchor: true, hasResult: a % 3 !== 0, frozen: a % 2 === 0 }))
for (let s = 0; s < SHOTS; s += 1) {
  items.push(item(`shot-${s}`, shapeOf(s)))
  edges.push({ source: `anchor-${s % ANCHORS}`, target: `shot-${s}` }, { source: `anchor-${(s * 7) % ANCHORS}`, target: `shot-${s}` })
  if (s % 4 !== 0) edges.push({ source: `shot-${s - 1}`, target: `shot-${s}` })
}
const facts = { items, edges }
// 框选：40 个镜头加它们直接连着的 10 张参考卡里的一部分（参考卡在选区里才会跟着进组）
const selection = [...Array.from({ length: 10 }, (_unused, a) => `anchor-${a}`), ...Array.from({ length: SELECTED - 10 }, (_unused, s) => `shot-${s}`)]
const allIds = items.map((value) => value.id)

const time = (fn) => {
  const start = performance.now()
  for (let i = 0; i < LOOPS; i += 1) fn()
  return (performance.now() - start) / LOOPS
}

// 预热一次，让 tsx 编译和 JIT 不落进第一轮
const base = planGenerationScope({ intent: 'group', selection, facts })
const half = base.members.filter((_id, index) => index % 2 === 0)
let sink = base
const metrics = { scopePlanMs: [], scopeNarrowMs: [], scopeToolbarMs: [] }
for (let run = 0; run < runs; run += 1) {
  metrics.scopePlanMs.push(time(() => { sink = planGenerationScope({ intent: 'group', selection, facts }) }))
  metrics.scopeNarrowMs.push(time(() => { sink = narrowGenerationScope(base, half, facts) }))
  metrics.scopeToolbarMs.push(time(() => { hasSelectableScopeRow('group', items) }))
}
if (!sink || !allIds.length) throw new Error('量具自检失败：没有算出规划')

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify({ runs, noisy: false, metrics }, null, 2))
