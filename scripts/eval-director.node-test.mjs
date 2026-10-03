import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { buildDirectorReport, loadDirectorCases, validateDirectorCases } from './eval-director.mjs'

test('Director matrix is a versioned, reviewable 24-case target set', () => {
  const dataset = loadDirectorCases()

  assert.equal(dataset.schemaVersion, 'director-goal-eval/v1')
  assert.equal(dataset.cases.length, 24)
  assert.equal(new Set(dataset.cases.map((item) => item.id)).size, dataset.cases.length)

  const categories = new Set(dataset.cases.map((item) => item.category))
  for (const category of ['indoor', 'outdoor', 'product', 'person']) {
    assert.ok(categories.has(category), `missing category ${category}`)
  }

  const tags = new Set(dataset.cases.flatMap((item) => item.tags))
  for (const tag of ['one-shot', 'three-shot', 'push', 'pull', 'orbit', 'follow', 'target-switch']) {
    assert.ok(tags.has(tag), `missing tag ${tag}`)
  }

  for (const item of dataset.cases) {
    assert.equal(item.evaluationTarget, true)
    assert.ok(item.prompt.length > 20)
    assert.ok(item.expectedDirectorCard.title)
    assert.deepEqual(Object.keys(item.required).sort(), ['action', 'aspect', 'camera', 'object', 'scene', 'timing'])
    assert.ok(item.expectedFailureBehavior.length > 0)
  }
  assert.deepEqual(validateDirectorCases(dataset), [])
})

test('Director pack is wired to the generic coding-agent contract', () => {
  const contractSchema = JSON.parse(
    fs.readFileSync(path.resolve('evals/contracts/module-feature-evaluation.schema.json'), 'utf8'),
  )
  const reportSchema = JSON.parse(
    fs.readFileSync(path.resolve('evals/contracts/module-feature-report.schema.json'), 'utf8'),
  )
  const prTemplate = fs.readFileSync(path.resolve('.github/PULL_REQUEST_TEMPLATE.md'), 'utf8')

  assert.equal(contractSchema.properties.contractVersion.const, 'module-feature-evaluation/v1')
  assert.equal(reportSchema.properties.reportVersion.const, 'module-feature-report/v1')
  for (const phrase of ['Goal contract', 'Automated checks', 'Real-user journey', 'Failure, rollback', 'unverified']) {
    assert.match(prTemplate, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')))
  }
  assert.match(
    fs.readFileSync(path.resolve('docs/evals/module-feature-evaluation-contract.md'), 'utf8'),
    /Director example/,
  )
})

test('case validator reports the missing required element', () => {
  const dataset = loadDirectorCases()
  const broken = structuredClone(dataset)
  delete broken.cases[0].required.camera

  const errors = validateDirectorCases(broken)

  assert.ok(errors.some((error) => error.includes('required.camera')))
})

test('report keeps automated checks and human judgments separate and deterministic', () => {
  const dataset = loadDirectorCases()
  const item = dataset.cases[0]
  const input = {
    runId: 'director-smoke-001',
    commit: '0123456789abcdef0123456789abcdef01234567',
    caseId: item.id,
    prompt: item.prompt,
    expectedDirectorCard: item.expectedDirectorCard,
    observed: {
      generationSuccess: true,
      whiteboxScene: true,
      objectMotion: true,
      cameraMotion: true,
      playablePreview: true,
      localEditPrecision: 'pass',
      timeToFirstPreviewMs: 4200,
    },
    automatedChecks: [
      { id: 'generation-success', pass: true, evidence: 'run://director-smoke-001/generation' },
      { id: 'playable-preview', pass: true, evidence: 'run://director-smoke-001/preview' },
    ],
    humanJudgments: [
      { id: 'prompt-correspondence', score: 4, note: 'The push is visible and the product is the subject.' },
    ],
    evidence: {
      screenshots: ['evidence/director-smoke-001/viewport.png'],
      videos: ['evidence/director-smoke-001/preview.mp4'],
    },
    failureReason: null,
  }

  const first = buildDirectorReport(input, { dataset })
  const second = buildDirectorReport(input, { dataset })

  assert.deepEqual(first, second)
  assert.equal(first.reportVersion, 'director-goal-report/v1')
  assert.equal(first.automatedChecks.length, 2)
  assert.equal(first.humanJudgments.length, 1)
  assert.match(first.markdown, /Automated checks/)
  assert.match(first.markdown, /Human judgments/)
  assert.match(first.markdown, /director-smoke-001/)
})
