#!/usr/bin/env node
// 合并前扫描（协调会话的工具，2026-10-02）。输入 PR 号，用 gh 读 PR 正文和改动文件，只打印结论，**不合并**。
// 它取代原来的交工前评审收据：不再问「有没有跑过评审」，而是问两个暂停点有没有真的发生——
//   ① 暂停点①设计卡：PR 正文 `## 设计卡` 是否填全（四类 9 格，其余只查 ★ 格 1、2、3、4、9）；
//   ② 暂停点②独立验收：四类的 PR 正文 `## 独立验收` 是否带报告链接，且验收线编号不同于实现线；
//   ③ 本 PR 把逃逸账本条目转成 fixed 时，有没有带 detected_by 的根因合同（判据看账本状态转换，不看正文用词）。
// 判四类的字符串规则与设计卡模板末尾那段一致（docs/engineering/design-card.md），宁可多报；误报由协调会话人工划掉。
//
// 用法：node scripts/merge-preflight.mjs <PR 号> [--repo owner/name]
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ESCAPE_LEDGER_FILE, fixedTransitions } from './escape-ledger-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const STAR_CELLS = [1, 2, 3, 4, 9]
export const ALL_CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const FOUR_CLASS_RULES = [
  { name: '花钱', pattern: /(?:^|\/)(?:spend[^/]*|[^/]*pricing[^/]*|[^/]*variant[^/]*|[^/]*credits[^/]*|[^/]*charge[^/]*|generationScheduler[^/]*)$/i, scope: /^(?:src|electron)\// },
  { name: '长跑', pattern: /(?:^|\/)[^/]*(?:task|queue|production|retriev|export|import)[^/]*$/i, scope: /^(?:src|electron)\// },
  { name: '可打断', pattern: /(?:^|\/)[^/]*(?:cancel|resume|stop|abort)[^/]*$/i, scope: /^(?:src|electron)\// },
]

const TEST_FILE = /\.(?:test|spec)\.[^.]+$|\.node-test\.[cm]?js$|(?:^|\/)(?:tests?|__tests__)\//

/** files: [{ path, status }]；addedLines: diff 里新增行的文本（用来认 AbortController）。 */
export function classifyChange(files, addedLines = '') {
  const hits = []
  for (const file of files) {
    const p = file.path
    if (TEST_FILE.test(p) || p.endsWith('.md') || p.endsWith('.json')) continue
    for (const rule of FOUR_CLASS_RULES) {
      if (rule.scope.test(p) && rule.pattern.test(p)) hits.push({ cls: rule.name, path: p })
    }
    if (/^src\/design\//.test(p)) hits.push({ cls: '新界面', path: p })
    if (/^src\/.*\.tsx$/.test(p) && file.status === 'A') hits.push({ cls: '新界面', path: p })
  }
  if (/\bnew\s+AbortController\b|\bAbortSignal\b/.test(addedLines)) hits.push({ cls: '可打断', path: '(diff 新增 AbortController)' })
  const classes = [...new Set(hits.map((hit) => hit.cls))]
  return { fourClass: classes.length > 0, classes, hits }
}

/** 取 `## 标题` 到下一个同级标题之间的正文；没有这一节返回 null。 */
export function extractSection(body, heading) {
  const lines = String(body || '').split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`).test(line.trim()))
  if (start < 0) return null
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break
    out.push(line)
  }
  return out.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
}

const PLACEHOLDER = /^(?:待填|待定|tbd|todo|\.{2,}|…+|-+|n\/a)$/i

/** 在设计卡正文里找格 n（★n / n 开头的行或表格行），返回该格的内容（去掉标签）；找不到返回 null。 */
export function cellContent(section, n) {
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*|\\|\\s*)?(?:★\\s*)?${n}(?![0-9])[\\s.:：、|]*(.*)$`)
  for (const line of String(section || '').split(/\r?\n/)) {
    const match = pattern.exec(line)
    if (!match) continue
    // 表格行：把行内的格分隔去掉，最后一列之前的标题也算内容的一部分——只要标签之后有实质字符就算填了
    const rest = match[1].replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
    return rest
  }
  return null
}

/** 一格是否「填了」：标签之后除了问题标题还有实质内容，或明写「不适用：理由」。 */
export function cellFilled(content) {
  if (content === null) return false
  if (PLACEHOLDER.test(content)) return false
  const na = /不适用\s*[:：]\s*(\S.*)/.exec(content)
  if (na) return na[1].trim().length >= 2
  // 只有标签（如「用户怎么用」「谁说了算」）没有后文，不算填
  return content.replace(/^\S{1,8}\s*/, '').trim().length >= 6 || content.length >= 14
}

export function checkDesignCard(body, { fourClass }) {
  const section = extractSection(body, '设计卡')
  const required = fourClass ? ALL_CELLS : STAR_CELLS
  if (section === null) return { ok: false, lines: [`✖ PR 正文没有 \`## 设计卡\` 一节（${fourClass ? '四类，9 格' : '★ 格 1、2、3、4、9'}）`] }
  const link = /https?:\/\/\S+|docs\/\S+\.md/.exec(section)
  const missing = required.filter((n) => !cellFilled(cellContent(section, n)))
  if (missing.length === 0) return { ok: true, lines: [`✅ 设计卡：${required.length} 格都填了`] }
  if (link && missing.length === required.length) {
    return { ok: true, lines: [`⚠ 设计卡只放了链接（${link[0]}），格子内容要人工到链接里核对（${required.join('、')}）`] }
  }
  return { ok: false, lines: [`✖ 设计卡缺格：${missing.join('、')}（要求：${fourClass ? '四类 9 格全填' : '★ 格 1、2、3、4、9'}；确实不适用写「不适用：理由」）`] }
}

/** 实现线编号：设计卡里的「线/负责人：X」或正文里的「实现线：X」。 */
export function implementationLine(body) {
  const match = /(?:实现线|线\/负责人)\s*[:：]\s*([^，,；;|\r\n]+)/.exec(String(body || ''))
  return match ? match[1].trim() : null
}

export function checkIndependentAcceptance(body) {
  const section = extractSection(body, '独立验收')
  if (section === null) return { ok: false, lines: ['✖ 四类改动缺 `## 独立验收` 一节（报告链接 + 验收线编号）'] }
  const lines = []
  let ok = true
  if (!/https?:\/\/\S+|docs\/\S+\.md/.test(section)) {
    ok = false
    lines.push('✖ 独立验收没有带报告链接')
  }
  const verifier = /验收线\s*(?:编号)?\s*[:：]\s*([^，,；;|\r\n]+)/.exec(section)
  if (!verifier) {
    ok = false
    lines.push('✖ 独立验收没写验收线编号（格式：验收线：<编号>）')
  } else {
    const implementer = implementationLine(body)
    const verifierId = verifier[1].trim()
    if (!implementer) lines.push(`⚠ 验收线 ${verifierId}：正文里没找到实现线编号（设计卡「线/负责人」或「实现线：」），无法核对是否同一条，请人工核`)
    else if (implementer === verifierId) {
      ok = false
      lines.push(`✖ 验收线编号 ${verifierId} 和实现线相同——验收必须另一条线做`)
    } else lines.push(`✅ 验收线 ${verifierId} ≠ 实现线 ${implementer}`)
  }
  if (ok && lines.every((line) => !line.startsWith('✖'))) lines.unshift('✅ 独立验收：带报告链接和验收线编号')
  return { ok, lines }
}

/**
 * 逃逸 bug 的判据（2026-10-06）：不再看正文有没有「逃逸 / 用户反馈 / 发版后」这几个词（两头都出错：
 * 正文提到「逃逸账本」被误判成修逃逸 bug，#1026 修用户反馈却没写这几个词被漏掉），
 * 改看**逃逸账本里的状态转换**：本 PR 让某条逃逸 candidate / reviewed → fixed，才要求带根因合同。
 * 转换怎么算只有一份实现：scripts/escape-ledger-lib.mjs 的 fixedTransitions（check:escape-ledger 同源）。
 *
 * contracts: [{ file, detected_by }]，来自本 PR 新增 / 改动的 docs/fixes/*.root-cause.json；
 * transitions: 本 PR 变成 fixed 的账本条目 id；body 里提到的账本条目 id 没转换只给提示。
 */
export function checkEscapeContract(body, contracts, transitions = [], ledgerIds = []) {
  const withField = contracts.filter((contract) => ['user', 'post-release', 'walkthrough', 'ci', 'review'].includes(contract.detected_by))
  const userFound = contracts.filter((contract) => ['user', 'post-release'].includes(contract.detected_by))
  const mentioned = ledgerIds.filter((id) => String(body || '').includes(id) && !transitions.includes(id))
  const hint = mentioned.length ? [`· 正文提到了账本条目 ${mentioned.join('、')}，但本 PR 没把它们改成 fixed——只是引用，不要求合同`] : []
  if (transitions.length === 0 && userFound.length === 0) {
    return { applicable: false, ok: true, lines: ['· 本 PR 没有让任何逃逸账本条目转成 fixed，合同检查跳过', ...hint] }
  }
  if (transitions.length === 0) {
    return { applicable: true, ok: false, lines: [`✖ 根因合同声明 detected_by 为用户 / 发版后发现（${userFound.map((contract) => contract.file).join('、')}），但本 PR 没有把对应的逃逸账本条目（tests/ux/full-walk/escapeLedger.json）转成 fixed——用户发现的问题要进账本并带类级检查结账`] }
  }
  if (withField.length === 0) {
    return { applicable: true, ok: false, lines: [`✖ 本 PR 把逃逸账本条目 ${transitions.join('、')} 转成 fixed，但没带含 detected_by 的根因合同（docs/fixes/*.root-cause.json）`] }
  }
  return { applicable: true, ok: true, lines: [`✅ 逃逸账本 ${transitions.join('、')} → fixed：带了含 detected_by 的合同（${withField.map((contract) => contract.file).join('、')}）`, ...hint] }
}

/**
 * 规则生效时刻 = 引入本套规则的 PR（#961）的合并时间。比它更早开的 PR（#947、#962 等）没有机会照新模板写，
 * 只给警告、不判红。参考 PR 还没合并 = 规则尚未生效，所有开着的 PR 都只警告。
 */
export const RULES_INTRODUCED_BY_PR = 961
/**
 * ④ 规则与门岗的改动范围（2026-10-05，#1032 事故：一张只该换截图基线的卡，提交里混进本地旧文件，
 * 把刚合入的 #1031 整个回退——CLAUDE.md、rules.json、八个门岗脚本、逃逸账本，44 个文件删 752 行）。
 * 判据：碰到下面这些路径的 PR，正文 `## 碰到的规则与门岗` 一节必须逐个点名；整文件删除那一行还要写「删除」和理由。
 * 不靠审的人眼尖——没点名就红。逃逸账本另算：条目只许变多或改状态，不许消失。
 */
export const PROTECTED_PATHS = [
  /^(?:CLAUDE|AGENTS)\.md$/,
  /^docs\/engineering-rules\.md$/,
  /^docs\/engineering\/(?:rules\.json|rules\.md|experience-system\.md|design-card\.md|self-written\.json|concept-owners\.json)$/,
  /^scripts\/(?:check-[^/]+|run-gates[^/]*|merge-preflight[^/]*|validation-policy[^/]*|git-delivery[^/]*|[^/]+-lib\.mjs|[^/]*baseline[^/]*\.json)$/,
  /^scripts\/claude-hooks\//,
  /^\.github\/workflows\//,
  /^\.claude\/settings[^/]*\.json$/,
]
export const SCOPE_SECTION = '碰到的规则与门岗'
/** package.json 里被删掉的一行（已去掉 diff 的「-」前缀）是不是门岗命令。 */
const GATE_SCRIPT_LINE = /^"(?:gates|check):[^"]*"\s*:/

/** files: [{ path, status: 'added' | 'modified' | 'removed' | 'renamed' }]；packageRemovedLines: package.json 里被删的行。 */
export function checkProtectedScope(body, files, { packageRemovedLines = [], ledgerRemovedIds = [] } = {}) {
  const touched = files.filter((file) => PROTECTED_PATHS.some((pattern) => pattern.test(file.path)))
  const gateLinesRemoved = packageRemovedLines.filter((line) => GATE_SCRIPT_LINE.test(line.trim()))
  if (gateLinesRemoved.length) touched.push({ path: 'package.json', status: 'modified', gateLines: gateLinesRemoved })
  const lines = []
  let ok = true
  if (ledgerRemovedIds.length) {
    ok = false
    lines.push(`✖ 逃逸账本里有条目被删掉：${ledgerRemovedIds.join('、')}（条目只许新增或改状态；多半是分支带着旧账本把别人的记录覆盖了）`)
  }
  if (!touched.length) {
    lines.push('· 没碰规则与门岗文件')
    return { ok, lines }
  }
  const section = extractSection(body, SCOPE_SECTION) ?? ''
  const sectionLines = section.split('\n')
  const missing = []
  for (const file of touched) {
    const mentions = sectionLines.filter((line) => line.includes(file.path))
    if (!mentions.length) { missing.push(file.status === 'removed' ? `${file.path}（整文件删除）` : file.path); continue }
    if (file.status === 'removed' && !mentions.some((line) => /删除\s*[：:—-]\s*\S/.test(line))) missing.push(`${file.path}（整文件删除，要写「删除：理由」）`)
    if (file.gateLines && !mentions.some((line) => /删除|移除|去掉|改名/.test(line))) missing.push('package.json（删掉了门岗命令，要写清删了哪个、为什么）')
  }
  if (missing.length) {
    ok = false
    lines.push(`✖ 碰到规则 / 门岗文件但正文 \`## ${SCOPE_SECTION}\` 没点名：${missing.slice(0, 8).join('、')}${missing.length > 8 ? ` 等 ${missing.length} 个` : ''}`)
    lines.push('  → 是本意就逐个写进那一节（删整文件写「删除：理由」）；不是本意就是分支带了旧文件，先 `git diff --stat origin/main...HEAD` 核对再重做')
  } else {
    lines.push(`✅ 规则与门岗：碰到 ${touched.length} 个，正文都点名了`)
  }
  return { ok, lines }
}

export function isGrandfathered({ createdAt, effectiveAt }) {
  if (!effectiveAt) return true
  if (!createdAt) return false
  return new Date(createdAt) < new Date(effectiveAt)
}

export function renderReport({ pr, classification, design, acceptance, escape, scope = { ok: true, lines: [] }, grandfathered = false }) {
  const lines = [`合并前扫描 · PR #${pr}`]
  lines.push(classification.fourClass
    ? `· 四类：命中（${classification.classes.join('、')}）——${classification.hits.slice(0, 5).map((hit) => hit.path).join('、')}${classification.hits.length > 5 ? ' …' : ''}`
    : '· 四类：未命中，只查设计卡 ★ 格')
  const soften = (list) => (grandfathered ? list.map((line) => line.replace(/^✖/, '⚠')) : list)
  lines.push(...soften(design.lines))
  if (classification.fourClass) lines.push(...soften(acceptance.lines))
  lines.push(...soften(escape.lines))
  // 规则与门岗的改动范围不吃「规则生效前开的 PR」那条宽限：#1032 这种回退正是旧分支带出来的。
  lines.push(...scope.lines)
  if (grandfathered) lines.push('· 这是规则生效（#961 合并）之前开的 PR：缺项只给警告，不判红')
  const blocked = !scope.ok || (!grandfathered && (!design.ok || (classification.fourClass && !acceptance.ok) || !escape.ok))
  lines.push(blocked ? '结论：✖ 有项没过，先别合（脚本只打印结论，不合并）' : '结论：✅ 扫描干净（脚本只打印结论，不合并；其余合并条件仍看 CI 与收据）')
  return { text: lines.join('\n'), blocked }
}

function gh(args, { repo } = {}) {
  const full = repo ? [...args, '--repo', repo] : args
  return execFileSync('gh', full, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function ghApiFile(repoSlug, filePath, ref) {
  try {
    const raw = execFileSync('gh', ['api', `repos/${repoSlug}/contents/${filePath}?ref=${ref}`, '--jq', '.content'], { cwd: repoRoot, encoding: 'utf8' })
    return Buffer.from(raw.replace(/\s/g, ''), 'base64').toString('utf8')
  } catch {
    return null
  }
}

export function main(argv = process.argv.slice(2)) {
  const prArg = argv.find((arg) => /^\d+$/.test(arg))
  const repoIndex = argv.indexOf('--repo')
  const repo = repoIndex >= 0 ? argv[repoIndex + 1] : undefined
  if (!prArg) {
    console.error('用法：node scripts/merge-preflight.mjs <PR 号> [--repo owner/name]')
    return 2
  }
  const view = JSON.parse(gh(['pr', 'view', prArg, '--json', 'body,files,headRefOid,baseRefName,headRepository,headRepositoryOwner,createdAt'], { repo }))
  const files = (view.files ?? []).map((file) => ({ path: file.path, status: file.additions > 0 && file.deletions === 0 ? 'A' : 'M' }))
  let diff = ''
  try {
    diff = gh(['pr', 'diff', prArg], { repo })
  } catch {
    diff = ''
  }
  const addedLines = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n')
  const classification = classifyChange(files, addedLines)
  const body = view.body ?? ''

  const slug = repo ?? (view.headRepositoryOwner?.login && view.headRepository?.name ? `${view.headRepositoryOwner.login}/${view.headRepository.name}` : null)
  const contracts = []
  for (const file of files.filter((entry) => /^docs\/fixes\/.+\.root-cause\.json$/.test(entry.path))) {
    const text = slug ? ghApiFile(slug, file.path, view.headRefOid) : null
    try {
      contracts.push({ file: file.path, detected_by: text ? JSON.parse(text).detected_by : undefined })
    } catch {
      contracts.push({ file: file.path, detected_by: undefined })
    }
  }

  // 逃逸账本的状态转换：只有本 PR 改了账本才去取两版（base 取当前基线分支末端）
  const ledger = { transitions: [], ids: [], removed: [] }
  if (slug && files.some((file) => file.path === ESCAPE_LEDGER_FILE)) {
    const parse = (text) => { try { return text ? JSON.parse(text) : null } catch { return null } }
    const head = parse(ghApiFile(slug, ESCAPE_LEDGER_FILE, view.headRefOid))
    const base = parse(ghApiFile(slug, ESCAPE_LEDGER_FILE, view.baseRefName || 'main'))
    ledger.transitions = fixedTransitions(base, head)
    ledger.ids = (head?.entries ?? []).map((entry) => entry.id)
    const headIds = new Set(ledger.ids)
    ledger.removed = (base?.entries ?? []).map((entry) => entry.id).filter((id) => !headIds.has(id))
  }

  // 规则与门岗的改动范围：要真实的文件状态（removed / modified），gh pr view 的 files 只给增删行数
  let statusFiles = files.map((file) => ({ path: file.path, status: 'modified' }))
  const baseSlug = repo ?? slug
  if (baseSlug) {
    try {
      statusFiles = gh(['api', `repos/${baseSlug}/pulls/${prArg}/files`, '--paginate', '--jq', '.[] | [.filename, .status] | @tsv'])
        .split('\n').filter(Boolean).map((row) => { const [path, status] = row.split('\t'); return { path, status } })
    } catch { /* 取不到状态就按 modified 算：漏判整文件删除，但点名要求照旧 */ }
  }
  const packageBlock = diff.split(/^diff --git /m).find((block) => block.startsWith('a/package.json b/package.json')) ?? ''
  const packageRemovedLines = packageBlock.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1))

  let effectiveAt = null
  try {
    effectiveAt = JSON.parse(gh(['pr', 'view', String(RULES_INTRODUCED_BY_PR), '--json', 'mergedAt'], { repo })).mergedAt || null
  } catch {
    effectiveAt = null
  }
  const report = renderReport({
    pr: prArg,
    grandfathered: Number(prArg) !== RULES_INTRODUCED_BY_PR && isGrandfathered({ createdAt: view.createdAt, effectiveAt }),
    classification,
    design: checkDesignCard(body, classification),
    acceptance: checkIndependentAcceptance(body),
    escape: checkEscapeContract(body, contracts, ledger.transitions, ledger.ids),
    scope: checkProtectedScope(body, statusFiles, { packageRemovedLines, ledgerRemovedIds: ledger.removed }),
  })
  console.log(report.text)
  return report.blocked ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
