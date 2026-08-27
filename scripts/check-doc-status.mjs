#!/usr/bin/env node
/**
 * 方案状态棘轮：文档开头必须带状态标记；⛔ 必须指向替代文档。
 *
 * 状态即「登记制」：带 🚧/⏳/📋 的文档进 docs/DELIVERY-LEDGER.md 现役区并被每日提醒；
 * ✅/⛔/📎 已结案；🧊 是分诊过的远期项，列出但不催；没有标记 = 未登记，留在存量区不打扰。
 * 这样账本只盯真正在欠的债，而不是 400 篇历史文件。
 * baseline 保存具体文件路径，确保修掉一处旧债不能掩护另一处新增违规。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { statusOf, collectPlanDocuments, STATUS_HEAD_LINES } from './doc-status-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = path.join(repoRoot, 'docs')
const baselinePath = path.join(repoRoot, 'scripts', 'doc-status-baseline.json')
const planRoots = [path.join(docsRoot, 'plan'), path.join(docsRoot, 'superpowers', 'plans')]
const openingLineLimit = STATUS_HEAD_LINES

function collectMarkdownFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(file))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file)
  }
  return files
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/')
}

function replacementTargets(lines, markerLine, file) {
  const context = lines.slice(Math.max(0, markerLine - 1), markerLine + 2).join('\n')
  const hasReplacementCue = /(?:取代|替代|现行[^\n。]{0,30}见|见[^\n。]{0,30}现行)/u.test(context)
  if (!hasReplacementCue) return []

  const rawTargets = []
  const markdownLink = /\[[^\n]*?\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))/g
  for (const match of context.matchAll(markdownLink)) rawTargets.push(match[1] ?? match[2])
  for (const match of context.matchAll(/(?:docs\/)?(?:[\w一-鿿.-]+\/)*[\w一-鿿.-]+\.md/g)) rawTargets.push(match[0])

  return rawTargets
    .map((target) => target.split(/[?#]/, 1)[0].replaceAll('\\', '/'))
    .map((target) => (target.startsWith('docs/') ? path.resolve(repoRoot, target) : path.resolve(path.dirname(file), target)))
    .filter((target) => target !== file && fs.existsSync(target) && fs.statSync(target).isFile())
}

// statusOf / 文档收集 / 开头行数：唯一定义在 scripts/doc-status-lib.mjs，本文件不再各写一份。

function scan(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(0, openingLineLimit)
  const markerLine = lines.findIndex((line) => statusOf(line) !== null)
  if (markerLine === -1) return { missingStatus: true, deprecatedWithoutReplacement: false }
  const status = statusOf(lines[markerLine])
  return {
    missingStatus: false,
    deprecatedWithoutReplacement: status === '⛔' && replacementTargets(lines, markerLine, file).length === 0,
  }
}

function validateList(baseline, key) {
  const list = baseline[key]
  if (!Array.isArray(list) || list.some((value) => typeof value !== 'string')) {
    console.error(`✖ ${relative(baselinePath)} 的 ${key} 必须是文件路径字符串数组`)
    process.exit(1)
  }
  const duplicates = list.filter((value, index) => list.indexOf(value) !== index)
  if (duplicates.length > 0) {
    console.error(`✖ ${key} 基线里有重复路径：${[...new Set(duplicates)].join(', ')}`)
    process.exit(1)
  }
  return list
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return null
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  return {
    missingStatus: validateList(baseline, 'missingStatus'),
    deprecatedWithoutReplacement: validateList(baseline, 'deprecatedWithoutReplacement'),
  }
}

function writeBaseline(findings) {
  const baseline = {
    _comment: [
      '方案状态棘轮基线：只减不增。开头 12 行只允许既有图例的五类 emoji 状态。',
      '⛔ 状态同一行或紧邻行必须有“取代/替代/现行见”语义，并指向真实存在的另一篇 .md。',
      '身份使用仓库相对路径；新增违规必须修文档，不能追加到下面数组。',
    ],
    missingStatus: findings.missingStatus,
    deprecatedWithoutReplacement: findings.deprecatedWithoutReplacement,
  }
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
}

// 同上：索引文件不是方案，不要求状态标记。
const documents = collectPlanDocuments(repoRoot).map((rel) => path.join(repoRoot, rel))
const findings = { missingStatus: [], deprecatedWithoutReplacement: [] }
for (const file of documents) {
  const result = scan(file)
  if (result.missingStatus) findings.missingStatus.push(relative(file))
  if (result.deprecatedWithoutReplacement) findings.deprecatedWithoutReplacement.push(relative(file))
}

const updateBaseline = process.argv.includes('--update-baseline')
const baseline = readBaseline()
if (baseline === null) {
  if (!updateBaseline) {
    console.error(`✖ 缺少 ${relative(baselinePath)}；先核对实扫结果，再用 --update-baseline 初始化存量`)
    process.exit(1)
  }
  writeBaseline(findings)
  console.log(
    `✅ 已初始化方案状态基线：缺状态 ${findings.missingStatus.length} 篇；⛔ 无替代指向 ${findings.deprecatedWithoutReplacement.length} 篇`,
  )
  process.exit(0)
}

const keys = ['missingStatus', 'deprecatedWithoutReplacement']
const added = Object.fromEntries(keys.map((key) => [key, findings[key].filter((file) => !baseline[key].includes(file))]))
const removed = Object.fromEntries(keys.map((key) => [key, baseline[key].filter((file) => !findings[key].includes(file))]))
const addedCount = keys.reduce((sum, key) => sum + added[key].length, 0)

if (updateBaseline) {
  if (addedCount > 0) {
    console.error(`✖ 拒绝抬高基线：仍有 ${addedCount} 处新增状态违规；先修文档`)
    for (const key of keys) for (const file of added[key]) console.error(`  ${key}: ${file}`)
    process.exit(1)
  }
  writeBaseline(Object.fromEntries(keys.map((key) => [key, baseline[key].filter((file) => findings[key].includes(file))])))
  console.log(
    `✅ 已下调方案状态基线：缺状态 ${baseline.missingStatus.length} → ${baseline.missingStatus.length - removed.missingStatus.length}；⛔ 无替代指向 ${baseline.deprecatedWithoutReplacement.length} → ${baseline.deprecatedWithoutReplacement.length - removed.deprecatedWithoutReplacement.length}`,
  )
  process.exit(0)
}

console.log(
  `方案状态：${documents.length} 篇；缺状态 ${findings.missingStatus.length}（基线 ${baseline.missingStatus.length}）；⛔ 无替代指向 ${findings.deprecatedWithoutReplacement.length}（基线 ${baseline.deprecatedWithoutReplacement.length}）`,
)

if (addedCount > 0) {
  if (added.missingStatus.length > 0) {
    console.error(`✖ 方案状态回归：${added.missingStatus.length} 篇新增文档在开头 ${openingLineLimit} 行内没有状态标记`)
    for (const file of added.missingStatus) console.error(`  ${file}`)
    console.error('  → 沿用：✅ 已交付 ｜ 🚧 进行中 ｜ ⏳ 已拍板·未开工 ｜ 🧊 暂缓/远期 ｜ 📋 方案待拍板 ｜ ⛔ 已废弃 ｜ 📎 交接/日志')
  }
  if (added.deprecatedWithoutReplacement.length > 0) {
    console.error(`✖ 废弃文档回归：${added.deprecatedWithoutReplacement.length} 篇新增 ⛔ 状态没有替代文档指向`)
    for (const file of added.deprecatedWithoutReplacement) console.error(`  ${file}`)
    console.error('  → 在状态同一行或紧邻行写明由哪篇现行 .md 取代，且目标必须真实存在')
  }
  process.exit(1)
}

for (const key of keys) {
  if (removed[key].length === 0) continue
  console.log(`↓ ${key} 存量减少 ${removed[key].length} 篇；请从 baseline 删除这些路径锁定战果：`)
  for (const file of removed[key]) console.log(`  ${file}`)
}

console.log('✅ 方案状态棘轮通过（只减不增）')
