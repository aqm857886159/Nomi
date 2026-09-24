import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { writeGithubOutput } from './select-quality-gate-profile.mjs'
import { classifyValidationPolicy, CORE_SMOKE_ADVISORY_CHECK_NAMES, CORE_SMOKE_ADVISORY_FIXTURES, CORE_SMOKE_BLOCKING_CHECK_NAMES, CORE_SMOKE_BLOCKING_FIXTURES, CORE_SMOKE_FIXTURES } from './validation-policy.mjs'

function surfaces(result) {
  return {
    coreSmoke: result.coreSmoke,
    unit: result.unit,
    desktop: result.desktop,
    journeys: result.journeys,
    canvas: result.canvas,
    performance: result.performance,
    package: result.package,
    release: result.release,
    failClosed: result.failClosed,
  }
}

const focusedOnly = {
  coreSmoke: true,
  unit: 'focused',
  desktop: false,
  journeys: false,
  canvas: 'none',
  performance: false,
  package: false,
  release: false,
  failClosed: false,
}

const docsOnly = { ...focusedOnly, coreSmoke: false }

test('documentation and isolated renderer changes pay only focused-unit cost', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['README.md'])), docsOnly)
  assert.deepEqual(surfaces(classifyValidationPolicy(['src/workbench/timeline/TimelinePanel.tsx'])), focusedOnly)
})

// 根目录的 Agent 说明文档（AGENTS.md / CLAUDE.md）算纯文档（2026-09-22 用户拍板）：
// 此前只认 docs/|marketing/|README*，于是 #843 那种只改一份 Agent 说明的 PR 被判
// isolated_change，两格核心冒烟在纯文档 diff 上白跑一遍。
test('根目录的 AGENTS.md / CLAUDE.md 算 docs_only，但只有整份 diff 都是文档才算', () => {
  // (a) 只改一份根目录 Agent 说明 → docs_only，核心冒烟不开。
  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    const result = classifyValidationPolicy([path])
    assert.deepEqual(surfaces(result), docsOnly, `${path} 应判 docs_only`)
    assert.equal(result.reason, 'docs_only')
    assert.equal(result.coreSmoke, false)
  }
  // 两份一起改，外加真文档目录，仍是 docs_only。
  const mixedDocs = classifyValidationPolicy([
    { status: 'M', path: 'CLAUDE.md' },
    { status: 'M', path: 'AGENTS.md' },
    { status: 'A', path: 'docs/lessons/x.md' },
  ])
  assert.equal(mixedDocs.reason, 'docs_only')
  assert.equal(mixedDocs.coreSmoke, false)

  // (b) 掺一个产品文件就不再是纯文档：冒烟照开，reason 回到 isolated_change。
  const withSource = classifyValidationPolicy(['CLAUDE.md', 'src/workbench/timeline/TimelinePanel.tsx'])
  assert.equal(withSource.reason, 'isolated_change')
  assert.equal(withSource.coreSmoke, true)

  // (c) 阳性对照：本次放宽**只**认这两个名字，根目录别的文件不许顺势变成纯文档。
  //     package.json 仍是打包风险面；贴着代码住的 src/**/CLAUDE.md 也不在放宽范围内。
  for (const path of ['package.json', 'model-catalog.json', 'index.html', 'CHANGELOG.md',
    'src/workbench/generationCanvas/nodes/director/CLAUDE.md']) {
    const result = classifyValidationPolicy([path])
    assert.notEqual(result.reason, 'docs_only', `${path} 不该因这次放宽变成 docs_only`)
    assert.equal(result.coreSmoke, true, `${path} 仍要开核心冒烟`)
  }
})

test('docs-only deletions, including the historical README QR replacement, stay focused', () => {
  // Documentation portion of fb79d8ac94dddb350fef69ed5627868d2140e726.
  const qrFiles = [
    { status: 'M', path: 'README.md' },
    { status: 'M', path: 'README.zh-CN.md' },
    { status: 'D', path: 'docs/media/nomi-canvas-group-wechat-2026-09-01.jpg' },
    { status: 'A', path: 'docs/media/nomi-canvas-group-wechat-2026-09-08.jpg' },
  ]
  for (const files of [qrFiles, [{ status: 'D', path: 'docs/中文.md' }],
    [{ status: 'D', path: 'marketing/old.png' }], [{ status: 'D', path: 'README.old.md' }]]) {
    const result = classifyValidationPolicy(files)
    assert.deepEqual(surfaces(result), docsOnly)
    assert.equal(result.reason, 'docs_only')
  }
  // The historical commit also edited a test: its complete diff must stay full.
  assert.equal(classifyValidationPolicy([...qrFiles,
    { status: 'M', path: 'tests/ux/marketing-home.static.mjs' }]).unit, 'full')
})

test('production deletions and mixed unsafe paths cannot use the docs-only exemption', () => {
  for (const file of ['src/foo.png', 'electron/icon.svg', 'tests/fixtures/qr.png',
    '.github/workflows/check.yml', 'scripts/validation-policy.mjs', 'public/icon.png']) {
    const result = classifyValidationPolicy([
      { status: 'D', path: 'docs/old.md' }, { status: 'D', path: file },
    ])
    assert.equal(result.unit, 'full', file)
    assert.equal(result.failClosed, true, file)
  }
  assert.equal(classifyValidationPolicy([{ status: 'R100', path: 'docs/new.md' }]).failClosed, true)
})

test('Electron changes require full unit and desktop without unrelated canvas, performance, or package work', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['electron/tasks/taskAdmission.ts'])), {
    ...focusedOnly,
    unit: 'full',
    desktop: true,
  })
})

test('model execution paths select full unit and real journeys without packaging', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['src/config/modelCatalogCache.ts'])), {
    ...focusedOnly,
    unit: 'full',
    journeys: true,
  })
})

test('the resident Agent shell selects the real-user journey lane', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['src/workbench/ai/ProjectAgentResidentShell.tsx'])), {
    ...focusedOnly,
    unit: 'full',
    journeys: true,
  })
})

test('the registered product journeys cannot fall back to focused-only validation', () => {
  for (const file of [
    'tests/ux/resident-composer-receipt-fix.e2e.mjs',
    'tests/ux/storyboard-agent-canonical-patch.e2e.mjs',
    'tests/ux/production-mcp-journey.e2e.mjs',
    'tests/ux/golden-path.e2e.mjs',
  ]) {
    assert.deepEqual(surfaces(classifyValidationPolicy([file])), {
      ...focusedOnly,
      unit: 'full',
      journeys: true,
    })
  }
})

// 2026-09-24：计划卡与技能 chip 两条走查进 REAL_USER_TEST_MANIFEST。它们守的两处显示 owner 的路径名里
// 都没有 `agent`/`model`，不显式点名就只会跑 focused unit——那正是这两次回归各自烂了五到十天的原因。
test('the plan-card and skill-chip walks and the display owners they guard select the journey lane', () => {
  for (const file of [
    'tests/ux/agent-real-user-conversation.walk.mjs',
    'tests/ux/agent-transcript-merge.walk.mjs',
    'src/workbench/ai/resident/residentToolDisplay.ts',
    'src/workbench/ai/resident/timelineAgentSurface.tsx',
    'src/workbench/skillLibrary/skillDisplay.ts',
  ]) {
    assert.equal(classifyValidationPolicy([file]).journeys, true, file)
  }
})

test('renderer-to-Electron bridges retain full unit, desktop, and journey coverage', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['src/desktop/bridge.ts'])), {
    ...focusedOnly,
    unit: 'full',
    desktop: true,
    journeys: true,
  })
})

test('ordinary canvas behavior and React Flow performance paths select different surfaces', () => {
  assert.deepEqual(
    surfaces(classifyValidationPolicy(['src/workbench/generationCanvas/nodes/NodeParameterControls.tsx'])),
    {
      ...focusedOnly,
      unit: 'full',
      canvas: 'critical',
    },
  )
  assert.deepEqual(
    surfaces(classifyValidationPolicy(['src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx'])),
    {
      ...focusedOnly,
      unit: 'full',
      desktop: true,
      canvas: 'full',
      performance: true,
    },
  )
})

test('lane levels only rise: a later ordinary canvas file never downgrades a full canvas lane', () => {
  // PR #833 real shape: React Flow files first, ordinary generationCanvas files and canvas walks after them.
  const reactFlow = 'src/workbench/generationCanvas/reactFlow/generationCanvasReactFlow.css'
  const ordinary = [
    'src/workbench/generationCanvas/store/generationCanvasStore.ts',
    'tests/ux/canvas-shortcut-parity.walk.mjs',
  ]
  const expected = { ...focusedOnly, unit: 'full', desktop: true, canvas: 'full', performance: true }
  assert.deepEqual(surfaces(classifyValidationPolicy([reactFlow, ...ordinary])), expected)
  assert.deepEqual(surfaces(classifyValidationPolicy([...ordinary, reactFlow])), expected)
  // Same class without the performance lane: a full-canvas walkthrough followed by an ordinary canvas file.
  const fullWalk = 'tests/ux/group-reference-direction.walk.mjs'
  for (const order of [[fullWalk, ordinary[0]], [ordinary[0], fullWalk]]) {
    assert.equal(classifyValidationPolicy(order).canvas, 'full', order.join(' -> '))
  }
})

test('packaging and native runtime identity paths select package without forcing canvas performance', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['electron/preload.ts'])), {
    ...focusedOnly,
    unit: 'full',
    desktop: true,
    package: true,
  })
})

test('packaged MCP surface truth sources select the package lane on the PR path', () => {
  // 2026-09-02 escape: surface-16-collapse rewrote the capability-core catalog, the PR round
  // never selected the package lane, and the packaged smoke only burned on the next main push.
  // The catalog/collapse/stdio-server/launcher dir, the harness tool-surface manifest, and the
  // smoke instrument itself must each pull mac-package forward onto the PR path.
  assert.deepEqual(surfaces(classifyValidationPolicy(['electron/capabilityCore/mcpToolCatalog.ts'])), {
    ...focusedOnly,
    unit: 'full',
    desktop: true,
    journeys: true,
    package: true,
  })
  assert.deepEqual(surfaces(classifyValidationPolicy(['electron/shared/agentCapabilities/verbs/canvasVerbs.ts'])), {
    ...focusedOnly,
    unit: 'full',
    desktop: true,
    package: true,
  })
  assert.deepEqual(surfaces(classifyValidationPolicy(['tests/ux/packaged-mcp-smoke.e2e.mjs'])), {
    ...focusedOnly,
    unit: 'full',
    desktop: true,
    package: true,
  })
})

test('canvas group/reference walkthroughs belong to functional canvas without forcing performance', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['tests/ux/group-reference-direction.walk.mjs'])), {
    ...focusedOnly,
    unit: 'full',
    canvas: 'full',
  })
})

test('core flow smoke is on for every non-docs diff — including the shared CSS / generation-workspace shape that escaped on 09-22', () => {
  // 09-22 回归坏在共享 CSS 开关：画布套件因为「没改到 generationCanvas」被跳过。冒烟不跟路径挂钩。
  for (const file of [
    'src/styles/workbench.css',
    'src/workbench/generation/GenerationWorkspace.tsx',
    'src/workbench/timeline/TimelinePanel.tsx',
    'src/i18n/locales/generationCommon.ts',
    'electron/tasks/taskAdmission.ts',
  ]) {
    for (const eventName of ['pull_request', 'push', 'merge_group']) {
      assert.equal(classifyValidationPolicy([file], { eventName }).coreSmoke, true, `${file} (${eventName})`)
    }
  }
  // 文档混进一个非文档文件 = 不是纯文档。
  assert.equal(classifyValidationPolicy(['docs/a.md', 'src/styles/workbench.css']).coreSmoke, true)
  // 只有纯文档关掉它。
  assert.equal(classifyValidationPolicy(['docs/a.md', 'README.md']).coreSmoke, false)
  // 冒烟自身的清单 / 夹具 / 跑法算验证基础设施：改它就全跑。
  assert.equal(classifyValidationPolicy(['tests/ux/core-smoke/scenarios.mjs']).failClosed, true)
})

test('阻断档与非阻断档：两档互斥、合起来是全集，且 used 当前不阻断', () => {
  // 2026-09-22 用户拍板：empty 阻断，used 照跑不判。升阻断只改 CORE_SMOKE_BLOCKING_FIXTURES 一处，
  // CI 的 continue-on-error 与合后收据都从它派生（各自的门岗测试钉死派生关系）。
  assert.deepEqual([...CORE_SMOKE_BLOCKING_FIXTURES], ['empty'])
  assert.deepEqual([...CORE_SMOKE_ADVISORY_FIXTURES], ['used'])
  assert.deepEqual([...CORE_SMOKE_BLOCKING_CHECK_NAMES], ['Core Flow Smoke (empty)'])
  assert.deepEqual([...CORE_SMOKE_ADVISORY_CHECK_NAMES], ['Core Flow Smoke (used)'])
  // 没有哪个夹具两边都不在（那就是没人管），也没有哪个两边都在。
  assert.deepEqual([...CORE_SMOKE_BLOCKING_FIXTURES, ...CORE_SMOKE_ADVISORY_FIXTURES].sort(), [...CORE_SMOKE_FIXTURES].sort())
  for (const fixture of CORE_SMOKE_FIXTURES) {
    assert.notEqual(CORE_SMOKE_BLOCKING_FIXTURES.includes(fixture), CORE_SMOKE_ADVISORY_FIXTURES.includes(fixture), fixture)
  }
  // 非阻断不等于不跑：CI matrix 仍然是全集。
  assert.ok(CORE_SMOKE_FIXTURES.includes('used'))
})

test('main pushes reuse changed-file risk instead of becoming full only because they are pushes', () => {
  assert.deepEqual(
    surfaces(classifyValidationPolicy(['README.md'], { eventName: 'push' })),
    docsOnly,
  )
})

test('empty, delete, rename, and explicit full requests fail closed across every surface', () => {
  const cases = [
    classifyValidationPolicy([]),
    classifyValidationPolicy([{ status: 'D', path: 'src/workbench/foo.ts' }]),
    classifyValidationPolicy([{ status: 'R100', path: 'src/workbench/renamed.ts' }]),
    classifyValidationPolicy(['README.md'], { requestedMode: 'full' }),
    classifyValidationPolicy(['README.md'], { eventName: 'workflow_dispatch' }),
  ]
  for (const result of cases) {
    assert.deepEqual(surfaces(result), {
      coreSmoke: true,
      unit: 'full',
      desktop: true,
      journeys: true,
      canvas: 'full',
      performance: true,
      package: true,
      release: result.reason === 'explicit_full_validation' || result.reason === 'workflow_dispatch_release_boundary',
      failClosed: true,
    })
  }
})

test('validation infrastructure changes exercise functional coverage without unrelated performance or packaging gates', () => {
  for (const files of [
    ['.github/workflows/quality-gate.yml'],
    [{ status: 'R100', path: 'eslint.config.mjs' }],
    ['scripts/select-quality-gate-profile.mjs'],
    ['scripts/real-user-test-gates.mjs'],
  ]) {
    assert.deepEqual(surfaces(classifyValidationPolicy(files)), {
      coreSmoke: true,
      unit: 'full',
      desktop: true,
      journeys: true,
      canvas: 'full',
      performance: false,
      package: false,
      release: false,
      failClosed: true,
    })
  }
})

test('performance-instrument changes re-run the performance lane on themselves so a mis-tuned budget cannot merge unverified', () => {
  for (const files of [
    ['scripts/validation-policy.mjs'],
    ['tests/ux/canvas-performance-benchmark.e2e.mjs'],
    ['scripts/canvas-performance-verdict.mjs'],
  ]) {
    assert.deepEqual(surfaces(classifyValidationPolicy(files)), {
      coreSmoke: true,
      unit: 'full',
      desktop: true,
      journeys: true,
      canvas: 'full',
      performance: true,
      package: false,
      release: false,
      failClosed: true,
    })
  }
})

test('validation infrastructure composes monotonically with real product and package risks', () => {
  assert.deepEqual(
    surfaces(
      classifyValidationPolicy([
        '.github/workflows/quality-gate.yml',
        'src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx',
      ]),
    ),
    {
      coreSmoke: true,
      unit: 'full',
      desktop: true,
      journeys: true,
      canvas: 'full',
      performance: true,
      package: false,
      release: false,
      failClosed: true,
    },
  )
  assert.deepEqual(surfaces(classifyValidationPolicy(['scripts/select-quality-gate-profile.mjs', 'package.json'])), {
    coreSmoke: true,
    unit: 'full',
    desktop: true,
    journeys: true,
    canvas: 'full',
    performance: false,
    package: true,
    release: false,
    failClosed: true,
  })
  // The perf instrument composes with packaging risk and still forces its own lane.
  assert.deepEqual(surfaces(classifyValidationPolicy(['scripts/validation-policy.mjs', 'package.json'])), {
    coreSmoke: true,
    unit: 'full',
    desktop: true,
    journeys: true,
    canvas: 'full',
    performance: true,
    package: true,
    release: false,
    failClosed: true,
  })
})

test('mixed changes merge risks monotonically and preserve normalized Git entries', () => {
  const result = classifyValidationPolicy([
    { status: 'M', path: './src/workbench/generationCanvas/nodes/NodeParameterControls.tsx' },
    { status: 'M', path: 'electron/preload.ts' },
  ])
  assert.deepEqual(surfaces(result), {
    ...focusedOnly,
    unit: 'full',
    desktop: true,
    canvas: 'critical',
    package: true,
  })
  assert.deepEqual(result.files, [
    { status: 'M', path: 'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx' },
    { status: 'M', path: 'electron/preload.ts' },
  ])
})

test('GitHub output exposes every policy dimension with stable snake-case names', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-validation-output-'))
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))
  const outputPath = path.join(tempRoot, 'output')
  writeGithubOutput(classifyValidationPolicy(['electron/preload.ts']), outputPath)
  const output = Object.fromEntries(
    fs.readFileSync(outputPath, 'utf8').trim().split('\n').map((line) => line.split('=')),
  )
  assert.deepEqual(output, {
    core_smoke: 'true',
    unit: 'full',
    desktop: 'true',
    journeys: 'false',
    canvas: 'none',
    performance: 'false',
    package: 'true',
    release: 'false',
    fail_closed: 'false',
    reason: 'electron:electron/preload.ts',
    changed_count: '1',
  })
})
