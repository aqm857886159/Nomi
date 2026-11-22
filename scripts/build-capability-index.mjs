#!/usr/bin/env node
// 接口级「已有能力与主人速查」引擎（动手前自动发现的唯一实现）：
// 在新建或首次编辑 src/、electron/ 文件、以及派工检查时，自动展示「这附近谁说了算、仓内已有什么库/主人」。
//
// 不另起真相源（R33）：清单每次现算，只读 4 份现有单一真相源——
//   · docs/engineering/concept-owners/           —— 概念与唯一 owner + consumers/doors（经 loadConceptRegistry 读）；
//   · scripts/boundary-owners.mjs                —— 边界主人台账（经唯一读口 readLedger 读，反查目标文件属于哪个边界）；
//   · docs/engineering/framework-boundaries.json —— 依赖框架已经提供的能力（按 scope 前缀匹配目标路径）；
//   · package.json                               —— dependencies + 已打包进渲染层的前端生产库（@mantine/hooks、swr、@floating-ui/dom 等）。
//
// 用法：
//   node scripts/build-capability-index.mjs <路径>
//   node scripts/build-capability-index.mjs --path electron/agentLane/laneSkillCatalog.mts
//   node scripts/build-capability-index.mjs --topic cache
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readLedger } from './boundary-owners.mjs'
import { CONCEPT_OWNERS_DIR, loadConceptRegistry } from './concept-registry-lib.mjs'

export const DEFAULT_MAX_BYTES = 2500
const MAX_CONCEPT_LINES = 8
const MAX_DIRECT_OWNER_LINES = 6
const MAX_FRAMEWORK_LINES = 8
const MAX_LINE_CHARS = 110

/** 渲染层 Vite 打包进生产包、但挂在 devDependencies 的核心成熟库（原先只读 dependencies 导致全部隐身）。 */
export const FRONTEND_RUNTIME_PACKAGES = Object.freeze([
  '@mantine/hooks',
  'swr',
  '@floating-ui/dom',
  '@fluentui/priority-overflow',
  '@tanstack/react-virtual',
  'immer',
  '@xyflow/react',
  '@mantine/core',
  'zustand',
  'i18next',
  'framer-motion',
])

/** 通用能力速查卡（按主题/关键词或高频目录自动展示，避免在已有文件里重搓 ABC 零件）。 */
export const GENERIC_CAPABILITY_OWNERS = Object.freeze([
  { id: 'concurrency', keywords: /并发|限流|队列|concurren|queue|limit/i, line: '并发限流 → 已装 p-limit（例 electron/workspace/workspaceSync.ts）' },
  { id: 'cache', keywords: /缓存|lru|ttl|cache|memo/i, line: '缓存/去重 → 渲染层用已装 swr；主进程单活跃目录用轻量 stat 指纹，不手写多槽 LRU' },
  { id: 'watch', keywords: /监听|watch|chokidar/i, line: '文件变化 → 禁止直接 fs.watch/watchFile，改用轻量 stat/lstat 指纹' },
  { id: 'retry', keywords: /重试|退避|轮询|retry|backoff|poll/i, line: '重试退避 → 主进程用 electron/sharingRetry.ts / vendorHttp.ts；脚本用 scripts/lib/transientRetry.mjs' },
  { id: 'debounce', keywords: /防抖|节流|debounce|throttle/i, line: '防抖节流 → 渲染层用已装 @mantine/hooks（useDebouncedCallback / useThrottledCallback）' },
  { id: 'rename', keywords: /改名|原子写|写盘|rename|atomic/i, line: '原子写/改名 → 唯一主人 electron/jsonFile.ts（renameSyncWithRetry / writeJsonAtomic）' },
  { id: 'error-classify', keywords: /错误|报错|余额|配额|限流|429|402|quota|balance|error/i, line: '上游错误归类 → 唯一主人 electron/shared/vendorFailure.ts（categorizeVendorFailure），别写第二层正则' },
  { id: 'popover', keywords: /弹层|浮层|定位|tooltip|popover|floating/i, line: '弹层定位 → 用已装 @floating-ui/dom + @radix-ui/react-tooltip / @mantine/core' },
])

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

function conceptTouchesFile(concept, target) {
  if (!target) return false
  if (norm(concept?.owner?.path) === target) return true
  for (const field of ['consumers', 'doors', 'allowedConsumers', 'readers', 'writers']) {
    const list = concept?.[field]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const p = typeof item === 'string' ? item : item?.path || item?.file
      if (p && norm(p) === target) return true
    }
  }
  return false
}

function boundaryMatchesFile(boundaries, target) {
  if (!target || !Array.isArray(boundaries)) return []
  const hits = []
  for (const entry of boundaries) {
    const owner = norm(entry?.owner || entry?.ownerPath || '')
    const files = [owner, ...(Array.isArray(entry?.files) ? entry.files.map(norm) : []), ...(Array.isArray(entry?.consumers) ? entry.consumers.map(norm) : [])]
    if (files.includes(target)) {
      hits.push(`- ${clip(`[边界] ${entry.id || entry.name} → ${owner || target}`)}`)
    }
  }
  return hits
}

export function buildCapabilityIndex({
  concepts = [],
  frameworks = [],
  dependencies = [],
  frontendDependencies = [],
  boundaries = [],
  targetRel = '',
  topic = '',
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const target = norm(targetRel)
  const topicText = String(topic || '').trim()
  const hood = target ? neighbourhoodOf(target) : ''
  const isProductTarget = /^(?:src|electron)\//.test(target)

  // 1. 直接命中本文件（owner 或 consumers/doors 反查）+ 边界台账
  const directLines = []
  if (target) {
    for (const c of concepts) {
      if (conceptTouchesFile(c, target)) {
        directLines.push(`- ${clip(`${c.name} — ${norm(c.owner?.path)}#${c.owner?.symbol || '*'}`)}`)
      }
    }
    directLines.push(...boundaryMatchesFile(boundaries, target))
  }
  const uniqueDirect = [...new Set(directLines)]

  // 2. 同目录（邻域）已有 owner
  const conceptLines = target
    ? concepts
      .filter((c) => c?.owner?.path && (norm(c.owner.path) === hood || norm(c.owner.path).startsWith(`${hood}/`)))
      .sort((a, b) => norm(a.owner.path).localeCompare(norm(b.owner.path)) || String(a.subject).localeCompare(String(b.subject)))
      .map((c) => `- ${clip(`${c.name} — ${norm(c.owner.path)}#${c.owner.symbol}`)}`)
      .filter((line) => !uniqueDirect.includes(line))
    : []

  // 3. 依赖框架能力
  const frameworkLines = []
  if (target) {
    for (const fw of frameworks) {
      for (const cap of fw.capabilities || []) {
        const hit = (cap.scope || []).map(norm).filter((s) => target.startsWith(s)).sort((a, b) => b.length - a.length)[0]
        if (!hit) continue
        frameworkLines.push({ specificity: hit.length, line: `- ${clip(`[${fw.id}] ${cap.id}：${firstClause(cap.provides)}`)}` })
      }
    }
    frameworkLines.sort((a, b) => b.specificity - a.specificity || a.line.localeCompare(b.line))
  }

  // 4. 通用能力速查卡（按 topic 或按目录角色自动给；不再因 total >= 3 就藏起现成库）
  const genericLines = []
  if (topicText) {
    for (const entry of GENERIC_CAPABILITY_OWNERS) {
      if (entry.keywords.test(topicText) || entry.id.includes(topicText.toLowerCase())) {
        genericLines.push(`- ${entry.line}`)
      }
    }
    if (genericLines.length === 0) {
      for (const entry of GENERIC_CAPABILITY_OWNERS) genericLines.push(`- ${entry.line}`)
    }
    // 主题模式也反查匹配主题词的概念 owner
    const re = new RegExp(topicText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    for (const c of concepts) {
      if (re.test(`${c.subject} ${c.name} ${c.owner?.path} ${c.owner?.symbol}`)) {
        conceptLines.push(`- ${clip(`${c.name} — ${norm(c.owner?.path)}#${c.owner?.symbol}`)}`)
      }
    }
  } else if (isProductTarget && (dependencies.length > 0 || frontendDependencies.length > 0)) {
    const relevantIds = target.startsWith('src/')
      ? ['debounce', 'cache', 'popover', 'error-classify']
      : ['cache', 'watch', 'retry', 'concurrency', 'rename', 'error-classify']
    for (const id of relevantIds) {
      const entry = GENERIC_CAPABILITY_OWNERS.find((item) => item.id === id)
      if (entry) genericLines.push(`- ${entry.line}`)
    }
  }

  let shownDirect = uniqueDirect.slice(0, MAX_DIRECT_OWNER_LINES)
  let shownConcepts = conceptLines.slice(0, MAX_CONCEPT_LINES)
  let shownFrameworks = frameworkLines.slice(0, MAX_FRAMEWORK_LINES).map((x) => x.line)
  let shownGeneric = genericLines.slice(0, 6)
  const total = uniqueDirect.length + conceptLines.length + frameworkLines.length

  // 合并 dependencies + 渲染层 devDependencies 生产库（不再因热点目录 total >= 3 就藏掉）
  const mergedDeps = target.startsWith('src/')
    ? [...new Set([...frontendDependencies, ...dependencies])]
    : [...new Set([...dependencies, ...frontendDependencies])]
  let shownDependencies = (isProductTarget || topicText) && mergedDeps.length > 0 ? [...mergedDeps] : []

  const render = () => {
    const shown = shownDirect.length + shownConcepts.length + shownFrameworks.length
    const blocks = []
    if (shownDirect.length) blocks.push(`直接关联本文件的唯一主人 / 边界：\n${shownDirect.join('\n')}`)
    if (shownFrameworks.length) blocks.push(`依赖框架已经提供：\n${shownFrameworks.join('\n')}`)
    if (shownConcepts.length) blocks.push(`${hood ? `本仓库同目录（${hood}）已有 owner` : `匹配主题「${topicText}」的已有 owner`}：\n${shownConcepts.join('\n')}`)
    if (shownGeneric.length) blocks.push(`通用能力现成库 / 唯一主人（别在业务文件重搓）：\n${shownGeneric.join('\n')}`)
    if (shownDependencies.length) blocks.push(`package.json 可复用生产依赖（含前端已装库）：${shownDependencies.join('、')}`)
    if (total > shown) blocks.push(`…另有 ${total - shown} 条没列出（node scripts/build-capability-index.mjs ${target || `--topic ${topicText}`}）`)
    return blocks.join('\n')
  }

  let text = render()
  while (Buffer.byteLength(text, 'utf8') > maxBytes && (shownDependencies.length || shownGeneric.length || shownConcepts.length || shownFrameworks.length || shownDirect.length)) {
    if (shownDependencies.length) shownDependencies = shownDependencies.slice(0, -1)
    else if (shownConcepts.length > 3) shownConcepts = shownConcepts.slice(0, -1)
    else if (shownFrameworks.length > 4) shownFrameworks = shownFrameworks.slice(0, -1)
    else if (shownGeneric.length > 3) shownGeneric = shownGeneric.slice(0, -1)
    else if (shownConcepts.length) shownConcepts = shownConcepts.slice(0, -1)
    else if (shownFrameworks.length) shownFrameworks = shownFrameworks.slice(0, -1)
    else if (shownGeneric.length) shownGeneric = shownGeneric.slice(0, -1)
    else shownDirect = shownDirect.slice(0, -1)
    text = render()
  }
  return {
    text,
    bytes: Buffer.byteLength(text, 'utf8'),
    directOwners: shownDirect.length,
    concepts: shownConcepts.length,
    frameworkCapabilities: shownFrameworks.length,
    genericHints: shownGeneric.length,
    dependencies: shownDependencies.length,
    total,
  }
}

function requireConcepts(root) {
  const registry = loadConceptRegistry(root)
  if (!registry) throw new Error(`概念登记目录不存在：${CONCEPT_OWNERS_DIR}/`)
  return registry.concepts
}

export function loadRegistries(root) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
  const pkg = read('package.json')
  const deps = Object.keys(pkg.dependencies || {}).sort()
  const devDeps = pkg.devDependencies || {}
  const frontendDeps = FRONTEND_RUNTIME_PACKAGES.filter((name) => name in devDeps)
  let boundaries = []
  try {
    const ledger = readLedger(root)
    boundaries = [
      ...(Array.isArray(ledger?.boundaries) ? ledger.boundaries : []),
      ...(Array.isArray(ledger?.entries) ? ledger.entries : []),
      ...(Array.isArray(ledger?.reanchored)
        ? ledger.reanchored.map((row) => ({
            id: row?.anchor?.symbol || row?.symbol,
            owner: row?.anchor?.path || row?.path,
            files: [row?.path, row?.anchor?.path].filter(Boolean),
          }))
        : []),
    ]
  } catch { /* 可选台账 */ }
  return {
    concepts: requireConcepts(root),
    frameworks: read('docs/engineering/framework-boundaries.json').frameworks,
    dependencies: deps,
    frontendDependencies: frontendDeps,
    boundaries,
  }
}

function parseCli(argv) {
  let targetRel = ''
  let topic = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--path' && argv[i + 1]) { targetRel = argv[++i]; continue }
    if (arg.startsWith('--path=')) { targetRel = arg.slice(7); continue }
    if (arg === '--topic' && argv[i + 1]) { topic = argv[++i]; continue }
    if (arg.startsWith('--topic=')) { topic = arg.slice(8); continue }
    if (!arg.startsWith('-') && !targetRel) targetRel = arg
  }
  return { targetRel, topic }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { targetRel, topic } = parseCli(process.argv.slice(2))
  if (!targetRel && !topic) {
    console.error('用法：node scripts/build-capability-index.mjs [--path <文件路径>] [--topic <关键词>]')
    process.exit(1)
  }
  const result = buildCapabilityIndex({ ...loadRegistries(root), targetRel, topic })
  console.log(result.text)
  console.error(`[capability-index] ${result.bytes} 字节 · 直接主人 ${result.directOwners} · 框架能力 ${result.frameworkCapabilities} · 同目录 owner ${result.concepts} · 通用速查 ${result.genericHints} · 依赖名 ${result.dependencies} · 共命中 ${result.total}`)
}
