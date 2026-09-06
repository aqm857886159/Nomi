#!/usr/bin/env node
/**
 * 调研来源门岗（advisory）：调研文档必须有「自媒体来源」一节，并引用 tikhub 附件。
 *
 * ── 它防的是什么 ──
 * 调研班的默认信息面只有论文和英文技术博客——那两层讲的是「能做到什么」，
 * 讲「真做的人卡在哪」的中文自媒体那一层从来没进过输入（手册 §15）。
 * 缺这一层不会让任何测试变红、不会让任何门岗报错，它只是**安静地让每份调研
 * 都少一只眼睛**。这道门岗就是那只眼睛的机器化提醒。
 *
 * ── 为什么是 advisory 不是硬拦 ──
 * 「这次该不该查自媒体」是判断题，不是正确性题：纯内部架构调研上自媒体确实没信号。
 * 硬拦会逼人写一节假的来过门——那比没有这节更糟。所以判据设计成
 * **明写「本次没用 TikHub，因为 X」也算达标**，只有静默省掉才报。
 * 在 `gates:contracts` 里降级为 advisory（失败出 warning 不阻断）；
 * 直接跑本脚本仍然 fail-closed（exit 1），这样它才能当断言用。
 *
 * ── 棘轮 ──
 * `scripts/research-sources-baseline.json` 记录**具体路径**（不是裸数字）：
 * 裸数字会允许「补齐一篇旧的、同时新增一篇不合规的」蒙混过关。基线只减不增。
 *
 * 用法：node scripts/check-research-sources.mjs [--update-baseline]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const researchRoot = path.join(repoRoot, 'docs', 'research')
const baselinePath = path.join(repoRoot, 'scripts', 'research-sources-baseline.json')

/** 只看开头这么多行找 H1——H1 在别处出现的话那也不是标题。 */
export const TITLE_SCAN_LINES = 40

/**
 * 哪些文档算「调研文档」。
 *
 * 判据是**标题**而不是路径：`docs/research/` 下混着日报、索引、附件包 README 和真调研。
 * 只有标题自称调研/research 的才是这道门要管的东西。
 */
export function isResearchTitle(title) {
  return /调研|research/iu.test(title ?? '')
}

/**
 * 明确豁免的文件名形状——每条都要写清楚理由，这是本门岗唯一的逃生口。
 */
const EXEMPT_BASENAMES = [
  // 每日论文雷达由 `nomi-research-radar` 技能按固定方向表生成，信息面是 arxiv，
  // 不是「针对某个问题的调研」；要求它每天写一节自媒体来源只会产出每天一句废话。
  /-radar\.md$/u,
]

function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectMarkdown(file))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file)
  }
  return files.sort()
}

/** 从正文判定：有没有「自媒体来源」一节 + 有没有引用 tikhub 附件。 */
export function inspectContent(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const title = (lines.slice(0, TITLE_SCAN_LINES).find((line) => /^#\s+/u.test(line)) ?? '').replace(/^#\s+/u, '').trim()
  const hasSection = lines.some((line) => /^#{2,4}\s.*自媒体来源/u.test(line))
  const mentionsTikhub = /tikhub/iu.test(text ?? '')
  const reasons = []
  if (!hasSection) reasons.push('缺「自媒体来源」一节')
  if (!mentionsTikhub) reasons.push('没引用 tikhub 附件（docs/research/<date>-<topic>/tikhub/）')
  return { title, hasSection, mentionsTikhub, reasons }
}

/** 扫全树，返回 { checked, violations }。violations 的身份是仓库相对路径。 */
export function scanResearchDocs(root, { titleMatcher = isResearchTitle, relativeTo = repoRoot } = {}) {
  const checked = []
  const violations = []
  for (const file of collectMarkdown(root)) {
    const base = path.basename(file)
    if (EXEMPT_BASENAMES.some((pattern) => pattern.test(base))) continue
    const text = fs.readFileSync(file, 'utf8')
    const report = inspectContent(text)
    if (!titleMatcher(report.title)) continue
    const relative = path.relative(relativeTo, file).split(path.sep).join('/')
    checked.push(relative)
    if (report.reasons.length > 0) violations.push({ file: relative, reasons: report.reasons })
  }
  return { checked, violations }
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return []
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const list = baseline.documentsWithoutSocialSources
  if (!Array.isArray(list) || list.some((value) => typeof value !== 'string')) {
    console.error('✖ scripts/research-sources-baseline.json 的 documentsWithoutSocialSources 必须是路径字符串数组')
    process.exit(1)
  }
  return list
}

function writeBaseline(paths) {
  fs.writeFileSync(baselinePath, `${JSON.stringify({
    _comment: [
      '调研来源棘轮基线：只减不增。',
      '扫描 docs/research/**/*.md 中标题含「调研 / research」的文档（*-radar.md 豁免）。',
      '这些是本门岗立项之前就存在的历史文档；新增调研文档必须带「自媒体来源」一节并引用 tikhub 附件，',
      '不能追加到本数组。补齐一篇就从这里删一行。',
    ],
    documentsWithoutSocialSources: paths,
  }, null, 2)}\n`)
}

function main() {
  const update = process.argv.includes('--update-baseline')
  const { checked, violations } = scanResearchDocs(researchRoot)
  const offenders = violations.map((violation) => violation.file)

  if (update) {
    writeBaseline(offenders)
    console.log(`✅ 已写入基线：${offenders.length} 篇历史调研文档（共扫描 ${checked.length} 篇）`)
    return 0
  }

  const baseline = readBaseline()
  const baselineSet = new Set(baseline)
  const added = violations.filter((violation) => !baselineSet.has(violation.file))
  const fixed = baseline.filter((file) => !offenders.includes(file))

  if (added.length > 0) {
    console.error(`⚠️ ${added.length} 篇调研文档缺自媒体来源（advisory：不阻断，但请补上）：\n`)
    for (const violation of added) {
      console.error(`  · ${violation.file}`)
      console.error(`    ${violation.reasons.join(' / ')}`)
    }
    console.error('\n补法：抄 docs/research/TEMPLATE.md 的「### 2.3 自媒体来源（TikHub · 必填）」一节。')
    console.error('跑：node scripts/research/tikhub-search.mjs --q "<关键词>" --out docs/research/<date>-<topic>/tikhub/')
    console.error('这次确实用不上自媒体？在那一节里明写「本次没用 TikHub，因为 X」——明说也算达标，静默省掉才不算。')
    console.error('详见 docs/engineering/agent-orchestration-playbook.md §15。')
    return 1
  }

  if (fixed.length > 0) {
    console.error(`✖ 基线过期：这 ${fixed.length} 篇已经补齐了，请跑 --update-baseline 把它们从基线里删掉：`)
    for (const file of fixed) console.error(`  · ${file}`)
    return 1
  }

  console.log(`✅ 调研来源门岗：扫描 ${checked.length} 篇调研文档，${baseline.length} 篇历史存量（基线只减不增）`)
  return 0
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
if (invokedDirectly) process.exit(main())
