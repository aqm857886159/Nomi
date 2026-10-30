import { describe, expect, it } from 'vitest'
import { inferRoutes, loadRoutingTable, checkRoutingCard, checkRoutingEvidence } from './pr-judgement-lib.mjs'

const table = loadRoutingTable()
const files = ['electron/jsonFile.ts', 'electron/workspace/workspaceRepository.ts', 'electron/workspace/workspaceRegistry.ts', 'electron/assets/projectAssetStore.ts', 'electron/events/canvasEventLog.ts', 'electron/logging/rendererLog.ts', 'electron/productionRun/productionGenerationSubmission.ts', 'src/workbench/project/workbenchProjectSession.ts']

describe('saving and landing paths require performance evidence', () => {
  it.each(files)('%s routes to perf-scenario', (file) => {
    const inferred = inferRoutes([{ status: 'M', path: file }], '', table)
    expect(inferred.categories.map((category) => category.id)).toContain('perf')
    const card = checkRoutingCard('## 功能分类\n- [x] 新增功能 / 性能\n', inferred, table)
    expect(card.union).toContain('perf')
    const missing = checkRoutingEvidence('## 验收证据\n', card.union, table)
    expect(missing.ok).toBe(false)
    expect(missing.lines.join('\n')).toContain('perf-scenario')
  })
  it.each(['electron/workspace/saveFaultSweep.test.ts', 'docs/plan/anything.md', 'electron/jsonFile.tsx', 'electron/workspaceOther.ts', 'src/workbench/projectile/run.ts'])('unrelated/test path %s does not gain perf', (file) => {
    expect(inferRoutes([{ status: 'M', path: file }], '', table).categories.map((category) => category.id)).not.toContain('perf')
  })
})
