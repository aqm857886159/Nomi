#!/usr/bin/env node
// 被拦雷达（2026-11-07，10-24 → 11-07 PR 拦截审计的量具最小版）：PR 上的 CI 红了几次、红在哪道门岗、
// 有几次「只有正文」（代码一点毛病没有）、红完之后到底改没改代码。只读，不改任何门岗。
//
// 为什么要它：审计发现 PR 上 94 次 CI 红里 63 次带着「按流程注定先红」的正文合并档项、46 次只有这一项；
// 而且约三分之一的红在 run 列表里看不见——被重跑后的成功盖掉了，只有 attempts API 里有。没有这张表，
// 「这道门岗拦下的是真问题还是流程注定的红」只能靠人每次重新审计。
//
// 取数（全部只读，经 scripts/lib/transientRetry.mjs 的 execGhReadSync）：
//   · gh run list（Quality Gate，窗口内）→ 每个 PR 运行的最终结论与重跑次数；
//   · attempts API → 重跑之前那几次的结论（失败的才算一轮红）；
//   · 每一轮红的 jobs → 哪几个 job 红了；Contracts 红了再拉它的日志，解析 run-gates-contracts 的汇总
//     （「❌ N 个门岗阻断失败：」+「  · <门岗>（退出码 X）」，格式由 scripts/block-radar.node-test.mjs 用真汇总函数钉死）；
//   · 本机 git → codeChanged：这次红的 head 到同一分支下一次绿的 head 之间，first-parent 上非合并提交有没有碰代码路径；
//   · 本机记录 $(git rev-parse --git-common-dir)/nomi-block-events.jsonl（scripts/lib/blockEvents.mjs 写）→ 本机各阶段被拦的次数。
// 跑完的运行不会再变，取到的原始数据按运行号缓存（--cache），重跑只拉新的。
//
// 用法：node scripts/block-radar.mjs [--since 2026-10-24] [--until <ISO 时刻>] [--repo owner/name] [--cache <目录>] [--json] [--no-code-changed]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { blockEventsPath, readBlockEvents } from './lib/blockEvents.mjs'
import { execGhReadSync } from './lib/transientRetry.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const QUALITY_GATE_WORKFLOW = 'Quality Gate'
export const CONTRACTS_JOB = 'Contracts'
/** 正文判据门岗：它红 = 这一轮带着正文类的项（独立验收、账本 fixed、真实场景复现、设计卡……）。 */
export const BODY_GATE = 'check:pr-judgement'
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure'])

/** Actions 日志每行开头的时间戳（job 日志首行还带 BOM）。 */
export function stripLogPrefix(line) {
  return String(line).replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '')
}

/**
 * 解析 Contracts 日志里 scripts/run-gates-contracts.mjs 的阻断汇总。
 * @returns {{ declared: number, gates: string[] } | null} 没找到汇总 = null（job 在门岗之前就挂了，或格式变了——测试会红）
 */
export function parseContractsSummary(logText) {
  const lines = String(logText ?? '').split(/\r?\n/).map(stripLogPrefix)
  let found = null
  for (let index = 0; index < lines.length; index += 1) {
    const head = /^❌ (\d+) 个门岗阻断失败：$/.exec(lines[index])
    if (!head) continue
    const gates = []
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next]
      if (/^ {2}这一轮已经跑完全部门岗/.test(line)) break
      const gate = /^ {2}· (\S+)（退出码 [^）]+）$/.exec(line)
      if (gate) gates.push(gate[1])
    }
    found = { declared: Number(head[1]), gates } // 一份日志里有多份汇总（重试步骤）时取最后一份
  }
  return found
}

/** 这一轮红算哪一类：带正文项 / 只有正文项（只有 Contracts 红、且 Contracts 里只有正文判据红）。 */
export function classifyRed({ failedJobs, gates }) {
  const bodyClass = Array.isArray(gates) && gates.includes(BODY_GATE)
  const bodyOnly = bodyClass && failedJobs.length === 1 && failedJobs[0] === CONTRACTS_JOB && gates.length === 1
  return { bodyClass, bodyOnly }
}

/** 改动路径分桶（同审计的算法）：只有落进 code 桶才算「改了代码」。 */
export function codeBucket(file) {
  if (file.startsWith('tests/ux/full-walk/escapeLedger/')) return 'ledger'
  if (file.startsWith('docs/fixes/') && file.endsWith('.root-cause.json')) return 'rootcause'
  if (file.startsWith('docs/engineering/concept-owners/')) return 'concept'
  if (file.startsWith('docs/evidence/') || file.startsWith('docs/plan/') || file.startsWith('roadmap/')) return 'evidence/plan'
  if (file.startsWith('docs/')) return 'docs'
  if (/baseline|\.baseline\.|budget/.test(file)) return 'baseline'
  return 'code'
}

/** red → green 之间 first-parent 上的非合并提交有没有碰 code 桶；同一个 head（重跑就绿）= false；本机缺对象 = null。 */
export function codeChangedBetween(git, redHead, greenHead) {
  if (!greenHead) return null
  if (redHead === greenHead) return false
  try {
    const commits = git(['rev-list', '--first-parent', '--no-merges', `${redHead}..${greenHead}`]).split('\n').filter(Boolean)
    for (const commit of commits) {
      const files = git(['show', '--name-only', '--format=', commit]).split('\n').filter(Boolean)
      if (files.some((file) => codeBucket(file) === 'code')) return true
    }
    return false
  } catch { return null }
}

/** 同一分支在 `at` 之后（含）最早一次绿的 PR 运行的 head。 */
export function nextGreenHead(greens, branch, at) {
  return greens.filter((run) => run.headBranch === branch && run.createdAt >= at).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.headSha ?? null
}

/**
 * 把窗口内的运行展开成「一轮红」的记录（最终失败 + 重跑之前失败的那几次）。取数函数注入（测试用假的）：
 *   attemptConclusion(runId, n) → 'failure' | 'success' | …；jobs(runId, n) → [{ id, name, conclusion }]；log(jobId) → 文本
 */
export function collectRedRounds({ runs, attemptConclusion, jobs, log }) {
  const rounds = []
  for (const run of runs.filter((entry) => entry.event === 'pull_request')) {
    const attempts = []
    for (let n = 1; n < (run.attempt ?? 1); n += 1) if (attemptConclusion(run.databaseId, n) === 'failure') attempts.push({ n, final: false })
    if (run.conclusion === 'failure') attempts.push({ n: run.attempt ?? 1, final: true })
    for (const { n, final } of attempts) {
      const jobList = jobs(run.databaseId, n)
      const failedJobs = [...new Set(jobList.filter((job) => job.name !== QUALITY_GATE_WORKFLOW && FAILED.has(job.conclusion)).map((job) => job.name.replace(/ \(\d+\)$/, '')))].sort()
      const contracts = jobList.find((job) => job.name === CONTRACTS_JOB && FAILED.has(job.conclusion))
      const summary = contracts ? parseContractsSummary(log(contracts.id)) : null
      const gates = summary ? summary.gates : contracts ? null : []
      // 没有哪个 job 真失败、只是被取消（没分到机器、被手动取消）：PR 上照样是红的、要人重跑，但不是哪道门岗拦的，单列
      const cancelledOnly = !jobList.some((job) => job.name !== QUALITY_GATE_WORKFLOW && FAILED.has(job.conclusion) && job.conclusion !== 'cancelled')
      rounds.push({ runId: run.databaseId, attempt: n, final, branch: run.headBranch, head: run.headSha, at: run.createdAt, failedJobs, gates, cancelledOnly, ...classifyRed({ failedJobs, gates }) })
    }
  }
  return rounds
}

export function summarize(rounds) {
  const byGate = new Map()
  for (const round of rounds) for (const gate of round.gates ?? ['（Contracts 日志里没有汇总）']) byGate.set(gate, (byGate.get(gate) ?? 0) + 1)
  const count = (pick) => rounds.filter(pick).length
  return {
    redRounds: rounds.length,
    finalReds: count((round) => round.final),
    hiddenReds: count((round) => !round.final),
    cancelledOnly: count((round) => round.cancelledOnly),
    bodyClass: count((round) => round.bodyClass),
    bodyOnly: count((round) => round.bodyOnly),
    codeChanged: { yes: count((round) => round.codeChanged === true), no: count((round) => round.codeChanged === false), unknown: count((round) => round.codeChanged == null) },
    bodyOnlyCodeChanged: count((round) => round.bodyOnly && round.codeChanged === true),
    byGate: [...byGate.entries()].sort((a, b) => b[1] - a[1]),
  }
}

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

function cached(dir, key, load) {
  const file = path.join(dir, key)
  try { return fs.readFileSync(file, 'utf8') } catch { /* 没缓存 */ }
  const text = load()
  fs.writeFileSync(file, text)
  return text
}

export function main(argv = process.argv.slice(2), { eventsFile = undefined, gh = (args) => execGhReadSync(args, { cwd: repoRoot, maxBuffer: 256 * 1024 * 1024, timeout: 180_000 }), git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }), out = (line) => console.log(line) } = {}) {
  const since = argValue(argv, '--since', new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10))
  const until = argValue(argv, '--until', new Date().toISOString())
  const untilIso = new Date(until).toISOString()
  const repo = argValue(argv, '--repo', null)
  const cacheDir = argValue(argv, '--cache', path.join(os.tmpdir(), 'nomi-block-radar'))
  fs.mkdirSync(cacheDir, { recursive: true })
  const withRepo = (args) => (repo ? [...args, '--repo', repo] : args)
  const repoName = repo ?? gh(['api', 'repos/{owner}/{repo}', '--jq', '.full_name']).trim()
  const runs = JSON.parse(gh(withRepo(['run', 'list', '--workflow', QUALITY_GATE_WORKFLOW, '--created', `>=${since}`, '--limit', '1000', '--json', 'attempt,conclusion,createdAt,databaseId,event,headBranch,headSha,status'])))
    .filter((run) => run.createdAt < untilIso && run.status === 'completed')
  if (runs.length >= 1000) out('⚠ gh run list 拿满了 1000 条，窗口前段可能被截掉：把 --since 往后挪')
  const api = (route) => gh(['api', route])
  const rounds = collectRedRounds({
    runs,
    attemptConclusion: (id, n) => JSON.parse(cached(cacheDir, `attempt-${id}-${n}.json`, () => api(`repos/${repoName}/actions/runs/${id}/attempts/${n}`))).conclusion,
    jobs: (id, n) => JSON.parse(cached(cacheDir, `jobs-${id}-${n}.json`, () => api(`repos/${repoName}/actions/runs/${id}/attempts/${n}/jobs?per_page=100`))).jobs,
    log: (jobId) => cached(cacheDir, `log-${jobId}.txt`, () => api(`repos/${repoName}/actions/jobs/${jobId}/logs`)),
  })
  const greens = runs.filter((run) => run.event === 'pull_request' && run.conclusion === 'success')
  const withCode = !argv.includes('--no-code-changed')
  for (const round of rounds) round.codeChanged = withCode ? codeChangedBetween(git, round.head, nextGreenHead(greens, round.branch, round.at)) : null

  // 本机记录（没有就是空）：同样补 codeChanged（下一次绿取 CI 上同一分支的绿）
  let local = { records: [], malformed: 0 }
  try { local = readBlockEvents(eventsFile ?? blockEventsPath({ cwd: repoRoot })) } catch { /* 不在仓库里 = 没有本机记录 */ }
  const localRows = local.records.filter((record) => record.at >= new Date(since).toISOString() && record.at < untilIso)
    .map((record) => ({ ...record, codeChanged: withCode ? codeChangedBetween(git, record.head, nextGreenHead(greens, record.branch, record.at)) : null }))

  const summary = summarize(rounds)
  if (argv.includes('--json')) {
    out(JSON.stringify({ since, until: untilIso, repo: repoName, summary, rounds, local: { rows: localRows, malformed: local.malformed } }, null, 1))
    return 0
  }
  out(`被拦雷达 · ${repoName} · ${since} → ${untilIso}（Quality Gate，PR 上）`)
  out(`  红的轮次 ${summary.redRounds}（最终失败 ${summary.finalReds} + 重跑之前失败 ${summary.hiddenReds}；其中没有 job 真失败、只是被取消的 ${summary.cancelledOnly}）`)
  out(`  带正文判据（${BODY_GATE} 红）${summary.bodyClass}；只有正文（只有 Contracts 红、且只有 ${BODY_GATE}）${summary.bodyOnly}`)
  out(`  红完改了代码 ${summary.codeChanged.yes} / 没改 ${summary.codeChanged.no} / 算不出 ${summary.codeChanged.unknown}（「只有正文」里改了代码的 ${summary.bodyOnlyCodeChanged}）`)
  out('  按门岗（Contracts 里红的；一轮可以算进几道）：')
  for (const [gate, count] of summary.byGate.slice(0, 15)) out(`    ${String(count).padStart(4)}  ${gate}`)
  const byStage = new Map()
  for (const row of localRows) for (const gate of row.gates) byStage.set(`${row.stage} · ${gate}`, (byStage.get(`${row.stage} · ${gate}`) ?? 0) + 1)
  out(`本机记录（nomi-block-events.jsonl）：${localRows.length} 次阻断${local.malformed ? `，坏行 ${local.malformed}` : ''}`)
  for (const [key, count] of [...byStage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) out(`    ${String(count).padStart(4)}  ${key}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
