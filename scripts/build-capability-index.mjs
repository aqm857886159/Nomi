#!/usr/bin/env node
// 接口级「已有能力清单」生成器：在 src/、electron/ 新建文件的那一刻，给 agent 看「这附近已经有什么」。
//
// 为什么存在：调研（docs/research/2026-10-01-ai-collaboration-rules/report.md）里 RepoReuse 的实验——
// agent 在多轮任务里越来越少看仓库已有代码；给一份**接口级**（模块、一句话职责、入口）的简洁清单，复用率从
// 30.0% 升到 67.8%，塞完整源码没有改善。今天的 laneContextFit 就是在「pi 已经有压缩」没人看的地方长出来的。
//
// 不另起真相源（R33）：清单**每次现算**，只读两张现有登记表——
//   · docs/engineering/concept-owners/       —— 我们自己的概念与唯一 owner（一个概念一个文件，经 loadConceptRegistry 读）；
//   · docs/engineering/framework-boundaries.json —— 依赖框架已经提供的能力（按 scope 前缀匹配目标路径）。
// 不写任何文件、不入库；登记表漏登的能力，这里就列不出来（所以补登记是前置，见 pi 的 context-compaction）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONCEPT_OWNERS_DIR, loadConceptRegistry } from './concept-registry-lib.mjs'

export const DEFAULT_MAX_BYTES = 2500
const MAX_CONCEPT_LINES = 12
const MAX_FRAMEWORK_LINES = 10
const MAX_LINE_CHARS = 110
/** 命中的条目少于这个数，就追加一行运行时依赖名：登记表在大目录里常常是空的，而依赖清单确定、永远完整、一行。 */
const THIN_HITS = 3

const norm = (p) => String(p || '').split('\\').join('/').replace(/^\.\//, '')

/** 目标路径的「邻域」前缀：electron/agentLane/… → electron/agentLane；src/workbench/ai/lane/… → src/workbench/ai。 */
export function neighbourhoodOf(targetRel) {
  const parts = norm(targetRel).split('/').filter(Boolean)
  const depth = parts[0] === 'src' ? 3 : 2
  return parts.slice(0, Math.min(depth, Math.max(1, parts.length - 1))).join('/')
}

const clip = (text, max = MAX_LINE_CHARS) => {
  const t = String(text).replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
const firstClause = (text) => String(text || '').split(/[。；;\n]/)[0]

export function buildCapabilityIndex({ concepts = [], frameworks = [], dependencies = [], targetRel, maxBytes = DEFAULT_MAX_BYTES }) {
  const target = norm(targetRel)
  const hood = neighbourhoodOf(target)

  const conceptLines = concepts
    .filter((c) => c?.owner?.path && (norm(c.owner.path) === hood || norm(c.owner.path).startsWith(`${hood}/`)))
    .sort((a, b) => norm(a.owner.path).localeCompare(norm(b.owner.path)) || String(a.subject).localeCompare(String(b.subject)))
    .map((c) => `- ${clip(`${c.name} — ${norm(c.owner.path)}#${c.owner.symbol}`)}`)

  const frameworkLines = []
  for (const fw of frameworks) {
    for (const cap of fw.capabilities || []) {
      const hit = (cap.scope || []).map(norm).filter((s) => target.startsWith(s)).sort((a, b) => b.length - a.length)[0]
      if (!hit) continue
      frameworkLines.push({ specificity: hit.length, line: `- ${clip(`[${fw.id}] ${cap.id}：${firstClause(cap.provides)}`)}` })
    }
  }
  frameworkLines.sort((a, b) => b.specificity - a.specificity || a.line.localeCompare(b.line))

  let shownConcepts = conceptLines.slice(0, MAX_CONCEPT_LINES)
  let shownFrameworks = frameworkLines.slice(0, MAX_FRAMEWORK_LINES).map((x) => x.line)
  const total = conceptLines.length + frameworkLines.length
  // 登记没覆盖到的目录（electron/ai、mcp 相关等最容易长轮子的地方）：登记表给不出东西时，至少把依赖名列出来。
  let shownDependencies = total < THIN_HITS ? [...dependencies] : []
  const render = () => {
    const shown = shownConcepts.length + shownFrameworks.length
    const blocks = []
    if (shownFrameworks.length) blocks.push(`依赖框架已经提供：\n${shownFrameworks.join('\n')}`)
    if (shownConcepts.length) blocks.push(`本仓库同目录（${hood}）已有 owner：\n${shownConcepts.join('\n')}`)
    if (shownDependencies.length) blocks.push(`登记表在这里给不出多少（${total} 条）。package.json 运行时依赖（先看有没有现成的）：${shownDependencies.join('、')}`)
    if (total > shown) blocks.push(`…另有 ${total - shown} 条没列出（node scripts/build-capability-index.mjs ${target}）`)
    return blocks.join('\n')
  }
  let text = render()
  while (Buffer.byteLength(text, 'utf8') > maxBytes && (shownConcepts.length || shownFrameworks.length || shownDependencies.length)) {
    if (shownDependencies.length) shownDependencies = shownDependencies.slice(0, -1)
    else if (shownConcepts.length) shownConcepts = shownConcepts.slice(0, -1)
    else shownFrameworks = shownFrameworks.slice(0, -1)
    text = render()
  }
  return { text, bytes: Buffer.byteLength(text, 'utf8'), concepts: shownConcepts.length, frameworkCapabilities: shownFrameworks.length, dependencies: shownDependencies.length, total }
}

function requireConcepts(root) {
  const registry = loadConceptRegistry(root)
  if (!registry) throw new Error(`概念登记目录不存在：${CONCEPT_OWNERS_DIR}/`)
  return registry.concepts
}

export function loadRegistries(root) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
  return {
    concepts: requireConcepts(root),
    frameworks: read('docs/engineering/framework-boundaries.json').frameworks,
    dependencies: Object.keys(read('package.json').dependencies || {}).sort(),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const target = process.argv[2]
  if (!target) {
    console.error('用法：node scripts/build-capability-index.mjs <要新建的文件路径，如 electron/agentLane/foo.ts>')
    process.exit(1)
  }
  const result = buildCapabilityIndex({ ...loadRegistries(root), targetRel: target })
  console.log(result.text)
  console.error(`[capability-index] ${result.bytes} 字节 · 框架能力 ${result.frameworkCapabilities} · 同目录 owner ${result.concepts} · 依赖名 ${result.dependencies} · 共命中 ${result.total}`)
}
