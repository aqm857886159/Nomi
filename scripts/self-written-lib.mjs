// 「自写登记表」门岗的判据本体（P0「只写我们独有的」，2026-10-01）。
//
// 守的不变量：**Nomi 自己写的只有领域本身；领域目录之外新增一个模块，就是在自写一项通用能力——
// 必须进登记表，理由只认领域约束；没有登记的，门岗报。**
//
// 为什么需要它（R5 在，轮子还是照造）：
//   · `check:prior-art` 只查「有没有写那一节、有没有 3 条出处」，不查 diff 里是不是新造了通用能力——
//     #945 引了出处，照样自写了 `laneContextFit`；
//   · `framework-boundaries.json` 的 forbidden 只匹配已知名字，新轮子换个名字就漏过去；
//   · R5.3（build-vs-buy）这条最对的规则，门岗一栏是「—」。
// 这里的判据不看名字、不看出处写得好不好，只看**事实**：新增的文件落在哪、有没有人为它负责。
//
// 为什么这个门岗本身是自写的（登记在 `docs/engineering/self-written.json` 里，id = self-written-gate）：
// 现成的架构门岗（eslint-plugin-boundaries、dependency-cruiser）管的是「谁能 import 谁」，
// 没有一个回答「diff 里新增的模块有没有被一张领域目录或登记表认领」。
//
// 判据住在 lib 里，是为了能被 node-test 喂假仓库（R17：先证明它会咬人）。

/** 登记表在仓库里的位置（门岗、prior-art、周期审计三处共用，不各抄一份路径）。 */
export const SELF_WRITTEN_FILE = 'docs/engineering/self-written.json'

export const SELF_WRITTEN_STATUSES = Object.freeze(['justified', 'to-replace', 'under-review'])

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
/** 门岗只看 src/ 与 electron/ 下的代码文件。 */
const CODE_FILE = /^(?:src|electron)\/.+\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/

const SOURCE_URL = /https?:\/\/\S+/
const SOURCE_FILE_LINE = /[\w@./+-]+\.[A-Za-z0-9]+:\d+/
const SOURCE_REPO_PATH = /(?:^|[\s`(])(?:docs|src|electron|scripts|tests|node_modules)\/[\w@./+-]+/

export function isGatedCodeFile(path) {
  return CODE_FILE.test(String(path).replaceAll('\\', '/'))
}

/** 去掉注释与字符串外壳后的正文（只用来判「有没有运行时语句」，不求语法精确）。 */
function stripComments(source) {
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 顶层语句的起始片段（按括号深度切；只用来判「有没有运行时语句」，不求语法精确）。 */
function topLevelStatements(body) {
  const out = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if ('{(['.includes(ch)) depth += 1
    if ('})]'.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ';' || ch === '\n')) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/**
 * 豁免——每一条都有判据，不是「看着像」：
 *   test        测试与夹具：文件名含 .test. / .spec. / .e2e.，或在 __tests__ / __fixtures__ / testSupport 下。
 *               测试不是产品能力，是对能力的证明。
 *   declaration `.d.ts`：只有类型声明，没有运行时。
 *   wiring      去掉注释后，**每一条顶层语句**都是 import / export … from / export * ：纯接线（re-export、桶文件），
 *               它不引入能力，只是换个名字露出已有的能力。
 *   types-only  去掉注释后，每一条顶层语句都是 type / interface / import / export type|interface|{…} / declare：
 *               没有任何运行时声明。
 * 返回豁免名；不豁免返回 null。
 */
export function exemptionOf(path, content) {
  const file = String(path).replaceAll('\\', '/')
  if (/\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/.test(file) || /(?:^|\/)(?:__tests__|__fixtures__|testSupport)\//.test(file)
    || /(?:^|\/)test[A-Z][^/]*\.[cm]?[jt]sx?$/.test(file) || /TestUtils?\.[cm]?[jt]sx?$/.test(file)) return 'test'
  if (/\.d\.ts$/.test(file)) return 'declaration'
  const statements = topLevelStatements(stripComments(content))
  if (statements.length === 0) return 'types-only'
  const reexport = /^(?:import\b[\s\S]*|export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[\s\S]*\})\s+from\s+['"][^'"]+['"])$/
  if (statements.every((statement) => reexport.test(statement))) return 'wiring'
  const typeOnly = /^(?:import\b[\s\S]*|(?:export\s+)?(?:declare\s+)?(?:type|interface)\b[\s\S]*|export\s+type\s+\{[\s\S]*\}(?:\s+from\s+['"][^'"]+['"])?|export\s+(?:declare\s+)?(?:type|interface)\b[\s\S]*|declare\b[\s\S]*)$/
  if (statements.every((statement) => typeOnly.test(statement))) return 'types-only'
  return null
}

/** 路径模式：以 `/` 结尾 = 目录前缀；含 `*` = glob（`**` 跨目录、`*` 不跨）；否则 = 精确文件或目录名。 */
export function pathMatches(pattern, path) {
  const p = String(pattern).replaceAll('\\', '/')
  const file = String(path).replaceAll('\\', '/')
  const globbed = p.includes('*') || p.includes('[')
  if (!globbed) {
    if (p.endsWith('/')) return file.startsWith(p)
    return file === p || file.startsWith(`${p}/`)
  }
  // glob：`**` 跨目录、`*` 不跨目录、`[A-Z]` 字符类；以 / 结尾 = 该目录整棵子树
  const body = p.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  const tail = p.endsWith('/') ? '.*' : ''
  return new RegExp(`^${body}${tail}$`).test(file)
}

function hasSource(text) {
  const value = String(text ?? '')
  return SOURCE_URL.test(value) || SOURCE_FILE_LINE.test(value) || SOURCE_REPO_PATH.test(value)
}

/** 登记表自己的形状校验。返回错误数组（不分档：登记表写坏了永远红）。 */
export function validateRegistry(registry, { exists = () => true, today } = {}) {
  const errors = []
  const stale = []
  if (!registry || typeof registry !== 'object') return { errors: [`${SELF_WRITTEN_FILE} 不是一个对象`], stale }
  if (typeof registry.enforceFrom !== 'string' || !DATE_ONLY.test(registry.enforceFrom)) {
    errors.push('enforceFrom 必须是 YYYY-MM-DD（这天起门岗从警告变成阻断合并）')
  }
  const roots = Array.isArray(registry.domainRoots) ? registry.domainRoots : null
  if (!roots || roots.length === 0) errors.push('domainRoots 必须是非空数组')
  for (const root of roots ?? []) {
    const label = `domainRoots[${root?.path ?? '?'}]`
    if (typeof root?.path !== 'string' || !root.path.trim()) { errors.push(`${label}: 缺 path`); continue }
    if (typeof root.reason !== 'string' || root.reason.trim().length < 8) {
      errors.push(`${label}: reason 必须写清它为什么是领域（Nomi 独有的东西），而不是一个词`)
    }
    if (!exists(root.path)) stale.push(`${label}: 路径不存在（陈旧登记）`)
  }
  for (const zone of registry.genericZones ?? []) {
    if (typeof zone?.path !== 'string' || !zone.path.trim()) errors.push('genericZones 条目缺 path')
    else if (typeof zone.reason !== 'string' || zone.reason.trim().length < 4) errors.push(`genericZones[${zone.path}]: 缺 reason`)
  }
  for (const root of roots ?? []) {
    if (root?.exclude !== undefined && !(Array.isArray(root.exclude) && root.exclude.every((item) => typeof item === 'string'))) {
      errors.push(`domainRoots[${root?.path ?? '?'}]: exclude 必须是字符串数组`)
    }
  }
  const ids = new Set()
  const entries = Array.isArray(registry.entries) ? registry.entries : null
  if (!entries) errors.push('entries 必须是数组')
  for (const entry of entries ?? []) {
    const id = entry?.id
    const label = `entries[${id ?? '?'}]`
    if (typeof id !== 'string' || !id.trim()) { errors.push(`${label}: 缺 id`); continue }
    if (ids.has(id)) errors.push(`${label}: id 重复`)
    ids.add(id)
    for (const field of ['capability', 'whyNotIntegrated', 'revisitWhen']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) errors.push(`${label}: 缺 ${field}`)
    }
    if (!SELF_WRITTEN_STATUSES.includes(entry.status)) {
      errors.push(`${label}: status 必须是 ${SELF_WRITTEN_STATUSES.join(' / ')}`)
    }
    if (!Array.isArray(entry.paths) || entry.paths.length === 0) errors.push(`${label}: paths 必须是非空数组`)
    for (const path of Array.isArray(entry.paths) ? entry.paths : []) {
      if (!exists(path)) stale.push(`${label}: 路径 ${path} 不存在（陈旧登记）`)
    }
    const alternatives = Array.isArray(entry.alternativesChecked) ? entry.alternativesChecked : []
    if (alternatives.length === 0) errors.push(`${label}: alternativesChecked 至少一条（查过哪些现成方案）`)
    for (const alt of alternatives) {
      if (typeof alt?.name !== 'string' || !alt.name.trim()) errors.push(`${label}: alternativesChecked 条目缺 name`)
      else if (!hasSource(alt.source)) errors.push(`${label}: 现成方案「${alt.name}」没有出处（URL、file:line 或仓库路径）——没有出处等于没查`)
    }
    if (entry.status === 'to-replace') {
      if (typeof entry.plan !== 'string' || !entry.plan.trim()) errors.push(`${label}: to-replace 必须绑一份替换计划（plan）——不绑计划就是合理自写的借口`)
      else if (!exists(entry.plan)) errors.push(`${label}: plan ${entry.plan} 不存在`)
    }
    if (entry.status === 'under-review' && !DATE_ONLY.test(entry.reviewBy ?? '')) {
      errors.push(`${label}: under-review 必须写 reviewBy（YYYY-MM-DD）——评估也有期限`)
    }
    if (entry.status === 'to-replace' && Array.isArray(entry.paths) && entry.paths.length > 0 && entry.paths.every((path) => !exists(path))) {
      errors.push(`${label}: to-replace 的 paths 已经全部不存在——已替换，请删这条登记（登记表不留死账）`)
    }
    if (entry.renewed !== undefined) {
      const renewed = Array.isArray(entry.renewed) ? entry.renewed : null
      if (!renewed || !renewed.every((item) => DATE_ONLY.test(item?.on ?? '') && DATE_ONLY.test(item?.from ?? '') && typeof item?.reason === 'string' && item.reason.trim().length >= 4)) {
        errors.push(`${label}: renewed 必须是 [{ on, from, reason }]（续期日、原 reviewBy、为什么现在还下不了结论）`)
      } else if (renewed.length > MAX_RENEWALS) {
        errors.push(`${label}: 评估期限最多续 ${MAX_RENEWALS} 次，已续 ${renewed.length} 次——现在必须下结论（接入现成方案 / 改 to-replace / 写清只认领域约束的 justified）`)
      }
    }
    if (entry.revisitBy !== undefined && !DATE_ONLY.test(entry.revisitBy)) errors.push(`${label}: revisitBy 必须是 YYYY-MM-DD`)
  }
  return { errors, stale }
}

/** 新登记的评估期限上限（天）、最多续几次。 */
export const MAX_REVIEW_DAYS = 30
export const MAX_RENEWALS = 1

const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

/**
 * 评估到期真拦（P0）。输入：当前登记表、base 登记表（可空）、这次改动碰到的全部文件（可空）、今天。
 *   · 过期 + 碰了它的 paths：under-review 的 reviewBy 已过（today > reviewBy），这次改动又碰了该条目的文件 → 报。
 *     例外就是「改动本身是评估 / 替换」：同一次改动把它改离 under-review（或删掉条目）——那时它已不是 under-review，自然不报。
 *     没碰它的 paths 的改动不被它拖住（它由 audit:self-written 列进周期清单）。
 *   · 新登记（或刚改成 under-review）的 reviewBy 距今不超过 MAX_REVIEW_DAYS；存量条目的日期不动、不追溯。
 *   · 延期（reviewBy 比 base 晚）必须同时在 renewed 里加一条记录，延后后仍不超过 MAX_REVIEW_DAYS；最多续 MAX_RENEWALS 次。
 */
export function evaluateReviewDeadlines({ registry, baseRegistry = null, changedFiles = null, today }) {
  const errors = []
  const baseById = new Map((baseRegistry?.entries ?? []).map((entry) => [entry.id, entry]))
  const limit = addDays(today, MAX_REVIEW_DAYS)
  for (const entry of registry?.entries ?? []) {
    if (entry.status !== 'under-review' || !DATE_ONLY.test(entry.reviewBy ?? '')) continue
    const label = `entries[${entry.id}]`
    if (changedFiles && entry.reviewBy < today && changedFiles.some((file) => (entry.paths ?? []).some((pattern) => pathMatches(pattern, file)))) {
      errors.push(`${label}: 评估已过期（reviewBy ${entry.reviewBy}），这次改动又碰了它的文件。先把评估做完：接入现成方案 / 改 to-replace（绑 plan）/ 改 justified（理由只认领域约束）；确实下不了结论，在 renewed 里记录并把 reviewBy 续到 ${limit} 之内（只能续 ${MAX_RENEWALS} 次）`)
    }
    if (!baseRegistry) continue
    const base = baseById.get(entry.id)
    if (!base || base.status !== 'under-review') {
      if (entry.reviewBy > limit) errors.push(`${label}: 新登记的 under-review，reviewBy 距今不得超过 ${MAX_REVIEW_DAYS} 天（${entry.reviewBy} > ${limit}）`)
    } else if (entry.reviewBy > base.reviewBy) {
      if ((entry.renewed?.length ?? 0) !== (base.renewed?.length ?? 0) + 1) errors.push(`${label}: reviewBy 从 ${base.reviewBy} 往后推，必须同时在 renewed 里加一条记录（on / from / reason）`)
      if (entry.reviewBy > limit) errors.push(`${label}: 续期后的 reviewBy 距今不得超过 ${MAX_REVIEW_DAYS} 天（${entry.reviewBy} > ${limit}）`)
    }
  }
  return errors
}

/**
 * 主判：`added` = diff（merge-base..HEAD）里**新增**的文件 [{ path, content }]。
 * - 登记表形状错误：永远是 errors；
 * - 未被认领的新增模块：`today < enforceFrom` 出 warnings，之后出 errors；
 * - 陈旧登记（路径不存在）：同上分档。
 */
export function evaluateSelfWritten({ registry, added, today, exists = () => true, baseRegistry = null, changedFiles = null }) {
  const shape = validateRegistry(registry, { exists, today })
  const errors = [...shape.errors, ...evaluateReviewDeadlines({ registry, baseRegistry, changedFiles, today })]
  const warnings = []
  const enforcing = typeof registry?.enforceFrom === 'string' && today >= registry.enforceFrom
  const bucket = enforcing ? errors : warnings
  for (const message of shape.stale) bucket.push(message)

  const roots = registry?.domainRoots ?? []
  const generic = (registry?.genericZones ?? []).map((zone) => zone.path)
  const inDomain = (path) => !generic.some((zone) => pathMatches(zone, path))
    && roots.some((root) => pathMatches(root.path, path) && !(root.exclude ?? []).some((pattern) => pathMatches(pattern, path)))
  const covered = (registry?.entries ?? []).flatMap((entry) => entry.paths ?? [])
  const violations = []
  for (const { path, content } of added ?? []) {
    if (!isGatedCodeFile(path)) continue
    if (exemptionOf(path, content)) continue
    if (inDomain(path)) continue
    if (covered.some((pattern) => pathMatches(pattern, path))) continue
    violations.push(path)
  }
  if (violations.length > 0) {
    bucket.push(`${violations.length} 个新增文件落在领域目录之外、也没有被自写登记表认领（P0：只写我们独有的）：\n`
      + violations.map((file) => `      · ${file}`).join('\n')
      + '\n      → 先找现成的框架 / 库 / 标准接入（「先查别人」的结论默认是接入）；'
      + '\n      → 确实只能自写：在 docs/engineering/self-written.json 加一条 entry'
      + '（capability / paths / alternativesChecked 带出处 / whyNotIntegrated 只认领域约束 / revisitWhen），PR 正文引用查证；'
      + '\n      → 其实是领域代码：这是领域目录清单的缺口，加进 domainRoots 并说明为什么它是 Nomi 独有的（改它同样要 PR 正文引用查证）。')
  }
  return { errors, warnings, violations, enforcing }
}

const stable = (value) => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item))

/**
 * diff 里有没有「新增通用能力」：entries 新增 / 修改（按 id 比内容），或 domainRoots 变了（扩大领域目录是同一种口子）。
 * 只删不改（清掉一项自写）不算——那是在减。
 */
export function registryChanges(base, head) {
  const baseEntries = new Map((base?.entries ?? []).map((entry) => [entry.id, stable(entry)]))
  const changedEntries = []
  for (const entry of head?.entries ?? []) {
    if (baseEntries.get(entry.id) !== stable(entry)) changedEntries.push(entry.id)
  }
  const baseRoots = new Set((base?.domainRoots ?? []).map((root) => stable(root)))
  const addedRoots = (head?.domainRoots ?? []).filter((root) => !baseRoots.has(stable(root))).map((root) => root.path)
  return { changed: changedEntries.length > 0 || addedRoots.length > 0, changedEntries, addedRoots }
}

/** 周期审计（R14）的「自写登记复查」：到期的、评估中的、已标待替换的，列进替换计划。 */
export function dueForReview(registry, today) {
  const rows = []
  for (const entry of registry?.entries ?? []) {
    if (entry.status === 'to-replace') rows.push({ id: entry.id, why: `待替换（计划 ${entry.plan}）` })
    else if (entry.status === 'under-review') {
      rows.push({ id: entry.id, why: entry.reviewBy <= today ? `评估已到期（${entry.reviewBy}）` : `评估中（${entry.reviewBy} 前给结论）` })
    } else if (entry.revisitBy && entry.revisitBy <= today) rows.push({ id: entry.id, why: `复查日已到（${entry.revisitBy}）：${entry.revisitWhen}` })
  }
  return rows
}

/** 路径模式的静态前缀（检查「这条登记指向的东西还在不在」用）：glob 取到第一个 `*` 之前的目录。 */
export function staticPrefixOf(pattern) {
  const value = String(pattern).replaceAll('\\', '/')
  const star = value.indexOf('*')
  if (star === -1) return value.replace(/\/$/, '')
  const prefix = value.slice(0, star)
  return prefix.endsWith('/') ? prefix.replace(/\/$/, '') : prefix.slice(0, Math.max(0, prefix.lastIndexOf('/')))
}
