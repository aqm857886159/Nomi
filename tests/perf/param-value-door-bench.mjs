#!/usr/bin/env node
// 参数值门的开销量具（设计卡 docs/plan/2026-11-17-param-value-type.md ★7）。
// 真函数，用 tsx 直接载入，不起窗口、不连网、零花费：
//   · 发送口：electron/catalog/taskParams.ts#applyHeadlessParamDefaults（值门 + 档案修值 + 出口编码 + 补供应商默认，两个发送口都经这里）；
//   · 读分镜方案：electron/shared/storyboard/storyboardPlanSchema.ts#parseStoryboardPlan（逐镜规整打架的两个时长字段）。
//
// 最坏规模：一张画布 200 个视频节点，档案混合——字符串时长档（RunningHub Seedance 2.0 / Kling 3.0、Agnes 2.5）、
// 数字时长档（APIMart 海螺 2.3、Veo 3.1 Fast）各占一部分，一半节点存的写法和声明相反（老数据 / 外部助手写进来的）；
// 分镜 40 镜，一半是「durationSec 0 + params.duration "12"」这种打架字段。
//
// 量什么：
//   · sendDoor200Ms（主指标）：200 个节点各过一次发送口；
//   · planRead40Ms：40 镜方案读入（含规整）；
//   · encodedStrings：量具自检（字符串档的节点报文里时长都是字符串，应恒为字符串档节点数 120）；
//   · conflictShotSeconds：量具自检（打架的那一镜读成几秒，修后恒为 12，修前是 0）。
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

registerCjs()
register()
const { applyHeadlessParamDefaults } = await import('../../electron/catalog/taskParams.ts')
const { parseStoryboardPlan } = await import('../../electron/shared/storyboard/storyboardPlanSchema.ts')

// [供应商, 模型, 目录行声明的档案, 方式, 声明写法, 档位]
const MODELS = [
  ['runninghub', 'bytedance/seedance-2.0-global', 'runninghub-seedance', 'text', 'string', [5, 8, 12]],
  ['runninghub', 'kling-v3.0-pro', 'rh-kling-3.0', 'text', 'string', [6, 8, 10]],
  ['agnes', 'agnes-video-2.5', undefined, 'text', 'string', [4, 5, 10]],
  ['apimart', 'MiniMax-Hailuo-2.3', undefined, 't2v', 'number', [6, 10]],
  ['apimart', 'veo3.1-fast-official', undefined, 't2v', 'number', [4, 6, 8]],
]
const NODES = 200, SHOTS = 40

const nodes = Array.from({ length: NODES }, (_unused, index) => {
  const [vendorKey, modelKey, archetypeId, modeId, declaredAs, options] = MODELS[index % MODELS.length]
  const seconds = options[index % options.length]
  const flipped = index % 2 === 0
  const stored = (declaredAs === 'string') === flipped ? seconds : String(seconds)
  return {
    declaredAs,
    extras: { modelKey, modelVendor: vendorKey, vendor: vendorKey, archetype: { modeId }, duration: stored, aspect_ratio: '16:9', prompt: `第 ${index} 镜` },
    selected: { modelKey, vendorKey, taskKind: 'text_to_video', modeId, ...(archetypeId ? { modelMeta: { archetypeId } } : {}) },
  }
})
const planRaw = {
  title: '雨夜', anchors: [], shots: Array.from({ length: SHOTS }, (_unused, index) => ({
    index: index + 1, shotId: `shot-${index + 1}`, shotKind: 'video', anchorIds: [], prompt: `第 ${index + 1} 镜`,
    durationSec: index % 2 === 0 ? 0 : 5, params: index % 2 === 0 ? { duration: '12', aspect_ratio: '16:9' } : { aspect_ratio: '16:9' },
    modelKey: 'bytedance/seedance-2.0-global', modelVendor: 'runninghub', modeId: 'text',
  })),
}

const load = () => os.loadavg()[1]
const metrics = { sendDoor200Ms: [], planRead40Ms: [], encodedStrings: [], conflictShotSeconds: [] }
const loads = [load()]
let failure

function once() {
  let encodedStrings = 0
  const sendStart = performance.now()
  for (const node of nodes) {
    const sent = applyHeadlessParamDefaults(node.extras, node.selected, undefined)
    if (node.declaredAs === 'string' && typeof sent?.duration === 'string') encodedStrings += 1
  }
  const sendDoor200Ms = performance.now() - sendStart
  const planStart = performance.now()
  const plan = parseStoryboardPlan(planRaw)
  const planRead40Ms = performance.now() - planStart
  return { sendDoor200Ms, planRead40Ms, encodedStrings, conflictShotSeconds: plan.shots[0]?.durationSec }
}

try {
  once()
  for (let run = 0; run < runs; run += 1) {
    const result = once()
    metrics.sendDoor200Ms.push(result.sendDoor200Ms)
    metrics.planRead40Ms.push(result.planRead40Ms)
    metrics.encodedStrings.push(result.encodedStrings)
    metrics.conflictShotSeconds.push(result.conflictShotSeconds)
  }
} catch (error) {
  failure = error
} finally {
  loads.push(load())
}

const report = {
  scope: `${NODES} video nodes across ${MODELS.length} archetypes (half stored against the declared type), ${SHOTS}-shot plan with half conflicting durations; real send-door and plan-read functions`,
  date: new Date().toISOString(),
  machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`,
  node: process.version,
  noisy: loads.some((value) => value >= 10),
  loads,
  runs,
  metrics,
  ...(failure ? { failure: failure.message } : {}),
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...metrics, noisy: report.noisy, loads }))
if (failure) { console.error(failure.message); process.exit(1) }
