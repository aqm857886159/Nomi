// PR 正文判据库（2026-10-08）：设计卡格子 / 独立验收 / 逃逸账本转 fixed 须带 detected_by 合同 / 规则生效宽限 / 整体裁决。
// 推送前（scripts/check-pr-judgement.mjs，pre-push 钩子经 scripts/pre-push-contracts.mjs 调，CI Contracts 同一个入口）
// 与合并前扫描（scripts/merge-preflight.mjs）都调这一份——#1094 的形状：设计卡不是 ★ 格式、detected_by 写错，
// 推送时放行、合并时才红，是因为两边各有一套口径。判据只此一处，两边同标准。
// 路由 / 规则与门岗范围仍在 scripts/pr-judgement-lib.mjs（本模块在它之上叠设计卡等判据，并给一个总入口 evaluatePrBody）。
import { escapeIdOfPath, fixedTransitions } from './escape-ledger-lib.mjs'
import { evaluatePrJudgement, extractSection, inferRoutes } from './pr-judgement-lib.mjs'

/** 四类（花钱 / 长跑 / 可打断 / 新界面）——路由表里 pathRules.legacy 的那部分；files: [{ path, status }]，status 'A' = 新增。 */
export function classifyChange(files, addedLines = '') {
  const { fourClass, classes, hits } = inferRoutes(files, addedLines)
  return { fourClass, classes, hits }
}

export const STAR_CELLS = [1, 2, 3, 4, 9]
export const ALL_CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9]


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

/** 判据只认中文标题；英文写法（`## Design card`）当「没写」，但点明原因，别让人对着已经写了的一节找半天。 */
const ENGLISH_HEADINGS = {
  设计卡: /^#{2,3}\s+design[\s-]*card\s*$/im,
  独立验收: /^#{2,3}\s+independent[\s-]*(?:acceptance|verification|review)\s*$/im,
}
export const englishHeadingHint = (body, heading) =>
  (ENGLISH_HEADINGS[heading]?.test(String(body || '')) ? `（正文里是英文标题，判据只认中文标题 \`## ${heading}\`，请改成中文）` : '')

export function checkDesignCard(body, { fourClass }) {
  const section = extractSection(body, '设计卡')
  const required = fourClass ? ALL_CELLS : STAR_CELLS
  if (section === null) return { ok: false, lines: [`✖ PR 正文没有 \`## 设计卡\` 一节（${fourClass ? '四类，9 格' : '★ 格 1、2、3、4、9'}）${englishHeadingHint(body, '设计卡')}`] }
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

/**
 * 判据跑在哪一步：'push'（推送前钩子）或 'merge'（CI 的 check:pr-judgement、合并前扫描）。
 * 独立验收的报告要等分支推上去、验收线跑完才有，推送时只能写「待出」——推送前只提醒，CI / 合并前照旧要链接。
 * CI 里一律按 'merge'：继承来的环境变量不能在那里放宽判据。
 */
export function resolveJudgementStage(env = process.env) {
  if (env.CI) return 'merge'
  return env.NOMI_PR_JUDGEMENT_STAGE === 'push' ? 'push' : 'merge'
}

export function checkIndependentAcceptance(body, { stage = 'merge' } = {}) {
  const section = extractSection(body, '独立验收')
  if (section === null) return { ok: false, lines: [`✖ 四类改动缺 \`## 独立验收\` 一节（报告链接 + 验收线编号）${englishHeadingHint(body, '独立验收')}`] }
  const lines = []
  let ok = true
  if (!/https?:\/\/\S+|docs\/\S+\.md/.test(section)) {
    if (stage === 'push') lines.push('⚠ 独立验收还没有报告链接：推送时允许（报告要推送后才有），CI 的 check:pr-judgement 与合并前扫描会一直红到补上链接')
    else {
      ok = false
      lines.push('✖ 独立验收没有带报告链接')
    }
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
 * 本 PR 动到的逃逸账本条目 → { transitions, removed }。账本一条一个文件（2026-10-07），所以只取**本 PR 改动的条目文件**
 * 在 base / head 两版，不拉整个目录。纯函数、可测：
 *   files: [{ path, status, previousPath? }]（status 用 GitHub 的 added / modified / removed / renamed，或 A / M）；
 *   fetch(path, side) → 文本 | null（side = 'base' | 'head'；取不到 = null）。
 * 「被删」= 条目文件在 base 有、head 没有（removed、改名的旧路径，或 head 取不到而 base 取得到）。
 * 转换怎么算只有一份实现：fixedTransitions（check:escape-ledger 同源）。
 */
export function ledgerChanges(files, fetch) {
  const parse = (text) => { try { return text ? JSON.parse(text) : null } catch { return null } }
  const touched = []
  for (const file of files) {
    if (escapeIdOfPath(file.path)) touched.push({ path: file.path, status: file.status })
    if (file.previousPath && escapeIdOfPath(file.previousPath)) touched.push({ path: file.previousPath, status: 'removed' })
  }
  const base = []
  const head = []
  const removed = []
  for (const file of touched) {
    const before = file.status === 'added' || file.status === 'A' ? null : parse(fetch(file.path, 'base'))
    const after = file.status === 'removed' ? null : parse(fetch(file.path, 'head'))
    if (before) base.push(before)
    if (after) head.push(after)
    else if (before) removed.push(escapeIdOfPath(file.path))
  }
  return { transitions: fixedTransitions({ entries: base }, { entries: head }), removed }
}

/** base 账本里已结账（fixed）条目指向的根因合同文件。纯函数、可测。 */
export function settledContracts(baseLedger) {
  return (baseLedger?.entries ?? []).filter((entry) => entry.status === 'fixed' && entry.rootCauseContract).map((entry) => entry.rootCauseContract)
}

export function checkEscapeContract(body, contracts, transitions = [], ledgerIds = [], settled = []) {
  const withField = contracts.filter((contract) => ['user', 'post-release', 'walkthrough', 'ci', 'review'].includes(contract.detected_by))
  const userFound = contracts.filter((contract) => ['user', 'post-release'].includes(contract.detected_by))
  const mentioned = ledgerIds.filter((id) => String(body || '').includes(id) && !transitions.includes(id))
  const hint = mentioned.length ? [`· 正文提到了账本条目 ${mentioned.join('、')}，但本 PR 没把它们改成 fixed——只是引用，不要求合同`] : []
  if (transitions.length === 0 && userFound.length === 0) {
    return { applicable: false, ok: true, lines: ['· 本 PR 没有让任何逃逸账本条目转成 fixed，合同检查跳过', ...hint] }
  }
  if (transitions.length === 0) {
    // 修订已结账的合同（例：用户后来改了拍板，合同不变量跟着改）：条目在 base 已是 fixed，本 PR 只修订合同，不要求再转换一次。
    // 新增的合同、或对应条目还没结账的，照旧要进账本。
    const unsettled = userFound.filter((contract) => contract.added || !settled.includes(contract.file))
    if (unsettled.length === 0) {
      return { applicable: true, ok: true, lines: [`· 修订已结账的根因合同（${userFound.map((contract) => contract.file).join('、')}）：对应逃逸账本条目在 base 已是 fixed，不要求再转换`, ...hint] }
    }
    return { applicable: true, ok: false, lines: [`✖ 根因合同声明 detected_by 为用户 / 发版后发现（${unsettled.map((contract) => contract.file).join('、')}），但本 PR 没有把对应的逃逸账本条目（tests/ux/full-walk/escapeLedger/）转成 fixed——用户发现的问题要进账本并带类级检查结账`] }
  }
  if (withField.length === 0) {
    return { applicable: true, ok: false, lines: [`✖ 本 PR 把逃逸账本条目 ${transitions.join('、')} 转成 fixed，但没带含 detected_by 的根因合同（docs/fixes/*.root-cause.json）`] }
  }
  return { applicable: true, ok: true, lines: [`✅ 逃逸账本 ${transitions.join('、')} → fixed：带了含 detected_by 的合同（${withField.map((contract) => contract.file).join('、')}）`, ...hint] }
}

/**
 * 规则生效时刻 = 引入本套规则的 PR（#961）的合并时间（2026-10-03T06:49:25Z，写死：推送前没有 gh 也得判）。
 * 比它更早开的 PR（#947、#962 等）没有机会照新模板写，只给警告、不判红。effectiveAt 显式传 null = 规则尚未生效（测试用）。
 */
export const RULES_INTRODUCED_BY_PR = 961
export const RULES_EFFECTIVE_AT = '2026-10-03T06:49:25Z'

export function isGrandfathered({ createdAt, effectiveAt = RULES_EFFECTIVE_AT }) {
  if (!effectiveAt) return true
  if (!createdAt) return false
  return new Date(createdAt) < new Date(effectiveAt)
}

/** 正文判据的逐行输出与是否判红；renderReport（合并前）和推送前各自加抬头 / 结论。 */
export function renderBodyLines({ classification, design, acceptance, escape, scope = { ok: true, lines: [] }, routing = { blocking: false, lines: [], ok: true }, grandfathered = false }) {
  const lines = []
  lines.push(classification.fourClass
    ? `· 四类：命中（${classification.classes.join('、')}）——${classification.hits.slice(0, 5).map((hit) => hit.path).join('、')}${classification.hits.length > 5 ? ' …' : ''}`
    : '· 四类：未命中，只查设计卡 ★ 格')
  const soften = (list) => (grandfathered ? list.map((line) => line.replace(/^✖/, '⚠')) : list)
  lines.push(...soften(design.lines))
  if (classification.fourClass) lines.push(...soften(acceptance.lines))
  lines.push(...soften(escape.lines))
  // 路由（功能分类 / 验收证据）：生效日之前开的 PR 已在 routing.lines 里降成警告
  lines.push(...routing.lines)
  // 规则与门岗的改动范围不吃「规则生效前开的 PR」那条宽限：#1032 这种回退正是旧分支带出来的。
  lines.push(...scope.lines)
  if (grandfathered) lines.push('· 这是规则生效（#961 合并）之前开的 PR：缺项只给警告，不判红')
  const blocked = !scope.ok || routing.blocking || (!grandfathered && (!design.ok || (classification.fourClass && !acceptance.ok) || !escape.ok))
  return { lines, blocked }
}

/** 合并前扫描的完整报告：抬头 + 判据行 + 结论。 */
export function mergeReport(pr, { lines, blocked }) {
  const out = [`合并前扫描 · PR #${pr}`, ...lines]
  out.push(blocked ? '结论：✖ 有项没过，先别合（脚本只打印结论，不合并）' : '结论：✅ 扫描干净（脚本只打印结论，不合并；其余合并条件仍看 CI 与收据）')
  return { text: out.join('\n'), blocked }
}

export const renderReport = ({ pr, ...rest }) => mergeReport(pr, renderBodyLines(rest))

/**
 * 正文判据的总入口（推送前的 check-pr-judgement 与合并前扫描都从这里判）：
 *   files: [{ path, status }]（A / M / D 或 added / modified / removed）；addedByFile: Map(路径 → 新增行)；
 *   contracts / ledger（transitions、ids、removed、settledContracts）见 checkEscapeContract / ledgerChanges；
 *   createdAt: PR 创建时间（拿不到 = 不宽限，fail-closed）；enforce: 假设规则已生效（回放用）。
 */
export function evaluatePrBody({ body, files, addedLines = '', addedByFile = null, packageRemovedLines = [], contracts = [], ledger = {}, createdAt = null, enforce = false, stage = 'merge' }) {
  const normalized = files.map((file) => ({ ...file, status: file.status === 'added' ? 'A' : file.status }))
  const withAdded = addedByFile ? normalized.map((file) => ({ ...file, added: addedByFile.get(file.path) ?? '' })) : normalized
  const classification = classifyChange(withAdded, addedLines)
  const judgement = evaluatePrJudgement({
    body,
    files: normalized,
    addedLines,
    addedByFile,
    packageRemovedLines,
    ledgerRemovedIds: ledger.removed ?? [],
    createdAt: enforce ? null : createdAt,
  })
  const result = renderBodyLines({
    classification,
    design: checkDesignCard(body, classification),
    acceptance: checkIndependentAcceptance(body, { stage }),
    escape: checkEscapeContract(body, contracts, ledger.transitions ?? [], ledger.ids ?? [], ledger.settledContracts ?? []),
    scope: judgement.scope,
    routing: judgement.routing,
    grandfathered: !enforce && isGrandfathered({ createdAt }),
  })
  return { ...result, classification, judgement }
}
