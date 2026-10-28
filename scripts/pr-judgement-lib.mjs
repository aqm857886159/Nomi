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

import { knownScenarios, loadScenarios, parsePerfEvidence } from './perf-scenarios-lib.mjs'
import { compareBoardManifests } from './check-board-parity.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const ROUTING_FILE = 'docs/engineering/test-routing.json'
export const CARD_SECTION = '功能分类'
export const EVIDENCE_SECTION = '验收证据'
export const SCOPE_SECTION = '碰到的规则与门岗'
export const INTENT_SECTION = '变更意图'
export const PROCESS_TIER_EFFECTIVE_FROM = '2026-10-28T00:00:00+08:00'

export const PROCESS_TIERS = Object.freeze({ SHORT: 'short', STANDARD: 'standard', STRICT: 'strict' })

export function processTieringEnforced(createdAt = null, enforce = false) {
  if (enforce || !createdAt) return true
  const time = new Date(createdAt).getTime()
  if (!Number.isFinite(time)) return true
  const start = new Date(PROCESS_TIER_EFFECTIVE_FROM).getTime()
  if (!Number.isFinite(start)) return true
  return time >= start
}

const INTENT_LINE = /^\s*[-*]?\s*(?:意图|intent)\s*[:：]\s*(.+)$/i
const CANDIDATE_TIER_LINE = /^\s*[-*]?\s*(?:候选档位|档位|tier)\s*[:：]\s*(.+)$/i
const SINGLE_INTENT_LINE = /^\s*[-*]?\s*(?:单一意图|single intent)\s*[:：]\s*(.+)$/i
const UI_ASSERTION_LINE = /^\s*[-*]?\s*(?:界面核实|ui 核实|ui verification)\s*[:：]\s*(.+)$/i
const PURE_FIX_DECLARATION = /纯修复\s*[:：]\s*不改用户可见(?:元素|内容)?、?\s*布局、?\s*文案/
const SHORT_WORD = /^(?:短|short|s)$/i
const STANDARD_WORD = /^(?:标准|standard|normal|中)$/i
const STRICT_WORD = /^(?:严|严格|strict|full)$/i
const UI_SOURCE = /^(?:src\/.*\.(?:tsx|ts|css|scss)|electron\/.*\.(?:tsx|ts|css|scss))$/i
const UI_MANIFEST = /^docs\/design\/boards\//i
const NON_PRODUCT = /^(?:docs\/.*|tests?\/.*|evals\/.*|\.github\/.*|scripts\/.*|fixtures\/.*|(?:[^/]+\.(?:md|json|ya?ml|toml|lock|txt))|.*\.(?:test|spec|e2e)\.[^.]+)$/i

function normalizeTier(value) {
  const text = String(value ?? '').trim()
  if (SHORT_WORD.test(text)) return PROCESS_TIERS.SHORT
  if (STANDARD_WORD.test(text)) return PROCESS_TIERS.STANDARD
  if (STRICT_WORD.test(text)) return PROCESS_TIERS.STRICT
  return null
}

/** PR 正文 `## 变更意图` 的唯一解析器。缺字段即 unknown，unknown 永远不能短档。 */
export function parseChangeIntent(body) {
  const section = extractSection(body, INTENT_SECTION)
  if (section === null) return { present: false, intent: null, candidateTier: null, singleIntent: false, uiAssertion: null, pureFix: false, reason: '缺少变更意图一节' }
  const lines = section.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const intent = lines.map((line) => INTENT_LINE.exec(line)?.[1]?.trim()).find(Boolean) ?? null
  const candidateRaw = lines.map((line) => CANDIDATE_TIER_LINE.exec(line)?.[1]?.trim()).find(Boolean) ?? null
  const singleRaw = lines.map((line) => SINGLE_INTENT_LINE.exec(line)?.[1]?.trim()).find(Boolean) ?? null
  const uiAssertion = lines.map((line) => UI_ASSERTION_LINE.exec(line)?.[1]?.trim()).find(Boolean) ?? null
  const pureFix = PURE_FIX_DECLARATION.test(section)
  const intentKind = intent && /纯文档|文档|测试|配置|pure\s+(?:docs?|tests?|config)/i.test(intent) ? 'non-product' : intent && /纯修复|bugfix|fix/i.test(intent) ? 'pure-fix' : intent ? 'other' : null
  const singleIntent = singleRaw ? /^(?:是|yes|true|单一|single)$/i.test(singleRaw) : false
  return {
    present: true,
    intent,
    intentKind,
    candidateRaw,
    candidateTier: normalizeTier(candidateRaw),
    singleIntent,
    uiAssertion,
    pureFix,
    reason: !intent ? '变更意图缺少意图' : !candidateRaw ? '变更意图缺少候选档位' : !singleRaw ? '变更意图缺少单一意图声明' : !singleIntent ? '变更意图不是单一意图' : null,
  }
}

/**
 * 界面候选文件的保守判定。只要产品源文件变了，必须拿到 base/head 清单；
 * 文档、测试、配置和门岗自身不需要假装有 UI 证据。
 */
export function deriveUiVerification({ files = [], baseBoards = null, headBoards = null, explicit = null } = {}) {
  if (explicit && typeof explicit === 'object') return explicit
  const normalized = files.map((file) => norm(file.path))
  const uiFiles = normalized.filter((file) => UI_SOURCE.test(file) || UI_MANIFEST.test(file))
  const productUiFiles = uiFiles.filter((file) => !NON_PRODUCT.test(file))
  if (!productUiFiles.length) return { known: true, changed: false, reason: '改动没有界面候选文件' }
  const base = typeof baseBoards === 'function' ? baseBoards() : baseBoards
  const head = typeof headBoards === 'function' ? headBoards() : headBoards
  const compared = compareBoardManifests(base, head)
  if (!compared.known) return { known: false, changed: null, reason: `${compared.reason}；界面候选文件有改动` }
  return { ...compared, reason: `${compared.reason}；界面候选文件：${productUiFiles.slice(0, 5).join('、')}${productUiFiles.length > 5 ? ' …' : ''}` }
}

const NO_UI_DIFF = /无(?:界面|UI)差异|no\s+ui\s+diff/i

/**
 * 三档判定的唯一实现。
 *   · 严：现行四类（花钱 / 长跑 / 可打断 / 新界面）。直接读 inferRoutes 的 fourClass，不另写第二套判据，也没有别的升严来源；声明降不了档。
 *   · 短：四类之外，且 ① 没写 `## 变更意图`、文件清单自证全是纯文档 / 测试 / 配置；或 ② 声明了单一意图的纯修复（或纯文档 / 测试 / 配置）、
 *     写明「界面核实：无界面差异」，base/head 界面清单也核实无差异。让逃逸账本条目转 fixed 的 PR 永远不进短档。
 *   · 标准：其余，也就是今天四类之外的全部要求。声明了短档但核实有差异、核实不了，一律落在这里，不升严。
 * uiVerification 可以是值，也可以是函数：只有声明短档的 PR 才调用，别的 PR 不为它去读拍板图清单；取数抛错按核实不了算。
 * shortAllowed=false：规则生效前开的 PR 不适用短档。
 */
export function evaluateProcessTier({ body, files = [], inferred, ledgerTransitions = [], uiVerification = null, shortAllowed = true } = {}) {
  const declaration = parseChangeIntent(body)
  if (inferred?.fourClass) {
    const note = declaration.candidateTier === PROCESS_TIERS.SHORT ? '；声明短档不生效，四类不能降档' : ''
    return { tier: PROCESS_TIERS.STRICT, declaration, autoShort: false, uiVerification: null, failures: [], lines: [`· 流程档位：严（四类命中：${(inferred.classes ?? []).join('、')}${note}）`] }
  }

  // 文件清单本身已经能证明纯文档 / 测试 / 配置改动没有产品入口，这类 PR 不必为了新规则补一段意图声明。
  const nonProductOnly = files.length > 0 && files.every((file) => NON_PRODUCT.test(norm(file.path)))
  const autoShort = !declaration.present && nonProductOnly
  const declaredShort = declaration.candidateTier === PROCESS_TIERS.SHORT
  const failures = []
  if (!shortAllowed) failures.push('规则生效前开的 PR，不适用短档')
  if (ledgerTransitions.length) failures.push(`让逃逸账本条目转 fixed（${ledgerTransitions.join('、')}），不进短档`)
  let ui = null
  if (declaredShort) {
    if (!declaration.singleIntent) failures.push(declaration.reason || '不是单一意图')
    if (!declaration.pureFix && declaration.intentKind !== 'non-product') failures.push('声明不是纯修复 / 纯文档 / 测试 / 配置')
    if (!declaration.uiAssertion || !NO_UI_DIFF.test(declaration.uiAssertion)) failures.push('缺少“界面核实：无界面差异”声明')
    if (!failures.length) {
      try { ui = typeof uiVerification === 'function' ? uiVerification() : uiVerification } catch (error) { ui = { known: false, changed: null, reason: `取数失败：${error?.message ?? error}` } }
      if (!ui || typeof ui !== 'object' || ui.known !== true) failures.push(`界面差异核实不了（${ui?.reason || '没有 base/head 界面清单核实'}）`)
      else if (ui.changed !== false) failures.push(`界面清单有差异（${ui.reason || 'base/head 拍板图清单不一致'}）`)
    }
  }
  const wantsShort = autoShort || declaredShort
  const short = wantsShort && failures.length === 0
  const lines = []
  if (short) lines.push(autoShort ? '· 流程档位：短（未写变更意图，文件清单自动核实为纯文档 / 测试 / 配置）' : `· 流程档位：短（声明单一意图的纯修复 / 纯文档 / 测试 / 配置；${ui.reason}）`)
  else if (wantsShort) lines.push(`· 流程档位：标准（短档不成立：${failures.join('；')}）`)
  else lines.push('· 流程档位：标准（四类之外的其余改动，沿用今天的全部要求）')
  if (declaration.candidateTier === PROCESS_TIERS.STRICT) lines.push('· 候选档位「严」只是声明：严档只由四类命中判定')
  return { tier: short ? PROCESS_TIERS.SHORT : PROCESS_TIERS.STANDARD, declaration, autoShort, uiVerification: ui, failures, lines }
}

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
  // category 可以是数组（2026-10-11：界面 / 画布 / 长跑改动同时落进「新增功能 / 性能」类，性能证据只在 perf 类定义一份）；四类的 legacy 标签只记一次
  const addAll = (category, legacy, file) => [].concat(category).forEach((id, index) => add(id, index === 0 ? legacy : undefined, file))
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
      if (rule.re.test(p)) addAll(rule.category, rule.legacy, p)
    }
  }
  const abort = table.abortSignal
  // 和路径判据同一个范围：只认产品代码里的新增（门岗脚本 / 文档里「提到」AbortController 不是可打断功能）
  const abortScope = abort?.scope ? new RegExp(abort.scope) : null
  const perFile = files.some((file) => typeof file.added === 'string')
  const scanned = perFile
    ? files.filter((file) => typeof file.added === 'string' && !TEST_FILE.test(norm(file.path)) && (!abortScope || abortScope.test(norm(file.path)))).map((file) => file.added).join('\n')
    : addedLines
  if (abort && new RegExp(abort.pattern).test(scanned)) addAll(abort.category, abort.legacy, '(diff 新增 AbortController)')
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

/** 性能场景证据的 id（2026-10-11）：不走通用的「有链接就算」，要有数字、id 在登记表里，「未验证」不算通过（docs/engineering/perf-scenarios.md）。 */
export const PERF_EVIDENCE_ID = 'perf-scenario'
/** 性能证据行的判据。known = knownScenarios 的结果；problems 非空（取不到 / 坏了 / 结构不合格）时，非「不适用」的性能行一律红（fail-closed）。 */
const perfVerdictFor = (known, options = {}) => (line) => {
  const verdict = parsePerfEvidence(line, known.ids, known.byId, options)
  if (known.problems.length && verdict.ok && !verdict.notApplicable) return { ok: false, reason: `场景登记表核对不了：${known.problems.join('；')}` }
  return verdict
}

/** 一行证据条目算不算数：有报告链接 / 路径 / 截图 / 运行号 / PR 号，或明写「未验证：原因」。 */
export function evidenceLineVerdict(line) {
  const unverified = UNVERIFIED.exec(line)
  if (unverified && unverified[1].trim().length >= 2) return { ok: true, unverified: true, reason: unverified[1].trim() }
  if (EVIDENCE_TOKEN.some((pattern) => pattern.test(line))) return { ok: true, unverified: false }
  return { ok: false }
}

/**
 * 真付费抽检证据的严格判据（2026-10-16，合并前扫描专用）。
 *
 * 为什么单拎：通用的 `evidenceLineVerdict` 对每个证据项都接受「未验证：原因」，也接受任何一个 PR 号 / 路径 / 链接。
 * 对别的证据那是合理的（工具没建、本次不适用），对「花钱类 PR 合并前要有真付费抽检」却等于没有门：
 * #1203（Agent 权限两档 + 两刹车，花钱类）写了一行「未验证」，合并前扫描绿、CI 绿、被合并循环合入，真付费验收被跳过。
 * 花钱类的真付费门槛只写在文字里（docs/engineering/delivery-and-review.md），没有门岗。
 *
 * 严格口径：这一行必须以 `spend-paid-sample：` 开头（别名不算），后面是
 *   · 运行号 / 报告链接 / 报告路径（真付费抽检跑过的凭据）；或
 *   · `协调豁免：<理由>`（协调会话明示豁免，理由至少 3 个字；扫描会把它醒目地打在报告里）。
 * 「未验证」不接受；裸 PR 号（`#1203`）不接受——PR 号证明不了谁跑过真付费。
 */
export const PAID_SAMPLE_EVIDENCE_ID = 'spend-paid-sample'
const PAID_SAMPLE_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?spend-paid-sample(?:\*\*)?\s*[:：]\s*(.*)$/i
const PAID_SAMPLE_WAIVER = /协调豁免\s*[:：]\s*(\S.{2,})/
const PAID_SAMPLE_PROOF = [
  /https?:\/\/\S+/,
  /(?:docs|reports?|artifacts|evals)[\\/][\w@./\\+-]+\.(?:md|json|txt)\b/i,
  /(?:run|运行号?|actions\/runs)\D{0,3}\d{5,}/i,
]
export const isPaidSampleLine = (line) => PAID_SAMPLE_LINE.test(String(line))
export function paidSampleVerdict(line) {
  const head = PAID_SAMPLE_LINE.exec(String(line))
  if (!head) return { ok: false, reason: `要以「${PAID_SAMPLE_EVIDENCE_ID}：」开头一行（别名不算）` }
  const rest = head[1]
  const waiver = PAID_SAMPLE_WAIVER.exec(rest)
  if (waiver) return { ok: true, waived: true, reason: waiver[1].trim() }
  if (/未验证/.test(rest)) return { ok: false, reason: '花钱类 PR 不接受「未验证」：要真付费抽检的运行号 / 报告链接，或「协调豁免：<理由>」' }
  if (PAID_SAMPLE_PROOF.some((pattern) => pattern.test(rest))) return { ok: true }
  return { ok: false, reason: '没有运行号 / 报告链接 / 报告路径（裸 PR 号不算），也不是「协调豁免：<理由>」' }
}

/**
 * 必交证据 = 各类别要求的并集，只含 when = "pr" 的（每个 PR 按功能分类跑；paid 的在 PR 上只要求正文交证据、不在 CI 自动跑）。
 * when = "manual-full" 的只在用户手动触发的全量跑里跑，PR 正文不要求（用 manualFullEvidence 列出来）。
 */
/** 工具还没建：tool 写 missing，或写计划接的工具名加 (planned)（例：stagehand (planned)）。 */
export const isMissingTool = (tool) => tool === 'missing' || /\(planned\)$/.test(String(tool || ''))

export function requiredEvidence(categoryIds, table = loadRoutingTable(), createdAt = null) {
  // since：这条证据的生效日（ISO 日期）；更早开的 PR 没机会照新模板写，不要求（创建时间未知 = 要求，fail-closed）
  return collectEvidence(categoryIds, table).filter((item) => item.when !== 'manual-full' && !(item.since && createdAt && new Date(createdAt) < new Date(`${item.since}T00:00:00Z`)))
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
export function checkRoutingEvidence(body, categoryIds, table = loadRoutingTable(), createdAt = null, scenarios = null, { paidStrict = false, readRaw = null } = {}) {
  // scenarios：调用方（CI / 合并前扫描）用 knownScenarios 算好的已知场景；不传 = 按当前检出（只给单测直接调用用）
  const known = scenarios ?? knownScenarios({ baseEntries: loadScenarios(repoRoot) })
  const required = requiredEvidence(categoryIds, table, createdAt)
  // 证据判「对不对」（2026-10-22 起开的 PR）：性能证据要读原始结果、核数字，不再是「有一行就算」
  const perfOptions = { strict: evidenceJudgementEnforced(table, createdAt), readRaw }
  const manualFull = manualFullEvidence(categoryIds, table)
  const manualNote = manualFull.length ? [`· 手动全量跑覆盖（PR 正文不要求）：${manualFull.map((item) => item.id).join('、')}`] : []
  if (required.length === 0) return { ok: true, lines: ['· 验收证据：没有类别要求证据', ...manualNote], gaps: [] }
  const section = extractSection(body, EVIDENCE_SECTION)
  const sectionLines = (section ?? '').split('\n').filter((line) => line.trim())
  const missing = []
  const bad = []
  const gaps = []
  const perfReasons = []
  const paidReasons = []
  const paidNotes = []
  let provided = 0
  let unverifiedCount = 0
  for (const item of required) {
    const tokens = [item.id, ...(item.aliases ?? [])]
    const strictPaid = paidStrict && item.id === PAID_SAMPLE_EVIDENCE_ID
    const mine = strictPaid
      ? sectionLines.filter(isPaidSampleLine)
      : sectionLines.filter((line) => tokens.some((token) => line.toLowerCase().includes(token.toLowerCase())))
    if (!mine.length) {
      missing.push(item)
      if (strictPaid) paidReasons.push('合并前扫描要求花钱类 PR 有一行 `spend-paid-sample：<运行号 / 报告链接>` 或 `spend-paid-sample：协调豁免：<理由>`（别名不算，未验证不算）')
      continue
    }
    const verdicts = mine.map(strictPaid ? paidSampleVerdict : item.id === PERF_EVIDENCE_ID ? perfVerdictFor(known, perfOptions) : evidenceLineVerdict)
    const good = verdicts.find((verdict) => verdict.ok)
    if (!good) {
      bad.push(item)
      if (item.id === PERF_EVIDENCE_ID) perfReasons.push(...verdicts.map((verdict) => verdict.reason).filter(Boolean))
      if (strictPaid) paidReasons.push(...verdicts.map((verdict) => verdict.reason).filter(Boolean))
      continue
    }
    if (strictPaid && good.waived) paidNotes.push(`⚠ ${PAID_SAMPLE_EVIDENCE_ID}：协调豁免——${good.reason}（没有真付费抽检；豁免理由请协调会话合并前再看一眼）`)
    provided += 1
    if (good.unverified) {
      unverifiedCount += 1
      if (isMissingTool(item.tool)) gaps.push({ category: item.category, id: item.id, label: item.label, toolRef: item.toolRef })
    }
  }
  const lines = []
  let ok = true
  // 取不到 / 坏了的场景登记表：有性能证据要求时，直接红并说清原因（不等到逐行判）
  if (known.problems.length && required.some((item) => item.id === PERF_EVIDENCE_ID)) {
    ok = false
    lines.push(...known.problems.map((problem) => `✖ 场景登记表：${problem}`))
  }
  if (missing.length || bad.length) {
    ok = false
    if (missing.length) lines.push(`✖ \`## ${EVIDENCE_SECTION}\` 缺这些证据条目：${missing.map((item) => `${item.id}（${item.label}）`).join('；')}`)
    if (bad.length) lines.push(`✖ 这些证据条目没有报告链接 / 运行号 / 截图路径，也没写「未验证：原因」：${bad.map((item) => item.id).join('、')}`)
    for (const reason of new Set(perfReasons)) lines.push(`  → ${PERF_EVIDENCE_ID}：${reason}`)
    for (const reason of new Set(paidReasons)) lines.push(`  → ${PAID_SAMPLE_EVIDENCE_ID}：${reason}`)
    lines.push(`  → 每项一行：\`- <证据 id>：<链接 / 运行号 / 截图路径>\` 或 \`- <证据 id>：未验证：原因\`；工具还没建的证据写「未验证：工具未建」`)
  } else {
    lines.push(`✅ 验收证据：${required.length} 项都有条目（实证 ${provided - unverifiedCount}，未验证 ${unverifiedCount}）`)
  }
  for (const gap of gaps) lines.push(`⚠ 缺工具：${gap.id}（${gap.label}）——${gap.toolRef}`)
  lines.push(...paidNotes)
  lines.push(...manualNote)
  return { ok, lines, gaps }
}

/** 整个路由判据：card + evidence。 */
export function checkRouting(body, inferred, table = loadRoutingTable(), createdAt = null, scenarios = null, options = {}) {
  const card = checkRoutingCard(body, inferred, table)
  const evidence = checkRoutingEvidence(body, card.union, table, createdAt, scenarios, options)
  return { ok: card.ok && evidence.ok, lines: [...card.lines, ...evidence.lines], gaps: evidence.gaps, categories: card.union }
}

/**
 * 证据判「对不对」的生效日（2026-10-21 起，流程试行第 3 项）：独立验收看报告结论 / 验收 HEAD / 验收线、性能证据读原始结果、改界面认领拍板图清单。
 * 生效日写在路由政策表的 evidenceJudgement.effectiveFrom（CI 取 base 版本，PR 不能自己放宽）；此日期之前开的 PR 不追溯；
 * 表里没有这一节 = 规则还没上线；创建时间未知 = 按生效处理（fail-closed）。
 */
export function evidenceJudgementEnforced(table, createdAt = null) {
  const from = table?.evidenceJudgement?.effectiveFrom
  if (!from) return false
  if (!createdAt) return true
  const created = new Date(createdAt).getTime()
  const start = new Date(`${from}T00:00:00Z`).getTime()
  // 日期读不懂（非法值）按已生效：不能让「写个坏日期」变成关掉严格口径的开关（S5）
  if (!Number.isFinite(created) || !Number.isFinite(start)) return true
  return created >= start
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
export function evaluatePrJudgement({ body, files: rawFiles, addedLines = '', addedByFile = null, packageRemovedLines = [], ledgerRemovedIds = [], createdAt = null, table = undefined, scenarios = null, paidStrict = false, readRaw = null }) {
  // table 缺省 = 检出里的政策表（合并前扫描的检出即 main）；CI 必须显式传 base 上的表，PR 不能放宽自己的路由要求
  table = table ?? loadRoutingTable()
  const files = addedByFile ? rawFiles.map((file) => ({ ...file, added: addedByFile.get(file.path) ?? '' })) : rawFiles
  const inferred = inferRoutes(files, addedLines, table)
  const routing = checkRouting(body, inferred, table, createdAt, scenarios, { paidStrict, readRaw })
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
