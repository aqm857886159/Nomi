#!/usr/bin/env node
// 素材文件存活判定（整份项目内容扫描）的开销量具（设计卡 docs/plan/2026-11-17-asset-liveness-scan.md ★7）。
// 真函数：src/workbench/assets/assetResultDeletion.ts#collectProjectFileReferences / isProjectFileReferenced，用 tsx 直接载入。
// 不起窗口、不连网、零花费。
//
// 最坏规模：600 个节点 × 每个 20 版结果（1.2 万条，10% 带 8 张白板图层）、每个节点参考列表 4 张；
// 分镜 20 份方案 × 50 个镜头 × 每镜 3 张参考绑定；时间轴 500 个片段；20 篇原稿 × 8000 字（各夹 20 个地址）；
// 助手输入 20 个附件；素材库列表 1000 项。
//
// 量什么：
//   · scanMs（主指标）：整份内容建一次引用索引；
//   · lookupMs：单个文件查一次索引（1000 次的平均）；
//   · listFilterMs：素材库 1000 项过滤 = 一次扫描 + 1000 次查表（列表按 store 状态记忆，同一刻只扫一次）；
//   · referencedFiles：量具自检（被引用的文件里抽 1000 个，必须全判有人用）。
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

// 渲染层模块是无扩展名导入（按 CommonJS 加载）：两套加载器各注册一次。
registerCjs()
register()
const { collectProjectFileReferences, isProjectFileReferenced } = await import('../../src/workbench/assets/assetResultDeletion.ts')

const P = 'project-1'
const url = (name) => `nomi-local://asset/${P}/assets/generated/${name}.png`
const NODES = 600, VERSIONS = 20, LIST = 1000

function worstContent() {
  const nodes = Array.from({ length: NODES }, (_unused, n) => {
    const history = Array.from({ length: VERSIONS }, (_u, v) => ({
      id: `r-${n}-${v}`, type: 'image', url: url(`n${n}-v${v}`), thumbnailUrl: url(`n${n}-v${v}-thumb`), createdAt: v,
      ...(v % 10 === 0 ? { raw: { whiteboardState: { canvasAssets: Array.from({ length: 8 }, (_x, l) => ({ url: url(`n${n}-v${v}-layer${l}`) })) } } } : {}),
    }))
    return { id: `node-${n}`, kind: 'image', title: `节点 ${n}`, position: { x: n, y: n }, status: 'success', prompt: `第 ${n} 个镜头的提示词，参考 ${url(`n${(n + 1) % NODES}-v0`)} 的光线`,
      result: history[VERSIONS - 1], history, meta: { referenceImageUrls: Array.from({ length: 4 }, (_u, r) => url(`n${(n + r + 1) % NODES}-v1`)) },
      runs: [{ id: `run-${n}`, status: 'success', raw: { asset: { data: { relativePath: `assets/generated/n${n}-v19.png` } } } }] }
  })
  const storyboard = Object.fromEntries(Array.from({ length: 20 }, (_u, d) => [`doc-${d}`, [{ id: `design-${d}`, plan: { shots: Array.from({ length: 50 }, (_x, s) => ({
    index: s, prompt: `镜头 ${s}`, referenceBindings: { image_ref: Array.from({ length: 3 }, (_y, b) => ({ url: url(`n${(d * 50 + s + b) % NODES}-v2`), name: 'ref' })) },
  })) } }]]))
  const filler = '雨后的街道，纸船在水洼里慢慢漂，清晨的光从屋檐斜照下来。'.repeat(270)
  const documents = Array.from({ length: 20 }, (_u, d) => ({ id: `doc-${d}`, contentJson: { type: 'doc', content: Array.from({ length: 20 }, (_x, k) => ({
    type: 'paragraph', content: [{ type: 'text', text: `${filler.slice(0, 400)} ${url(`n${(d * 20 + k) % NODES}-v3`)}` }] })) } }))
  const timeline = { tracks: [{ id: 'video', clips: Array.from({ length: 500 }, (_u, c) => ({ id: `clip-${c}`, sourceNodeId: `asset:${P}:assets/generated/n${c % NODES}-v4.png`, url: url(`n${c % NODES}-v4`) })) }] }
  const attachments = Array.from({ length: 20 }, (_u, a) => ({ id: `att-${a}`, url: url(`n${a}-v5`) }))
  return { nodes, rest: { content: { workbenchDocuments: documents, timeline, storyboardDesignsByDocumentId: storyboard }, workbenchSession: { projectAgentAttachments: attachments } } }
}

const content = worstContent()
const listTargets = Array.from({ length: LIST }, (_u, i) => ({ projectId: P, relativePath: `assets/generated/n${i % NODES}-v${i % 6}.png` }))
const load = () => os.loadavg()[1]
const metrics = { scanMs: [], lookupMs: [], listFilterMs: [], referencedFiles: [] }
// 噪声判法同 tests/perf/ 其余 Node 量具：开始和结束各取一次 5 分钟负载，任一 ≥ 10 记有噪声（场景据此作废，不进基线）。
const loads = [load()]
let failure

function once() {
  const scanStart = performance.now()
  const references = collectProjectFileReferences(content.nodes, content.rest)
  const scanMs = performance.now() - scanStart
  const lookupStart = performance.now()
  let referenced = 0
  for (const target of listTargets) if (isProjectFileReferenced(target, references)) referenced += 1
  const lookupTotal = performance.now() - lookupStart
  if (referenced !== LIST) throw new Error(`Expected all ${LIST} referenced, got ${referenced}`)
  return { scanMs, lookupMs: lookupTotal / LIST, listFilterMs: scanMs + lookupTotal, referenced }
}

try {
  once()
  for (let run = 0; run < runs; run += 1) {
    const result = once()
    metrics.scanMs.push(result.scanMs)
    metrics.lookupMs.push(result.lookupMs)
    metrics.listFilterMs.push(result.listFilterMs)
    metrics.referencedFiles.push(result.referenced)
  }
} catch (error) {
  failure = error
} finally {
  loads.push(load())
}

const report = {
  scope: `${NODES} nodes x ${VERSIONS} versions, 20x50x3 storyboard bindings, 500 timeline clips, 20 documents, 20 attachments; list of ${LIST}; real scan functions`,
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
