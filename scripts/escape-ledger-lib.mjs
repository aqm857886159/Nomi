// 逃逸账本（tests/ux/full-walk/escapeLedger.json）的结账判据（P2「修根因」的闭环，2026-10-06）。
//
// 守的不变量：**用户发现的问题（逃逸）要进账本，结账（status = fixed）必须挂结构性预防——
// 一份根因合同 + 一条类级的检查 + 合入的 PR 号；只修现场不算修好。**
//
// 为什么有这道门（#1015 之前、之后都一样）：root-cause-contracts.mjs 已经要求「反复出现的修复必须带结构性预防」，
// 但用户发现的问题根本没被强制走进这条链——账本里的条目怎么结账，没有任何门岗管。
//
// 「类级」怎么判（只许一份实现，merge-preflight 也从这里取）：
//   · kind = iron-law：指向一条铁律（⑩ ⑪ ⑫，或原来九条里的 inv:N），file 必须就是该铁律的检查文件，
//     并且这条逃逸自己声明过属于这条铁律（ironLaws / existingInvariants）；
//   · kind = matrix：矩阵 / 普查测试——file 是测试文件，且有「参数化或遍历一份清单」的形状
//     （it.each / for…of / forEach / 矩阵、普查字样 + 从清单 / 登记 / 档案取数）；只测一个场景的不算。
// 判据是形状启发式，不是证明：它挡住的是「拿一个单场景回归测试来结账」，挡不住有心人写假遍历——
// 那一层由 PR 的独立验收线对着根因合同核。

export const ESCAPE_LEDGER_FILE = 'tests/ux/full-walk/escapeLedger.json'
/** candidate 停留超过这么多天就警告，提醒派人复核 / 修。 */
export const CANDIDATE_MAX_DAYS = 14

export const STATUS_VALUES = Object.freeze(['candidate', 'reviewed', 'fixed'])
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const CONTRACT_PATH = /^docs\/fixes\/[^/]+\.root-cause\.json$/
const DETECTED_BY = ['user', 'post-release', 'walkthrough', 'ci', 'review']

/** 三条新铁律各自的检查文件；原来九条（invariants）统一在 invariants.mjs。 */
export const IRON_LAW_CHECKS = Object.freeze({
  '⑩': 'tests/experience-laws/intentShownEqualsDrafted.test.mjs',
  '⑪': 'tests/experience-laws/parameterReachability.test.mjs',
  '⑫': 'tests/ux/full-walk/catalog.mjs',
})
export const INVARIANT_CHECK_FILE = 'tests/ux/full-walk/invariants.mjs'

const TEST_FILE = /\.(?:test|node-test|walk|paid)\.[cm]?[jt]sx?$|(?:^|\/)tests\/experience-laws\//
const LOOP_SHAPE = /\b(?:it|test|describe)\.each\b|\bfor\s*\(\s*(?:const|let)\s+[^)]*\bof\b|\.forEach\(|\.flatMap\(|Object\.entries\(|矩阵|普查|\bmatrix\b|\bcensus\b/i
const ENUMERATED_SOURCE = /catalog|ledger|archetype|registry|matrix|published|INVARIANTS|\bROWS\b|\bcells\b|清单|登记/i

/** 矩阵 / 普查测试的形状判据：有遍历或参数化，且遍历的是一份清单（不是写死的一个场景）。 */
export function looksClassLevel(source) {
  const text = String(source ?? '')
  return LOOP_SHAPE.test(text) && ENUMERATED_SOURCE.test(text)
}

const daysBetween = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

/** 类检查的判断（一个条目的 classCheck 够不够格）：返回错误数组。 */
export function classCheckErrors(entry, { exists, read }) {
  const check = entry.classCheck
  const label = `entries[${entry.id}]`
  if (!check || typeof check !== 'object') return [`${label}: fixed 必须挂一条类级检查（classCheck：{ kind: "iron-law" | "matrix", file, ref? }）——只修现场不算修好`]
  const errors = []
  if (typeof check.file !== 'string' || !check.file.trim()) return [`${label}: classCheck.file 缺失`]
  if (!exists(check.file)) errors.push(`${label}: classCheck.file 不存在：${check.file}`)
  if (check.kind === 'iron-law') {
    const ref = String(check.ref ?? '')
    const invariant = /^inv:([1-9])$/.exec(ref)
    const expected = invariant ? INVARIANT_CHECK_FILE : IRON_LAW_CHECKS[ref]
    if (!expected) errors.push(`${label}: classCheck.ref 必须是铁律 ⑩ ⑪ ⑫ 或 inv:1 … inv:9，收到「${ref}」`)
    else {
      if (check.file !== expected) errors.push(`${label}: 铁律 ${ref} 的检查文件是 ${expected}，不是 ${check.file}`)
      const declared = invariant ? (entry.existingInvariants ?? []).includes(Number(invariant[1])) : (entry.ironLaws ?? []).includes(ref)
      if (!declared) errors.push(`${label}: 这条逃逸没有声明属于铁律 ${ref}（${invariant ? 'existingInvariants' : 'ironLaws'} 里没有），不能拿它的检查结账`)
    }
  } else if (check.kind === 'matrix') {
    if (!TEST_FILE.test(check.file)) errors.push(`${label}: matrix 类检查必须是测试文件（*.test / *.node-test / *.walk / tests/experience-laws/）：${check.file}`)
    else if (exists(check.file) && !looksClassLevel(read(check.file))) {
      errors.push(`${label}: ${check.file} 看不出是类级检查——需要参数化 / 遍历一份清单（it.each、for…of、矩阵、普查，且从清单 / 登记 / 档案取数）；只测单个场景的不算`)
    }
  } else errors.push(`${label}: classCheck.kind 必须是 iron-law 或 matrix`)
  return errors
}

/** 根因合同的判断：文件在、是合法 JSON、有 detected_by 和结构性预防、并点名了这条类检查。 */
export function contractErrors(entry, { exists, read }) {
  const label = `entries[${entry.id}]`
  const file = entry.rootCauseContract
  if (typeof file !== 'string' || !CONTRACT_PATH.test(file)) return [`${label}: fixed 必须带根因合同（rootCauseContract: docs/fixes/<日期>-<名字>.root-cause.json）`]
  if (!exists(file)) return [`${label}: 根因合同不存在：${file}`]
  let contract
  try { contract = JSON.parse(read(file)) } catch { return [`${label}: 根因合同不是合法 JSON：${file}`] }
  const errors = []
  if (!DETECTED_BY.includes(contract?.detected_by)) errors.push(`${label}: 根因合同缺 detected_by（${DETECTED_BY.join(' / ')}）：${file}`)
  if (!contract?.prevention || typeof contract.prevention !== 'object' || !contract.prevention.kind) errors.push(`${label}: 根因合同没有结构性预防（prevention）：${file}`)
  const checkFile = entry.classCheck?.file
  if (typeof checkFile === 'string' && checkFile && !read(file).includes(checkFile)) {
    errors.push(`${label}: 根因合同里没有点名这条类检查（${checkFile}）——合同和检查要互相指得到：${file}`)
  }
  return errors
}

/**
 * 账本校验。返回 { errors, warnings }：
 *   · 格式不合法 → errors；
 *   · fixed 缺根因合同 / 类检查 / PR 号 → errors；
 *   · candidate 停留超过 CANDIDATE_MAX_DAYS → warnings（提醒派人，不阻断）。
 */
export function validateEscapeLedger(ledger, { today, exists = () => true, read = () => '' } = {}) {
  const errors = []
  const warnings = []
  if (!ledger || typeof ledger !== 'object') return { errors: [`${ESCAPE_LEDGER_FILE} 不是一个对象`], warnings }
  if (ledger.$schemaVersion !== 1) errors.push('$schemaVersion 必须是 1')
  if (JSON.stringify(ledger.statusValues) !== JSON.stringify(STATUS_VALUES)) errors.push(`statusValues 必须是 ${JSON.stringify(STATUS_VALUES)}`)
  const categories = ledger.categories && typeof ledger.categories === 'object' ? ledger.categories : null
  if (!categories) errors.push('categories 必须是对象')
  if (!Array.isArray(ledger.entries)) return { errors: [...errors, 'entries 必须是数组'], warnings }
  const ids = new Set()
  for (const entry of ledger.entries) {
    const label = `entries[${entry?.id ?? '?'}]`
    if (typeof entry?.id !== 'string' || !entry.id.trim()) { errors.push(`${label}: 缺 id`); continue }
    if (ids.has(entry.id)) errors.push(`${label}: id 重复`)
    ids.add(entry.id)
    if (categories && !categories[entry.category]) errors.push(`${label}: category「${entry.category}」没在 categories 里登记`)
    if (typeof entry.problem !== 'string' || entry.problem.trim().length < 8) errors.push(`${label}: problem 必须写清用户碰到了什么（原话级，≥8 字）`)
    if (!DATE_ONLY.test(entry.since ?? '')) errors.push(`${label}: since 必须是 YYYY-MM-DD（入账日，candidate 停留时长从这天数）`)
    if (!STATUS_VALUES.includes(entry.status)) { errors.push(`${label}: status 必须是 ${STATUS_VALUES.join(' / ')}`); continue }
    for (const field of ['evidence', 'completionCommits', 'ironLaws', 'useCases', 'fullWalkJourneys', 'existingInvariants']) {
      if (!Array.isArray(entry[field])) errors.push(`${label}: ${field} 必须是数组`)
    }
    if (entry.status !== 'candidate' && entry.manualReview !== 'reviewed') errors.push(`${label}: status ${entry.status} 必须先人工复核（manualReview: "reviewed"）`)
    if (entry.status === 'candidate' && DATE_ONLY.test(entry.since ?? '') && today) {
      const age = daysBetween(entry.since, today)
      if (age > CANDIDATE_MAX_DAYS) warnings.push(`${label}: candidate 已停留 ${age} 天（>${CANDIDATE_MAX_DAYS}）——该派人复核 / 修了：${entry.problem.slice(0, 40)}`)
    }
    if (entry.status === 'fixed') {
      errors.push(...contractErrors(entry, { exists, read }))
      errors.push(...classCheckErrors(entry, { exists, read }))
      if (!Number.isInteger(entry.fixedInPr) || entry.fixedInPr <= 0) errors.push(`${label}: fixed 必须写合入的 PR 号（fixedInPr: 正整数）`)
    }
  }
  return { errors, warnings }
}

/** 两版账本之间「变成 fixed」的条目 id（新出现就是 fixed 的也算）。merge-preflight 与本门岗共用这一份判断。 */
export function fixedTransitions(baseLedger, headLedger) {
  const before = new Map((baseLedger?.entries ?? []).map((entry) => [entry.id, entry.status]))
  return (headLedger?.entries ?? []).filter((entry) => entry.status === 'fixed' && before.get(entry.id) !== 'fixed').map((entry) => entry.id)
}
