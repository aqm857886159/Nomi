#!/usr/bin/env node
// Agent 工具入参边界的开销量具（设计卡 docs/plan/2026-11-07-agent-tool-failure-boundary.md ★7）。
// 真函数：electron/agentLane/laneToolInputBoundary.mts#createLaneToolInputBoundary 包住真的 draft_shots 工具
// （electron/agentLane/laneExtendedTools.ts#createExtendedLaneTools → laneTools.mts#createLaneTools，和 openLane 同一条装配），熔断用真的 laneRepeatedFailure。
// 不起模型、不连网、零花费：只量这条边界自己在一个回合里多花的那段 CPU。
//
// 最坏规模：一个回合 50 次 draft_shots 调用、每次 12 个镜头，其中 20 次被拒——
//   12 次是形状错（第 i 个镜头把 duration 写在镜头上，pi 的 TypeBox 尺子拒），
//   8 次是工具自己的准备步骤拒（第 i 个镜头的 parameters 里写了 aspectRatio，比例只有一个家）。
// 被拒和通过交替，模拟宿主 after_tool 里「这个工具成功一次就清墙」，所以 20 次都拿到完整拒收正文、没有一次被拦。
//
// 量什么：
//   · turnBoundaryMs（主指标）：50 次包过的 prepareArguments 总耗时。它包含边界替 pi 先跑的那一次校验
//     （pi 随后自己再跑一次，那次不算在这里），所以是「边界多花的时间」的上界；每轮新建一个边界，编译一次 schema 也算在里面；
//   · projectionRecomputeMs：面板投影对这 20 条拒收各重推一次信封（failureOf，宿主按 toolCallId 只算一次）的总耗时；
//   · rejectedPerTurn：这一轮真被拒的次数（应为 20，量具本身的自检）。
// 接口同 tests/perf/node-json-bench.mjs 的约定：--runs N --out 文件 → { runs, noisy, metrics: { 名字: number[] } }。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { register as registerCjs } from 'tsx/cjs/api'
import { register } from 'tsx/esm/api'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')

const CALLS = 50
const SHOTS = 12
const SHAPE_REJECTIONS = 12
const PREPARE_REJECTIONS = 8
const REJECTED = SHAPE_REJECTIONS + PREPARE_REJECTIONS

// lane 的模块是 .mts（ESM）和无扩展名导入的 .ts（按 CommonJS 加载）混着用：两套加载器各注册一次。
registerCjs()
register()
const { createLaneToolInputBoundary } = await import('../../electron/agentLane/laneToolInputBoundary.mts')
const { createLaneRepeatedFailureTracker } = await import('../../electron/agentLane/laneRepeatedFailure.mts')
const { createExtendedLaneTools } = await import('../../electron/agentLane/laneExtendedTools.ts')
const { createLaneTools } = await import('../../electron/agentLane/laneTools.mts')

const shot = (index, extra = {}, parameters = {}) => ({
  title: `镜头 ${index + 1}`,
  prompt: `第 ${index + 1} 个镜头：一只纸船在雨后的水洼里慢慢漂，清晨的光从屋檐斜照下来，水面有细小的涟漪`,
  taskKind: 'text_to_video',
  candidate: { providerId: 'apimart', modelId: 'doubao-seedance-2.0' },
  parameters: { duration: 5, resolution: '720p', generate_audio: false, ...parameters },
  ...extra,
})
const shots = (bad) => ({ shots: Array.from({ length: SHOTS }, (_unused, index) => bad(index) ?? shot(index)) })

/** 一个回合的 50 次调用：被拒和通过交替，前 40 次里 20 次被拒，后 10 次全过。 */
function turnCalls() {
  const calls = []
  for (let n = 0; n < REJECTED; n += 1) {
    const at = n % SHOTS
    calls.push(n < SHAPE_REJECTIONS
      ? shots((index) => (index === at ? { ...shot(index), duration: 5 } : undefined))
      : shots((index) => (index === at ? shot(index, {}, { aspectRatio: '16:9' }) : undefined)))
    calls.push(shots(() => undefined))
  }
  while (calls.length < CALLS) calls.push(shots(() => undefined))
  return calls
}

const noop = async () => ({ ok: true, result: null })
const load = () => os.loadavg()[1]
const metrics = { turnBoundaryMs: [], projectionRecomputeMs: [], rejectedPerTurn: [] }
let noisy = load() >= 10
let failure

function oneTurn() {
  // 和 openLane 一样：每条 lane 新建工具描述 → pi 工具（createLaneTools，TypeBox 参数在这一步生成）→ 熔断和边界。
  const descriptors = createExtendedLaneTools({ execute: noop }).filter((tool) => tool.name === 'draft_shots')
  const failures = createLaneRepeatedFailureTracker()
  const boundary = createLaneToolInputBoundary({ failures, specs: descriptors })
  const [tool] = boundary.wrap(createLaneTools(descriptors))
  if (!tool) throw new Error('draft_shots is not in the extended lane tools')
  const calls = turnCalls()
  const rejected = []
  const startedAt = performance.now()
  for (const args of calls) {
    try {
      tool.prepareArguments(args)
      failures.note(tool.name, false, '')
    } catch (error) {
      rejected.push({ args, text: error instanceof Error ? error.message : String(error) })
    }
  }
  const turnMs = performance.now() - startedAt
  if (rejected.length !== REJECTED) throw new Error(`Expected ${REJECTED} rejections, the boundary rejected ${rejected.length}; first: ${rejected[0]?.text.slice(0, 400)}`)
  const stopped = rejected.filter((entry) => entry.text.includes('tool_retry_stopped'))
  if (stopped.length > 0) throw new Error(`No call should hit the wall in this turn; ${stopped.length} did`)
  const projectionStartedAt = performance.now()
  const envelopes = rejected.map(({ args, text }) => boundary.failureOf({ toolName: tool.name, args, text }))
  const projectionMs = performance.now() - projectionStartedAt
  // 量具自检：量的是该量的那两类拒收，不是别的什么错。
  const codes = envelopes.map((envelope) => envelope?.code)
  const expected = [...Array(SHAPE_REJECTIONS).fill('tool_arguments_invalid'), ...Array(PREPARE_REJECTIONS).fill('wrong_verb')]
  if (codes.join() !== expected.join()) throw new Error(`Unexpected envelope codes: ${codes.join(', ')}`)
  const unnamedShape = rejected.slice(0, SHAPE_REJECTIONS).filter(({ text }, n) => !text.includes(`- shots.${n % SHOTS}.duration:`))
  if (unnamedShape.length > 0) throw new Error(`A shape rejection does not name its field: ${unnamedShape[0].text.slice(0, 300)}`)
  return { turnMs, projectionMs, rejected: rejected.length }
}

try {
  // 预热：模块初始化和 V8 编译不算进数字里（每轮新建边界的 schema 编译照算）。
  oneTurn()
  for (let run = 0; run < runs; run += 1) {
    const { turnMs, projectionMs, rejected } = oneTurn()
    metrics.turnBoundaryMs.push(turnMs)
    metrics.projectionRecomputeMs.push(projectionMs)
    metrics.rejectedPerTurn.push(rejected)
  }
} catch (error) {
  failure = error
} finally {
  noisy = noisy || load() >= 10
}

const report = {
  scope: `${CALLS} draft_shots calls of ${SHOTS} shots each in one turn, ${REJECTED} rejected (${SHAPE_REJECTIONS} shape, ${PREPARE_REJECTIONS} prepare-step); real input boundary + real repeated-failure tracker, no model, no network`,
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
console.log(JSON.stringify({ ...metrics, noisy }))
if (failure) { console.error(failure.message); process.exit(1) }
