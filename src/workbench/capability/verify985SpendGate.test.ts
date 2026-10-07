// V-3b 独立验收：花钱闸走真的落地（materializeShots 盖章）+ 真的渲染端处理函数（director.preview-blocks）+ 真的 canRunGenerationNode。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import { materializeShots } from './multiShotCanvasLanding'
import { directorPreviewBlocksOp } from './directorPreviewBlocksOp'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import { canRunGenerationNode } from '../generationCanvas/runner/generationRunController'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

const RUN = 'run-verify-1'
const shots = ['shot-1', 'shot-2'].map((shotId, i) => ({ shotId, kind: 'video' as const, prompt: `p${i}`, candidate: { candidateId: `c${i}`, revision: 1 } }))

function addDirector(id: string, preview: Record<string, unknown>) {
  const node = { id, kind: 'director', title: '', position: { x: 0, y: 0 }, meta: { directorPreview: { revision: 'dplan-1', updatedAt: 1, ...preview } } } as unknown as GenerationCanvasNode
  useGenerationCanvasStore.getState().restoreSnapshot({ ...useGenerationCanvasStore.getState(), nodes: [...useGenerationCanvasStore.getState().nodes, node], edges: [], groups: [] } as never)
}

describe('V-3b spend gate on the real Agent landing stamps', () => {
  let nodeIds: Record<string, string>
  let project: ProjectSessionTestHarness
  afterEach(() => project.dispose())
  beforeEach(async () => {
    project = createProjectSessionTestHarness(); await project.open('project-a')
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    const landed = await materializeShots({ materializationOperationId: `canvas-landing:${RUN}`, runId: RUN, shots })
    nodeIds = Object.fromEntries(landed.bindings.map((b) => [b.shotId, b.nodeId]))
  })

  it('landing really stamps productionRunId=operationId and the canvas-landing: idempotency stamp (the old wrong key)', () => {
    const n = useGenerationCanvasStore.getState().nodes.find((x) => x.id === nodeIds['shot-1'])!
    expect(n.meta).toMatchObject({ productionRunId: RUN, productionShotId: 'shot-1', materializationOperationId: `canvas-landing:${RUN}` })
  })

  it('rendering -> blocked, with a reason, only for the shot with the preview', () => {
    addDirector('d1', { status: 'rendering', targetNodeId: nodeIds['shot-1'] })
    const { blocks } = directorPreviewBlocksOp({ operationId: RUN, candidateReferences: { 'shot-1': [], 'shot-2': [] } })
    expect(blocks).toEqual([{ nodeId: nodeIds['shot-1'], shotId: 'shot-1', reason: 'rendering' }])
    const node = useGenerationCanvasStore.getState().nodes.find((x) => x.id === nodeIds['shot-1'])!
    expect(canRunGenerationNode(node, { nodes: useGenerationCanvasStore.getState().nodes, edges: [] })).toBe(false)
  })

  it('failed / too_long -> blocked', () => {
    addDirector('d1', { status: 'failed', reason: 'too_long', targetNodeId: nodeIds['shot-1'] })
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: {} }).blocks).toEqual([{ nodeId: nodeIds['shot-1'], shotId: 'shot-1', reason: 'failed', failure: 'too_long' }])
  })

  it('ready but the draft candidate lacks it -> not_referenced with the asset id; carrying it -> clear; omitted candidateReferences -> not asked', () => {
    addDirector('d1', { status: 'ready', attach: 'video_ref', assetId: 'asset-pre', targetNodeId: nodeIds['shot-1'] })
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: { 'shot-1': ['other'], 'shot-2': [] } }).blocks)
      .toEqual([{ nodeId: nodeIds['shot-1'], shotId: 'shot-1', reason: 'not_referenced', previewAssetId: 'asset-pre' }])
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: { 'shot-1': ['asset-pre'], 'shot-2': [] } }).blocks).toEqual([])
  })

  it('shotIds scope: a blocked shot outside the generate scope does not block', () => {
    addDirector('d1', { status: 'rendering', targetNodeId: nodeIds['shot-1'] })
    expect(directorPreviewBlocksOp({ operationId: RUN, shotIds: ['shot-2'], candidateReferences: {} }).blocks).toEqual([])
  })

  it('shots without a preview are unaffected; unknown operation id blocks nothing', () => {
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: { 'shot-1': [], 'shot-2': [] } }).blocks).toEqual([])
    addDirector('d1', { status: 'rendering', targetNodeId: nodeIds['shot-1'] })
    expect(directorPreviewBlocksOp({ operationId: 'canvas-landing:' + RUN, candidateReferences: {} }).blocks).toEqual([])
  })

  it('newest preview wins: a re-render after ready blocks again', () => {
    addDirector('d1', { status: 'ready', attach: 'video_ref', assetId: 'a1', targetNodeId: nodeIds['shot-1'], updatedAt: 1 })
    addDirector('d2', { status: 'rendering', targetNodeId: nodeIds['shot-1'], updatedAt: 2 })
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: { 'shot-1': ['a1'] } }).blocks.map((b) => b.reason)).toEqual(['rendering'])
  })
})

describe('V-3b single-shot draft (no shot id): the not_referenced check still applies', () => {
  it('ready preview not carried by the single-shot candidate -> blocked; carried -> clear', async () => {
    const project = createProjectSessionTestHarness(); await project.open('project-a')
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    // 单镜草稿落地的节点只有 runId 章、没有 shotId。
    const nodeId = 'single-node'
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ id: nodeId, kind: 'video', title: '', position: { x: 0, y: 0 }, meta: { productionRunId: RUN } } as unknown as GenerationCanvasNode], edges: [], groups: [] } as never)
    addDirector('d1', { status: 'ready', attach: 'video_ref', assetId: 'asset-pre', targetNodeId: nodeId })
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: { '': ['other'] } }).blocks.map((b) => b.reason)).toEqual(['not_referenced'])
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: { '': ['asset-pre'] } }).blocks).toEqual([])
    project.dispose()
  })
})
