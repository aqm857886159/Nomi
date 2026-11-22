import { makeTempDir } from './_test-temp.mjs'
// scripts/eng-metrics.mjs 的行为测试：先声明 recurrence_of、后 Simple S-sym 兜底估算、两数严格分报、--candidates 候选推荐、永远 exit 0。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildReport,
  computeDue,
  computeEscape,
  computeFalsePositive,
  computeRecurrence,
  fetchRuns,
  findRecurrenceCandidates,
  formatCandidates,
  formatLine,
  parseCsv,
  readContracts,
} from './eng-metrics.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

function repoWith(contracts) {
  const repo = makeTempDir('nomi-eng-metrics-')
  const dir = path.join(repo, 'docs', 'fixes')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(contracts)) fs.writeFileSync(path.join(dir, name), JSON.stringify(body))
  return repo
}

const contractWith = ({
  files = ['electron/a.ts'],
  boundaries = [],
  change_kind,
  recurrence_of,
  detected_by,
  recurrence_check_on,
  problem_type,
} = {}) => {
  const doc = { scope_paths: files }
  if (boundaries.length > 0) {
    doc.shared_boundaries = boundaries.map(([p, symbol]) => ({ path: p, symbol, responsibility: 'guard' }))
  }
  if (change_kind !== undefined) doc.change_kind = change_kind
  if (recurrence_of !== undefined) doc.recurrence_of = recurrence_of
  if (detected_by !== undefined) doc.detected_by = detected_by
  if (recurrence_check_on !== undefined) doc.recurrence_check_on = recurrence_check_on
  if (problem_type !== undefined) doc.problem_type = problem_type
  return doc
}

test('30 天复发：声明复发（recurrence_of）与旧合同兜底估算（Simple S-sym）严格拆成两个数，排除 structural', () => {
  const repo = repoWith({
    // 旧合同（未填 recurrence_of）
    '2026-10-01-legacy-a.root-cause.json': contractWith({
      files: ['electron/a.ts', 'electron/b.ts'],
      boundaries: [['electron/a.ts', 'guardA']],
    }),
    // 同非枢纽边界符号且 ≤30 天 -> 旧合同兜底命中
    '2026-10-10-legacy-b.root-cause.json': contractWith({
      files: ['electron/a.ts', 'electron/c.ts'],
      boundaries: [['electron/a.ts', 'guardA']],
    }),
    // 仅共享文件/同路径不同符号 -> Simple S-sym 不误报
    '2026-10-12-legacy-c.root-cause.json': contractWith({
      files: ['electron/a.ts', 'electron/b.ts'],
      boundaries: [['electron/a.ts', 'otherSymbol']],
    }),
    // 超过 30 天 -> 不算 30 天复发
    '2026-12-01-legacy-d.root-cause.json': contractWith({
      files: ['electron/a.ts'],
      boundaries: [['electron/a.ts', 'guardA']],
    }),
    // structural 合同 -> 排除出复发分母与命中
    '2026-10-08-struct.root-cause.json': contractWith({
      files: ['electron/a.ts'],
      boundaries: [['electron/a.ts', 'guardA']],
      change_kind: 'structural',
    }),
    // 新合同：显式声明 recurrence_of: null（不复发）
    '2026-10-15-declared-null.root-cause.json': contractWith({
      files: ['electron/a.ts'],
      boundaries: [['electron/a.ts', 'guardA']],
      recurrence_of: null,
    }),
    // 新合同：显式声明 recurrence_of 指向 30 天内旧合同（声明复发）
    '2026-10-20-declared-hit.root-cause.json': contractWith({
      files: ['electron/z.ts'],
      recurrence_of: '2026-10-01-legacy-a',
    }),
    // 新合同：显式声明 recurrence_of 指向超过 30 天的旧合同（不算 30 天内复发）
    '2026-11-25-declared-old.root-cause.json': contractWith({
      files: ['electron/z.ts'],
      recurrence_of: ['2026-10-01-legacy-a.root-cause.json'],
    }),
  })
  const result = computeRecurrence(readContracts(repo))
  assert.deepEqual(result, {
    declared: { recurred: 1, total: 3 },
    estimated: { recurred: 1, total: 4 },
  })
  fs.rmSync(repo, { recursive: true, force: true })
})

test('逃逸率：只数带 detected_by 的合同；没有样本时 formatLine 写「—」不写 0%', () => {
  assert.deepEqual(computeEscape([{ detected_by: 'user' }, { detected_by: 'ci' }, { detected_by: 'post-release' }, {}]), { escaped: 2, total: 3 })
  const line = formatLine({
    escape: computeEscape([]),
    recurrence: { declared: { recurred: 0, total: 0 }, estimated: { recurred: 0, total: 0 } },
    falsePositive: { error: '今天没查成：gh 不可用或没登录' },
    due: { declared: { due: 0, recurredAfter: 0 }, estimated: { due: 0, recurredAfter: 0 } },
  })
  assert.match(line, /逃逸率 —（合同还没带 detected_by）/)
  assert.match(line, /30 天复发 声明 —（0\/0） \/ 旧合同估算 —（0\/0）/)
  assert.match(line, /门岗误报 —（今天没查成/)
  assert.match(line, /到期合同 声明 0 份（复发 0 份） \/ 旧合同估算 0 份（复发 0 份）/)
  assert.doesNotMatch(line, /0%/)
})

test('到期合同：声明与旧合同估算分开统计，排除 structural，老合同不追溯', () => {
  const repo = repoWith({
    '2026-09-01-old.root-cause.json': contractWith({
      files: ['electron/a.ts'],
      boundaries: [['electron/a.ts', 'guardA']],
    }),
    // 旧合同到期（2026-11-02），17 天后被同边界符号旧合同命中
    '2026-10-03-legacy-due.root-cause.json': contractWith({
      files: ['electron/a.ts'],
      boundaries: [['electron/a.ts', 'guardA']],
    }),
    '2026-10-20-legacy-again.root-cause.json': contractWith({
      files: ['electron/a.ts'],
      boundaries: [['electron/a.ts', 'guardA']],
    }),
    // structural 到期不计入
    '2026-10-04-struct-due.root-cause.json': contractWith({
      files: ['electron/a.ts'],
      change_kind: 'structural',
    }),
    // 声明合同到期（2026-11-04），被后继合同显式 recurrence_of 指认
    '2026-10-05-declared-due.root-cause.json': contractWith({
      files: ['electron/x.ts'],
      recurrence_of: null,
    }),
    '2026-10-25-declared-followup.root-cause.json': contractWith({
      files: ['electron/y.ts'],
      recurrence_of: '2026-10-05-declared-due',
    }),
    // 显式 recurrence_check_on 在未来
    '2026-12-01-explicit.root-cause.json': contractWith({
      files: ['electron/k.ts'],
      recurrence_of: null,
      recurrence_check_on: '2026-12-31',
    }),
  })
  const contracts = readContracts(repo)
  assert.deepEqual(computeDue(contracts, '2026-11-15'), {
    declared: { due: 1, recurredAfter: 1 },
    estimated: { due: 1, recurredAfter: 1 },
  })
  assert.deepEqual(computeDue(contracts, '2026-10-05'), {
    declared: { due: 0, recurredAfter: 0 },
    estimated: { due: 0, recurredAfter: 0 },
  })
  assert.deepEqual(computeDue(contracts, '2027-01-02'), {
    declared: { due: 3, recurredAfter: 1 },
    estimated: { due: 2, recurredAfter: 1 },
  })
  fs.rmSync(repo, { recursive: true, force: true })
})

test('--candidates 候选推荐：优先共享非枢纽边界符号，其次边界路径与文件交集，排除自身与 structural', () => {
  const repo = repoWith({
    '2026-10-01-exact-sym.root-cause.json': contractWith({
      files: ['electron/pay.ts', 'electron/outbox.ts'],
      boundaries: [['electron/pay.ts', 'submitOnce']],
      problem_type: 'paid submit blind resend',
    }),
    '2026-10-05-same-path.root-cause.json': contractWith({
      files: ['electron/pay.ts', 'electron/other.ts'],
      boundaries: [['electron/pay.ts', 'otherHelper']],
      problem_type: 'same boundary file different symbol',
    }),
    '2026-10-08-file-only.root-cause.json': contractWith({
      files: ['electron/outbox.ts', 'electron/unrelated.ts'],
      boundaries: [['electron/unrelated.ts', 'noop']],
      problem_type: 'only scope file overlap',
    }),
    '2026-10-09-struct.root-cause.json': contractWith({
      files: ['electron/pay.ts'],
      boundaries: [['electron/pay.ts', 'submitOnce']],
      change_kind: 'structural',
      problem_type: 'structural refactor',
    }),
    '2026-10-10-draft.root-cause.json': contractWith({
      files: ['electron/pay.ts', 'electron/outbox.ts'],
      boundaries: [['electron/pay.ts', 'submitOnce']],
      problem_type: 'new draft contract',
    }),
  })
  const contracts = readContracts(repo)
  const target = contracts.find((c) => c.slug === '2026-10-10-draft')
  const candidates = findRecurrenceCandidates(target, contracts)
  assert.deepEqual(
    candidates.map((c) => c.slug),
    ['2026-10-01-exact-sym', '2026-10-05-same-path', '2026-10-08-file-only'],
  )
  assert.deepEqual(candidates[0].sharedBoundarySymbols, ['electron/pay.ts::submitOnce'])
  const text = formatCandidates(candidates, target.slug)
  assert.match(text, /2026-10-01-exact-sym/)
  assert.match(text, /electron\/pay\.ts::submitOnce/)

  const draftPath = path.join(repo, 'docs', 'fixes', '2026-10-10-draft.root-cause.json')
  const cli = spawnSync(process.execPath, [path.join(here, 'eng-metrics.mjs'), '--candidates', draftPath, '--repo', repo], { encoding: 'utf8' })
  assert.equal(cli.status, 0)
  assert.match(cli.stdout, /2026-10-01-exact-sym/)
  assert.doesNotMatch(cli.stdout, /2026-10-09-struct/)
  fs.rmSync(repo, { recursive: true, force: true })
})

test('门岗误报代理：失败 run 的同一 head SHA 后来又成功 = 重跑就绿；窗口外不算', () => {
  const runs = [
    { sha: 'a', conclusion: 'failure', createdAt: '2026-10-01T00:00:00Z' },
    { sha: 'a', conclusion: 'success', createdAt: '2026-10-01T01:00:00Z' },
    { sha: 'b', conclusion: 'failure', createdAt: '2026-10-01T00:00:00Z' },
    { sha: 'c', conclusion: 'failure', createdAt: '2025-01-01T00:00:00Z' },
  ]
  assert.deepEqual(computeFalsePositive(runs, '2026-10-02'), { rerunGreen: 1, failed: 2, coveredDays: 2 })
})

test('门岗误报：重跑沿用同一个运行号、结论被覆盖成成功——按 attempt > 1 认出来，不再算成 0', () => {
  const runs = [
    { sha: 'a', conclusion: 'success', createdAt: '2026-11-20T02:00:00Z', attempt: 2 },
    { sha: 'b', conclusion: 'failure', createdAt: '2026-11-20T03:00:00Z', attempt: 1 },
    { sha: 'c', conclusion: 'failure', createdAt: '2026-11-20T04:00:00Z', attempt: 2 },
    { sha: 'd', conclusion: 'success', createdAt: '2026-11-20T05:00:00Z', attempt: 1 },
    { sha: 'e', conclusion: 'cancelled', createdAt: '2026-11-13T05:00:00Z', attempt: 1 },
  ]
  assert.deepEqual(computeFalsePositive(runs, '2026-11-21'), { rerunGreen: 1, failed: 3, coveredDays: 9 })
  const blind = computeFalsePositive(runs.map((run) => ({ sha: run.sha, conclusion: run.conclusion, createdAt: run.createdAt })), '2026-11-21')
  assert.equal(blind.rerunGreen, 0)
})

test('门岗误报那一段印出实际覆盖的天数；缺 attempt 的旧缓存当天作废重取', () => {
  const line = formatLine({
    escape: { escaped: 0, total: 0 },
    recurrence: { declared: { recurred: 0, total: 0 }, estimated: { recurred: 0, total: 0 } },
    falsePositive: { rerunGreen: 8, failed: 39, coveredDays: 9 },
    due: { declared: { due: 0, recurredAfter: 0 }, estimated: { due: 0, recurredAfter: 0 } },
  })
  assert.match(line, /门岗误报 21%（8\/39，近 9 天）/)
  const repo = repoWith({})
  const cacheFile = path.join(repo, '.claude', 'eng-metrics-cache.json')
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  fs.writeFileSync(cacheFile, JSON.stringify({ date: '2026-11-21', runs: [{ sha: 'old', conclusion: 'failure', createdAt: '2026-11-20T00:00:00Z' }] }))
  const ghRun = () => JSON.stringify([{ headSha: 'a', conclusion: 'success', createdAt: '2026-11-20T02:00:00Z', attempt: 2 }])
  assert.deepEqual(fetchRuns({ today: '2026-11-21', cacheFile, ghRun }).runs, [{ sha: 'a', conclusion: 'success', createdAt: '2026-11-20T02:00:00Z', attempt: 2 }])
  fs.rmSync(repo, { recursive: true, force: true })
})

test('CI 数据每天只打一次 API：同一天第二次读缓存；gh 不可用时明说没查成，不用旧缓存冒充', () => {
  const repo = repoWith({})
  const cacheFile = path.join(repo, '.claude', 'eng-metrics-cache.json')
  let calls = 0
  const ghRun = () => {
    calls += 1
    return JSON.stringify([{ headSha: 'a', conclusion: 'failure', createdAt: '2026-10-01T00:00:00Z' }])
  }
  assert.equal(fetchRuns({ today: '2026-10-02', cacheFile, ghRun }).runs.length, 1)
  assert.equal(fetchRuns({ today: '2026-10-02', cacheFile, ghRun }).runs.length, 1)
  assert.equal(calls, 1)
  const broken = () => {
    throw new Error('no gh')
  }
  assert.match(fetchRuns({ today: '2026-10-03', cacheFile, ghRun: broken }).error, /今天没查成/)
  fs.rmSync(repo, { recursive: true, force: true })
})

test('buildReport 把四项拼成一行且复发两数分报；parseCsv 认带引号的逗号', () => {
  const repo = repoWith({
    '2026-10-03-new.root-cause.json': contractWith({
      files: ['electron/a.ts', 'electron/b.ts'],
      detected_by: 'user',
      recurrence_of: null,
    }),
  })
  const line = buildReport({ repo, today: '2026-11-20', noCi: true })
  assert.match(
    line,
    /^逃逸率 100%（1\/1） · 30 天复发 声明 0%（0\/1） \/ 旧合同估算 —（0\/0） · 门岗误报 —（本次没查 CI） · 到期合同 声明 1 份（复发 0 份） \/ 旧合同估算 0 份（复发 0 份）$/,
  )
  assert.deepEqual(parseCsv('a,"b,c",d\n1,2,3\n'), [['a', 'b,c', 'd'], ['1', '2', '3']])
  fs.rmSync(repo, { recursive: true, force: true })
})

test('命令行永远 exit 0，且只打印一行', () => {
  const result = spawnSync(process.execPath, [path.join(here, 'eng-metrics.mjs'), '--no-ci'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim().split('\n').length, 1)
  assert.match(
    result.stdout,
    /逃逸率 .* · 30 天复发 声明 .* \/ 旧合同估算 .* · 门岗误报 .* · 到期合同 声明 \d+ 份（复发 \d+ 份） \/ 旧合同估算 \d+ 份（复发 \d+ 份）/,
  )
})
