import assert from 'node:assert/strict'
import test from 'node:test'
import { compareResults } from './release-core-compare.results.mjs'

const receipt = () => ({ schema: 1, complete: true, exitCode: 0, mode: 'rehearsal', commit: 'a'.repeat(40),
  contract: { inputHash: 'b'.repeat(64), brain: { vendorKey: 'test', modelKey: 'brain' }, image: { vendorKey: 'test', modelKey: 'image' }, parameters: {}, language: 'zh', locale: 'zh-CN', draftTurns: 1, maxImages: 5 },
  draft: { success: true, shotCount: 4, toolCalls: 1, failures: 0, retries: 0, manualSteps: 0, placeholders: 0, elapsedMs: 10000 },
  batch: { shots: Array.from({ length: 5 }, (_, i) => ({ shotId: `shot-${i + 1}`, outcome: 'success' })), elapsedMs: 10000,
    longestUnresponsiveMs: 100, heartbeat: { samples: 5 }, rtts: [10], busyReleased: true, rejectedRetries: 0 } })

test('equal observations tie; one missing successful image cannot be offset by faster completion', () => {
  const before = receipt(), after = receipt()
  assert.equal(compareResults(before, after).verdict, '持平')
  after.batch.shots[4].outcome = 'failed'
  after.batch.elapsedMs = 5000
  assert.equal(compareResults(before, after).verdict, '变差')
  assert.equal(compareResults(after, before).verdict, '变差', 'Slowdown still blocks an image improvement')
  after.batch.elapsedMs = before.batch.elapsedMs
  assert.equal(compareResults(after, before).verdict, '变好')
})

test('duration and responsiveness thresholds include their exact boundary', () => {
  const before = receipt(), after = receipt()
  after.batch.elapsedMs = 12000
  after.batch.longestUnresponsiveMs = 300
  assert.equal(compareResults(before, after).verdict, '持平')
  after.batch.elapsedMs++
  assert.equal(compareResults(before, after).verdict, '变差')
  after.batch.elapsedMs = 10000
  before.batch.longestUnresponsiveMs = 999
  after.batch.longestUnresponsiveMs = 1001
  assert.equal(compareResults(before, after).verdict, '变差')
})

test('missing, nonfinite, duplicated, incomplete and mismatched evidence blocks comparison', () => {
  const mutations = [
    r => { delete r.draft.toolCalls }, r => { r.batch.longestUnresponsiveMs = NaN },
    r => { r.batch.shots[4].shotId = 'shot-1' }, r => { r.complete = false },
    r => { r.mode = 'paid' }, r => { r.contract.inputHash = 'c'.repeat(64) },
    r => { r.contract.locale = 'en' }, r => { r.contract.parameters.size = 'other' },
    r => { r.batch.heartbeat.samples = 0 }, r => { r.batch.busyReleased = null },
    r => { r.exitCode = 1 }, r => { delete r.exitCode },
  ]
  for (const mutate of mutations) {
    const after = receipt(); mutate(after)
    assert.throws(() => compareResults(receipt(), after))
  }
})

test('each adverse metric and stuck/failed ordering blocks the release', () => {
  for (const key of ['toolCalls', 'failures', 'retries', 'manualSteps', 'placeholders']) {
    const after = receipt(); after.draft[key]++
    assert.equal(compareResults(receipt(), after).verdict, '变差', key)
  }
  const after = receipt(); after.batch.busyReleased = false
  assert.equal(compareResults(receipt(), after).verdict, '变差')
  const before = receipt(); before.batch.shots[0].outcome = 'failed'
  after.batch.busyReleased = true; after.batch.shots[0].outcome = 'stuck'
  assert.equal(compareResults(before, after).verdict, '变差')
})
