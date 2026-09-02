import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { writeGithubOutput } from './select-quality-gate-profile.mjs'
import { classifyValidationPolicy } from './validation-policy.mjs'

function surfaces(result) {
  return {
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
  unit: 'focused',
  desktop: false,
  journeys: false,
  canvas: 'none',
  performance: false,
  package: false,
  release: false,
  failClosed: false,
}

test('documentation and isolated renderer changes pay only focused-unit cost', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['README.md'])), focusedOnly)
  assert.deepEqual(surfaces(classifyValidationPolicy(['src/workbench/timeline/TimelinePanel.tsx'])), focusedOnly)
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

test('packaging and native runtime identity paths select package without forcing canvas performance', () => {
  assert.deepEqual(surfaces(classifyValidationPolicy(['electron/preload.ts'])), {
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

test('main pushes reuse changed-file risk instead of becoming full only because they are pushes', () => {
  assert.deepEqual(
    surfaces(classifyValidationPolicy(['README.md'], { eventName: 'push' })),
    focusedOnly,
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
  ]) {
    assert.deepEqual(surfaces(classifyValidationPolicy(files)), {
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
    unit: 'full',
    desktop: 'true',
    walkthroughs: 'false',
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

// roster 走查的触发面必须独立于 desktop。
// 2026-09-02 实测教训：roster 步骤最初挂在 desktop 上，而 desktop 只认 electron/ 与
// src/desktop/bridge.ts —— 改 src/i18n 压根不会让它为 true，于是 roster 收的那一簇
// i18n/locale 走查在**最该跑的时候恰好不跑**，整个步骤形同不存在。
test('i18n and settings-shell changes select the walkthrough roster', () => {
  for (const path of [
    'src/i18n/locales/runtime.ts',
    'src/i18n/index.ts',
    'src/workbench/settings/SettingsDialog.tsx',
    'src/workbench/library/ProjectLibraryPage.tsx',
    'tests/ux/ci-roster.mjs',
    'tests/ux/library-language-switcher.walk.mjs',
  ]) {
    const policy = classifyValidationPolicy([{ path, status: 'M' }], { eventName: 'pull_request' })
    assert.equal(policy.walkthroughs, true, `${path} 应当触发 roster 走查`)
  }
})

test('unrelated changes do not pay for the walkthrough roster', () => {
  for (const path of ['README.md', 'docs/plan/whatever.md', 'src/utils/cn.ts']) {
    const policy = classifyValidationPolicy([{ path, status: 'M' }], { eventName: 'pull_request' })
    assert.equal(policy.walkthroughs, false, `${path} 不该触发 roster 走查`)
  }
})

test('fail-closed profiles always include the walkthrough roster', () => {
  // 删除/重命名、空 diff、显式 full 都 fail-closed 到全维度——roster 不许是例外，
  // 否则「不确定时跑全套」这个承诺就有个洞。
  const deleted = classifyValidationPolicy([{ path: 'src/anything.tsx', status: 'D' }], { eventName: 'pull_request' })
  assert.equal(deleted.walkthroughs, true)
  const empty = classifyValidationPolicy([], { eventName: 'pull_request' })
  assert.equal(empty.walkthroughs, true)
  const explicitFull = classifyValidationPolicy([{ path: 'README.md', status: 'M' }], { eventName: 'pull_request', requestedMode: 'full' })
  assert.equal(explicitFull.walkthroughs, true)
})

test('the workflow actually consumes the walkthroughs output (otherwise the scope is dead weight)', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/quality-gate.yml', import.meta.url), 'utf8')
  // scope job 要导出它、roster step 要用它、desktop-linux job 要因它而启动。
  assert.match(workflow, /walkthroughs: \$\{\{ steps\.profile\.outputs\.walkthroughs \}\}/)
  // roster 是**独立 job**（2026-09-02 随 main 的拆班方向调整）：它的触发面与
  // smoke/journeys/canvas 都不重合，搭 desktop-linux 会让两边互相平白拉起。
  assert.match(workflow, /walkthrough-roster:/)
  assert.match(workflow, /if: needs\.scope\.outputs\.walkthroughs == 'true'/)
  assert.match(workflow, /run: xvfb-run -a pnpm run test:walkthroughs:ci/)
  // 汇总 job 必须等它、且在该维度选中时要求它成功——否则这个 job 红了也拦不住合并。
  assert.match(workflow, /needs: \[scope, contracts, unit, desktop-linux, walkthrough-roster,/)
  assert.match(workflow, /needs\['walkthrough-roster'\]\.result/)
})
