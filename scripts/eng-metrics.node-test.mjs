import { makeTempDir } from './_test-temp.mjs'
// scripts/eng-metrics.mjs 的行为测试：三个数的口径、缓存、拿不到就明说「—」、永远 exit 0。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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

const scope = (...files) => ({ scope_paths: files })

test('30 天复发：30 天内与更早合同共享 ≥2 个文件且重叠过半才算；超过 30 天或只共享 1 个不算', () => {
  const repo = repoWith({
    '2026-10-01-a.root-cause.json': scope('electron/a.ts', 'electron/b.ts', 'electron/c.ts'),
    '2026-10-10-b.root-cause.json': scope('electron/a.ts', 'electron/b.ts'),
    '2026-10-12-c.root-cause.json': scope('electron/a.ts', 'electron/zzz.ts'),
    '2026-12-01-d.root-cause.json': scope('electron/a.ts', 'electron/b.ts', 'electron/c.ts'),
  })
  const result = computeRecurrence(readContracts(repo))
  assert.deepEqual(result, { recurred: 1, total: 4 })
  fs.rmSync(repo, { recursive: true, force: true })
})

test('逃逸率：只数带 detected_by 的合同；没有样本时 formatLine 写「—」不写 0%', () => {
  assert.deepEqual(computeEscape([{ detected_by: 'user' }, { detected_by: 'ci' }, { detected_by: 'post-release' }, {}]), { escaped: 2, total: 3 })
  const line = formatLine({
    escape: computeEscape([]),
    recurrence: { recurred: 0, total: 0 },
    falsePositive: { error: '今天没查成：gh 不可用或没登录' },
    due: { due: 0, recurredAfter: 0 },
  })
  assert.match(line, /逃逸率 —（合同还没带 detected_by）/)
  assert.match(line, /门岗误报 —（今天没查成/)
  assert.doesNotMatch(line, /0%/)
})

test('到期合同：recurrence_check_on（缺省文件日期 + 30 天）已到才算，老合同不追溯；到期后又有同类的计入括号', () => {
  const repo = repoWith({
    '2026-09-01-old.root-cause.json': scope('electron/a.ts', 'electron/b.ts'),
    '2026-10-03-new.root-cause.json': scope('electron/a.ts', 'electron/b.ts'),
    '2026-10-20-again.root-cause.json': scope('electron/a.ts', 'electron/b.ts'),
    '2026-12-01-explicit.root-cause.json': { ...scope('electron/x.ts', 'electron/y.ts'), recurrence_check_on: '2026-12-31' },
  })
  const contracts = readContracts(repo)
  assert.deepEqual(computeDue(contracts, '2026-11-15'), { due: 1, recurredAfter: 1 })
  assert.deepEqual(computeDue(contracts, '2026-10-05'), { due: 0, recurredAfter: 0 })
  assert.deepEqual(computeDue(contracts, '2027-01-02'), { due: 3, recurredAfter: 1 })
  fs.rmSync(repo, { recursive: true, force: true })
})

test('门岗误报代理：失败 run 的同一 head SHA 后来又成功 = 重跑就绿；窗口外不算', () => {
  const runs = [
    { sha: 'a', conclusion: 'failure', createdAt: '2026-10-01T00:00:00Z' },
    { sha: 'a', conclusion: 'success', createdAt: '2026-10-01T01:00:00Z' },
    { sha: 'b', conclusion: 'failure', createdAt: '2026-10-01T00:00:00Z' },
    { sha: 'c', conclusion: 'failure', createdAt: '2025-01-01T00:00:00Z' },
  ]
  assert.deepEqual(computeFalsePositive(runs, '2026-10-02'), { rerunGreen: 1, failed: 2 })
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

test('buildReport 把四项拼成一行；parseCsv 认带引号的逗号', () => {
  const repo = repoWith({ '2026-10-03-new.root-cause.json': { ...scope('electron/a.ts', 'electron/b.ts'), detected_by: 'user' } })
  const line = buildReport({ repo, today: '2026-11-20', noCi: true })
  assert.match(line, /^逃逸率 100%（1\/1） · 30 天复发 0%（0\/1） · 门岗误报 —（本次没查 CI） · 到期合同 1 份（同类复发 0 份）$/)
  assert.deepEqual(parseCsv('a,"b,c",d\n1,2,3\n'), [['a', 'b,c', 'd'], ['1', '2', '3']])
  fs.rmSync(repo, { recursive: true, force: true })
})

test('命令行永远 exit 0，且只打印一行', () => {
  const result = spawnSync(process.execPath, [path.join(here, 'eng-metrics.mjs'), '--no-ci'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim().split('\n').length, 1)
  assert.match(result.stdout, /逃逸率 .* · 30 天复发 .* · 门岗误报 .* · 到期合同 \d+ 份（同类复发 \d+ 份）/)
})
