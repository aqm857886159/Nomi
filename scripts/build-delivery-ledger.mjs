#!/usr/bin/env node
/**
 * 交付账本：把「已拍板但没交付」变成一份看得见、且每天会顶到眼前的清单。
 *
 * 为什么要它：2026-08-27 实测，docs/plan/INDEX.md 里 30 篇 🚧 + 18 篇 📋 中，
 * 有 37 篇停滞超过 60 天、中位数 81 天。「方案合进主干就被忘掉」不是风险，是
 * 已经发生的事实。而当时的应对是「PR 先不合」——那只是把待办挪进一个更差的队列：
 * 不可搜索（本轮两次重复造轮子都由此而来）、会烂、方案之间无法互相引用。
 *
 * 设计要点：
 * 1. 登记制。只有文件里带状态标记的才进现役区。没标记 = 未登记 = 不打扰。
 *    这样账本盯的是「我们真正在欠的债」，不是 400 篇历史文件。
 * 2. committed 产物只含「状态 + 标题 + 路径」，**不含日期**——否则内容随时间漂，
 *    --check 门岗会天天翻红。停滞天数由 --brief 在读的时候现算。
 * 3. 手工维护的清单一定会漂（本仓已证三次：README 说 64 篇 / INDEX 说 71 篇 /
 *    实际 397 篇），所以本文件全量生成，禁止手改。
 *
 * 用法：
 *   node scripts/build-delivery-ledger.mjs            # 生成 docs/DELIVERY-LEDGER.md
 *   node scripts/build-delivery-ledger.mjs --check    # 门岗：产物是否与源同步
 *   node scripts/build-delivery-ledger.mjs --brief    # 给 hook 用：一行提醒 + top N
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  collectPlanDocuments,
  documentStatus,
  documentTitle,
  OPEN_STATUSES,
  DEFERRED_STATUSES,
  CLOSED_STATUSES,
  STATUS_LABEL,
} from './doc-status-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = path.join(repoRoot, 'docs/DELIVERY-LEDGER.md')
const BRIEF_TOP_N = 3

function readDocuments() {
  return collectPlanDocuments(repoRoot).map((relativePath) => {
    const text = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    const { status } = documentStatus(text)
    return { relativePath, status, title: documentTitle(text, relativePath) }
  })
}

/** 最后一次改动日期（git 权威；取不到就返回 null，不猜）。 */
function lastTouchedDays(relativePath) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', relativePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!out) return null
    return Math.floor((Date.now() / 1000 - Number(out)) / 86400)
  } catch {
    return null
  }
}

function section(title, rows, emptyNote) {
  const lines = [`## ${title}`, '']
  if (rows.length === 0) {
    lines.push(emptyNote, '')
    return lines
  }
  lines.push('| 状态 | 文档 | 标题 |', '|---|---|---|')
  for (const row of rows) {
    const href = path.relative(path.dirname(OUTPUT), path.join(repoRoot, row.relativePath)).split(path.sep).join('/')
    lines.push(`| ${row.status} ${STATUS_LABEL[row.status]} | [${path.basename(row.relativePath)}](${href}) | ${row.title} |`)
  }
  lines.push('')
  return lines
}

function monthBuckets(documents) {
  // 只做「按月计数」，不倾倒 400 行清单——目的是给一个分批分诊的抓手。
  const counts = new Map()
  for (const doc of documents) {
    const match = /(\d{4})-(\d{2})-\d{2}/.exec(path.basename(doc.relativePath))
    const key = match ? `${match[1]}-${match[2]}` : '无日期'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

function render(documents) {
  const byStatus = (list) => documents
    .filter((doc) => list.includes(doc.status))
    .sort((a, b) => list.indexOf(a.status) - list.indexOf(b.status) || a.relativePath.localeCompare(b.relativePath))

  const open = byStatus(OPEN_STATUSES)
  const deferred = byStatus(DEFERRED_STATUSES)
  const closed = documents.filter((doc) => CLOSED_STATUSES.includes(doc.status))
  const unregistered = documents.filter((doc) => doc.status === null)

  const lines = [
    '# 交付账本 — 已拍板但没交付的，都在这',
    '',
    '> 🚧 长期维护 · **本文件由 `scripts/build-delivery-ledger.mjs` 生成，禁止手改。**',
    '> 改状态请改各方案文档开头的状态标记，再跑 `pnpm run gen:ledger`；`check:ledger` 在 gates 链里拦漂移。',
    '',
    '**登记制**：只有文件开头带状态标记的方案才进现役区。没标记 = 未登记 = 不打扰你。',
    '要把一篇旧方案拉进来盯，就给它开头加一行状态；确认不做就标 `⛔` 并写明被谁取代；',
    '远期但不砍的标 `🧊`——它会被列出来，但不会每天催你。',
    '',
    '---',
    '',
    ...section(
      `现役欠账（${open.length}）`,
      open,
      '_当前没有登记在案的欠账。_',
    ),
    ...section(
      `远期 / 暂缓（${deferred.length}）`,
      deferred,
      '_没有标记为远期的方案。_',
    ),
    '## 其余',
    '',
    `- **已结案**：${closed.length} 篇（✅ 已交付 / ⛔ 已废弃 / 📎 交接日志）`,
    `- **未登记存量**：${unregistered.length} 篇。这些是历史文件，**有意不进现役区**——其中很多离得很远、或已经不需要做。`,
    '  想分诊就挑一篇加状态标记；不分诊也不会有人催。`check:doc-status` 只拦**新增**文档缺标记，不逼你清存量。',
    '',
    ...(unregistered.length === 0 ? [] : [
      '<details>',
      `<summary>按月份看这 ${unregistered.length} 篇存量（点开，便于分批分诊）</summary>`,
      '',
      '| 月份 | 篇数 |',
      '|---|---:|',
      ...monthBuckets(unregistered).map(([month, count]) => `| ${month} | ${count} |`),
      '',
      '</details>',
      '',
    ]),
    `- 合计扫描：${documents.length} 篇方案文档（docs/plan/ 与 docs/superpowers/plans/，不含 INDEX.md）`,
    '',
    '---',
    '',
    '## 怎么让它每天顶到眼前',
    '',
    '账本躺着没人看就等于没有——`docs/plan/INDEX.md` 的状态列就是前车之鉴：数据一直都在，',
    '37 篇停滞 60 天+ 照样发生。**salience 才是关键。**',
    '',
    '本仓已有验证过的机制：L0 hook（`.claude/hooks/self-check.sh`，每条消息自动注入）。',
    '把下面一行加进去，每轮开头就会看到欠账：',
    '',
    '```sh',
    '# 交付账本提醒（现役欠账 + 最久停滞）。失败不阻塞，静默跳过。',
    'node "$CLAUDE_PROJECT_DIR/scripts/build-delivery-ledger.mjs" --brief 2>/dev/null || true',
    '```',
    '',
    '> `.claude/` 被 gitignore，hook 不随 git 走——换机 / 新 worktree 需手动补。',
    '> 不想动 hook 就手跑：`pnpm run ledger:brief`。',
    '',
  ]
  return lines.join('\n')
}

function brief(documents) {
  const open = documents.filter((doc) => OPEN_STATUSES.includes(doc.status))
  if (open.length === 0) return '交付账本：当前没有登记在案的欠账。'
  const aged = open
    .map((doc) => ({ ...doc, days: lastTouchedDays(doc.relativePath) }))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1))
  const top = aged.slice(0, BRIEF_TOP_N)
    .map((doc) => `${doc.status}${path.basename(doc.relativePath, '.md')}${doc.days === null ? '' : `(${doc.days}d)`}`)
    .join(' · ')
  const oldest = aged[0]?.days
  const oldestText = oldest === null || oldest === undefined ? '' : `，最久停滞 ${oldest} 天`
  return `交付账本：现役欠账 ${open.length} 篇${oldestText} → ${top}（全量见 docs/DELIVERY-LEDGER.md）`
}

const documents = readDocuments()

if (process.argv.includes('--brief')) {
  console.log(brief(documents))
  process.exit(0)
}

const expected = render(documents)

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
  // 逐行比较行尾无关内容：工作区行尾由 .gitattributes 钉成 LF，但仍按内容比对更稳。
  if (actual.split(/\r?\n/).join('\n') === expected.split(/\r?\n/).join('\n')) {
    const open = documents.filter((doc) => OPEN_STATUSES.includes(doc.status)).length
    console.log(`✅ 交付账本同步：现役欠账 ${open} 篇，共扫描 ${documents.length} 篇方案`)
    process.exit(0)
  }
  console.error('✖ 交付账本已过期：某篇方案的状态标记变了，但 docs/DELIVERY-LEDGER.md 没重生成')
  console.error('  → 跑 `pnpm run gen:ledger` 后提交（本文件是生成物，不要手改）')
  process.exit(1)
}

fs.writeFileSync(OUTPUT, expected)
const open = documents.filter((doc) => OPEN_STATUSES.includes(doc.status)).length
console.log(`✅ 已生成 docs/DELIVERY-LEDGER.md：现役欠账 ${open} 篇，共扫描 ${documents.length} 篇方案`)
