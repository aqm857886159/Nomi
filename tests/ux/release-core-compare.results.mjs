#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const countKeys = ['shotCount', 'toolCalls', 'failures', 'retries', 'manualSteps', 'placeholders']
function validate(record) {
  assert.equal(record.schema, 1, 'Unknown receipt schema')
  assert.equal(record.complete, true, 'Incomplete evidence blocks the release comparison')
  assert.equal(record.exitCode, 0, 'A clean process exit receipt is required')
  assert.ok(['paid', 'rehearsal'].includes(record.mode), 'Missing run mode')
  assert.match(record.commit ?? '', /^[a-f0-9]{40}$/)
  assert.match(record.contract?.inputHash ?? '', /^[a-f0-9]{64}$/)
  assert.ok(record.contract.brain?.vendorKey && record.contract.brain?.modelKey)
  assert.ok(record.contract.image?.vendorKey && record.contract.image?.modelKey)
  assert.ok(record.contract.parameters && typeof record.contract.parameters === 'object')
  assert.equal(record.contract.language, 'zh')
  assert.ok(['zh-CN', 'en'].includes(record.contract.locale))
  assert.equal(record.contract.draftTurns, 1)
  assert.equal(record.contract.maxImages, 5)
  assert.equal(typeof record.draft?.success, 'boolean')
  assert.equal(typeof record.batch?.busyReleased, 'boolean')
  for (const key of countKeys) assert.ok(Number.isInteger(record.draft[key]) && record.draft[key] >= 0, `Invalid draft.${key}`)
  for (const [label, value] of [['draft.elapsedMs', record.draft.elapsedMs], ['batch.elapsedMs', record.batch.elapsedMs],
    ['batch.longestUnresponsiveMs', record.batch.longestUnresponsiveMs], ['batch.rejectedRetries', record.batch.rejectedRetries]]) {
    assert.ok(Number.isFinite(value) && value >= 0, `Missing/invalid ${label}`)
  }
  assert.ok(record.batch.heartbeat?.samples > 0 && record.batch.rtts?.length > 0, 'Missing responsiveness samples')
  assert.equal(record.batch.shots?.length, 5, 'Five per-shot observations are required')
  assert.deepEqual(record.batch.shots.map(shot => shot.shotId).sort(), ['shot-1', 'shot-2', 'shot-3', 'shot-4', 'shot-5'])
  for (const shot of record.batch.shots) assert.ok(['success', 'failed', 'stuck'].includes(shot.outcome), 'Unknown shot outcome')
}

export function compareResults(previous, candidate) {
  validate(previous); validate(candidate)
  assert.equal(previous.mode, candidate.mode, 'Never compare a rehearsal with paid evidence')
  assert.deepEqual(previous.contract, candidate.contract, 'Inputs, language, models and parameters must match')
  const rows = []
  const add = (metric, before, after, direction = -1, tolerance = 0) => {
    const delta = (Number(after) - Number(before)) * direction
    rows.push({ metric, previous: before, candidate: after, verdict: Math.abs(delta) <= tolerance ? '持平' : delta < 0 ? '变差' : '变好' })
  }
  add('起草落成', previous.draft.success, candidate.draft.success, 1)
  for (const key of countKeys) add(`起草.${key}`, previous.draft[key], candidate.draft[key], key === 'shotCount' ? 1 : -1)
  add('起草耗时(ms)', previous.draft.elapsedMs, candidate.draft.elapsedMs, -1, Math.max(previous.draft.elapsedMs * 0.2, 2000))
  const rank = { stuck: 0, failed: 1, success: 2 }
  for (const before of previous.batch.shots) {
    const after = candidate.batch.shots.find(shot => shot.shotId === before.shotId)
    add(`批量.${before.shotId}`, rank[before.outcome], rank[after.outcome], 1)
    Object.assign(rows.at(-1), { previous: before.outcome, candidate: after.outcome })
  }
  add('批量成功镜数', previous.batch.shots.filter(s => s.outcome === 'success').length, candidate.batch.shots.filter(s => s.outcome === 'success').length, 1)
  add('批量耗时(ms)', previous.batch.elapsedMs, candidate.batch.elapsedMs, -1, Math.max(previous.batch.elapsedMs * 0.2, 2000))
  const before = previous.batch.longestUnresponsiveMs, after = candidate.batch.longestUnresponsiveMs
  add('最长无响应(ms)', before, after, -1, Math.max(before * 0.2, 200))
  if ((before > 1000) !== (after > 1000)) rows.at(-1).verdict = after > 1000 ? '变差' : '变好'
  add('结束后解除忙碌', previous.batch.busyReleased, candidate.batch.busyReleased, 1)
  add('被拒重试数', previous.batch.rejectedRetries, candidate.batch.rejectedRetries)
  const verdict = rows.some(row => row.verdict === '变差') ? '变差' : rows.some(row => row.verdict === '变好') ? '变好' : '持平'
  return { mode: previous.mode, previousCommit: previous.commit, candidateCommit: candidate.commit, verdict, rows }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 4, 'Usage: release-core-compare.results.mjs <previous.json> <candidate.json>')
    const result = compareResults(...process.argv.slice(2).map(file => JSON.parse(fs.readFileSync(file, 'utf8'))))
    console.log(`结论：${result.verdict}（${result.mode}）\n\n| 指标 | 上一版 | 这一版 | 判定 |\n| --- | --- | --- | --- |`)
    for (const row of result.rows) console.log(`| ${row.metric} | ${row.previous} | ${row.candidate} | ${row.verdict} |`)
    if (result.verdict === '变差') process.exitCode = 1
  } catch (error) { console.error(`阻断：${error.message}`); process.exitCode = 2 }
}
