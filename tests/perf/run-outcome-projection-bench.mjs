#!/usr/bin/env node
// 镜头结果归谁：结局按运行记录号收账 + 节点显示从记录算，在最坏规模下要多久（设计卡 docs/plan/2026-11-07-shot-result-ownership.md ★7）。
// 真函数：唯一合并规则 src/workbench/generationCanvas/store/nodeRunOutcome.ts#nodeRunOutcomePatch（活的画布、盘上副本、暂存重放、
// 撤销叠回四处共用这一个）与重开项目时的收敛 store/canvasSnapshotNormalizer.ts#convergeStuckMidFlightNodes。
// 纯计算，零花费、零外网、零文件读写。
//
// 量什么（一个项目 200 个节点、每节点 20 条运行记录）：
//   · projectionMs（主指标）：批量跑着时一轮里 200 个节点各来一个进度、一个结果（按号找记录 + 投影），合计毫秒；
//   · convergeMs：打开项目时 200 个节点都停在「生成中」（最旧那条在跑、比它新的有成功的），收敛一遍的毫秒。
// 接口同 tests/perf/node-json-bench.mjs 的约定：--runs N --out 文件 → { runs, noisy, metrics: { 名字: number[] } }。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { require as tsxRequire } from 'tsx/cjs/api'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')

const NODES = 200
const RUNS_PER_NODE = 20
const WARMUP = 3

const { nodeRunOutcomePatch } = tsxRequire('../../src/workbench/generationCanvas/store/nodeRunOutcome.ts', import.meta.url)
const { convergeStuckMidFlightNodes } = tsxRequire('../../src/workbench/generationCanvas/store/canvasSnapshotNormalizer.ts', import.meta.url)

/** 一个节点：20 条记录，最新那条在跑（这一轮要落结局的那次），其余成功 / 失败交替，版本历史 19 版。 */
function buildNode(index, liveAt) {
  const runs = Array.from({ length: RUNS_PER_NODE }, (_, at) => {
    const startedAt = 1_000_000 - at * 1000
    if (at === liveAt) return { id: `run-${index}-${at}`, status: 'running', startedAt, updatedAt: startedAt, taskId: `task-${index}-${at}` }
    const success = at % 2 === 0
    return { id: `run-${index}-${at}`, status: success ? 'success' : 'error', startedAt, updatedAt: startedAt + 500, completedAt: startedAt + 500,
      ...(success ? { resultId: `result-${index}-${at}` } : { error: '500 Internal Server Error' }) }
  })
  const history = runs.filter((run) => run.resultId).map((run, at) => ({ id: run.resultId, type: 'image', url: `nomi-local://asset/p/${run.resultId}.png`, createdAt: run.startedAt, versionNo: 19 - at }))
  return {
    id: `node-${index}`, kind: 'image', title: `镜 ${index}`, prompt: 'shot', position: { x: index * 10, y: 0 }, categoryId: 'shots',
    size: { width: 340, height: 280 }, status: 'running', runs, history, result: history[0], resultVersionMax: 19,
    progress: runs[liveAt].status === 'running' ? { runId: runs[liveAt].id, phase: 'generating', updatedAt: 1 } : undefined,
  }
}

function oneProjectionRound() {
  let nodes = Array.from({ length: NODES }, (_, index) => buildNode(index, 0))
  const started = performance.now()
  nodes = nodes.map((node) => {
    const runId = node.runs[0].id
    const afterProgress = { ...node, ...nodeRunOutcomePatch(node, { kind: 'progress', progress: { runId, phase: 'generating', percent: 50, taskId: node.runs[0].taskId } }) }
    return { ...afterProgress, ...nodeRunOutcomePatch(afterProgress, { kind: 'result', runId, result: { id: `fresh-${node.id}`, type: 'image', url: `nomi-local://asset/p/fresh-${node.id}.png`, createdAt: 2_000_000 } }) }
  })
  const elapsed = performance.now() - started
  if (nodes.some((node) => node.status !== 'success' || node.runs[0].status !== 'success' || node.result.id !== `fresh-${node.id}`)) throw new Error('projection round did not land every result on its own record')
  return elapsed
}

function oneConvergeRound() {
  // 最旧那条在跑，比它新的都已结束（有成功的）：收敛只改在跑那条，显示按记录算。
  const nodes = Array.from({ length: NODES }, (_, index) => buildNode(index, RUNS_PER_NODE - 1))
  const started = performance.now()
  const converged = convergeStuckMidFlightNodes(nodes)
  const elapsed = performance.now() - started
  if (converged.some((node) => node.status !== 'success' || node.runs[RUNS_PER_NODE - 1].status !== 'recoverable' || node.runs[0].status !== 'success')) throw new Error('convergence touched a finished record or left a spinner')
  return elapsed
}

const load = () => os.loadavg()[1]
let noisy = load() >= 10
const metrics = { projectionMs: [], convergeMs: [] }
let failure
try {
  for (let i = 0; i < WARMUP; i += 1) { oneProjectionRound(); oneConvergeRound() }
  for (let i = 0; i < runs; i += 1) {
    metrics.projectionMs.push(Number(oneProjectionRound().toFixed(2)))
    metrics.convergeMs.push(Number(oneConvergeRound().toFixed(2)))
  }
  noisy = noisy || load() >= 10
} catch (error) {
  failure = error
}

const report = {
  scope: `${NODES} nodes x ${RUNS_PER_NODE} run records; one progress + one result per node per round (projectionMs), then restart convergence of all nodes (convergeMs); pure computation through the real nodeRunOutcomePatch / convergeStuckMidFlightNodes`,
  date: new Date().toISOString(),
  machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`,
  node: process.version,
  noisy,
  runs,
  metrics,
  ...(failure ? { failure: failure.message } : {}),
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ projectionMs: metrics.projectionMs, convergeMs: metrics.convergeMs, noisy }))
if (failure) { console.error(failure.message); process.exit(1) }
