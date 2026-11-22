#!/usr/bin/env node
// 工程体系三个数（2026-10-02，由 three-numbers.py 原型改写；2026-11-22 升级为先声明 recurrence_of、后 Simple S-sym 兜底估算、两数严格分报）。
// 输出一行：「逃逸率 x% · 30 天复发 声明 y1% / 旧合同估算 y2% · 门岗误报 z% · 到期合同 声明 N1 份（复发 k1 份） / 旧合同估算 N2 份（复发 k2 份）」。
// **它不作为任何通过条件**：只看趋势，永远 exit 0，任何一项拿不到就明说「—（原因）」，绝不编数字。
//
// 数据源：
//   · 逃逸率  = 根因合同里 detected_by 为 user / post-release 的份数 ÷ 带 detected_by 的份数（v3 新字段，2026-10-02 起才有）；
//               还没有样本时给 `—`。要拿旧复盘的基线可传 --fixes <fixes.csv>（第 7 列「发现者」），口径同原型。
//   · 30 天复发 = 严格拆成两个独立的数，绝不混成一个数（均排除 change_kind === "structural" 的纯重构合同）：
//               ① 声明：已填写 recurrence_of（含显式 null 与显式前任列表）的纠正型合同中，显式指认 30 天内旧合同的占比；
//               ② 旧合同估算：未填写 recurrence_of 的老纠正型合同，用独立留出集选出的 Simple S-sym 兜底规则
//                 （30 天内与更早非 structural 合同共享 ≥1 个非枢纽 shared_boundaries `path::symbol`）估算的占比。
//   · 门岗误报 = Quality Gate 最近取到的运行里，「红过、没改代码又绿了」的占比。两种都算：①重跑变绿——`gh run rerun` 沿用同一个运行号，
//               结论被最后一次覆盖，所以按 attempt > 1 且现在成功来认（2026-11-21 之前只认②，协调一直用重跑，这个数恒为 0%）；
//               ②同一个 head SHA 另起了一次运行并成功。分母是红过的运行 = 现在仍失败的 + ①。
//               只取最近 300 次运行，实际覆盖几天随提交量变，所以括号里印「近 N 天」，不冒充 60 天。
//               gh 数据每天缓存一次（.claude/eng-metrics-cache.json，gitignore 里），不在每次开场都打 API；
//               gh 不可用 / 没登录 → 这一项写「—（今天没查成）」，不写成 0%。仍是代理口径：被取消的运行、没人重跑的假红都没算，真实值只会更高。
//   · 到期合同 = recurrence_check_on（缺省为合同文件日期 + 30 天）已到的纠正型合同，同样严格拆成「声明」与「旧合同估算」两数。
//               只数 2026-10-02 之后的合同或显式写了 recurrence_check_on 的合同（老合同不追溯）。
//   · 辅助模式 = `--candidates <contract.json>`：按非枢纽共享边界符号 / 边界路径 / 文件交集列出仓库里最相近的候选旧合同，辅助填写 recurrence_of。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { execGhReadSync } from './lib/transientRetry.mjs'
import { resolveRecurrenceRef } from './root-cause-contracts.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DUE_TRACKING_SINCE = '2026-10-02'
const DAY = 86_400_000
/** 缓存里每条运行带哪些字段；加字段就换名，旧缓存当天作废重取（否则今天剩下的时间都拿缺字段的旧数据算）。 */
const RUN_CACHE_SHAPE = 'sha,conclusion,createdAt,attempt'

const toDate = (text) => new Date(`${text}T00:00:00Z`)
const dayDiff = (later, earlier) => Math.round((later - earlier) / DAY)
const pct = (num, den) => `${Math.round((num / den) * 100)}%`
const NOT_PROD = /\.(?:test|spec)\.|\/tests?\/|^docs\/|\.md$/
const normalizeRel = (p) => String(p || '').replaceAll('\\', '/').replace(/^\.\//, '')

function parseRecurrenceOfField(data) {
  const hasField = Object.prototype.hasOwnProperty.call(data, 'recurrence_of') && data.recurrence_of !== undefined
  if (!hasField || data.recurrence_of === null) return { declared: hasField, refs: [] }
  const raw = typeof data.recurrence_of === 'string'
    ? [data.recurrence_of]
    : Array.isArray(data.recurrence_of)
      ? data.recurrence_of
      : []
  const refs = []
  const seen = new Set()
  for (const item of raw) {
    const resolved = resolveRecurrenceRef(item)
    if (!resolved || seen.has(resolved.slug)) continue
    seen.add(resolved.slug)
    refs.push(resolved.slug)
  }
  return { declared: true, refs }
}

function parseContractRecord(fileName, data) {
  const match = /^(\d{4}-\d{2}-\d{2})-.*\.root-cause\.json$/.exec(fileName)
  const slug = fileName.replace(/\.root-cause\.json$/, '')
  const paths = [...new Set(
    (Array.isArray(data.scope_paths) ? data.scope_paths : [])
      .filter((p) => typeof p === 'string' && !NOT_PROD.test(p))
      .map(normalizeRel),
  )]
  const sharedBoundaries = (Array.isArray(data.shared_boundaries) ? data.shared_boundaries : [])
    .filter((b) => b && typeof b === 'object' && typeof b.path === 'string' && b.path.trim() && typeof b.symbol === 'string' && b.symbol.trim())
    .map((b) => ({ path: normalizeRel(b.path.trim()), symbol: b.symbol.trim() }))
  const rec = parseRecurrenceOfField(data)
  return {
    file: fileName,
    slug,
    id: typeof data.id === 'string' && data.id.trim() ? data.id.trim() : slug,
    date: match ? match[1] : null,
    change_kind: data.change_kind ?? 'corrective',
    problem_type: typeof data.problem_type === 'string' ? data.problem_type : '',
    symptom: typeof data.symptom === 'string' ? data.symptom : '',
    paths,
    shared_boundaries: sharedBoundaries,
    detected_by: data.detected_by,
    recurrence_check_on: data.recurrence_check_on,
    recurrence_of_declared: rec.declared,
    recurrence_of: rec.refs,
  }
}

export function readContracts(repo = repoRoot) {
  const dir = path.join(repo, 'docs', 'fixes')
  if (!fs.existsSync(dir)) return []
  const contracts = []
  for (const name of fs.readdirSync(dir)) {
    const match = /^(\d{4}-\d{2}-\d{2})-.*\.root-cause\.json$/.exec(name)
    if (!match) continue
    let data
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
    } catch {
      continue
    }
    contracts.push(parseContractRecord(name, data))
  }
  return contracts.sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file))
}

/** 计算枢纽文件阈值（出现在 >3% 合同里，至少 10 份）与每个文件的出现次数。 */
function pathFrequency(contracts) {
  const freq = new Map()
  for (const contract of contracts) {
    for (const p of new Set(contract.paths)) freq.set(p, (freq.get(p) ?? 0) + 1)
  }
  const hub = Math.max(10, Math.floor(contracts.length * 0.03))
  return { freq, hub }
}

/** 去掉枢纽文件（出现在 >3% 合同里的 index / store 之类，不当同类证据），附加非枢纽边界集合。 */
export function withoutHubs(contracts) {
  const { freq, hub } = pathFrequency(contracts)
  return contracts.map((contract) => {
    const nonHubPaths = new Set(contract.paths.filter((p) => (freq.get(p) ?? 0) <= hub))
    const boundaries = Array.isArray(contract.shared_boundaries) ? contract.shared_boundaries : []
    const nonHubBoundarySymbols = new Set()
    const nonHubBoundaryPaths = new Set()
    if (contract.change_kind !== 'structural') {
      for (const b of boundaries) {
        if ((freq.get(b.path) ?? 0) <= hub) {
          nonHubBoundarySymbols.add(`${b.path}::${b.symbol}`)
          nonHubBoundaryPaths.add(b.path)
        }
      }
    }
    return {
      ...contract,
      paths: nonHubPaths,
      boundarySymbols: nonHubBoundarySymbols,
      boundaryPaths: nonHubBoundaryPaths,
    }
  })
}

/** Simple S-sym 兜底规则：排除 structural，且两份合同共享 ≥1 个非枢纽 shared_boundaries（同 path::symbol）。 */
function sameClassFallback(a, b) {
  if (a.change_kind === 'structural' || b.change_kind === 'structural') return false
  for (const sym of a.boundarySymbols) {
    if (b.boundarySymbols.has(sym)) return true
  }
  return false
}

/** 30 天复发：严格拆成声明数（已填 recurrence_of）与旧合同兜底估算（未填 recurrence_of，走 Simple S-sym）。 */
export function computeRecurrence(contracts) {
  const list = withoutHubs(contracts)
  const bySlug = new Map(list.map((c) => [c.slug, c]))
  const declared = { recurred: 0, total: 0 }
  const estimated = { recurred: 0, total: 0 }

  list.forEach((contract, index) => {
    if (contract.change_kind === 'structural') return
    if (contract.recurrence_of_declared) {
      declared.total += 1
      const hit = (contract.recurrence_of ?? []).some((targetSlug) => {
        const target = bySlug.get(targetSlug)
        if (!target || !target.date || !contract.date) return false
        const gap = dayDiff(toDate(contract.date), toDate(target.date))
        return gap >= 0 && gap <= 30
      })
      if (hit) declared.recurred += 1
      return
    }
    estimated.total += 1
    const hit = list.slice(0, index).some((earlier) => {
      if (earlier.change_kind === 'structural') return false
      const gap = dayDiff(toDate(contract.date), toDate(earlier.date))
      return gap > 0 && gap <= 30 && sameClassFallback(contract, earlier)
    })
    if (hit) estimated.recurred += 1
  })
  return { declared, estimated }
}

export function computeEscape(contracts) {
  const withField = contracts.filter((contract) => typeof contract.detected_by === 'string')
  const escaped = withField.filter((contract) => contract.detected_by === 'user' || contract.detected_by === 'post-release').length
  return { escaped, total: withField.length }
}

/** 到期合同：recurrence_check_on（缺省 = 文件日期 + 30 天）<= today，同样严格拆成声明数与旧合同估算数。 */
export function computeDue(contracts, today) {
  const list = withoutHubs(contracts)
  const todayDate = toDate(today)
  const declared = { due: 0, recurredAfter: 0 }
  const estimated = { due: 0, recurredAfter: 0 }

  list.forEach((contract, index) => {
    if (contract.change_kind === 'structural') return
    const tracked = contract.date >= DUE_TRACKING_SINCE || typeof contract.recurrence_check_on === 'string'
    if (!tracked) return
    const checkOn = typeof contract.recurrence_check_on === 'string'
      ? toDate(contract.recurrence_check_on)
      : new Date(toDate(contract.date).getTime() + 30 * DAY)
    if (checkOn > todayDate) return

    const laterExplicit = list.slice(index + 1).some((candidate) =>
      candidate.change_kind !== 'structural' && (candidate.recurrence_of ?? []).includes(contract.slug),
    )
    if (contract.recurrence_of_declared) {
      declared.due += 1
      if (laterExplicit) declared.recurredAfter += 1
      return
    }
    estimated.due += 1
    const laterFallback = laterExplicit || list.slice(index + 1).some((candidate) => {
      if (candidate.change_kind === 'structural') return false
      const gap = dayDiff(toDate(candidate.date), toDate(contract.date))
      return gap > 0 && gap <= 30 && sameClassFallback(candidate, contract)
    })
    if (laterFallback) estimated.recurredAfter += 1
  })
  return { declared, estimated }
}

/** 给定一份正在编写的合同，按非枢纽共享边界符号 / 边界路径 / 文件交集列出仓库里最相近的候选旧合同。 */
export function findRecurrenceCandidates(targetContract, contracts, { limit = 10 } = {}) {
  const { freq, hub } = pathFrequency(contracts)
  const targetSlug = targetContract.slug
  const targetPaths = new Set((targetContract.paths ?? []).filter((p) => (freq.get(p) ?? 0) <= hub))
  const targetBoundaries = Array.isArray(targetContract.shared_boundaries) ? targetContract.shared_boundaries : []
  const targetBSym = new Set(targetBoundaries.filter((b) => (freq.get(b.path) ?? 0) <= hub).map((b) => `${b.path}::${b.symbol}`))
  const targetBPath = new Set(targetBoundaries.filter((b) => (freq.get(b.path) ?? 0) <= hub).map((b) => b.path))

  const scored = []
  for (const candidate of contracts) {
    if (candidate.slug === targetSlug) continue
    if (candidate.change_kind === 'structural') continue
    if (targetContract.date && candidate.date && candidate.date > targetContract.date) continue

    const candBoundaries = Array.isArray(candidate.shared_boundaries) ? candidate.shared_boundaries : []
    const sharedBoundarySymbols = [...new Set(
      candBoundaries
        .filter((b) => (freq.get(b.path) ?? 0) <= hub)
        .map((b) => `${b.path}::${b.symbol}`)
        .filter((s) => targetBSym.has(s)),
    )]
    const sharedBoundaryPaths = [...new Set(
      candBoundaries
        .filter((b) => (freq.get(b.path) ?? 0) <= hub)
        .map((b) => b.path)
        .filter((p) => targetBPath.has(p)),
    )]
    const sharedPaths = [...new Set((candidate.paths ?? []).filter((p) => targetPaths.has(p)))]

    if (sharedBoundarySymbols.length === 0 && sharedBoundaryPaths.length === 0 && sharedPaths.length === 0) continue
    scored.push({
      slug: candidate.slug,
      id: candidate.id,
      date: candidate.date,
      problem_type: candidate.problem_type || candidate.symptom.slice(0, 100),
      sharedBoundarySymbols,
      sharedBoundaryPaths,
      sharedPaths,
    })
  }

  scored.sort((a, b) =>
    (b.sharedBoundarySymbols.length > 0) - (a.sharedBoundarySymbols.length > 0)
    || b.sharedBoundarySymbols.length - a.sharedBoundarySymbols.length
    || b.sharedBoundaryPaths.length - a.sharedBoundaryPaths.length
    || b.sharedPaths.length - a.sharedPaths.length
    || String(b.date || '').localeCompare(String(a.date || ''))
    || a.slug.localeCompare(b.slug),
  )
  return scored.slice(0, limit)
}

export function formatCandidates(candidates, targetLabel) {
  if (candidates.length === 0) {
    return `候选旧合同（${targetLabel}）：未找到共享非枢纽边界或文件的相近旧合同（如确认不是复发，请填 "recurrence_of": null）。`
  }
  const lines = [`候选旧合同（${targetLabel}，按共享非枢纽边界符号 > 边界路径 > 文件交集排序，共 ${candidates.length} 条）：`]
  for (const [idx, item] of candidates.entries()) {
    const reasons = []
    if (item.sharedBoundarySymbols.length > 0) reasons.push(`边界符号: ${item.sharedBoundarySymbols.join(', ')}`)
    else if (item.sharedBoundaryPaths.length > 0) reasons.push(`边界路径: ${item.sharedBoundaryPaths.join(', ')}`)
    if (item.sharedPaths.length > 0) reasons.push(`文件交集(${item.sharedPaths.length}): ${item.sharedPaths.slice(0, 4).join(', ')}`)
    lines.push(`  ${idx + 1}. ${item.slug} (${item.date || 'unknown'}) — ${item.problem_type || '(无标题)'}`)
    lines.push(`     ${reasons.join(' | ')}`)
  }
  lines.push('提示：如确属上述某份旧合同复发，请将其 slug 填入 "recurrence_of"；若非复发，请显式填 "recurrence_of": null。')
  return lines.join('\n')
}

/**
 * runs: [{ sha, conclusion, createdAt, attempt }]（Quality Gate）。红过又绿 = 重跑变绿（attempt > 1 且现在成功）+ 失败 run 的 head SHA 后来另有成功 run。
 * failed 是红过的运行数（现在仍失败的 + 重跑变绿的）；coveredDays 是取到的运行实际覆盖的天数（不超过窗口）。
 */
export function computeFalsePositive(runs, today, windowDays = 60) {
  const end = toDate(today).getTime() + DAY
  const since = toDate(today).getTime() - windowDays * DAY
  const inWindow = runs.filter((run) => new Date(run.createdAt).getTime() >= since)
  const failed = inWindow.filter((run) => run.conclusion === 'failure')
  const rerunSucceeded = inWindow.filter((run) => run.conclusion === 'success' && Number(run.attempt) > 1).length
  let sameShaGreen = 0
  for (const run of failed) {
    const later = inWindow.some((other) => other.sha === run.sha && other.conclusion === 'success' && new Date(other.createdAt) > new Date(run.createdAt))
    if (later) sameShaGreen += 1
  }
  const oldest = inWindow.reduce((min, run) => Math.min(min, new Date(run.createdAt).getTime()), end)
  const coveredDays = Math.min(windowDays, Math.max(1, Math.ceil((end - oldest) / DAY)))
  return { rerunGreen: rerunSucceeded + sameShaGreen, failed: failed.length + rerunSucceeded, coveredDays }
}

function formatRatio(num, den) {
  return den > 0 ? `${pct(num, den)}（${num}/${den}）` : '—（0/0）'
}

export function formatLine({ escape, recurrence, falsePositive, due }) {
  const esc = escape.total > 0 ? `${pct(escape.escaped, escape.total)}（${escape.escaped}/${escape.total}）` : '—（合同还没带 detected_by）'
  const rec = `声明 ${formatRatio(recurrence.declared.recurred, recurrence.declared.total)} / 旧合同估算 ${formatRatio(recurrence.estimated.recurred, recurrence.estimated.total)}`
  const fp = falsePositive.error
    ? `—（${falsePositive.error}）`
    : falsePositive.failed > 0 ? `${pct(falsePositive.rerunGreen, falsePositive.failed)}（${falsePositive.rerunGreen}/${falsePositive.failed}，近 ${falsePositive.coveredDays} 天）` : '—（窗口内没有失败 run）'
  const dueText = `声明 ${due.declared.due} 份（复发 ${due.declared.recurredAfter} 份） / 旧合同估算 ${due.estimated.due} 份（复发 ${due.estimated.recurredAfter} 份）`
  return `逃逸率 ${esc} · 30 天复发 ${rec} · 门岗误报 ${fp} · 到期合同 ${dueText}`
}

/** 带引号的 CSV 解析（复盘 fixes.csv 的字段里有逗号）。 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function csvEscapeFromFixes(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).slice(1).filter((row) => row.length > 6)
  const escaped = rows.filter((row) => ['用户', '发版后', '发版后3天'].includes(row[6])).length
  return { escaped, total: rows.length }
}

function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function loadCache(file, today) {
  try {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'))
    return cache.date === today && cache.shape === RUN_CACHE_SHAPE ? cache : null
  } catch {
    return null
  }
}

/** Quality Gate 最近的 run：每天最多打一次 API，结果缓存。失败返回 { error }。 */
export function fetchRuns({ today, cacheFile, refresh = false, ghRun = defaultGhRun }) {
  const cached = refresh ? null : loadCache(cacheFile, today)
  if (cached?.runs) return { runs: cached.runs }
  try {
    const raw = ghRun(['run', 'list', '--workflow', 'Quality Gate', '--limit', '300', '--json', 'headSha,conclusion,createdAt,attempt'])
    const runs = JSON.parse(raw).map((run) => ({ sha: run.headSha, conclusion: run.conclusion, createdAt: run.createdAt, attempt: run.attempt ?? 1 }))
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify({ date: today, shape: RUN_CACHE_SHAPE, runs }))
    } catch {
      /* 缓存写不进去不影响本次输出 */
    }
    return { runs }
  } catch {
    // 今天没查成：有旧缓存就不用（过期数字会被当成今天的），明说没查成。
    return { error: '今天没查成：gh 不可用或没登录' }
  }
}

function defaultGhRun(args) {
  return execGhReadSync(args, { cwd: repoRoot, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 })
}

export function buildReport({ repo = repoRoot, today = localToday(), fixesCsv = null, noCi = false, refresh = false, ghRun } = {}) {
  const contracts = readContracts(repo)
  const escape = fixesCsv ? csvEscapeFromFixes(fixesCsv) : computeEscape(contracts)
  const recurrence = computeRecurrence(contracts)
  const due = computeDue(contracts, today)
  let falsePositive
  if (noCi) {
    falsePositive = { error: '本次没查 CI' }
  } else {
    const fetched = fetchRuns({ today, cacheFile: path.join(repo, '.claude', 'eng-metrics-cache.json'), refresh, ghRun })
    falsePositive = fetched.error ? { error: fetched.error } : computeFalsePositive(fetched.runs, today)
  }
  return formatLine({ escape, recurrence, falsePositive, due })
}

function runCandidatesMode(contractPath, repo = repoRoot) {
  const resolved = path.resolve(contractPath)
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  const target = parseContractRecord(path.basename(resolved), data)
  const contracts = readContracts(repo)
  const candidates = findRecurrenceCandidates(target, contracts)
  return formatCandidates(candidates, target.slug)
}

function main(argv = process.argv.slice(2)) {
  const option = (name) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : null
  }
  try {
    const repo = option('--repo') ? path.resolve(option('--repo')) : repoRoot
    const candidatePath = option('--candidates')
    if (candidatePath) {
      console.log(runCandidatesMode(candidatePath, repo))
      return 0
    }
    console.log(buildReport({ repo, fixesCsv: option('--fixes'), noCi: argv.includes('--no-ci'), refresh: argv.includes('--refresh') }))
  } catch (error) {
    // 永远不阻断：出错就明说这一行没算成。
    console.log(`工程三个数：今天没算成（${error instanceof Error ? error.message : String(error)}）`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
