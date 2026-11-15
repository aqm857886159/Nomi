// 方向检查（RW）的两种「按概念数」的计数单位（2026-10-05）：文件 / 目录之外，再按
//   · 自写登记条目（docs/engineering/self-written.json 的一条 entry，paths 下所有文件合起来）；
//   · 概念（docs/engineering/concept-owners/ 的一个 concept，owner + write_api 列出的文件合起来）
// 数。原因：同一个通用能力 / 同一个概念的修补散在好几个文件里，按文件、按目录都凑不够 3 个（MCP 一个月修 14 次、散在 6 个文件）。
// 计数、阈值、命中提示都在 fix-churn.mjs；这里只回答「有哪些单位、各含哪些文件、窗口和阈值是多少」。
import fs from 'node:fs'
import path from 'node:path'
import { loadConceptRegistry } from './concept-registry-lib.mjs'
import { pathMatches } from './self-written-lib.mjs'

export const SELF_WRITTEN_WINDOW_DAYS = 30
/** 自写通用能力：近 30 天已有 1 个 fix，这一刀就是第 2 个。 */
export const SELF_WRITTEN_PRIOR_FIX = 1
export const CONCEPT_WINDOW_DAYS = 14
export const CONCEPT_PRIOR_FIX = 2
/** 概念算「同一概念」的上限：窗口内 fix 碰过的不同源码文件数（与目录同一把尺子）。 */
export const CONCEPT_MAX_FILES = 6

const WATCHED_SELF_WRITTEN = new Set(['under-review', 'to-replace'])
const norm = (p) => String(p || '').split('\\').join('/')

/** 一条登记算不算「自写通用能力」：评估中 / 待替换，或合理自写但落在 genericZones（hooks、轮询、缓存、重试……）里。 */
export function isWatchedEntry(entry, registry) {
  if (WATCHED_SELF_WRITTEN.has(entry?.status)) return true
  if (entry?.status !== 'justified') return false
  const zones = (registry?.genericZones ?? []).map((zone) => zone.path)
  return (entry.paths ?? []).some((p) => zones.some((zone) => pathMatches(zone, p)))
}

export function selfWrittenUnits(registry) {
  return (registry?.entries ?? []).filter((entry) => isWatchedEntry(entry, registry)).map((entry) => ({
    kind: 'self-written',
    id: entry.id,
    label: `自写登记「${entry.id}」`,
    status: entry.status,
    patterns: entry.paths ?? [],
    windowDays: SELF_WRITTEN_WINDOW_DAYS,
    prior: SELF_WRITTEN_PRIOR_FIX,
    maxFiles: null,
  }))
}

/** 只含 1 个文件的概念不单列（和「文件」那票重复）。 */
export function conceptUnits(doc) {
  const units = []
  for (const concept of doc?.concepts ?? []) {
    const files = [...new Set([concept.owner?.path, ...(concept.write_api ?? []).map((w) => w.path)].filter(Boolean).map(norm))]
    if (files.length < 2) continue
    units.push({ kind: 'concept', id: concept.name, label: `概念「${concept.name}」`, patterns: files, windowDays: CONCEPT_WINDOW_DAYS, prior: CONCEPT_PRIOR_FIX, maxFiles: CONCEPT_MAX_FILES })
  }
  return units
}

/** 交接处（docs/engineering/seams.json）：一个事实从这头传到那头、一路上好几个文件都要对得上的那一段。 */
export const SEAM_WINDOW_DAYS = 14
/** 近 14 天已有 1 个 fix，这一刀就是第 2 次修（用户 2026-11-15 拍板）。 */
export const SEAM_PRIOR_FIX = 1

/** 非测试、非文档的生产文件才算碰了交接处。 */
export const isSeamProduction = (rel) => {
  const r = norm(rel)
  return !(r.startsWith('docs/') || r.startsWith('tests/perf/results') || /\.(test|spec|node-test)\.[cm]?[jt]sx?$/.test(r) || /\.(png|jpg|md)$/.test(r) || r.includes('/__fixtures__/'))
}

/** 交接处表 → 单位。注意：它不进 loadUnits——只在写任务书时数（check-dispatch-brief），提交时的方向检查不认它。 */
export function seamUnits(doc) {
  return (doc?.seams ?? []).map((seam) => ({
    kind: 'seam',
    id: seam.id,
    label: `交接处「${seam.name}」`,
    name: seam.name,
    owner: seam.owner,
    map: seam.map && seam.map !== '无' ? seam.map : null,
    checked: seam.checked !== false,
    patterns: seam.prefixes ?? [],
    windowDays: SEAM_WINDOW_DAYS,
    prior: SEAM_PRIOR_FIX,
    maxFiles: null,
    productionOnly: true,
  }))
}

/** 读工作树里的交接处表；读不到 / 解析失败 = 空（fail-open）。 */
export function loadSeams(root) {
  try { return seamUnits(JSON.parse(fs.readFileSync(path.join(root, 'docs/engineering/seams.json'), 'utf8'))) } catch { return [] }
}

/** 路径前缀匹配（seam 的 patterns 是前缀，不是 glob / 目录）；其余单位照旧走 pathMatches。 */
export const unitMatches = (unit, file) => unit.kind === 'seam'
  ? unit.patterns.some((prefix) => norm(file).startsWith(prefix))
  : unit.patterns.some((pattern) => pathMatches(pattern, norm(file)))

/** 读工作树里的两份登记；读不到 / 解析失败 = 空（fail-open，方向检查不因它挂掉）。 */
export function loadUnits(root) {
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) } catch { return null } }
  let concepts = null
  try { concepts = loadConceptRegistry(root) } catch { concepts = null }
  return [...selfWrittenUnits(read('docs/engineering/self-written.json')), ...conceptUnits(concepts)]
}
