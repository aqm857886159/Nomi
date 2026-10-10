#!/usr/bin/env node
// 工程体系三个数（2026-10-02，由 three-numbers.py 原型改写；不用 Python，Windows 上 python3 有商店别名的坑）。
// 输出一行：「逃逸率 x% · 30 天复发 y% · 门岗误报 z% · 到期合同 N 份（同类复发 k 份）」。
// **它不作为任何通过条件**：只看趋势，永远 exit 0，任何一项拿不到就明说「—（原因）」，绝不编数字。
//
// 数据源：
//   · 逃逸率  = 根因合同里 detected_by 为 user / post-release 的份数 ÷ 带 detected_by 的份数（v3 新字段，2026-10-02 起才有）；
//               还没有样本时给 `—`。要拿旧复盘的基线可传 --fixes <fixes.csv>（第 7 列「发现者」），口径同原型。
//   · 30 天复发 = docs/fixes/*.root-cause.json 里「30 天内与更早某份合同共享 ≥2 个非枢纽非测试文件、且重叠不少于较小集合一半」的合同占比
//               （代理口径，偏粗，以后改用合同里的类字段）。
//   · 门岗误报 = Quality Gate 近 60 天失败的 run 里，「同一个 head SHA 后来又有成功的 run」的占比（重跑就绿 = 红得没道理）。
//               gh 数据每天缓存一次（.claude/eng-metrics-cache.json，gitignore 里），不在每次开场都打 API；
//               gh 不可用 / 没登录 → 这一项写「—（今天没查成）」，不写成 0%。注意这是代理口径（只认「同 SHA 重跑就绿」），清点线的完整分类要高得多。
//   · 到期合同 = recurrence_check_on（缺省为合同文件日期 + 30 天）已到的合同数；括号里是其中「到期前后 30 天内又有后来的同类合同」的份数。
//               只数 2026-10-02 之后的合同或显式写了 recurrence_check_on 的合同（老合同不追溯）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { execGhReadSync } from './lib/transientRetry.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DUE_TRACKING_SINCE = '2026-10-02'
const DAY = 86_400_000

const toDate = (text) => new Date(`${text}T00:00:00Z`)
const dayDiff = (later, earlier) => Math.round((later - earlier) / DAY)
const pct = (num, den) => `${Math.round((num / den) * 100)}%`
const NOT_PROD = /\.(?:test|spec)\.|\/tests?\/|^docs\/|\.md$/

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
    const paths = (Array.isArray(data.scope_paths) ? data.scope_paths : []).filter((p) => typeof p === 'string' && !NOT_PROD.test(p))
    contracts.push({
      file: name,
      date: match[1],
      paths,
      detected_by: data.detected_by,
      recurrence_check_on: data.recurrence_check_on,
    })
  }
  return contracts.sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file))
}

/** 去掉枢纽文件（出现在 >3% 合同里的 index / store 之类，不当同类证据），返回带 shared 判据的合同。 */
export function withoutHubs(contracts) {
  const freq = new Map()
  for (const contract of contracts) for (const p of new Set(contract.paths)) freq.set(p, (freq.get(p) ?? 0) + 1)
  const hub = Math.max(10, Math.floor(contracts.length * 0.03))
  return contracts.map((contract) => ({ ...contract, paths: new Set(contract.paths.filter((p) => freq.get(p) <= hub)) }))
}

function sameClass(a, b) {
  const shared = [...a.paths].filter((p) => b.paths.has(p)).length
  return shared >= 2 && shared / Math.min(a.paths.size, b.paths.size) >= 0.5
}

/** 30 天内与更早某份合同同类的合同占比。 */
export function computeRecurrence(contracts) {
  const list = withoutHubs(contracts)
  let recurred = 0
  list.forEach((contract, index) => {
    const hit = list.slice(0, index).some((earlier) => {
      const gap = dayDiff(toDate(contract.date), toDate(earlier.date))
      return gap > 0 && gap <= 30 && sameClass(contract, earlier)
    })
    if (hit) recurred += 1
  })
  return { recurred, total: list.length }
}

export function computeEscape(contracts) {
  const withField = contracts.filter((contract) => typeof contract.detected_by === 'string')
  const escaped = withField.filter((contract) => contract.detected_by === 'user' || contract.detected_by === 'post-release').length
  return { escaped, total: withField.length }
}

/** 到期的合同：recurrence_check_on（缺省 = 文件日期 + 30 天）<= today。 */
export function computeDue(contracts, today) {
  const list = withoutHubs(contracts)
  const todayDate = toDate(today)
  let due = 0
  let recurredAfter = 0
  list.forEach((contract, index) => {
    const tracked = contract.date >= DUE_TRACKING_SINCE || typeof contract.recurrence_check_on === 'string'
    if (!tracked) return
    const checkOn = typeof contract.recurrence_check_on === 'string'
      ? toDate(contract.recurrence_check_on)
      : new Date(toDate(contract.date).getTime() + 30 * DAY)
    if (checkOn > todayDate) return
    due += 1
    const later = list.slice(index + 1).some((candidate) => {
      const gap = dayDiff(toDate(candidate.date), toDate(contract.date))
      return gap > 0 && gap <= 30 && sameClass(candidate, contract)
    })
    if (later) recurredAfter += 1
  })
  return { due, recurredAfter }
}

/** runs: [{ sha, conclusion, createdAt }]（Quality Gate）。误报 = 失败 run 的 head SHA 后来又有成功。 */
export function computeFalsePositive(runs, today, windowDays = 60) {
  const since = toDate(today).getTime() - windowDays * DAY
  const inWindow = runs.filter((run) => new Date(run.createdAt).getTime() >= since)
  const failed = inWindow.filter((run) => run.conclusion === 'failure')
  let rerunGreen = 0
  for (const run of failed) {
    const later = inWindow.some((other) => other.sha === run.sha && other.conclusion === 'success' && new Date(other.createdAt) > new Date(run.createdAt))
    if (later) rerunGreen += 1
  }
  return { rerunGreen, failed: failed.length }
}

export function formatLine({ escape, recurrence, falsePositive, due }) {
  const esc = escape.total > 0 ? `${pct(escape.escaped, escape.total)}（${escape.escaped}/${escape.total}）` : '—（合同还没带 detected_by）'
  const rec = recurrence.total > 0 ? `${pct(recurrence.recurred, recurrence.total)}（${recurrence.recurred}/${recurrence.total}）` : '—'
  const fp = falsePositive.error
    ? `—（${falsePositive.error}）`
    : falsePositive.failed > 0 ? `${pct(falsePositive.rerunGreen, falsePositive.failed)}（${falsePositive.rerunGreen}/${falsePositive.failed}）` : '—（窗口内没有失败 run）'
  return `逃逸率 ${esc} · 30 天复发 ${rec} · 门岗误报 ${fp} · 到期合同 ${due.due} 份（同类复发 ${due.recurredAfter} 份）`
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
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).slice(1).filter((row) => row.length > 6)
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
    return cache.date === today ? cache : null
  } catch {
    return null
  }
}

/** Quality Gate 最近的 run：每天最多打一次 API，结果缓存。失败返回 { error }。 */
export function fetchRuns({ today, cacheFile, refresh = false, ghRun = defaultGhRun }) {
  const cached = refresh ? null : loadCache(cacheFile, today)
  if (cached?.runs) return { runs: cached.runs }
  try {
    const raw = ghRun(['run', 'list', '--workflow', 'Quality Gate', '--limit', '300', '--json', 'headSha,conclusion,createdAt'])
    const runs = JSON.parse(raw).map((run) => ({ sha: run.headSha, conclusion: run.conclusion, createdAt: run.createdAt }))
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify({ date: today, runs }))
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

function main(argv = process.argv.slice(2)) {
  const option = (name) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : null
  }
  try {
    console.log(buildReport({ fixesCsv: option('--fixes'), noCi: argv.includes('--no-ci'), refresh: argv.includes('--refresh') }))
  } catch (error) {
    // 永远不阻断：出错就明说这一行没算成。
    console.log(`工程三个数：今天没算成（${error instanceof Error ? error.message : String(error)}）`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
