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
  ]) {
    assert.deepEqual(surfaces(classifyValidationPolicy([file])), {
      ...focusedOnly,
      unit: 'full',
      journeys: true,
    })
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
  assert.deepEqual(surfaces(classifyValidationPolicy(['electron/harness/tools/modelToolSurfaceManifest.ts'])), {
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
    ['scripts/real-user-test-gates.mjs'],
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
