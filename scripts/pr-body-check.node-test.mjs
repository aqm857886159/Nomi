// 「PR Body」检查结论的读法（scripts/lib/prBodyCheck.mjs）：合并前扫描靠它决定放不放行。
// 形状来自真实的 `gh pr view --json statusCheckRollup`（2026-11-07 草稿 PR 实测）：同一个 head 上同名检查可以有好几条
// （opened → edited → edited，旧的被并发组取消），排队中的那条 startedAt 是 0001-01-01。
import assert from 'node:assert/strict'
import test from 'node:test'

import { PR_BODY_CHECK_NAME, PR_BODY_WORKFLOW_NAME, prBodyCheckVerdict } from './lib/prBodyCheck.mjs'

const QUEUED_AT = '0001-01-01T00:00:00Z'
const run = (overrides = {}) => ({
  __typename: 'CheckRun',
  name: PR_BODY_CHECK_NAME,
  workflowName: PR_BODY_WORKFLOW_NAME,
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  startedAt: '2026-11-07T03:00:00Z',
  completedAt: '2026-11-07T03:00:20Z',
  detailsUrl: 'https://github.com/o/r/actions/runs/1/job/2',
  ...overrides,
})
const qualityGate = { __typename: 'CheckRun', name: 'Quality Gate', workflowName: 'Quality Gate', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-07T03:00:00Z', completedAt: '2026-11-07T03:20:00Z' }
const later = { startedAt: '2026-11-07T03:05:00Z', completedAt: '2026-11-07T03:05:20Z' }

test('green only when the latest PR Body run on the head is SUCCESS', () => {
  assert.equal(prBodyCheckVerdict([qualityGate, run()]).state, 'success')
  assert.equal(prBodyCheckVerdict([qualityGate, run()]).ok, true)
  // 先红后绿：改完正文自动重判绿了 = 放行（这正是拆出来的目的）
  assert.equal(prBodyCheckVerdict([run({ conclusion: 'FAILURE' }), run(later)]).ok, true)
  // 先绿后红：正文又改坏了 = 拒，不能拿旧绿灯放行
  const regressed = prBodyCheckVerdict([run(), run({ ...later, conclusion: 'FAILURE' })])
  assert.equal(regressed.ok, false)
  assert.equal(regressed.state, 'failure')
  assert.match(regressed.line, /FAILURE/)
  assert.match(regressed.line, /actions\/runs\/1/)
  // 列表里的先后不算数，按完成时间
  assert.equal(prBodyCheckVerdict([run({ ...later, conclusion: 'FAILURE' }), run()]).ok, false)
})

test('a run that has not finished blocks even when an older run is green (queued runs carry a fake start time)', () => {
  for (const pending of [
    run({ ...later, status: 'IN_PROGRESS', conclusion: '', completedAt: QUEUED_AT }),
    run({ status: 'QUEUED', conclusion: '', startedAt: QUEUED_AT, completedAt: QUEUED_AT }),
    run({ status: 'PENDING', conclusion: null, startedAt: null, completedAt: null }),
  ]) {
    const verdict = prBodyCheckVerdict([run(), pending])
    assert.equal(verdict.ok, false)
    assert.equal(verdict.state, 'pending')
    assert.match(verdict.line, /还在跑/)
  }
})

test('cancelled, timed out, skipped or failed latest runs all block, each with its conclusion named', () => {
  for (const conclusion of ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'SKIPPED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'NEUTRAL', '']) {
    const verdict = prBodyCheckVerdict([run({ conclusion })])
    assert.equal(verdict.ok, false, conclusion)
    assert.equal(verdict.state, 'failure')
    assert.match(verdict.line, conclusion ? new RegExp(conclusion) : /未知结论/)
  }
})

test('no PR Body check at all blocks and says how to trigger one; other workflows with the same job name do not count', () => {
  for (const rollup of [[], [qualityGate], null, undefined, 'not-a-list',
    [run({ workflowName: 'Quality Gate' })],
    [{ __typename: 'StatusContext', context: PR_BODY_CHECK_NAME, state: 'SUCCESS' }],
  ]) {
    const verdict = prBodyCheckVerdict(rollup)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.state, 'missing')
    assert.match(verdict.line, /gh pr edit/)
  }
})
