import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { createNomiUserWorkflowFixture, NOMI_WORKFLOW_SCALES, validateWorkflowFixtureSummary } from './fixtures/nomi-user-workflow-fixture.mjs'
import { percentile, redact } from './nomi-user-workflow-performance.e2e.mjs'

test('workflow scale contract is fixed and complete', () => {
  assert.deepEqual(Object.keys(NOMI_WORKFLOW_SCALES), ['small', 'typical', 'heavy'])
  for (const [scale, config] of Object.entries(NOMI_WORKFLOW_SCALES)) {
    assert.equal(config.plans * config.shotsPerPlan > 0, true)
    assert.equal(config.images > 0 && config.videos > 0, true)
    assert.equal(config.documents > 0, true)
    assert.equal(typeof validateWorkflowFixtureSummary, 'function')
    assert.equal(scale.length > 0, true)
  }
})

test('small fixture persists document, plan and mixed media counts', () => {
  const root = makeTempDir('nomi-workflow-fixture-test-')
  const fixture = createNomiUserWorkflowFixture({ projectsDir: root, scale: 'small', projectId: 'fixture-contract-small' })
  assert.deepEqual(fixture.summary, {
    scale: 'small', documents: 2, plans: 2, shots: 24, images: 4, videos: 2,
    mediaProfile: 'synthetic-preview', canvasScale: 'REAL', canvasNodes: 6, canvasEdges: 5,
  })
  const record = JSON.parse(fs.readFileSync(path.join(fixture.projectRoot, '.nomi', 'project.json'), 'utf8'))
  assert.equal(record.payload.workbenchDocuments.length, 2)
  assert.equal(Object.values(record.payload.storyboardDesignsByDocumentId).flat().length, 2)
  assert.equal(record.payload.generationCanvas.nodes.filter((node) => node.kind === 'image').length, 4)
  assert.equal(record.payload.generationCanvas.nodes.filter((node) => node.kind === 'video').length, 2)
})

test('percentiles and raw path redaction are deterministic', () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 48)
  const output = redact({ path: '/workspace/Nomi/private.txt', nested: ['/tmp/secret'] })
  assert.deepEqual(output, { path: '<repo>/private.txt', nested: ['<temp>/secret'] })
})
