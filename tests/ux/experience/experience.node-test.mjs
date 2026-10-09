import { makeTempDirAsync } from '../../../scripts/_test-temp.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readJson, rubricFile, hash } from './collect.mjs'
import { validateEvidence, judgeOffline, judgeInput, judgeWithAdapter } from './judge.mjs'
import { measuredBaseline, compareBaseline, tightenBaseline, validateRunIdentity } from './report.mjs'
const rubric = await readJson(rubricFile)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
function fixture() {
  const dom = {
    controls: [],
    layout: [],
    primaryCandidates: 1,
    emptyHints: 1,
    controlCoverage: 0,
    viewport: { width: 1440, height: 900, dpr: 2 },
    theme: 'light',
  }
  const shot = { screenshot: 'shot.png', sha256: hash(png), dom }
  return {
    journey: 'sample',
    title: 'sample',
    identity: { compatibility: { sourceHash: 'a' } },
    status: 'completed',
    outcome: { passed: true, assertion: 'positive persisted result' },
    expectedSteps: ['submit'],
    steps: [
      {
        id: 'submit',
        type: 'click',
        status: 'completed',
        before: shot,
        after: shot,
        feel: { findings: [] },
        events: [{ type: 'click', trusted: true }],
        metrics: {
          clicks: 1,
          inputs: 0,
          keys: 0,
          scrolls: 0,
          confirmations: 0,
          panelSwitches: 1,
          pointerDistancePx: 0,
          fittsSum: 0,
          pointerPairs: 0,
          actionMs: 20,
          completionMs: 40,
          feedbackMs: null,
          longTaskBlockingMs: null,
        },
      },
    ],
  }
}
async function withEvidence(fn) {
  const dir = await makeTempDirAsync('experience-test-')
  try {
    await fs.writeFile(path.join(dir, 'shot.png'), png)
    await fn(fixture(), dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
test('complete positive outcome, ordered steps and actual PNG hashes are required', async () =>
  withEvidence(async (run, dir) => {
    await validateEvidence(run, dir)
    for (const mutate of [
      (r) => (r.status = 'failed'),
      (r) => (r.outcome.passed = false),
      (r) => r.expectedSteps.push('missing-final'),
      (r) => (r.steps[0].after = { ...r.steps[0].after, sha256: 'wrong' }),
    ]) {
      const bad = structuredClone(run)
      mutate(bad)
      await assert.rejects(() => validateEvidence(bad, dir))
    }
    await fs.unlink(path.join(dir, 'shot.png'))
    await assert.rejects(() => validateEvidence(run, dir))
  }))
test('missing/negative/nonfinite measurements and vanished event probe fail closed', async () =>
  withEvidence(async (run, dir) => {
    for (const mutate of [
      (r) => delete r.steps[0].metrics.clicks,
      (r) => (r.steps[0].metrics.clicks = -1),
      (r) => (r.steps[0].metrics.clicks = NaN),
      (r) => (r.steps[0].events = []),
      (r) => (r.steps[0].events[0].trusted = false),
      (r) => (r.steps[0].metrics.clicks = 2),
    ]) {
      const bad = structuredClone(run)
      mutate(bad)
      await assert.rejects(() => validateEvidence(bad, dir))
    }
  }))
test('unknown understanding stays null; rules and dimensions are data-driven', () => {
  const run = fixture(),
    result = judgeOffline(run, rubric)
  assert.equal(result.dimensions.find((d) => d.id === 'goal').score, null)
  assert.equal(result.dimensions.find((d) => d.id === 'feel').score, 3)
  run.steps[0].feel.findings.push({ rule: 'blocked' })
  assert.equal(judgeOffline(run, rubric).dimensions.find((d) => d.id === 'feel').score, 1)
  const changed = structuredClone(rubric)
  changed.dimensions.push({
    id: 'custom',
    label: 'custom',
    metrics: ['clicks'],
    rules: [{ metric: 'clicks', max: 0 }],
    judge: null,
  })
  assert.equal(judgeOffline(run, changed).dimensions.at(-1).violations.length, 1)
  changed.dimensions.at(-1).rules[0].max = 2
  assert.equal(judgeOffline(run, changed).dimensions.at(-1).violations.length, 0)
})
test('ratchet rejects extra scrolling, mechanical findings, changed source and missing metrics', () => {
  const run = fixture(),
    baseline = measuredBaseline(run, rubric)
  for (const mutate of [
    (r) => r.steps[0].metrics.scrolls++,
    (r) => r.steps[0].feel.findings.push({ rule: 'blocked' }),
  ]) {
    const bad = structuredClone(run)
    mutate(bad)
    const current = measuredBaseline(bad, rubric)
    assert.equal(compareBaseline(current, baseline).status, 'regressed')
    assert.throws(() => tightenBaseline(current, baseline))
  }
  const incompatible = structuredClone(baseline)
  incompatible.compatibility.sourceHash = 'b'
  assert.equal(compareBaseline(incompatible, baseline).status, 'incompatible')
  assert.throws(() => tightenBaseline(incompatible, baseline))
  delete run.steps[0].metrics.clicks
  assert.throws(() => measuredBaseline(run, rubric))
  const tightened = structuredClone(baseline)
  tightened.metrics.clicks = 0
  assert.equal(tightenBaseline(tightened, baseline).metrics.clicks, 0)
})
test('nonempty exemptions cannot silently disappear', () => {
  const changed = structuredClone(rubric)
  changed.exemptions = [{ reason: 'ignore' }]
  assert.throws(() => judgeOffline(fixture(), changed), /Exemptions/)
})
test('explicit VLM adapter requires all dimensions, valid score and evidence; no network default', async () => {
  const input = judgeInput(fixture(), rubric)
  const dimensions = rubric.dimensions
    .filter((d) => d.judge)
    .map((d) => ({
      id: d.id,
      score: null,
      reason: 'Synthetic interface example; no model was called',
      evidence: [{ step: 'submit' }],
    }))
  await assert.rejects(() => judgeWithAdapter(input))
  assert.equal(
    (await judgeWithAdapter(input, { model: 'synthetic-example', evaluate: async () => ({ dimensions }) })).mode,
    'external-adapter',
  )
  for (const bad of [
    [],
    [...dimensions, dimensions[0]],
    dimensions.map((d) => ({ ...d, score: 4 })),
    dimensions.map((d) => ({ ...d, evidence: [{ step: 'missing' }] })),
  ]) {
    await assert.rejects(() => judgeWithAdapter(input, { evaluate: async () => ({ dimensions: bad }) }))
  }
})

test('report rejects evidence mixed from another execution or application', () => {
  const run = fixture()
  Object.assign(run.identity, { runId: 'run-1', applicationSha: 'a' })
  const manifest = { runId: 'run-1', applicationSha: 'a', sourceHash: 'a', digests: { source: 'a' } }
  validateRunIdentity(run, manifest)
  for (const key of ['runId', 'applicationSha', 'sourceHash']) {
    assert.throws(() => validateRunIdentity(run, { ...manifest, [key]: 'other' }))
  }
  assert.throws(() => validateRunIdentity(run, { ...manifest, digests: {} }))
})
