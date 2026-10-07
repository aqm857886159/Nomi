// 逃逸账本（tests/ux/full-walk/escapeLedger/，一条一个文件）的结账判据与唯一加载函数（P2「修根因」的闭环，2026-10-06）。
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

import path from 'node:path'

import { META_FILE, readEntryDirectory, readEntryDirectoryAtRef, refuseRetiredFile } from './lib/entryDirectory.mjs'

// ── 存储形状（2026-10-07）：一条一个文件 ─────────────────────────────────────────────────────────
// 原来是一个大 JSON（entries[]），几乎每个修复 PR 都往末尾追加一条，并行 PR 必然互相 CONFLICTING。
// 现在：`<目录>/<id>.json` 一条一个；顶层字段（$schemaVersion、_doc、statusValues、categories）在 `_meta.json`。
// 读账本只许走 loadEscapeLedger（工作树或某个提交），文件名 ↔ id 的规则只写在这里。
export const ESCAPE_LEDGER_DIR = 'tests/ux/full-walk/escapeLedger'
/** id 就是文件名（不转义）：字母数字开头，只含字母数字、点、下划线、连字符。 */
export const ESCAPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 一条逃逸的文件路径（相对仓库根）。id 不合法直接抛错：写不进去的 id 不能悄悄改名落盘。 */
export function escapeEntryPath(id) {
  if (!ESCAPE_ID_PATTERN.test(String(id ?? ''))) throw new Error(`逃逸账本 id 只许字母数字开头、由字母数字 . _ - 组成（它就是文件名）：${id}`)
  return `${ESCAPE_LEDGER_DIR}/${id}.json`
}

/** 仓库相对路径 → 条目 id；不是账本里的条目文件（含 _meta.json）→ null。 */
export function escapeIdOfPath(file) {
  const rel = String(file ?? '').replaceAll('\\', '/')
  if (!rel.startsWith(`${ESCAPE_LEDGER_DIR}/`)) return null
  const name = rel.slice(ESCAPE_LEDGER_DIR.length + 1)
  if (name === META_FILE || name.includes('/') || !name.endsWith('.json')) return null
  const id = name.slice(0, -'.json'.length)
  return ESCAPE_ID_PATTERN.test(id) ? id : null
}

/**
 * 拆分前的大文件。它不是读口（不读、不兼容），只是一块墓碑：在途分支合 main 时如果把它留了下来，
 * 里面新加的条目就会悄悄不进账——所以工作树里它还在就直接报错，提示用拆分 PR 正文里的补搬命令。
 * 拆分前开的在途 PR 都合完以后，这块墓碑连同 lib/entryDirectory.mjs 的 refuseRetiredFile 一起删。
 */
export const RETIRED_ESCAPE_LEDGER_FILE = 'tests/ux/full-walk/escapeLedger.json'

/** 按码位比（不随系统语言变），排序结果在每台机器上都一样。 */
const byCodePoint = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
const bySinceThenId = (left, right) => byCodePoint(String(left.since ?? ''), String(right.since ?? '')) || byCodePoint(String(left.id), String(right.id))

/** 目录内容 → 与原大文件同形的账本对象 `{ ...meta, entries }`；文件名和 id 对不上就抛错（点名文件）。 */
export function assembleEscapeLedger(directory) {
  const problems = []
  for (const { name, value } of directory.entries) {
    const expected = `${value?.id}.json`
    if (!value || typeof value !== 'object' || Array.isArray(value)) problems.push(`${name}：一个文件必须是一条逃逸（对象）`)
    else if (name !== expected) problems.push(`${name}：文件名必须是「<id>.json」，这条的 id 是 ${JSON.stringify(value.id)}`)
  }
  if (problems.length) throw new Error(`${ESCAPE_LEDGER_DIR} 的条目文件不对：${problems.join('；')}`)
  return { ...directory.meta, entries: directory.entries.map((entry) => entry.value).sort(bySinceThenId) }
}

/**
 * 唯一加载函数：工作树（不给 ref）或某个提交上的逃逸账本 → `{ $schemaVersion, _doc, statusValues, categories, entries }`，
 * 条目按 since + id 稳定排序。账本目录不存在 → null；文件坏了 / 文件名不对 → 抛错。
 */
export function loadEscapeLedger(repoRoot, { ref = null } = {}) {
  if (!ref) refuseRetiredFile(repoRoot, RETIRED_ESCAPE_LEDGER_FILE)
  const directory = ref
    ? readEntryDirectoryAtRef(repoRoot, ref, ESCAPE_LEDGER_DIR)
    : readEntryDirectory(path.join(repoRoot, ESCAPE_LEDGER_DIR))
  return directory ? assembleEscapeLedger(directory) : null
}

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
  if (!ledger || typeof ledger !== 'object') return { errors: [`${ESCAPE_LEDGER_DIR} 不是一个账本对象`], warnings }
  if (ledger.$schemaVersion !== 1) errors.push('$schemaVersion 必须是 1')
  if (JSON.stringify(ledger.statusValues) !== JSON.stringify(STATUS_VALUES)) errors.push(`statusValues 必须是 ${JSON.stringify(STATUS_VALUES)}`)
  const categories = ledger.categories && typeof ledger.categories === 'object' ? ledger.categories : null
  if (!categories) errors.push('categories 必须是对象')
  if (!Array.isArray(ledger.entries)) return { errors: [...errors, 'entries 必须是数组'], warnings }
  const ids = new Set()
  const foldedIds = new Map()
  for (const entry of ledger.entries) {
    const label = `entries[${entry?.id ?? '?'}]`
    if (typeof entry?.id !== 'string' || !entry.id.trim()) { errors.push(`${label}: 缺 id`); continue }
    if (ids.has(entry.id)) errors.push(`${label}: id 重复`)
    ids.add(entry.id)
    if (!ESCAPE_ID_PATTERN.test(entry.id)) errors.push(`${label}: id 只许字母数字开头、由字母数字 . _ - 组成（它就是文件名）`)
    // Windows / macOS 的文件名不分大小写：只差大小写的两个 id 在那里会落到同一个文件上
    const folded = entry.id.toLowerCase()
    if (foldedIds.has(folded) && foldedIds.get(folded) !== entry.id) errors.push(`${label}: 和 ${foldedIds.get(folded)} 只差大小写（文件名不分大小写的系统上是同一个文件）`)
    foldedIds.set(folded, entry.id)
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
