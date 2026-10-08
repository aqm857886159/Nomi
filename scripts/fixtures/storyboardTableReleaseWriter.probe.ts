// @ts-nocheck — 这份探针在 `git archive <tag>` 解出的发布版源码树里运行（相对路径指向那棵树），不属于本仓的类型检查。
// Release-writer probe for the storyboard-table retirement fixture.
//
// This file is NOT part of the repository test lane: `scripts/generate-storyboard-table-fixture.mjs`
// copies it into an extracted release tree (`git archive <tag>`) and runs it there with that tree's
// vitest config, so every node below is written by the tagged release's own store code
// (`setStoryboardPlan` → `ensureStoryboardShotTable`, `addNode`, `createGroup`, `createProductionShotTable`),
// and the payload is read back through the release's own `readCurrentWorkbenchProjectPayload`.
import fs from 'node:fs'
import { it } from 'vitest'
import { useWorkbenchStore } from './workbench/workbenchStore'
import { useGenerationCanvasStore } from './workbench/generationCanvas/store/generationCanvasStore'
import { readCurrentWorkbenchProjectPayload } from './workbench/project/workbenchProjectSession'
import { createProductionShotTable, deconstructionShotTableSchema } from '../electron/shared/canvas/shotTable'
import { abandonPendingCanvasWrite, whenCanvasWriteBoundarySettled } from './workbench/generationCanvas/events/canvasWriteBoundary'

it('writes a project payload with every shot-table source the release can produce', async () => {
  const output = process.env.NOMI_FIXTURE_OUTPUT
  if (!output) throw new Error('NOMI_FIXTURE_OUTPUT is required')
  abandonPendingCanvasWrite()
  const canvas = () => useGenerationCanvasStore.getState()
  useWorkbenchStore.setState({
    workbenchDocuments: [{ id: 'doc-rain', version: 1, title: 'Rain letter', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
    activeDocumentId: 'doc-rain', activeStoryboardId: null, storyboardDesignsByDocumentId: {}, storyboardRowFocus: null, workspaceMode: 'generation',
  })
  canvas().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })

  // 1) storyboard source: the release creates its table view on an explicit plan write.
  const design = useWorkbenchStore.getState().setStoryboardPlan({
    title: 'Rainy store',
    anchors: [{ id: 'anchor-lin', kind: 'character', name: 'Lin', description: 'young woman, short hair', carrier: 'visual' }],
    shots: [
      { shotId: 'shot-a', index: 1, shotKind: 'video', durationSec: 5, anchorIds: ['anchor-lin'], prompt: 'Wide shot, Lin by the store awning' },
      { shotId: 'shot-b', index: 2, shotKind: 'video', durationSec: 5, anchorIds: ['anchor-lin'], prompt: 'Close-up, Lin in profile' },
      { shotId: 'shot-c', index: 3, shotKind: 'image', durationSec: 3, anchorIds: [], prompt: 'Low angle, a pocket watch in a puddle' },
    ],
  })
  if (!design) throw new Error('release did not create a design')
  await whenCanvasWriteBoundarySettled()
  // Shots materialized onto the canvas the way the release binds them (designId x shotId).
  for (const [index, shotId] of ['shot-a', 'shot-b'].entries()) {
    canvas().addNode({
      kind: 'video', title: `Shot ${index + 1}`, categoryId: 'shots', prompt: `prompt ${shotId}`,
      position: { x: 400 * index, y: 600 },
      meta: { storyboardDesignId: design.id, shotId, creationDocumentId: 'doc-rain', modelKey: 'seedance-2', modelVendor: 'apimart' },
    })
  }

  // 2) production source: the Agent landing adds the same node shape (multiShotCanvasLanding).
  const runId = 'run-agent-storyboard'
  const operationId = `canvas-landing:${runId}`
  const productionIds = ['p1', 'p2'].map((shotId, index) => canvas().addNode({
    kind: 'image', title: `Agent shot ${index + 1}`, categoryId: 'shots', prompt: `agent prompt ${shotId}`,
    position: { x: 400 * index, y: 1200 },
    meta: { productionRunId: runId, productionShotId: shotId, materializationOperationId: operationId, clientId: shotId },
  })?.id).filter((id): id is string => Boolean(id))
  canvas().createGroup('shots', 'Storyboard group · Agent plan', { materializationOperationId: operationId, nodeIds: productionIds })
  canvas().addNode({ kind: 'shot_table', title: 'Agent plan', categoryId: 'shots', meta: { shotTable: createProductionShotTable(runId, operationId, '2026-10-01T00:00:00.000Z') } })

  // 3) deconstruction source (kept by the retirement).
  canvas().addNode({ kind: 'video', title: 'Reference clip', categoryId: 'shots', position: { x: 0, y: 1800 } })
  const sourceNodeId = canvas().nodes.find((node) => node.title === 'Reference clip')!.id
  canvas().addNode({ kind: 'shot_table', title: 'Reference breakdown', categoryId: 'shots', meta: { shotTable: deconstructionShotTableSchema.parse({
    schemaVersion: 1, view: { selectedRowIds: [], density: 'auto' }, revision: 0, updatedAt: '2026-10-01T00:00:00.000Z',
    source: { kind: 'deconstruction', sourceNodeId, title: 'Reference clip', status: 'ready' },
    columnSetId: 'facts', columns: [], rows: [],
  }) } })

  const payload = readCurrentWorkbenchProjectPayload()
  fs.writeFileSync(output, `${JSON.stringify({ payload }, null, 2)}\n`, 'utf8')
})
