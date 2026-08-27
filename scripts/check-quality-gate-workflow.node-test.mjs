import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(repoRoot, '.github/workflows/quality-gate.yml')
const workflow = load(fs.readFileSync(workflowPath, 'utf8'))

test('quality gate runs for pull requests and main pushes without feature-branch push duplication', () => {
  assert.deepEqual(workflow.on, {
    push: { branches: ['main'] },
    pull_request: null,
  })
})

test('quality gate cancels only obsolete runs in the same PR or main lane', () => {
  assert.deepEqual(workflow.concurrency, {
    group: 'quality-gate-${{ github.event.pull_request.number || github.ref }}',
    'cancel-in-progress': true,
  })
  assert.equal(
    workflow.jobs.quality.env.VOCAB_BASE_REF,
    '${{ github.event.pull_request.base.sha || github.event.before }}',
  )
})
