import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateStats, parseLedger } from './codex-ledger-stats.mjs'

const categories = { 'semantic-change': '语义改变', 'partial-gates': '门岗未完整执行', 'evidence-missing': '证据缺失' }
const row = (overrides = {}) => JSON.stringify({ date: '2026-10-08', line: 'L-1', kind: 'implementation', pr: 1, outcome: 'accepted-first-pass', defects: [], note: '', ...overrides })

test('坏行和未知取值会失败', () => {
  assert.throws(() => parseLedger('{bad json}', categories), /invalid JSON/)
  assert.throws(() => parseLedger(row({ kind: 'other' }), categories), /unknown kind/)
  assert.throws(() => parseLedger(row({ defects: ['not-registered'] }), categories), /unknown defect/)
})

test('统计首轮通过率、CI 红比例和类别排行', () => {
  const rows = parseLedger([row(), row({ outcome: 'returned-by-coordinator', defects: ['semantic-change'] }), row({ kind: 'research', outcome: 'ci-red-after-push', defects: ['semantic-change', 'partial-gates'] })].join('\n'), categories)
  const stats = calculateStats(rows, 'semantic-change', categories)
  assert.equal(stats.firstPassByKind.implementation.rate, 0.5)
  assert.equal(stats.firstPassByKind.research.firstPass, 0)
  assert.equal(stats.ciRedAfterPush.rate, 1 / 3)
  assert.deepEqual(stats.defectRanking[0], { id: 'semantic-change', name: '语义改变', count: 2 })
})

test('累计至少两次且质量画像未提及的类别会列出', () => {
  const rows = parseLedger([row({ defects: ['partial-gates'] }), row({ line: 'L-2', defects: ['partial-gates'] }), row({ line: 'L-3', defects: ['evidence-missing'] }), row({ line: 'L-4', defects: ['evidence-missing'] })].join('\n'), categories)
  const stats = calculateStats(rows, 'partial-gates', categories)
  assert.deepEqual(stats.unmentioned, [{ id: 'evidence-missing', name: '证据缺失', count: 2 }])
})
