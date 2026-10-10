import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

import { CI_E2E_CHAIN } from './run-ci-e2e-chain.mjs'
import { assertPartition, E2E_UNITS, listShardItems, planShards } from './lib/e2eShardPlan.mjs'
import { CORE_SMOKE_ADVISORY_CHECK_NAMES, CORE_SMOKE_ADVISORY_FIXTURES, CORE_SMOKE_BLOCKING_CHECK_NAMES, CORE_SMOKE_BLOCKING_FIXTURES, CORE_SMOKE_CHECK_NAMES, CORE_SMOKE_FIXTURES, coreSmokeCheckName } from './validation-policy.mjs'
import { REQUIRED_MERGED_CHECKS } from './git-delivery.mjs'
import { CHROMIUM_INSTALL_STEP as PLAYWRIGHT_INSTALL_STEP } from './ci-browser-install.mjs'
import { CORE_SMOKE_SCENARIOS } from '../tests/ux/core-smoke/scenarios.mjs'
import { PROFILES, STAGES } from '../tests/system/profiles.mjs'
import { assertFullCanvasShardPartition, FULL_CANVAS_SHARDS } from '../tests/ux/canvas-real-suite.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = load(fs.readFileSync(path.join(repoRoot, '.github/workflows/quality-gate.yml'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const runCommands = (job) => job.steps?.flatMap((step) => (typeof step.run === 'string' ? [step.run] : [])) ?? []

test('the unit lane provisions Chromium before either browser integration test entry', () => {
  const steps = workflow.jobs.unit.steps
  const install = steps.findIndex(step => step.run === PLAYWRIGHT_INSTALL_STEP)
  assert.ok(install >= 0, 'Unit runs real browser integration tests and must provision Chromium')
  assert.equal(steps[install].if, undefined, 'Both focused and full lanes need the browser')
  for (const command of [
    'pnpm run test:unit:shard --shard=${{ matrix.shard }}/${{ strategy.job-total }}',
    'pnpm run test:system:focused',
  ]) {
    assert.ok(steps.findIndex(step => step.run === command) > install, `${command} must run after browser installation`)
  }
})

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
    group: 'quality-gate-${{ github.event.pull_request.number || github.sha }}',
    'cancel-in-progress': true,
  })
  // pull-requests: read 是正文侧门岗现取 PR 正文所需（2026-09-18，C 件）。
  assert.deepEqual(workflow.permissions, { actions: 'read', checks: 'read', contents: 'read', 'pull-requests': 'read' })

  const scopeEnvironment = workflow.jobs.scope.steps.find((step) => step.id === 'profile').env
  assert.equal(scopeEnvironment.NOMI_BASE_SHA, "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before || '' }}")
  assert.equal(scopeEnvironment.NOMI_HEAD_SHA, '${{ github.sha }}')
})

test('scope exposes every independent validation surface from the shared classifier', () => {
  assert.deepEqual(workflow.jobs.scope.outputs, {
    core_smoke: '${{ steps.profile.outputs.core_smoke }}',
    unit: '${{ steps.profile.outputs.unit }}',
    desktop: '${{ steps.profile.outputs.desktop }}',
    journeys: '${{ steps.profile.outputs.journeys }}',
    spend_walks: '${{ steps.profile.outputs.spend_walks }}',
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

  assert.equal(actionUses.filter((uses) => uses === 'actions/checkout@v7').length, 10)
  assert.equal(actionUses.filter((uses) => uses === 'pnpm/action-setup@v6').length, 8)
  assert.equal(actionUses.filter((uses) => uses === 'actions/setup-node@v7').length, 9)
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
  // 2026-09-18：正文**不再从事件负载里拿**。那份正文是 push 那一刻的快照，push 后补正文
  // 会被判成没写，只能空提交重推换一轮 40 分钟（PR #804）。现在由 scripts/lib/prBody.mjs
  // 用 gh 现取，所以这里钉死的是「取正文要用的三样」，并且钉死旧 env 已经消失。
  assert.equal(contracts.env.PRIOR_ART_PR_BODY, undefined)
  assert.equal(contracts.env.DOOR_MAP_PR_BODY, undefined)
  assert.equal(contracts.env.GH_TOKEN, '${{ github.token }}')
  assert.equal(contracts.env.GH_REPO, '${{ github.repository }}')
  assert.equal(contracts.env.NOMI_PR_NUMBER, '${{ github.event.pull_request.number }}')
  assert.equal(contracts.env.GITHUB_EVENT_NAME, '${{ github.event_name }}')
  assert.equal(
    contracts.env.PRIOR_ART_BASE_REF,
    '${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before || inputs.base_ref }}',
  )
  assert.equal(
    contracts.env.DOOR_MAP_BASE_REF,
    '${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before || inputs.base_ref }}',
  )

  const unit = workflow.jobs.unit
  assert.equal(unit.needs, 'scope')
  const full = unit.steps.find((step) => step.name?.includes('full lane'))
  const focused = unit.steps.find((step) => step.name?.includes('fast lane'))
  assert.equal(full.if, "needs.scope.outputs.unit == 'full'")
  assert.equal(focused.if, "needs.scope.outputs.unit == 'focused'")
  // 2026-10-09：full 档按 vitest 原生 --shard 分片（文件无重叠无遗漏由 vitest 的哈希区间切分保证），focused 档仍一片。
  assert.equal(full.run, 'pnpm run test:unit:shard --shard=${{ matrix.shard }}/${{ strategy.job-total }}')
  assert.equal(focused.run, 'pnpm run test:system:focused')
  assert.equal(unit.strategy['fail-fast'], false)
  assert.match(unit.strategy.matrix.shard, /unit == 'full' && '\[1,2,3\]' \|\| '\[1\]'/)
  // vitest 之外的 node:test 套件不归 vitest 分片管，必须恰好跑一次：固定第 1 片，且 `test` 脚本本身仍含它们（本地全量不丢）。
  const nodeSuites = unit.steps.find((step) => step.run === 'pnpm run test:node-suites')
  assert.equal(nodeSuites.if, "needs.scope.outputs.unit == 'full' && matrix.shard == 1")
  assert.match(packageJson.scripts.test, /vitest-fair-share\.mjs && pnpm run test:node-suites/)
  assert.match(packageJson.scripts['test:node-suites'], /test:agent-runtime/)
  assert.match(packageJson.scripts['test:unit:shard'], /vitest-fair-share\.mjs$/)
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
      selectedSteps['Browser feel mechanism'].run,
      selectedSteps['Popup geometry census'].run,
      selectedSteps['Electron smoke'].run,
      selectedSteps['CI-safe user journeys'].run,
      selectedSteps['MCP L1 handshake journey'].run,
      selectedSteps['MCP elicitation-first journey'].run,
      selectedSteps['Real user loopback journey gate'].run,
      selectedSteps['Golden path (Agent storyboard lands on canvas)'].run,
      selectedSteps['Critical canvas acceptance'].run,
    ],
    [
      'pnpm run test:feel:mechanism',
      'pnpm run test:popup-geometry -- --shard ${{ matrix.shard }}/${{ strategy.job-total }}',
      'xvfb-run -a pnpm run test:e2e',
      'xvfb-run -a pnpm run test:journeys',
      'xvfb-run -a pnpm run test:mcp-journey',
      'xvfb-run -a pnpm run test:mcp-elicitation',
      'xvfb-run -a pnpm run test:real-user-journeys:ci',
      'xvfb-run -a pnpm run test:golden',
      'xvfb-run -a pnpm run test:canvas:critical',
    ],
  )
  // 2026-09-18（B 件）：七步一律 continue-on-error，job 的结论交给末尾那一步。
  // 串行 fail-fast 让每轮 CI 只暴露一条红（#804 连三轮各红一条不同走查）。
  const chainSteps = [
    'Browser feel mechanism', 'Popup geometry census', 'Electron smoke', 'CI-safe user journeys', 'MCP L1 handshake journey',
    'MCP elicitation-first journey', 'Real user loopback journey gate', 'Critical canvas acceptance',
  ]
  for (const name of chainSteps) {
    assert.equal(selectedSteps[name]['continue-on-error'], true, `${name} 必须 continue-on-error，否则后面几条又被吞掉`)
    assert.ok(selectedSteps[name].id, `${name} 必须有 id，汇总步靠它读 outcome`)
  }
  const summary = desktop.steps.find((step) => step.name === 'E2E chain summary')
  assert.equal(summary.if, 'always()')
  assert.equal(summary.run, 'node scripts/summarize-e2e-chain.mjs')
  assert.equal(summary['continue-on-error'], undefined, '汇总步本身不许 continue-on-error——它就是 job 的结论')
  // 汇总必须**每一步都读到**：漏掉一个 id，那条走查就悄悄失去了决定 job 红绿的能力。
  for (const name of chainSteps) {
    assert.match(summary.env.CHAIN, new RegExp(`${selectedSteps[name].id}:\\$\\{\\{ steps\\.${selectedSteps[name].id}\\.outcome \\}\\}`))
  }

  // 本地那条链（pnpm run test:e2e:ci-chain）必须和这个 job **同序同命令**——
  // 两份清单各写各的，就是下一个「本地全绿 CI 连红三轮」。
  assert.deepEqual(CI_E2E_CHAIN.map((step) => step.id), chainSteps.map((name) => selectedSteps[name].id))
  assert.deepEqual(
    CI_E2E_CHAIN.map((step) => step.script),
    chainSteps.map((name) => /pnpm run ([\w:-]+)/.exec(selectedSteps[name].run)[1]),
  )

  // 每个步骤 = 风险面条件 && 本片计划里有它（计划见 scripts/lib/e2eShardPlan.mjs，不在 yml 里写死）。
  const inShard = (id) => `contains(steps.plan.outputs.units, '|${id}|')`
  assert.equal(selectedSteps['Browser feel mechanism'].if, inShard('feel'))
  assert.equal(selectedSteps['Electron smoke'].if, `needs.scope.outputs.desktop == 'true' && ${inShard('smoke')}`)
  assert.equal(selectedSteps['CI-safe user journeys'].if, `needs.scope.outputs.journeys == 'true' && ${inShard('journeys')}`)
  assert.equal(selectedSteps['MCP L1 handshake journey'].if, `needs.scope.outputs.journeys == 'true' && ${inShard('mcp-journey')}`)
  assert.equal(selectedSteps['MCP elicitation-first journey'].if, `needs.scope.outputs.journeys == 'true' && ${inShard('mcp-elicitation')}`)
  assert.equal(selectedSteps['Real user loopback journey gate'].if, `needs.scope.outputs.journeys == 'true' && ${inShard('real-user-journeys')}`)
  assert.equal(selectedSteps['Golden path (Agent storyboard lands on canvas)'].if, `needs.scope.outputs.journeys == 'true' && ${inShard('golden')}`)
  assert.equal(selectedSteps['Critical canvas acceptance'].if, `needs.scope.outputs.canvas == 'critical' && ${inShard('canvas-critical')}`)
  assert.equal(runCommands(desktop).filter((command) => command === 'pnpm run build').length, 1)
  // full/performance 面已拆到并行 job；本 job 不得再串行执行它们（那是 22 分钟关键路径的根因）。
  assert.equal(selectedSteps['Full functional canvas acceptance'], undefined)
  assert.equal(selectedSteps['Canvas performance budget'], undefined)

  const evidence = desktop.steps.find((step) => step.uses === 'actions/upload-artifact@v7')
  assert.equal(evidence.if, 'always()')
  assert.equal(evidence.with.name, 'linux-walkthrough-evidence-${{ matrix.shard }}')
  assert.match(evidence.with.path, /outputs\/canvas-acceptance\/\*\*/)
})

test('E2E walkthrough job is a shard matrix whose plan covers every walkthrough exactly once', () => {
  const desktop = workflow.jobs['desktop-linux']
  assert.deepEqual(desktop.strategy, { 'fail-fast': false, matrix: { shard: [1, 2, 3, 4] } })
  const plan = desktop.steps.find((step) => step.id === 'plan')
  assert.equal(plan.run, 'node scripts/e2e-shards.mjs --shard ${{ matrix.shard }}/${{ strategy.job-total }} --github-output')
  // 计划步必须排在所有走查步之前。
  const order = desktop.steps.map((step) => step.id ?? step.name)
  assert.ok(order.indexOf('plan') < order.indexOf('feel'))

  // yml 里每个 `contains(steps.plan.outputs.units, '|id|')` 条件引用的 id，与计划里的单元集合完全一致：
  // 计划里多一个单元而 yml 没有步骤认领 = 那条走查被分到某片却没人跑；反过来 = 步骤永远跳过。
  const referenced = new Set(
    desktop.steps.map((step) => /contains\(steps\.plan\.outputs\.units, '\|([\w-]+)\|'\)/.exec(step.if ?? '')?.[1]).filter(Boolean),
  )
  assert.deepEqual([...referenced].sort(), E2E_UNITS.map((unit) => unit.id).sort())
  // 普查按格摊到每一片，所以每片都跑（不带 plan 条件）。
  assert.equal(desktop.steps.find((step) => step.id === 'census').if, undefined)

  // 划分性质：任何片数下，每个单元、每个普查格恰好落在一片。
  const items = listShardItems()
  assert.ok(items.filter((item) => item.kind === 'census').length > 50, '普查格列表空了——枚举器坏了会让整条普查静默消失')
  for (let total = 1; total <= 8; total += 1) {
    const bins = assertPartition(total, items)
    assert.equal(bins.length, total)
    assert.equal(bins.reduce((n, bin) => n + bin.units.length + bin.census.length, 0), items.length)
  }
  // 新增一条走查 / 一个普查格会自动进某一片。
  const grown = [...items, { kind: 'unit', id: 'brand-new-walk', seconds: 90 }, { kind: 'census', id: 'new-screen/new-state', seconds: 4 }]
  const bins = assertPartition(4, grown)
  assert.equal(bins.filter((bin) => bin.units.includes('brand-new-walk')).length, 1)
  assert.equal(bins.filter((bin) => bin.census.includes('new-screen/new-state')).length, 1)
  // 计划自己坏了（重分）会当场抛错，不会静默少跑。
  assert.throws(() => assertPartition(4, [{ kind: 'unit', id: 'x', seconds: 1 }, { kind: 'unit', id: 'x', seconds: 1 }]), /不是一个划分/)

  // 均衡：最重一片不超过平均的 1.15 倍（按历史耗时装箱，不是按名字平分）。
  const heaviest = Math.max(...planShards(4, items).map((bin) => bin.seconds))
  const average = items.reduce((sum, item) => sum + item.seconds, 0) / 4
  assert.ok(heaviest <= average * 1.15, `最重一片 ${heaviest}s，平均 ${average}s`)

  // 汇总判定不变：Quality Gate 仍只看 needs['desktop-linux'].result，矩阵里任何一片红整个 job 就红。
  assert.match(
    workflow.jobs.quality.steps.find((step) => step.name === 'Require every validation surface').run,
    /needs\['desktop-linux'\]\.result/,
  )
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

test('core flow smoke runs on every non-docs change as a two-fixture matrix derived from the single fixture owner', () => {
  const smoke = workflow.jobs['core-smoke']
  assert.equal(smoke.needs, 'scope')
  // 唯一开关是分类器的 core_smoke（= 非纯文档）；不许再挂任何别的路径条件。
  assert.equal(smoke.if, "needs.scope.outputs.core_smoke == 'true'")
  assert.deepEqual(smoke.strategy, { 'fail-fast': false, matrix: { fixture: [...CORE_SMOKE_FIXTURES] } })
  // check 名由 matrix 值展开；合后收据按 coreSmokeCheckName 找它们——两边字面必须对得上。
  assert.equal(smoke.name, 'Core Flow Smoke (${{ matrix.fixture }})')
  assert.equal(coreSmokeCheckName('${{ matrix.fixture }}'), smoke.name)
  assert.deepEqual(CORE_SMOKE_CHECK_NAMES, CORE_SMOKE_FIXTURES.map(coreSmokeCheckName))
  // 核心冒烟 check 不进「skipped 也算过」的常规名单：阻断档在 git-delivery 里是 success-only。
  for (const name of CORE_SMOKE_CHECK_NAMES) assert.equal(REQUIRED_MERGED_CHECKS.includes(name), false)

  // 阻断 / 非阻断的唯一 owner 是分类器，CI 的 continue-on-error 必须逐字从它派生。
  // 现状（2026-09-22 用户拍板）：empty 阻断，used 非阻断。
  assert.deepEqual([...CORE_SMOKE_BLOCKING_FIXTURES], ['empty'])
  assert.deepEqual([...CORE_SMOKE_ADVISORY_FIXTURES], ['used'])
  assert.deepEqual([...CORE_SMOKE_BLOCKING_CHECK_NAMES], ['Core Flow Smoke (empty)'])
  assert.deepEqual([...CORE_SMOKE_ADVISORY_CHECK_NAMES], ['Core Flow Smoke (used)'])
  // 两档互斥且合起来正好是全集——不许有哪个夹具既不阻断也不在非阻断名单里（那就是没人管）。
  assert.deepEqual([...CORE_SMOKE_BLOCKING_FIXTURES, ...CORE_SMOKE_ADVISORY_FIXTURES].sort(), [...CORE_SMOKE_FIXTURES].sort())
  // 非阻断那一格挂 continue-on-error，阻断那一格绝不能挂——挂了 empty 就等于没有必过门。
  assert.equal(smoke['continue-on-error'], "${{ matrix.fixture != 'empty' }}")
  for (const fixture of CORE_SMOKE_FIXTURES) {
    const blocking = CORE_SMOKE_BLOCKING_FIXTURES.includes(fixture)
    assert.equal(smoke['continue-on-error'].includes(`!= '${fixture}'`), blocking, `${fixture} 的阻断档与 continue-on-error 表达式不一致`)
  }

  const commands = runCommands(smoke)
  assert.equal(commands.filter((command) => command === 'pnpm run build').length, 1)
  assert.ok(commands.includes('xvfb-run -a pnpm run test:core-smoke -- --fixture ${{ matrix.fixture }}'))
  assert.equal(packageJson.scripts['test:core-smoke'], 'python3 scripts/with-gates-lock.py -- node tests/ux/core-smoke/run.mjs')
  assert.ok(CORE_SMOKE_SCENARIOS.some((scenario) => scenario.script === 'tests/ux/node-params-and-version-pill.walk.mjs'))
  assert.ok(CORE_SMOKE_SCENARIOS.some((scenario) => scenario.script === 'tests/ux/canvas-drag-pan-gestures.walk.mjs'))

  const evidence = smoke.steps.find((step) => step.uses === 'actions/upload-artifact@v7')
  assert.equal(evidence.if, 'always()')
  assert.equal(evidence.with.name, 'core-smoke-evidence-${{ matrix.fixture }}')
  assert.match(evidence.with.path, /outputs\/core-smoke\/\*\*/)
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
  assert.deepEqual(PROFILES['ci-journeys'], ['journeys-ci', 'real-user-journeys'])
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
  assert.equal(scripts['test:system:contracts'], 'python3 scripts/with-gates-lock.py -- node scripts/test-system.mjs ci-contracts')
  assert.equal(scripts['test:system:unit'], 'python3 scripts/with-gates-lock.py -- node scripts/test-system.mjs ci-unit')
  assert.equal(scripts['test:system:desktop'], 'python3 scripts/with-gates-lock.py -- node scripts/test-system.mjs ci-desktop')
  assert.equal(scripts['test:system:journeys'], 'python3 scripts/with-gates-lock.py -- node scripts/test-system.mjs ci-journeys')
  assert.equal(scripts['test:real-user-journeys:ci'], 'python3 scripts/with-gates-lock.py -- node scripts/real-user-test-gates.mjs --provider loopback')
  assert.match(scripts['test:real-user-journeys'], /real-user-test-gates\.mjs --provider loopback/)
  assert.equal(
    scripts['test:mcp-elicitation'],
    'python3 scripts/with-gates-lock.py --command "pnpm run check:electron-install && node tests/ux/mcp-generation-elicitation-first.e2e.mjs"',
  )
  // A 件（2026-09-18）：本地一条命令按 CI 同序跑完七步。必须**只持一次 gates 锁**——
  // 七个 test:* 各自套锁，不在最外层套一次就会逐个重新排队（本机常有 20+ worktree）。
  assert.equal(scripts['test:e2e:ci-chain'], 'python3 scripts/with-gates-lock.py -- node scripts/run-ci-e2e-chain.mjs')
  assert.equal(scripts['test:system:canvas:critical'], 'python3 scripts/with-gates-lock.py -- node scripts/test-system.mjs ci-canvas-critical')
  assert.equal(scripts['test:system:canvas:full'], 'python3 scripts/with-gates-lock.py -- node scripts/test-system.mjs ci-canvas-full')
  assert.equal(scripts['test:system:performance'], 'python3 scripts/with-gates-lock.py -- node scripts/test-system.mjs ci-performance')
  assert.equal(scripts['test:canvas:performance'], 'python3 scripts/with-gates-lock.py -- node tests/ux/canvas-real-suite.mjs performance')
  // 棘轮只减不增：2026-09-06 v4 接线删掉旧面板后降到 81；2026-09-22 总合并清完合并带来的
  // 未用 import 与两处 prefer-const 后降到 79。调高需要理由，调低直接改这一行。
  assert.equal(scripts['lint:ci'], 'eslint . --max-warnings=79')
  assert.match(scripts['check:quality-gate-workflow'], /validation-policy\.node-test\.mjs/)
  assert.match(scripts['check:quality-gate-workflow'], /real-user-test-gates\.node-test\.mjs/)
})

test('Quality Gate requires mandatory jobs and every risk-selected optional surface', () => {
  const quality = workflow.jobs.quality
  assert.deepEqual(quality.needs, [
    'scope',
    'contracts',
    'director3dbox-face',
    'unit',
    'core-smoke',
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
  // 3D-BOX 开关开的那张工具面：每次都要验（便宜、只看声明），开关真的开着由 job 第一步自证。
  assert.match(command, /needs\['director3dbox-face'\]\.result \}\}" = "success"/)
  const flagFace = workflow.jobs['director3dbox-face']
  const flagStep = flagFace.steps.find((step) => step.run === 'pnpm run check:director3dbox-face')
  assert.equal(flagStep.env.NOMI_DESKTOP_DEV, '1')
  assert.equal(flagStep.env.NOMI_DIRECTOR_3DBOX, 'true')
  assert.ok(runCommands(flagFace).includes('pnpm run check:director3dbox-face'))
  assert.match(packageJson.scripts['check:director3dbox-face'], /^pnpm exec tsx scripts\/check-director3dbox-face-on\.ts && /)
  assert.match(command, /needs\['canvas-acceptance'\]\.result/)
  assert.match(command, /needs\['canvas-performance'\]\.result/)
  assert.match(command, /needs\['mac-package'\]\.result/)
  // 核心冒烟 fail-closed：skipped 只在 core_smoke=false 且 reason=docs_only 时放行，其余一律要 success。
  const coreSmokeBlock = /if \[ "\$\{\{ needs\.scope\.outputs\.core_smoke \}\}" = "false" \]; then\n\s*test "\$\{\{ needs\.scope\.outputs\.reason \}\}" = "docs_only"\n\s*test "\$\{\{ needs\['core-smoke'\]\.result \}\}" = "skipped"\n\s*else\n\s*test "\$\{\{ needs\['core-smoke'\]\.result \}\}" = "success"\n\s*fi/
  assert.match(command, coreSmokeBlock)
})

/**
 * 类级不变量：**取消式并发组不能按「多个提交共用的 ref」分组**。
 *
 * 2026-09-02 实测（docs/fixes/2026-09-02-main-push-concurrency-cancels-evidence.root-cause.json）：
 * quality-gate 对 push 事件回落到 `github.ref`，而 main 的 ref 恒为 refs/heads/main——于是每个新
 * merge 都取消上一个 merge 还在跑的班。实测 10:51–10:55 连续四班里三班被取消，`delivery:verify-merged`
 * 因此在那些 merge SHA 上发不出 exact-SHA 收据（工具正确拒绝把 cancelled 当成功）。
 *
 * 判据落在「push 触发 + cancel-in-progress」这个组合上，而不是只盯 quality-gate 一个文件：
 * 谁将来给某个取消式 workflow 加上 push 触发，这里就会红。
 */
test('取消式并发组不得按共用 ref 分组：push 触发的 workflow 必须按 commit 区分', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows')
  const files = fs.readdirSync(workflowDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  assert.ok(files.length > 0, '应当扫到 workflow 文件')

  const offenders = []
  for (const name of files) {
    const definition = load(fs.readFileSync(path.join(workflowDir, name), 'utf8'))
    const triggers = definition?.on ?? {}
    const hasPushTrigger = Object.prototype.hasOwnProperty.call(triggers, 'push')
    const cancels = definition?.concurrency?.['cancel-in-progress'] === true
    if (!hasPushTrigger || !cancels) continue
    const group = String(definition?.concurrency?.group ?? '')
    // push 事件下必须落到 github.sha；否则同一分支的相邻 push 会互相取消。
    if (!group.includes('github.sha')) offenders.push(`${name}: ${group}`)
  }

  assert.deepEqual(
    offenders,
    [],
    '下列 workflow 由 push 触发且会取消在跑的班，但并发组里没有 github.sha —— '
      + '同一分支的相邻 push 会互相取消，被取消的班留不下任何证据，exact-SHA 收据也发不出：\n  '
      + offenders.join('\n  '),
  )
})

test('browser feel fixtures run in the Chromium-equipped desktop lane, never Unit', () => {
  const commands = runCommands(workflow.jobs['desktop-linux'])
  const install = commands.indexOf(PLAYWRIGHT_INSTALL_STEP)
  const run = commands.indexOf('pnpm run test:feel:mechanism')
  assert.ok(install >= 0 && run > install)
  assert.ok(commands.findIndex((command) => command.startsWith('pnpm run test:popup-geometry')) > install)
  for (const [name, job] of Object.entries(workflow.jobs)) {
    // Feel's node:test fixtures stay in desktop. Unit also has Vitest browser
    // integration suites, which need Chromium without running Feel twice.
    if (/unit/i.test(name)) assert.doesNotMatch(runCommands(job).join('\n'), /test:feel:(browser|mechanism)/)
  }
  for (const name of ['_feel', '_feel-observer']) {
    assert.ok(!fs.existsSync(path.join(repoRoot, `tests/ux/${name}.test.mjs`)))
    assert.match(packageJson.scripts['test:feel:mechanism'], new RegExp(`${name}\\.browser\\.mjs`))
  }
  const evidence = workflow.jobs['desktop-linux'].steps.find((step) => step.uses === 'actions/upload-artifact@v7')
  assert.match(evidence.with.path, /artifacts\/feel\/\*\*/)
})

// 没设 timeout-minutes 的 job 卡住时 GitHub 要跑满 6 小时才杀，合并队列堵半天还不报红。
// 数字按各 job 近 30 次成功运行的最长耗时 ×2~3 给（见引入它的 PR 表）；这里只钉「每个 job 都有」。
test('every job in every workflow declares a job-level timeout-minutes', () => {
  const dir = path.join(repoRoot, '.github/workflows')
  for (const file of fs.readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
    const doc = load(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const [id, job] of Object.entries(doc.jobs ?? {})) {
      assert.ok(Number.isFinite(job['timeout-minutes']) && job['timeout-minutes'] > 0, `${file} job "${id}" needs timeout-minutes`)
    }
  }
})

// 2026-10-02（复盘 fixes 行 2、60：同一类「CI 缺 Chromium」两次）：不再一条 workflow 一条断言，
// 而是一次管住所有 workflow——任何 job 只要跑了会拉起真实浏览器的测试入口，就必须先装 Chromium，且装在它之前。
test('every workflow job that runs browser-backed tests installs Chromium before them', () => {
  const BROWSER_BACKED = [
    'pnpm run test:system:unit',
    'pnpm run test:system:focused',
    'pnpm run test:system:full',
    'pnpm run test:system:release',
    'pnpm run test:system:ci',
    'pnpm run test',
  ]
  const dir = path.join(repoRoot, '.github/workflows')
  const offenders = []
  let jobsWithBrowserTests = 0
  for (const file of fs.readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
    const doc = load(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
      const steps = job.steps ?? []
      const runIndex = steps.findIndex(
        (step) => typeof step.run === 'string' && BROWSER_BACKED.some((command) => step.run.split('\n').some((line) => line.trim() === command)),
      )
      if (runIndex < 0) continue
      jobsWithBrowserTests += 1
      const installIndex = steps.findIndex((step) => typeof step.run === 'string' && step.run.split('\n').some((line) => line.trim() === PLAYWRIGHT_INSTALL_STEP))
      if (installIndex < 0 || installIndex > runIndex) offenders.push(`${file}:${jobName}`)
    }
  }
  assert.ok(jobsWithBrowserTests > 0, '断言空转：没有找到任何跑浏览器测试的 job')
  assert.deepEqual(offenders, [], `这些 job 跑了浏览器测试却没在它之前装 Chromium：${offenders.join('、')}`)
})


test('spending and nightly workflows use shared routing, browser setup, timeouts, and summary semantics', () => {
  const quality = load(fs.readFileSync(path.join(repoRoot, '.github/workflows/quality-gate.yml'), 'utf8'))
  const desktop = quality.jobs['desktop-linux']
  const spend = desktop.steps.find((step) => step.name === 'Spending path walkthroughs (blocking subset)')
  assert.equal(spend.if, "needs.scope.outputs.spend_walks == 'true' && contains(steps.plan.outputs.units, '|spend-walks|')")
  assert.match(spend.run, /validation-policy\.mjs --print-spend-walks blocking/)
  assert.match(spend.run, /timeout 600/)
  // 证据上传和跑走查必须同一个条件：走查没跑时上传会报「No files were found」warning，被 CI 注解卫生当成意外（main 1d32e1b93）。
  const upload = desktop.steps.find((step) => step.name === 'Upload spending walkthrough evidence')
  assert.equal(upload.if, "always() && needs.scope.outputs.spend_walks == 'true' && contains(steps.plan.outputs.units, '|spend-walks|')")
  const nightly = load(fs.readFileSync(path.join(repoRoot, '.github/workflows/nightly-walkthroughs.yml'), 'utf8'))
  assert.equal(nightly.jobs.walks.steps.find((step) => step.name === 'Install Chromium').run, PLAYWRIGHT_INSTALL_STEP)
  assert.match(nightly.jobs.walks.steps.find((step) => step.name === 'Run non-paid walkthrough batch').run, /timeout 600/)
  assert.match(nightly.jobs.report.steps.find((step) => step.name === 'Publish summary and update issue').run, /nightly-walk-summary\.mjs/)
})

test('workflows delegate Chromium installation to the shared script', () => {
  const dir = path.join(repoRoot, '.github/workflows')
  const offenders = []
  for (const file of fs.readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    if (/playwright install/.test(source)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], `workflow 中禁止直接出现 playwright install：${offenders.join('、')}`)
})

test('every workflow job that runs a repository script checks out the repository first', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows')
  const offenders = []
  for (const file of fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))) {
    const definition = load(fs.readFileSync(path.join(workflowDir, file), 'utf8'))
    for (const [jobName, job] of Object.entries(definition.jobs ?? {})) {
      const steps = job.steps ?? []
      for (const [index, step] of steps.entries()) {
        if (typeof step.run !== 'string' || !/\bscripts\//.test(step.run)) continue
        const hasCheckout = steps.slice(0, index).some(
          (prior) => typeof prior.uses === 'string' && /^actions\/checkout@/.test(prior.uses),
        )
        if (!hasCheckout) offenders.push(`${file}:${jobName}:${index}`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})
