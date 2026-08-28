import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(repoRoot, '.github/workflows/quality-gate.yml')
const workflow = load(fs.readFileSync(workflowPath, 'utf8'))
const desktopRcWorkflow = load(fs.readFileSync(path.join(repoRoot, '.github/workflows/desktop-rc.yml'), 'utf8'))

function commands(steps) {
  return steps.flatMap((step) => (typeof step.run === 'string' ? [step.run] : []))
}

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

test('pull requests and release candidates execute both project-agent canvas journeys', () => {
  const expected = ['xvfb-run -a pnpm run test:mcp', 'xvfb-run -a node tests/ux/project-agent-canvas-isolation.e2e.mjs']
  const qualityCommands = commands(workflow.jobs.quality.steps)
  const releaseCommands = commands(desktopRcWorkflow.jobs.validate.steps)

  for (const command of expected) {
    assert.ok(
      qualityCommands.some((candidate) => candidate.includes(command)),
      `quality gate misses ${command}`,
    )
    assert.ok(
      releaseCommands.some((candidate) => candidate.includes(command)),
      `desktop RC misses ${command}`,
    )
  }
})
