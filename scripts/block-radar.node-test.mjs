// 被拦雷达（scripts/block-radar.mjs）：解析 CI 汇总、展开重跑之前的红、分「带正文 / 只有正文」、算红完改没改代码。
// 汇总格式用真汇总函数（scripts/run-gates-contracts.mjs 的 runGateSuite）现场生成：那边改一个字，这里就红（变异守护）。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'
import { BODY_GATE, classifyRed, codeBucket, codeChangedBetween, collectRedRounds, main, nextGreenHead, parseContractsSummary, stripLogPrefix, summarize } from './block-radar.mjs'
import { runGateSuite } from './run-gates-contracts.mjs'

/** 像 Actions 的 job 日志那样给每行加时间戳，首行带 BOM。 */
const asActionsLog = (text) => text.split('\n').map((line, index) => `${index === 0 ? '﻿' : ''}2026-11-06T10:00:${String(index % 60).padStart(2, '0')}.1234567Z ${line}`).join('\n')

async function realSummary(results) {
  let text = ''
  await runGateSuite({
    gates: Object.keys(results),
    advisory: new Set(['check:docs-index']),
    runGate: async (name) => results[name],
    write: (chunk) => { text += chunk },
    env: {},
  })
  return text
}

test('the real gates:contracts summary parses back to exactly the blocking gates (format mutation turns this red)', async () => {
  const text = await realSummary({
    'check:a': { code: 0, output: '' },
    [BODY_GATE]: { code: 1, output: '✖ 独立验收没有带报告链接\n  · 正文缩进行（退出码 9）不是门岗\n' },
    'check:docs-index': { code: 1, output: 'advisory 不算阻断\n' },
    'lint:ci': { code: 'signal:SIGTERM', output: 'killed\n' },
  })
  assert.deepEqual(parseContractsSummary(asActionsLog(text)), { declared: 2, gates: [BODY_GATE, 'lint:ci'] })
  assert.deepEqual(parseContractsSummary(text), { declared: 2, gates: [BODY_GATE, 'lint:ci'] }, '本机输出（没有时间戳）同样认得')
  // 全绿：没有阻断汇总
  assert.equal(parseContractsSummary(asActionsLog(await realSummary({ 'check:a': { code: 0, output: '' } }))), null)
})

test('a log without the summary (job died before the gates) is null, not "no gates failed"', () => {
  assert.equal(parseContractsSummary(asActionsLog('Run pnpm install --frozen-lockfile\nERR_PNPM_FETCH_404\n##[error]Process completed with exit code 1.')), null)
  assert.equal(stripLogPrefix('﻿2026-10-24T01:13:12.1677562Z Current runner version'), 'Current runner version')
})

test('only-body = only Contracts failed and inside it only the body criteria; body-class = the body criteria among the reds', () => {
  assert.deepEqual(classifyRed({ failedJobs: ['Contracts'], gates: [BODY_GATE] }), { bodyClass: true, bodyOnly: true })
  assert.deepEqual(classifyRed({ failedJobs: ['Contracts'], gates: [BODY_GATE, 'typecheck'] }), { bodyClass: true, bodyOnly: false })
  assert.deepEqual(classifyRed({ failedJobs: ['Contracts', 'Unit'], gates: [BODY_GATE] }), { bodyClass: true, bodyOnly: false })
  assert.deepEqual(classifyRed({ failedJobs: ['Contracts'], gates: null }), { bodyClass: false, bodyOnly: false })
  assert.deepEqual(classifyRed({ failedJobs: ['Unit'], gates: [] }), { bodyClass: false, bodyOnly: false })
})

const RUNS = [
  // 重跑过：第 1 次只有正文红，最终绿（这一轮在 run 列表里看不见）
  { databaseId: 1, attempt: 2, conclusion: 'success', event: 'pull_request', headBranch: 'fix/a', headSha: 'a1', createdAt: '2026-11-01T00:00:00Z' },
  // 最终红：正文 + 类型检查，另有 Unit 分片红
  { databaseId: 2, attempt: 1, conclusion: 'failure', event: 'pull_request', headBranch: 'fix/b', headSha: 'b1', createdAt: '2026-11-01T01:00:00Z' },
  // Contracts 红但日志里没有汇总（装依赖就挂了）
  { databaseId: 3, attempt: 1, conclusion: 'failure', event: 'pull_request', headBranch: 'fix/c', headSha: 'c1', createdAt: '2026-11-01T02:00:00Z' },
  // 不算：main 推送、取消
  { databaseId: 4, attempt: 1, conclusion: 'failure', event: 'push', headBranch: 'main', headSha: 'm1', createdAt: '2026-11-01T03:00:00Z' },
  { databaseId: 5, attempt: 1, conclusion: 'cancelled', event: 'pull_request', headBranch: 'fix/d', headSha: 'd1', createdAt: '2026-11-01T04:00:00Z' },
  // 重跑过：第 1 次只有一个 job 被取消（没分到机器、一步没跑）、汇总 job 红——PR 上是红的，但没有哪道门岗拦，单独计数
  { databaseId: 7, attempt: 2, conclusion: 'success', event: 'pull_request', headBranch: 'fix/e', headSha: 'e1', createdAt: '2026-11-01T05:00:00Z' },
]
const JOBS = {
  '1-1': [{ id: 11, name: 'Contracts', conclusion: 'failure' }, { id: 12, name: 'Unit (1)', conclusion: 'success' }, { id: 13, name: 'Quality Gate', conclusion: 'failure' }],
  '2-1': [{ id: 21, name: 'Contracts', conclusion: 'failure' }, { id: 22, name: 'Unit (2)', conclusion: 'failure' }, { id: 23, name: 'Unit (3)', conclusion: 'failure' }],
  '3-1': [{ id: 31, name: 'Contracts', conclusion: 'failure' }],
  '7-1': [{ id: 71, name: 'Mac Package', conclusion: 'cancelled' }, { id: 72, name: 'Contracts', conclusion: 'success' }, { id: 73, name: 'Quality Gate', conclusion: 'failure' }],
}
const LOGS = {
  11: asActionsLog(`❌ 1 个门岗阻断失败：\n  · ${BODY_GATE}（退出码 1）\n      ✖ 独立验收没有带报告链接\n\n  这一轮已经跑完全部门岗，上面就是**全部**需要修的东西——一次改完，不用一轮推一个。`),
  21: asActionsLog(`❌ 2 个门岗阻断失败：\n  · ${BODY_GATE}（退出码 1）\n  · typecheck（退出码 2）\n\n  这一轮已经跑完全部门岗`),
  31: asActionsLog('ERR_PNPM_FETCH_404'),
}

test('red rounds include the failures hidden behind a rerun; push and cancelled runs are not PR reds', () => {
  const seen = []
  const rounds = collectRedRounds({
    runs: RUNS,
    attemptConclusion: (id, n) => { seen.push(`${id}-${n}`); return (id === 1 || id === 7) && n === 1 ? 'failure' : 'success' },
    jobs: (id, n) => JOBS[`${id}-${n}`],
    log: (jobId) => LOGS[jobId],
  })
  assert.deepEqual(seen, ['1-1', '7-1'], '只问重跑过的运行的前几次')
  assert.deepEqual(rounds.map(({ runId, attempt, final, failedJobs, gates, bodyClass, bodyOnly, cancelledOnly }) => ({ runId, attempt, final, failedJobs, gates, bodyClass, bodyOnly, cancelledOnly })), [
    { runId: 1, attempt: 1, final: false, failedJobs: ['Contracts'], gates: [BODY_GATE], bodyClass: true, bodyOnly: true, cancelledOnly: false },
    { runId: 2, attempt: 1, final: true, failedJobs: ['Contracts', 'Unit'], gates: [BODY_GATE, 'typecheck'], bodyClass: true, bodyOnly: false, cancelledOnly: false },
    { runId: 3, attempt: 1, final: true, failedJobs: ['Contracts'], gates: null, bodyClass: false, bodyOnly: false, cancelledOnly: false },
    { runId: 7, attempt: 1, final: false, failedJobs: ['Mac Package'], gates: [], bodyClass: false, bodyOnly: false, cancelledOnly: true },
  ])
  const summary = summarize(rounds.map((round) => ({ ...round, codeChanged: round.runId === 2 ? true : round.runId === 1 ? false : null })))
  assert.equal(summary.redRounds, 4, 'PR 上红过就算一轮（要人重跑）')
  assert.equal(summary.cancelledOnly, 1, '其中没有任何 job 真失败、只是被取消的单列，便于和只数失败 job 的口径对账')
  assert.equal(summary.finalReds, 2)
  assert.equal(summary.hiddenReds, 2)
  assert.equal(summary.bodyClass, 2)
  assert.equal(summary.bodyOnly, 1)
  assert.deepEqual(summary.codeChanged, { yes: 1, no: 1, unknown: 2 })
  assert.deepEqual(summary.byGate[0], [BODY_GATE, 2])
})

test('codeChanged: commits between the red head and the next green head on the branch, by path bucket', (t) => {
  const dir = makeTempDir('block-radar-')
  t.after(() => cleanupTestTemp(dir))
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 't@example.com'])
  git(['config', 'user.name', 't'])
  const commit = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
    git(['add', '-A'])
    git(['commit', '-q', '-m', file])
    return git(['rev-parse', 'HEAD']).trim()
  }
  const red = commit('src/a.ts', 'a\n')
  const docsOnly = commit('tests/ux/full-walk/escapeLedger/E-1.json', '{}\n')
  const docsToo = commit('docs/plan/x.md', 'x\n')
  const code = commit('src/a.ts', 'b\n')
  assert.equal(codeChangedBetween(git, red, red), false, '同一个 head 重跑就绿 = 没改代码')
  assert.equal(codeChangedBetween(git, red, docsToo), false, '只补了账本和方案')
  assert.equal(codeChangedBetween(git, docsOnly, code), true)
  assert.equal(codeChangedBetween(git, red, null), null, '后来没再绿过 = 算不出')
  assert.equal(codeChangedBetween(git, red, '0'.repeat(40)), null, '本机没有那个提交 = 算不出')
  assert.equal(codeBucket('docs/fixes/x.root-cause.json'), 'rootcause')
  assert.equal(codeBucket('scripts/walkthrough-baseline.json'), 'baseline')
  assert.equal(codeBucket('scripts/merge-preflight.mjs'), 'code')
  const greens = [{ headBranch: 'fix/a', createdAt: '2026-11-02T00:00:00Z', headSha: 'late' }, { headBranch: 'fix/a', createdAt: '2026-11-01T05:00:00Z', headSha: 'early' }, { headBranch: 'fix/b', createdAt: '2026-11-01T06:00:00Z', headSha: 'other' }]
  assert.equal(nextGreenHead(greens, 'fix/a', '2026-11-01T01:00:00Z'), 'early')
  assert.equal(nextGreenHead(greens, 'fix/a', '2026-11-03T00:00:00Z'), null)
})

test('main: windowed run list, attempts and logs cached by run id, only read-only gh calls', (t) => {
  const cache = makeTempDir('block-radar-cache-')
  t.after(() => cleanupTestTemp(cache))
  const calls = []
  const runs = [...RUNS, { databaseId: 6, attempt: 1, conclusion: 'failure', event: 'pull_request', headBranch: 'fix/late', headSha: 'z', createdAt: '2026-11-09T00:00:00Z', status: 'completed' }].map((run) => ({ status: 'completed', ...run }))
  const gh = (args) => {
    calls.push(args.join(' '))
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs)
    const route = args[1]
    let match
    if ((match = /runs\/(\d+)\/attempts\/(\d+)\/jobs/.exec(route))) return JSON.stringify({ jobs: JOBS[`${match[1]}-${match[2]}`] })
    if ((match = /runs\/(\d+)\/attempts\/(\d+)$/.exec(route))) return JSON.stringify({ conclusion: match[1] === '1' && match[2] === '1' ? 'failure' : 'success' })
    if ((match = /jobs\/(\d+)\/logs/.exec(route))) return LOGS[match[1]]
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }
  const lines = []
  const argv = ['--since', '2026-10-24', '--until', '2026-11-07T00:00:00Z', '--repo', 'o/r', '--cache', cache, '--json', '--no-code-changed']
  assert.equal(main(argv, { eventsFile: path.join(cache, 'none.jsonl'), gh, git: () => '', out: (line) => lines.push(line) }), 0)
  const report = JSON.parse(lines.join('\n'))
  assert.equal(report.summary.redRounds, 3, '窗口外（11-09）那次不算')
  assert.equal(report.summary.bodyOnly, 1)
  assert.ok(calls.every((call) => /^run list |^api repos\/o\/r\/actions\//.test(call)), calls.join('\n'))
  const before = calls.length
  main(argv, { eventsFile: path.join(cache, 'none.jsonl'), gh, git: () => '', out: () => {} })
  assert.equal(calls.length - before, 1, '第二次只重新列运行，attempts / jobs / 日志都走缓存')
})
