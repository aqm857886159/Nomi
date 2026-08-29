import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowsDir = path.join(repoRoot, '.github/workflows')
const signaturePath = path.join(repoRoot, 'signatures/cla.json')

function claActionSteps() {
  return fs.readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .flatMap((name) => {
      const file = path.join(workflowsDir, name)
      const workflow = load(fs.readFileSync(file, 'utf8'))
      return Object.values(workflow.jobs ?? {}).flatMap((job) =>
        (job.steps ?? [])
          .filter((step) => typeof step.uses === 'string' && step.uses.startsWith('contributor-assistant/github-action@'))
          .map((step) => ({ file, workflow, step })))
    })
}

test('CLA signatures have one automation-owned ledger outside protected code branches', () => {
  const steps = claActionSteps()
  assert.equal(steps.length, 1, 'exactly one contributor-assistant action must own CLA signatures')
  assert.equal(steps[0].step.with?.branch, 'cla-signatures')
  assert.equal(steps[0].step.with?.['path-to-signatures'], 'signatures/cla.json')
  assert.equal(fs.existsSync(signaturePath), false, 'main must not retain a stale signature ledger copy')
})

test('privileged CLA events never execute fork code and keep the required write boundary explicit', () => {
  const [{ workflow }] = claActionSteps()
  assert.deepEqual(workflow.on, {
    issue_comment: { types: ['created'] },
    pull_request_target: { types: ['opened', 'closed', 'synchronize'] },
  })
  assert.deepEqual(workflow.permissions, {
    actions: 'write',
    contents: 'write',
    'pull-requests': 'write',
    statuses: 'write',
  })

  const serializedSteps = JSON.stringify(workflow.jobs)
  assert.doesNotMatch(serializedSteps, /actions\/checkout/i)
  assert.doesNotMatch(serializedSteps, /github\.event\.pull_request\.head|github\.head_ref/i)
})
