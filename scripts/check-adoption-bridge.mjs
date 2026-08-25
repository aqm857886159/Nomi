#!/usr/bin/env node
// P5 E1 铁律：生成画布不能绕过 Proposal 直接写时间轴。
// 采纳桥本身和素材库/轴内编辑是受控例外；本门岗只扫生成模块的直写入口。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 扫描面必须覆盖**所有可能落轴的地方**，不能只盯生成画布。
// 教训（2026-08-26）：第一版只扫 generationCanvas + addNodeToTimelineEnd.ts，
// 而真正漏网的直写在 `timeline/TimelineTrack.tsx` 的拖放分支里——
// 生成节点从画布/预览来源拖进轨道，绕过 Proposal 直接写轴，门岗却全绿。
// 门岗看不见的旁路比没有门岗更糟：它让人以为铁律成立。
const roots = [
  path.join(repoRoot, 'src/workbench/generationCanvas'),
  path.join(repoRoot, 'src/workbench/timeline'),
  path.join(repoRoot, 'src/workbench/preview'),
]

// 受控例外：**只有非生成产物**的落轴路径才配进这里，每条都要写清为什么。
// 基线只减不增——新增任何一条都等于开了一个新旁路，必须在 PR 里单独论证。
const allowlist = new Map([
  [
    'src/workbench/timeline/addAssetToTimeline.ts',
    // 素材库→时间轴。落的是**用户自己的素材**（AssetRef：project/canvas 下的文件），
    // 不是生成产物；它连 GenerationCanvasNode 都不碰。铁律管的是「生成模块不能绕过
    // Proposal 落轴」，用户导入自己的文件不在其内（见 docs/plan/2026-08-25-p5-e1-adoption-bridge.md §2.2）。
    2,
  ],
  [
    'src/workbench/adoption/adoptionStorePorts.ts',
    // 采纳桥自己的 store 接线处。它是**桥的出口**，不是绕过桥的旁路。
    // （当前只在注释里提到该 API，计数为 0；留在册上以免后人误加直写。）
    0,
  ],
])

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g, '')
}

function collect(entry) {
  if (!fs.existsSync(entry)) return []
  if (fs.statSync(entry).isFile()) return [entry]
  const files = []
  for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
    const full = path.join(entry, child.name)
    if (child.isDirectory() && child.name !== 'node_modules') files.push(...collect(full))
    else if (child.isFile() && /\.(tsx?|jsx?)$/.test(child.name)) files.push(full)
  }
  return files
}

const violations = []
const allowedCounts = new Map()
for (const file of roots.flatMap(collect)) {
  const rel = path.relative(repoRoot, file)
  if (file.includes(`${path.sep}adoption${path.sep}`) && !allowlist.has(rel)) continue
  const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'))
  code.split('\n').forEach((line, index) => {
    if (!/\baddTimelineClipAtFrame\s*\(/.test(line)) return
    if (allowlist.has(rel)) {
      allowedCounts.set(rel, (allowedCounts.get(rel) || 0) + 1)
      return
    }
    violations.push(`${rel}:${index + 1}`)
  })
}

if (violations.length > 0) {
  console.error('✖ 存在绕过 Adoption Proposal 的时间轴直写：')
  for (const hit of violations) console.error(`  ${hit}`)
  console.error('→ 请改为 adoption/adoptGenerationNode 或 adoption/adoptStoryboardBatch。')
  process.exit(1)
}

// 棘轮：白名单里的例外只准变少。多出来 = 有人在受控例外文件里又加了一条直写。
let ratchetBroken = false
for (const [rel, baseline] of allowlist) {
  const actual = allowedCounts.get(rel) || 0
  if (actual > baseline) {
    console.error(`✖ 受控例外 ${rel} 的直写数从基线 ${baseline} 涨到 ${actual}（棘轮只减不增）。`)
    ratchetBroken = true
  }
}
if (ratchetBroken) process.exit(1)

const total = [...allowedCounts.values()].reduce((sum, count) => sum + count, 0)
console.log(`✅ adoption bridge 铁律通过：无绕过 Proposal 的直写（受控例外基线 ${total} 处）`)
