// PR 正文判据的**唯一实现**（2026-10-06）：按功能分类决定测试路由 + 规则与门岗的改动范围。
// 合并前扫描（scripts/merge-preflight.mjs，协调会话那一道）和 CI（pnpm run check:pr-judgement，Contracts 里）调用同一份，
// 判据只留这一处——#1033 的「规则与门岗改动范围」原先只在 merge-preflight 里，CI 拦不住，现在挪到这里。
//
// 路由表：docs/engineering/test-routing.json（唯一一份）。四类（花钱 / 长跑 / 可打断 / 新界面）的路径判定也在表里（pathRules.legacy），
// 不另起一套。类别可多选，必交证据取并集；路径推出的类别是下限——设计卡「功能分类」里勾的只能比它多，不能比它少。
// 每个类别要求的证据，PR 正文 `## 验收证据` 里要有对应条目（报告链接 / 运行号 / 截图路径），或明写「未验证：原因」；
// 工具还没建的证据（tool: missing）接受「未验证：工具未建」，同时把缺口列出来，免得缺工具变成永久豁免。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const ROUTING_FILE = 'docs/engineering/test-routing.json'
export const CARD_SECTION = '功能分类'
export const EVIDENCE_SECTION = '验收证据'
export const SCOPE_SECTION = '碰到的规则与门岗'

export function loadRoutingTable(root = repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(root, ROUTING_FILE), 'utf8'))
}

const TEST_FILE = /\.(?:test|spec)\.[^.]+$|\.node-test\.[cm]?js$|(?:^|\/)(?:tests?|__tests__)\//
const norm = (value) => String(value || '').split('\\').join('/')

/** 取 `## 标题`（或 `### 标题`）到下一个同级或更高级标题之间的正文；没有这一节返回 null。 */
export function extractSection(body, heading) {
  const lines = String(body || '').split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^#{2,3}\\s+${heading}\\s*$`).test(line.trim()))
  if (start < 0) return null
  const level = /^#+/.exec(lines[start].trim())[0].length
  const out = []
  for (const line of lines.slice(start + 1)) {
    const m = /^(#{1,6})\s+/.exec(line)
    if (m && m[1].length <= level) break
    out.push(line)
  }
  return out.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
}

/** unified diff 文本 → Map(文件路径 → 该文件的新增行文本)。AbortController 这类「看内容」的判据要按文件排除测试，不能整个 diff 一起扫。 */
export function addedLinesByFile(diffText) {
  const out = new Map()
  for (const block of String(diffText || '').split(/^diff --git /m).slice(1)) {
    const lines = block.split(/\r?\n/)
    const header = /^a\/(.+?) b\/(.+)$/.exec(lines[0] ?? '')
    if (!header) continue
    out.set(header[2], lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n'))
  }
  return out
}

/**
 * 路径 + diff 新增行 → 类别（下限）与四类。files: [{ path, status, added? }]，status 'A' 表示新增；
 * added = 该文件的新增行文本（见 addedLinesByFile）。AbortController 只在**非测试文件**的新增行里认——
 * 测试里为了造取消场景写 new AbortController 不是「可打断」功能（#1038 误判）。files 都没带 added 时，退回整段 addedLines（旧用法）。
 */
export function inferRoutes(files, addedLines = '', table = loadRoutingTable()) {
  const hits = []
  const byCategory = new Map()
  const add = (category, legacy, file) => {
    byCategory.set(category, [...(byCategory.get(category) ?? []), file])
    if (legacy) hits.push({ cls: legacy, path: file })
  }
  const rules = (table.pathRules ?? []).map((rule) => ({
    ...rule,
    re: new RegExp(rule.pattern, 'i'),
    scopeRe: rule.scope ? new RegExp(rule.scope) : null,
    excludeRe: rule.exclude ? new RegExp(rule.exclude) : null,
  }))
  for (const file of files) {
    const p = norm(file.path)
    if (TEST_FILE.test(p) || p.endsWith('.md') || p.endsWith('.json')) continue
    for (const rule of rules) {
      if (rule.scopeRe && !rule.scopeRe.test(p)) continue
      if (rule.excludeRe && rule.excludeRe.test(p)) continue
      if (rule.added && file.status !== 'A') continue
      if (rule.re.test(p)) add(rule.category, rule.legacy, p)
    }
  }
  const abort = table.abortSignal
  // 和路径判据同一个范围：只认产品代码里的新增（门岗脚本 / 文档里「提到」AbortController 不是可打断功能）
  const abortScope = abort?.scope ? new RegExp(abort.scope) : null
  const perFile = files.some((file) => typeof file.added === 'string')
  const scanned = perFile
    ? files.filter((file) => typeof file.added === 'string' && !TEST_FILE.test(norm(file.path)) && (!abortScope || abortScope.test(norm(file.path)))).map((file) => file.added).join('\n')
    : addedLines
  if (abort && new RegExp(abort.pattern).test(scanned)) add(abort.category, abort.legacy, '(diff 新增 AbortController)')
  const classes = [...new Set(hits.map((hit) => hit.cls))]
  const categories = [...byCategory.entries()].map(([id, paths]) => ({ id, label: table.categories[id]?.label ?? id, paths: [...new Set(paths)] }))
  return { fourClass: classes.length > 0, classes, hits, categories }
}

const CHECKED_BOX = /^\s*[-*]\s*(?:\[[xX✓✔]\]|☑|✅)/

/** 一个类别在「功能分类」一节里被识别的所有写法：id、完整标签、标签按「 / 」拆开的每一段。 */
function categoryTokens(id, table) {
  const label = table.categories[id]?.label ?? id
  return [id, label, ...label.split('/').map((part) => part.trim())].filter((token) => token.length >= 2)
}

/** 设计卡「功能分类」：路径推出的类别必须都勾了；勾的可以更多。返回 { ok, lines, checked, union }。 */
export function checkRoutingCard(body, inferred, table = loadRoutingTable()) {
  const inferredIds = inferred.categories.map((category) => category.id)
  const section = extractSection(body, CARD_SECTION)
  const lines = []
  const checked = []
  if (section !== null) {
    const boxLines = section.split('\n').filter((line) => CHECKED_BOX.test(line))
    for (const id of Object.keys(table.categories)) {
      if (boxLines.some((line) => categoryTokens(id, table).some((token) => line.includes(token)))) checked.push(id)
    }
  }
  let ok = true
  if (inferredIds.length === 0) {
    lines.push('· 功能分类：改动路径没有推出任何类别（纯文档 / 测试 / 配置改动）')
  } else if (section === null) {
    ok = false
    lines.push(`✖ 缺 \`## ${CARD_SECTION}\` 一节：改动路径推出了 ${inferred.categories.map((c) => `${c.label}（${c.paths.slice(0, 2).join('、')}${c.paths.length > 2 ? ' …' : ''}）`).join('；')}，要在设计卡里勾上（可多选，勾的只能比推出的多）`)
  } else {
    const missing = inferredIds.filter((id) => !checked.includes(id))
    if (missing.length) {
      ok = false
      lines.push(`✖ 功能分类只许比路径推出的多、不许少：路径推出了「${missing.map((id) => table.categories[id].label).join('」「')}」，卡上没勾（用 \`- [x] 类别名\` 勾选）`)
    } else {
      lines.push(`✅ 功能分类：路径推出的 ${inferredIds.length} 类都勾了${checked.length > inferredIds.length ? `（另多勾 ${checked.length - inferredIds.length} 类）` : ''}`)
    }
  }
  const union = [...new Set([...inferredIds, ...checked])]
  return { ok, lines, checked, union }
}

const UNVERIFIED = /未验证\s*[:：]\s*(\S.*)/
const EVIDENCE_TOKEN = [
  /https?:\/\/\S+/,
  /(?:docs|tests|artifacts|evals)\/[\w@./+-]+/,
  /[\w@./+-]+\.(?:png|jpe?g|webp|gif|mp4)\b/i,
  /(?:run|运行号?|actions\/runs)\D{0,3}\d{5,}/i,
  /#\d{2,}/,
]

/** 一行证据条目算不算数：有报告链接 / 路径 / 截图 / 运行号 / PR 号，或明写「未验证：原因」。 */
export function evidenceLineVerdict(line) {
  const unverified = UNVERIFIED.exec(line)
  if (unverified && unverified[1].trim().length >= 2) return { ok: true, unverified: true, reason: unverified[1].trim() }
  if (EVIDENCE_TOKEN.some((pattern) => pattern.test(line))) return { ok: true, unverified: false }
  return { ok: false }
}

/**
 * 必交证据 = 各类别要求的并集，只含 when = "pr" 的（每个 PR 按功能分类跑；paid 的在 PR 上只要求正文交证据、不在 CI 自动跑）。
 * when = "manual-full" 的只在用户手动触发的全量跑里跑，PR 正文不要求（用 manualFullEvidence 列出来）。
 */
/** 工具还没建：tool 写 missing，或写计划接的工具名加 (planned)（例：stagehand (planned)）。 */
export const isMissingTool = (tool) => tool === 'missing' || /\(planned\)$/.test(String(tool || ''))

export function requiredEvidence(categoryIds, table = loadRoutingTable()) {
  return collectEvidence(categoryIds, table).filter((item) => item.when !== 'manual-full')
}

export function manualFullEvidence(categoryIds, table = loadRoutingTable()) {
  return collectEvidence(categoryIds, table).filter((item) => item.when === 'manual-full')
}

function collectEvidence(categoryIds, table) {
  const seen = new Map()
  for (const id of categoryIds) {
    for (const item of table.categories[id]?.evidence ?? []) if (!seen.has(item.id)) seen.set(item.id, { ...item, category: id })
  }
  return [...seen.values()]
}

/** `## 验收证据`：逐项对账。返回 { ok, lines, gaps }；gaps = 被「未验证」带过、且工具还没建的缺口。 */
export function checkRoutingEvidence(body, categoryIds, table = loadRoutingTable()) {
  const required = requiredEvidence(categoryIds, table)
  const manualFull = manualFullEvidence(categoryIds, table)
  const manualNote = manualFull.length ? [`· 手动全量跑覆盖（PR 正文不要求）：${manualFull.map((item) => item.id).join('、')}`] : []
  if (required.length === 0) return { ok: true, lines: ['· 验收证据：没有类别要求证据', ...manualNote], gaps: [] }
  const section = extractSection(body, EVIDENCE_SECTION)
  const sectionLines = (section ?? '').split('\n').filter((line) => line.trim())
  const missing = []
  const bad = []
  const gaps = []
  let provided = 0
  let unverifiedCount = 0
  for (const item of required) {
    const tokens = [item.id, ...(item.aliases ?? [])]
    const mine = sectionLines.filter((line) => tokens.some((token) => line.toLowerCase().includes(token.toLowerCase())))
    if (!mine.length) { missing.push(item); continue }
    const verdicts = mine.map(evidenceLineVerdict)
    const good = verdicts.find((verdict) => verdict.ok)
    if (!good) { bad.push(item); continue }
    provided += 1
    if (good.unverified) {
      unverifiedCount += 1
      if (isMissingTool(item.tool)) gaps.push({ category: item.category, id: item.id, label: item.label, toolRef: item.toolRef })
    }
  }
  const lines = []
  let ok = true
  if (missing.length || bad.length) {
    ok = false
    if (missing.length) lines.push(`✖ \`## ${EVIDENCE_SECTION}\` 缺这些证据条目：${missing.map((item) => `${item.id}（${item.label}）`).join('；')}`)
    if (bad.length) lines.push(`✖ 这些证据条目没有报告链接 / 运行号 / 截图路径，也没写「未验证：原因」：${bad.map((item) => item.id).join('、')}`)
    lines.push(`  → 每项一行：\`- <证据 id>：<链接 / 运行号 / 截图路径>\` 或 \`- <证据 id>：未验证：原因\`；工具还没建的证据写「未验证：工具未建」`)
  } else {
    lines.push(`✅ 验收证据：${required.length} 项都有条目（实证 ${provided - unverifiedCount}，未验证 ${unverifiedCount}）`)
  }
  for (const gap of gaps) lines.push(`⚠ 缺工具：${gap.id}（${gap.label}）——${gap.toolRef}`)
  lines.push(...manualNote)
  return { ok, lines, gaps }
}

/** 整个路由判据：card + evidence。 */
export function checkRouting(body, inferred, table = loadRoutingTable()) {
  const card = checkRoutingCard(body, inferred, table)
  const evidence = checkRoutingEvidence(body, card.union, table)
  return { ok: card.ok && evidence.ok, lines: [...card.lines, ...evidence.lines], gaps: evidence.gaps, categories: card.union }
}

/** 生效时间：此日期之前开的 PR 只警告；创建时间未知 = 按生效处理（fail-closed）。 */
export function routingEnforced(createdAt, table = loadRoutingTable()) {
  if (!createdAt || !table.effectiveFrom) return true
  return new Date(createdAt) >= new Date(`${table.effectiveFrom}T00:00:00Z`)
}

// ── 规则与门岗的改动范围（#1033，2026-10-05；2026-10-06 从 merge-preflight 挪到这里，CI 也跑）──────────────
// #1032 事故：一张只该换截图基线的卡，提交里混进本地旧文件，把刚合入的 #1031 整个回退——CLAUDE.md、rules.json、
// 八个门岗脚本、逃逸账本，44 个文件删 752 行。判据：碰到下面这些路径的 PR，正文 `## 碰到的规则与门岗` 一节必须逐个点名；
// 整文件删除那一行还要写「删除」和理由。逃逸账本另算：条目只许变多或改状态，不许消失。
export const PROTECTED_PATHS = [
  /^(?:CLAUDE|AGENTS)\.md$/,
  /^docs\/engineering-rules\.md$/,
  /^docs\/engineering\/(?:rules\.json|rules\.md|experience-system\.md|design-card\.md|test-routing\.json|self-written\.json)$/,
  /^docs\/engineering\/concept-owners\/[^/]+$/,
  /^scripts\/(?:check-[^/]+|run-gates[^/]*|merge-preflight[^/]*|experience-full-run[^/]*|validation-policy[^/]*|git-delivery[^/]*|[^/]+-lib\.mjs|[^/]*baseline[^/]*\.json)$/,
  /^scripts\/claude-hooks\//,
  /^\.github\/workflows\//,
  /^\.claude\/settings[^/]*\.json$/,
]
/**
 * 一条一个文件的登记目录（2026-10-07 概念登记从单个 concept-owners.json 拆成目录）：保护的单位仍是「这本登记」，
 * 正文点名目录（或具体文件）就算点名了，和原来点名那一个文件同一个强度；删掉其中一个文件照旧要写「删除：理由」。
 */
export const PROTECTED_DIRECTORIES = ['docs/engineering/concept-owners/']
const mentionKeys = (file) => [file, ...PROTECTED_DIRECTORIES.filter((dir) => file.startsWith(dir))]
/** package.json 里被删掉的一行（已去掉 diff 的「-」前缀）是不是门岗命令。 */
const GATE_SCRIPT_LINE = /^"(?:gates|check):[^"]*"\s*:/
const isRemoved = (status) => status === 'removed' || status === 'D'

/** files: [{ path, status: 'added' | 'modified' | 'removed' | 'renamed' | 'A' | 'M' | 'D' }]；packageRemovedLines: package.json 里被删的行。 */
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
    const keys = mentionKeys(file.path)
    const mentions = sectionLines.filter((line) => keys.some((key) => line.includes(key)))
    if (!mentions.length) { missing.push(isRemoved(file.status) ? `${file.path}（整文件删除）` : file.path); continue }
    if (isRemoved(file.status) && !mentions.some((line) => /删除\s*[：:—-]\s*\S/.test(line))) missing.push(`${file.path}（整文件删除，要写「删除：理由」）`)
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

/**
 * CI 与合并前扫描共用的整体判据（路由 + 规则与门岗范围）。
 * 路由部分受 effectiveFrom 宽限（旧 PR 只警告）；规则与门岗范围不吃宽限——#1032 这种回退正是旧分支带出来的。
 */
export function evaluatePrJudgement({ body, files: rawFiles, addedLines = '', addedByFile = null, packageRemovedLines = [], ledgerRemovedIds = [], createdAt = null, table = loadRoutingTable() }) {
  const files = addedByFile ? rawFiles.map((file) => ({ ...file, added: addedByFile.get(file.path) ?? '' })) : rawFiles
  const inferred = inferRoutes(files, addedLines, table)
  const routing = checkRouting(body, inferred, table)
  const enforced = routingEnforced(createdAt, table)
  const softened = enforced ? routing.lines : routing.lines.map((line) => line.replace(/^✖/, '⚠'))
  if (!enforced) softened.push(`· 这个 PR 在路由规则生效（${table.effectiveFrom}）之前开的：缺项只给警告，不判红`)
  const scope = checkProtectedScope(body, files, { packageRemovedLines, ledgerRemovedIds })
  return {
    inferred,
    routing: { ...routing, lines: softened, enforced, blocking: enforced && !routing.ok },
    scope,
    blocked: !scope.ok || (enforced && !routing.ok),
  }
}

/** 体检报告用：路由表里所有「工具还没建」的缺口。 */
export function toolGaps(table = loadRoutingTable()) {
  const gaps = []
  for (const [category, def] of Object.entries(table.categories)) {
    for (const item of def.evidence ?? []) if (isMissingTool(item.tool)) gaps.push({ category, id: item.id, label: item.label, toolRef: item.toolRef })
  }
  for (const item of table.layerToolGaps ?? []) gaps.push({ category: '(层)', id: item.id, label: item.label, toolRef: item.toolRef })
  return gaps
}
