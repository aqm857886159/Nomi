import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { PROFILES, STAGES } from '../tests/system/profiles.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(repoRoot, '.github/workflows/quality-gate.yml')
const workflowSource = fs.readFileSync(workflowPath, 'utf8')
const workflow = load(workflowSource)
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const desktopRcWorkflow = load(fs.readFileSync(path.join(repoRoot, '.github/workflows/desktop-rc.yml'), 'utf8'))

const runCommands = (job) => job.steps?.flatMap((step) => (typeof step.run === 'string' ? [step.run] : [])) ?? []

test('quality gate runs for pull requests and main pushes without feature-branch push duplication', () => {
  assert.deepEqual(workflow.on, {
    push: { branches: ['main'] },
    pull_request: null,
    workflow_dispatch: {
      inputs: {
        base_ref: {
          description: 'Reachable vocabulary baseline for a manual current-HEAD recovery run',
          required: false,
          default: 'origin/main',
          type: 'string',
        },
      },
    },
  })
})

test('quality gate cancels only obsolete runs in the same PR or main lane', () => {
  assert.deepEqual(workflow.concurrency, {
    group: 'quality-gate-${{ github.event.pull_request.number || github.ref }}',
    'cancel-in-progress': true,
  })
  assert.equal(
    workflow.jobs.contracts.env.VOCAB_BASE_REF,
    '${{ github.event.pull_request.base.sha || github.event.before || inputs.base_ref }}',
  )
  assert.equal(
    workflow.jobs.contracts.env.ROOT_CAUSE_BASE_REF,
    '${{ github.event.pull_request.base.sha || github.event.before || inputs.base_ref }}',
  )
})

test('pull requests and release candidates execute both project-agent canvas journeys', () => {
  const expected = ['xvfb-run -a pnpm run test:mcp', 'xvfb-run -a node tests/ux/project-agent-canvas-isolation.e2e.mjs']
  const qualityCommands = runCommands(workflow.jobs['desktop-linux'])
  const releaseCommands = runCommands(desktopRcWorkflow.jobs.validate)

  for (const command of expected) {
    assert.ok(qualityCommands.some((candidate) => candidate.includes(command)), `quality gate misses ${command}`)
    assert.ok(
      releaseCommands.some((candidate) => candidate.includes(command)),
      `desktop RC misses ${command}`,
    )
  }
})

test('parallel CI profiles preserve the complete legacy Ubuntu coverage set', () => {
  assert.deepEqual(PROFILES['ci-contracts'], ['contracts'])
  assert.deepEqual(PROFILES['ci-unit'], ['unit'])
  assert.deepEqual(PROFILES['ci-desktop'], ['build', 'e2e', 'journeys-ci'])

  const stageUnion = new Set([
    ...PROFILES['ci-contracts'],
    ...PROFILES['ci-unit'],
    ...PROFILES['ci-desktop'],
  ])
  assert.deepEqual([...stageUnion].sort(), ['build', 'contracts', 'e2e', 'journeys-ci', 'unit'])
  assert.deepEqual(
    [STAGES.contracts.command, ...STAGES.contracts.args],
    ['pnpm', 'run', 'gates:contracts'],
  )
})

test('package scripts keep local gates whole while exposing canonical CI profiles', () => {
  const scripts = packageJson.scripts
  assert.equal(scripts['test:system:contracts'], 'node scripts/test-system.mjs ci-contracts')
  assert.equal(scripts['test:system:unit'], 'node scripts/test-system.mjs ci-unit')
  assert.equal(scripts['test:system:desktop'], 'node scripts/test-system.mjs ci-desktop')

  const localGateCommands = scripts.gates.split('&&').map((command) => command.trim())
  assert.equal(localGateCommands[0], 'pnpm run gates:contracts')
  assert.deepEqual(localGateCommands.slice(1, 3), ['pnpm run test', 'pnpm run build'])

  const contractCommands = scripts['gates:contracts'].split('&&').map((command) => command.trim())
  assert.ok(contractCommands.includes('pnpm run lint:ci'))
  assert.ok(contractCommands.includes('pnpm run typecheck'))
  assert.ok(contractCommands.includes('pnpm run check:test-types'))
  assert.ok(!contractCommands.includes('pnpm run test'))
  assert.ok(!contractCommands.includes('pnpm run build'))
})

test('workflow runs every Linux validation surface in parallel without path-based skipping', () => {
  assert.doesNotMatch(workflowSource, /^\s*paths(?:-ignore)?:/m)
  assert.doesNotMatch(workflowSource, /changed-files|dorny\/paths-filter/)

  const expectedProfiles = new Map([
    ['contracts', 'pnpm run test:system:contracts'],
    ['unit', 'pnpm run test:system:unit'],
    ['desktop-linux', 'xvfb-run -a pnpm run test:system:desktop'],
  ])
  for (const [jobId, expectedCommand] of expectedProfiles) {
    const job = workflow.jobs[jobId]
    assert.ok(job, `missing ${jobId} job`)
    assert.ok(runCommands(job).includes(expectedCommand), `${jobId} must run ${expectedCommand}`)
    assert.equal(job.needs, undefined, `${jobId} must not wait for another validation surface`)
    assert.equal(job.if, undefined, `${jobId} must not be conditionally skipped`)
  }
})

test('desktop evidence and the complete Mac package path remain required', () => {
  const desktop = workflow.jobs['desktop-linux']
  const evidence = desktop.steps.find((step) => step.uses === 'actions/upload-artifact@v4')
  assert.equal(evidence.if, 'always()')
  assert.equal(evidence.with.name, 'linux-walkthrough-evidence')
  assert.match(evidence.with.path, /evals\/runs\/\*\*\/screenshots\/\*\*/)
  assert.match(evidence.with.path, /evals\/runs\/\*\*\/output\.jsonl/)

  const macPackage = workflow.jobs['mac-package']
  assert.equal(macPackage.needs, undefined)
  assert.equal(macPackage.if, undefined)
  assert.deepEqual(runCommands(macPackage), [
    'pnpm install --frozen-lockfile',
    'pnpm run build',
    'pnpm run dist:mac:dir',
    'codesign --verify --deep --strict --verbose=4 release/mac-arm64/Nomi.app',
  ])
})

test('Quality Gate aggregator fails closed unless every required job succeeds', () => {
  const quality = workflow.jobs.quality
  assert.deepEqual(quality.needs, ['contracts', 'unit', 'desktop-linux', 'mac-package'])
  assert.equal(quality.if, '${{ always() }}')
  assert.equal(quality.name, 'Quality Gate')

  const command = runCommands(quality).join('\n')
  for (const jobId of quality.needs) {
    const resultExpression = jobId.includes('-')
      ? `needs\\['${jobId}'\\]\\.result`
      : `needs\\.${jobId}\\.result`
    assert.match(command, new RegExp(resultExpression))
    assert.match(command, new RegExp(`${resultExpression} \\}\\}.*success`))
  }
})
