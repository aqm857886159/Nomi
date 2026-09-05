#!/usr/bin/env node
/**
 * 三个文档/生成物门（docs-index / doc-status / ledger）的**自动补齐**，在 main 上跑。
 *
 * ── 为什么把补齐从作者手里挪到 main 上（2026-09-05）──
 * 2026-08-22→09-05 全量 CI 失败审计：226 次红里 77 次（34%）是文档/合同门，其中这三个门占 63 次。
 * 它们**结构上不可能拦住任何生产 bug**——只查 Markdown 链接、开头有没有 emoji、生成物新不新鲜。
 * 而且它们并没在守住覆盖率：实扫 596 篇里 323 篇未收录、533 篇里 425 篇缺状态，
 * 80% 的债早被冻进基线，棘轮只是不让它涨。代价却是真的：main 上 30 个纯粹为了过这三个门而存在的
 * commit（`chore(docs): 补登 …至 plan INDEX`、`chore(ledger): regenerate …`），
 * 一个分支为一篇 md 连红 15 轮的化石。ledger 更是并行开发的直接税——21 次红里 10 次那个分支
 * **一篇文档都没加**，纯粹是 main 前进导致生成物过期。
 *
 * 补齐动作是确定性的、机器能做：重生成账本、把漏的那篇写进索引、给没状态的文档盖一个
 * 「📋 方案待拍板」。**故意盖成「待拍板」而不是猜**：猜出来的状态会污染交付账本的现役区，
 * 那比没有标记更糟。作者要改随时改，门岗只保证「登记了」。
 *
 * 边界（诚实标注）：
 *   · 索引补齐把链接追加到一个显式的「🤖 自动收录（待人工归位）」区，不假装知道它属于哪个主题；
 *     人再把它挪到对的表里就行——只减不增的棘轮由 check:docs-index 继续守。
 *   · docs/superpowers/plans/ 的索引是 `build-delivery-ledger.mjs` 的生成物（禁止手改），
 *     所以那一族的补齐 = 重跑生成器，本脚本不去追加行。
 *   · 判定「哪些没收录 / 哪些没状态」全部复用门岗自己的库（docs-index-lib / doc-status-lib），
 *     不另写一份扫描——两份判据一旦漂移，会出现「补齐完门岗还红」的死循环。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanDocumentIndex, toRepoRelative } from './docs-index-lib.mjs'
import { collectPlanDocuments, documentStatus } from './doc-status-lib.mjs'

/** 自动登记用的状态：**待拍板**，不猜。 */
export const AUTO_STATUS_LINE = '> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改'

export const AUTO_INDEX_HEADING = '## 🤖 自动收录（待人工归位）'
const AUTO_INDEX_NOTE = [
  '',
  '> 这些链接由 `.github/workflows/docs-autosync.yml` 在 main 上自动补登，只保证「能被搜到」，',
  '> 不代表已归好类。顺手把某一行挪进上面对应主题的表里即可——挪走后本区自然变短。',
  '',
  '',
]

function readBaselineList(repoRoot, file, keys) {
  const target = path.join(repoRoot, 'scripts', file)
  if (!fs.existsSync(target)) return new Set()
  const baseline = JSON.parse(fs.readFileSync(target, 'utf8'))
  return new Set(keys.flatMap((key) => (Array.isArray(baseline[key]) ? baseline[key] : [])))
}

/** 一篇未收录文档该由哪份索引收；生成物索引返回 null（它的补齐是重跑生成器）。 */
export function indexOwnerFor(relativePath) {
  if (relativePath.startsWith('docs/plan/')) return 'docs/plan/INDEX.md'
  if (relativePath.startsWith('docs/lessons/')) return 'docs/lessons/INDEX.md'
  return null
}

/** 在索引末尾的自动区追加链接；已在文中出现过就不重复追加。 */
function appendToIndex(repoRoot, indexRelative, documents) {
  const indexFile = path.join(repoRoot, indexRelative)
  const source = fs.readFileSync(indexFile, 'utf8')
  const lines = []
  for (const relativePath of documents) {
    const href = path
      .relative(path.dirname(indexFile), path.join(repoRoot, relativePath))
      .split(path.sep)
      .join('/')
    if (source.includes(`](${href})`)) continue
    lines.push(`- [${path.basename(relativePath, '.md')}](${href})`)
  }
  if (lines.length === 0) return []

  const body = source.endsWith('\n') ? source : `${source}\n`
  const next = body.includes(AUTO_INDEX_HEADING)
    ? `${body.replace(/\s*$/, '')}\n${lines.join('\n')}\n`
    : `${body}\n${AUTO_INDEX_HEADING}\n${AUTO_INDEX_NOTE.join('\n')}${lines.join('\n')}\n`
  fs.writeFileSync(indexFile, next)
  return documents
}

/** 把状态行插在 H1 之后（没有 H1 就插在最前），保证落在生效窗口的开头 12 行内。 */
export function insertStatusLine(source) {
  const lines = source.replace(/^﻿/, '').split('\n')
  const headingIndex = lines.findIndex((line) => /^#\s+\S/.test(line))
  if (headingIndex === -1) return `${AUTO_STATUS_LINE}\n\n${lines.join('\n')}`
  const before = lines.slice(0, headingIndex + 1)
  const after = lines.slice(headingIndex + 1)
  while (after.length > 0 && after[0].trim() === '') after.shift()
  return [...before, '', AUTO_STATUS_LINE, '', ...after].join('\n')
}

/**
 * 跑一遍补齐。返回做了什么——调用方（workflow）据此决定要不要 commit。
 * `regenerateLedger:false` 只给测试用：账本生成器的产物路径钉死在仓库根，
 * 夹具仓里跑它没有意义（那是它自己的门岗 build-delivery-ledger.node-test.mjs 的活）。
 */
export function repairDocGates({ repoRoot, regenerateLedger = true, run = execFileSync } = {}) {
  const statusBaseline = readBaselineList(repoRoot, 'doc-status-baseline.json', ['missingStatus'])
  const indexBaseline = readBaselineList(repoRoot, 'docs-index-baseline.json', ['unindexedDocuments'])

  // ① 状态标记：只补「新增的缺状态文档」，存量（基线里的）一律不动——那是有意冻住的历史债。
  const statusMarked = []
  for (const relativePath of collectPlanDocuments(repoRoot)) {
    if (statusBaseline.has(relativePath)) continue
    const file = path.join(repoRoot, relativePath)
    const source = fs.readFileSync(file, 'utf8')
    if (documentStatus(source).status !== null) continue
    fs.writeFileSync(file, insertStatusLine(source))
    statusMarked.push(relativePath)
  }

  // ② 生成物：状态改完再重生成，否则账本会落后一轮。
  if (regenerateLedger) {
    run(process.execPath, [path.join(repoRoot, 'scripts', 'build-delivery-ledger.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  }

  // ③ 索引：同样只补新增；生成物索引那一族由 ② 负责。
  const { unindexed } = scanDocumentIndex(repoRoot)
  const pending = unindexed.filter((relativePath) => !indexBaseline.has(relativePath))
  const byIndex = new Map()
  const unrepairable = []
  for (const relativePath of pending) {
    const owner = indexOwnerFor(relativePath)
    if (!owner || !fs.existsSync(path.join(repoRoot, owner))) {
      unrepairable.push(relativePath)
      continue
    }
    byIndex.set(owner, [...(byIndex.get(owner) ?? []), relativePath])
  }
  const indexed = []
  for (const [indexRelative, documents] of byIndex) {
    indexed.push(...appendToIndex(repoRoot, indexRelative, documents))
  }

  return { statusMarked, indexed, unrepairable, ledgerRegenerated: regenerateLedger }
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = repairDocGates({ repoRoot })
  const relative = (file) => toRepoRelative(repoRoot, path.join(repoRoot, file))
  console.log(`docs-autosync：登记状态 ${result.statusMarked.length} 篇；补登索引 ${result.indexed.length} 篇；账本已重生成`)
  for (const file of result.statusMarked) console.log(`  📋 ${relative(file)}`)
  for (const file of result.indexed) console.log(`  🔗 ${relative(file)}`)
  if (result.unrepairable.length > 0) {
    // fail-closed：补不了就必须有人看见，而不是让 main 上的验证步骤给出一句莫名其妙的红。
    console.error(`✖ ${result.unrepairable.length} 篇文档不知道该收进哪份索引（本脚本只认 docs/plan 与 docs/lessons）：`)
    for (const file of result.unrepairable) console.error(`  ${relative(file)}`)
    console.error('  → 手动收录，或在 scripts/repair-doc-gates.mjs 的 indexOwnerFor 里补一条归属规则')
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
