import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

import { PROFILES, STAGES } from '../tests/system/profiles.mjs'
import { assertFullCanvasShardPartition, FULL_CANVAS_SHARDS } from '../tests/ux/canvas-real-suite.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = load(fs.readFileSync(path.join(repoRoot, '.github/workflows/quality-gate.yml'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const runCommands = (job) => job.steps?.flatMap((step) => (typeof step.run === 'string' ? [step.run] : [])) ?? []

test('quality gate runs for pull requests and real main before/after pushes', () => {
  assert.deepEqual(workflow.on, {
    push: { branches: ['main'] },
    merge_group: null,
    pull_request: null,
    workflow_dispatch: {
      inputs: {
        base_ref: {
          description: 'Reachable vocabulary baseline for a manual current-HEAD recovery run',
          required: false,
          default: 'origin/main',
          type: 'string',
        },
        validation_mode: {
          description: 'Manual runs are always full; keep this explicit for auditability',
          required: false,
          default: 'full',
          type: 'choice',
          options: ['full'],
        },
      },
    },
  })
  assert.deepEqual(workflow.concurrency, {
    group: 'quality-gate-${{ github.event.pull_request.number || github.ref }}',
    'cancel-in-progress': true,
  })
  assert.deepEqual(workflow.permissions, { actions: 'read', checks: 'read', contents: 'read' })

  const scopeEnvironment = workflow.jobs.scope.steps.find((step) => step.id === 'profile').env
  assert.equal(scopeEnvironment.NOMI_BASE_SHA, "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before || '' }}")
  assert.equal(scopeEnvironment.NOMI_HEAD_SHA, '${{ github.sha }}')
})

test('scope exposes every independent validation surface from the shared classifier', () => {
  assert.deepEqual(workflow.jobs.scope.outputs, {
    unit: '${{ steps.profile.outputs.unit }}',
    desktop: '${{ steps.profile.outputs.desktop }}',
    // walkthroughs 是独立维度，不是 desktop 的搭车项：desktop 只认 electron/ 与
    // src/desktop/bridge.ts，而 CI 走查清单守的是 i18n/locale 面（改 src/i18n 不会让
    // desktop 为 true）。2026-09-02 曾把 roster 步骤挂在 desktop 上，等于它在最该跑的
    // 时候恰好不跑；正是「每个维度都必须在这里显式暴露」的精神让这个缺陷被抓回来。
    walkthroughs: '${{ steps.profile.outputs.walkthroughs }}',
    journeys: '${{ steps.profile.outputs.journeys }}',
    canvas: '${{ steps.profile.outputs.canvas }}',
    performance: '${{ steps.profile.outputs.performance }}',
    package: '${{ steps.profile.outputs.package }}',
    release: '${{ steps.profile.outputs.release }}',
    fail_closed: '${{ steps.profile.outputs.fail_closed }}',
    reason: '${{ steps.profile.outputs.reason }}',
    changed_count: '${{ steps.profile.outputs.changed_count }}',
  })
  assert.match(runCommands(workflow.jobs.scope).join('\n'), /select-quality-gate-profile\.mjs/)
})

test('quality gate uses Node 24-native actions without a forced runtime shim', () => {
  const actionUses = Object.values(workflow.jobs).flatMap(
    (job) => job.steps?.flatMap((step) => (typeof step.uses === 'string' ? [step.uses] : [])) ?? [],
  )

  assert.equal(actionUses.filter((uses) => uses === 'actions/checkout@v7').length, 8)
  assert.equal(actionUses.filter((uses) => uses === 'pnpm/action-setup@v6').length, 6)
  assert.equal(actionUses.filter((uses) => uses === 'actions/setup-node@v7').length, 7)
  assert.ok(actionUses.includes('actions/upload-artifact@v7'))
  assert.ok(actionUses.every((uses) => !/@v4$/.test(uses)))
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.env?.FORCE_JAVASCRIPT_ACTIONS_TO_NODE24, undefined)
  }
})

test('contracts always run and unit alone chooses focused or full coverage', () => {
  const contracts = workflow.jobs.contracts
  assert.equal(contracts.needs, undefined)
  assert.equal(contracts.if, undefined)
  assert.ok(runCommands(contracts).includes('pnpm run test:system:contracts'))
  assert.equal(
    contracts.env.ROOT_CAUSE_BASE_REF,
    '${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before || inputs.base_ref }}',
  )

  const unit = workflow.jobs.unit
  assert.equal(unit.needs, 'scope')
  const full = unit.steps.find((step) => step.name?.includes('full lane'))
  const focused = unit.steps.find((step) => step.name?.includes('fast lane'))
  assert.equal(full.if, "needs.scope.outputs.unit == 'full'")
  assert.equal(focused.if, "needs.scope.outputs.unit == 'focused'")
  assert.equal(full.run, 'pnpm run test:system:unit')
  assert.equal(focused.run, 'pnpm run test:system:focused')
})

test('Linux walkthrough job builds once and keeps only smoke, journey, and critical canvas surfaces', () => {
  const desktop = workflow.jobs['desktop-linux']
  assert.equal(desktop.needs, 'scope')
  assert.equal(
    desktop.if,
    "needs.scope.outputs.desktop == 'true' || needs.scope.outputs.journeys == 'true' || needs.scope.outputs.canvas == 'critical'",
  )

  const selectedSteps = Object.fromEntries(
    desktop.steps.filter((step) => step.name && step.run).map((step) => [step.name, step]),
  )
  assert.equal(selectedSteps['Build selected desktop surfaces once'].run, 'pnpm run build')
  assert.deepEqual(
    [
      selectedSteps['Electron smoke'].run,
      selectedSteps['CI-safe user journeys'].run,
      selectedSteps['MCP L1 handshake journey'].run,
      selectedSteps['Critical canvas acceptance'].run,
    ],
    [
      'xvfb-run -a pnpm run test:e2e',
      'xvfb-run -a pnpm run test:journeys',
      'xvfb-run -a pnpm run test:mcp-journey',
      'xvfb-run -a pnpm run test:canvas:critical',
    ],
  )
  assert.equal(selectedSteps['Electron smoke'].if, "needs.scope.outputs.desktop == 'true'")
  assert.equal(selectedSteps['CI-safe user journeys'].if, "needs.scope.outputs.journeys == 'true'")
  assert.equal(selectedSteps['MCP L1 handshake journey'].if, "needs.scope.outputs.journeys == 'true'")
  assert.equal(selectedSteps['Critical canvas acceptance'].if, "needs.scope.outputs.canvas == 'critical'")
  assert.equal(runCommands(desktop).filter((command) => command === 'pnpm run build').length, 1)
  // full/performance 面已拆到并行 job；本 job 不得再串行执行它们（那是 22 分钟关键路径的根因）。
  assert.equal(selectedSteps['Full functional canvas acceptance'], undefined)
  assert.equal(selectedSteps['Canvas performance budget'], undefined)

  const evidence = desktop.steps.find((step) => step.uses === 'actions/upload-artifact@v7')
  assert.equal(evidence.if, 'always()')
  assert.equal(evidence.with.name, 'linux-walkthrough-evidence')
  assert.match(evidence.with.path, /outputs\/canvas-acceptance\/\*\*/)
})

test('full canvas acceptance runs as a fail-closed two-shard matrix that partitions every scenario', () => {
  const acceptance = workflow.jobs['canvas-acceptance']
  assert.equal(acceptance.needs, 'scope')
  assert.equal(acceptance.if, "needs.scope.outputs.canvas == 'full'")
  assert.deepEqual(acceptance.strategy, { 'fail-fast': false, matrix: { shard: [1, 2] } })
  assert.equal(FULL_CANVAS_SHARDS.length, 2)
  assert.doesNotThrow(() => assertFullCanvasShardPartition())

  const commands = runCommands(acceptance)
  assert.ok(commands.includes('xvfb-run -a pnpm run test:canvas:acceptance -- --shard ${{ matrix.shard }}/2'))
  assert.equal(commands.filter((command) => command === 'pnpm run build').length, 1)

  const evidence = acceptance.steps.find((step) => step.uses === 'actions/upload-artifact@v7')
  assert.equal(evidence.if, 'always()')
  assert.equal(evidence.with.name, 'canvas-acceptance-evidence-${{ matrix.shard }}')
  assert.match(evidence.with.path, /outputs\/canvas-acceptance\/\*\*/)
})

test('canvas performance budget runs as its own parallel job with an untouched instrument command', () => {
  const performance = workflow.jobs['canvas-performance']
  assert.equal(performance.needs, 'scope')
  assert.equal(performance.if, "needs.scope.outputs.performance == 'true'")
  assert.equal(performance.strategy, undefined)

  const commands = runCommands(performance)
  assert.ok(commands.includes('xvfb-run -a pnpm run test:canvas:performance'))
  assert.equal(commands.filter((command) => command === 'pnpm run build').length, 1)

  const evidence = performance.steps.find((step) => step.uses === 'actions/upload-artifact@v7')
  assert.equal(evidence.if, 'always()')
  assert.equal(evidence.with.name, 'canvas-performance-evidence')
  assert.match(evidence.with.path, /tests\/ux\/perf-results\/canvas-\*\.json/)
})

test('macOS package is selected independently and retains build, package, and signature checks', () => {
  const macPackage = workflow.jobs['mac-package']
  assert.equal(macPackage.needs, 'scope')
  assert.equal(macPackage.if, "needs.scope.outputs.package == 'true'")
  assert.deepEqual(runCommands(macPackage), [
    'pnpm install --frozen-lockfile',
    'pnpm run build',
    'pnpm run dist:mac:dir',
    'codesign --verify --deep --strict --verbose=4 release/mac-arm64/Nomi.app',
  ])
})

test('system profiles expose separated surfaces and explicit full/release still include performance', () => {
  assert.deepEqual(PROFILES['ci-contracts'], ['contracts'])
  assert.deepEqual(PROFILES['ci-unit'], ['unit'])
  assert.deepEqual(PROFILES['ci-desktop'], ['build', 'e2e'])
  assert.deepEqual(PROFILES['ci-journeys'], ['journeys-ci'])
  assert.deepEqual(PROFILES['ci-canvas-critical'], ['canvas-critical'])
  assert.deepEqual(PROFILES['ci-canvas-full'], ['canvas-full'])
  assert.deepEqual(PROFILES['ci-performance'], ['canvas-performance'])
  assert.ok(PROFILES['full-local'].includes('canvas-performance'))
  assert.ok(PROFILES.release.includes('canvas-performance'))
  assert.deepEqual([STAGES['canvas-performance'].command, ...STAGES['canvas-performance'].args], [
    'pnpm',
    'run',
    'test:canvas:performance',
  ])
})

test('package scripts expose canonical separated profiles and classifier contract', () => {
  const scripts = packageJson.scripts
  assert.equal(scripts['test:system:contracts'], 'node scripts/test-system.mjs ci-contracts')
  assert.equal(scripts['test:system:unit'], 'node scripts/test-system.mjs ci-unit')
  assert.equal(scripts['test:system:desktop'], 'node scripts/test-system.mjs ci-desktop')
  assert.equal(scripts['test:system:journeys'], 'node scripts/test-system.mjs ci-journeys')
  assert.equal(scripts['test:system:canvas:critical'], 'node scripts/test-system.mjs ci-canvas-critical')
  assert.equal(scripts['test:system:canvas:full'], 'node scripts/test-system.mjs ci-canvas-full')
  assert.equal(scripts['test:system:performance'], 'node scripts/test-system.mjs ci-performance')
  assert.equal(scripts['test:canvas:performance'], 'node tests/ux/canvas-real-suite.mjs performance')
  assert.equal(scripts['lint:ci'], 'eslint . --max-warnings=82')
  assert.match(scripts['check:quality-gate-workflow'], /validation-policy\.node-test\.mjs/)
})

test('Quality Gate requires mandatory jobs and every risk-selected optional surface', () => {
  const quality = workflow.jobs.quality
  assert.deepEqual(quality.needs, [
    'scope',
    'contracts',
    'unit',
    'desktop-linux',
    'canvas-acceptance',
    'canvas-performance',
    'mac-package',
  ])
  assert.equal(quality.if, '${{ always() }}')
  assert.equal(quality.name, 'Quality Gate')

  const hygiene = quality.steps.find((step) => step.id === 'ci-hygiene')
  assert.equal(hygiene.run, 'node scripts/ci-annotation-hygiene.mjs')
  assert.equal(hygiene['continue-on-error'], true)
  assert.equal(hygiene.env.GITHUB_TOKEN, '${{ github.token }}')
  const evidence = quality.steps.find((step) => step.name === 'Upload CI hygiene evidence')
  assert.equal(evidence.uses, 'actions/upload-artifact@v7')
  assert.equal(evidence.with.path, 'outputs/ci-hygiene/ci-annotations.json')
  assert.equal(evidence.with['if-no-files-found'], 'error')

  const command = runCommands(quality).join('\n')
  assert.match(command, /steps\.ci-hygiene\.outcome/)
  for (const jobId of ['scope', 'contracts', 'unit']) {
    assert.match(command, new RegExp(`needs\\.${jobId}\\.result`))
  }
  for (const output of ['desktop', 'journeys', 'canvas', 'performance', 'package']) {
    assert.match(command, new RegExp(`needs\\.scope\\.outputs\\.${output}`))
  }
  // 每个风险面独立聚合：full 走查、perf 预算拆成并行 job 后仍必须逐面要求 success，
  // 不允许出现「面被选中但结果没人验」的缺口（canvas 的 critical/full 两档分别锚到两个 job）。
  assert.match(command, /"\$\{\{ needs\.scope\.outputs\.canvas \}\}" = "critical"/)
  assert.match(command, /"\$\{\{ needs\.scope\.outputs\.canvas \}\}" = "full"/)
  assert.match(command, /needs\['desktop-linux'\]\.result/)
  assert.match(command, /needs\['canvas-acceptance'\]\.result/)
  assert.match(command, /needs\['canvas-performance'\]\.result/)
  assert.match(command, /needs\['mac-package'\]\.result/)
})
