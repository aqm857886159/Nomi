import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildCanvasWriteAdmissionForOperation } from '../../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import type { CanvasWriteInput } from '../../../../electron/shared/agentCapabilities/canvasWrite'
import { SurfacePortWireError } from '../../../../electron/shared/surfacePortBinding'
import { abandonPendingCanvasWrite } from '../events/canvasWriteBoundary'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { readGenerationCanvasSnapshot } from './generationCanvasTools'
import { resetClientIdRegistry } from './applyCanvasToolCall'
import type { StoryboardPlan } from './storyboardPlan'

const receiptHarness = vi.hoisted(() => ({
  metadata: [] as unknown[],
  prepares: [] as Array<{ proposalId: string; before: unknown }>,
  commits: [] as unknown[],
  aborts: [] as string[],
}))

vi.mock('./proposalUndo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proposalUndo')>()
  return {
    ...actual,
    createProposalReceiptCoordinator(metadata: unknown) {
      receiptHarness.metadata.push(metadata)
      return {
        async prepare(proposalId: string, before: unknown) {
          receiptHarness.prepares.push({ proposalId, before })
          return true
        },
        async commit(input: unknown) {
          receiptHarness.commits.push(input)
          return true
        },
        async abort(proposalId: string) {
          receiptHarness.aborts.push(proposalId)
        },
        async disposition() {
          return 'committed' as const
        },
      }
    },
  }
})

import {
  captureCanvasWriteRawEvidence,
  executeCanvasWriteTarget,
  type CanvasWriteTargetExecution,
} from './canvasWriteTarget'

const RECEIPT_ID = 'receipt-host-canvas'
const APPROVAL_ID = 'approval-host-canvas'
const ACTION_HASH = 'a'.repeat(64)

function buildRequest(input: CanvasWriteInput): CanvasWriteTargetExecution {
  const evidence = captureCanvasWriteRawEvidence(
    readGenerationCanvasSnapshot(),
    input.operation === 'set_node_prompt' ? input.nodeId : { operation: input.operation, input },
  )
  const admission = buildCanvasWriteAdmissionForOperation(evidence, input)
  return {
    input,
    ...admission,
    receiptProposalId: RECEIPT_ID,
    approvalId: APPROVAL_ID,
    actionHash: ACTION_HASH,
    signal: new AbortController().signal,
    assertCurrent: vi.fn(),
  }
}

beforeEach(() => {
  abandonPendingCanvasWrite()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
  resetClientIdRegistry()
  receiptHarness.metadata.length = 0
  receiptHarness.prepares.length = 0
  receiptHarness.commits.length = 0
  receiptHarness.aborts.length = 0
})

afterEach(() => {
  abandonPendingCanvasWrite()
})

describe('canvas.write real renderer execution', () => {
  it('creates nodes and their edge with exact committed identifiers', async () => {
    const input: CanvasWriteInput = {
      operation: 'create_canvas_nodes',
      summary: 'Create a linked pair',
      nodes: [
        { clientId: 'source', kind: 'text', title: 'Source', prompt: 'source context' },
        { clientId: 'target', kind: 'image', title: 'Target', prompt: 'target image' },
      ],
      edges: [{ sourceClientId: 'source', targetClientId: 'target', mode: 'reference' }],
    }

    const result = await executeCanvasWriteTarget(buildRequest(input), readGenerationCanvasSnapshot)
    const snapshot = readGenerationCanvasSnapshot()
    expect(result.operation).toBe('create_canvas_nodes')
    if (!('applied' in result) || result.operation !== 'create_canvas_nodes') return
    expect(result.proposalId).toBe(RECEIPT_ID)
    expect(result.affectedNodeIds).toEqual(snapshot.nodes.map((node) => node.id))
    expect(result.affectedNodeIds).toEqual([result.clientIdToNodeId.source, result.clientIdToNodeId.target])
    expect(result.affectedEdgeIds).toEqual(snapshot.edges.map((edge) => edge.id))
    expect(snapshot.edges).toEqual([
      expect.objectContaining({
        id: result.affectedEdgeIds[0],
        source: result.clientIdToNodeId.source,
        target: result.clientIdToNodeId.target,
      }),
    ])
    expect(result.connectedCount).toBe(1)
    expect(result.skippedEdges).toEqual([])
  })

  it('connects existing nodes and reports only the exact new edge and endpoints', async () => {
    const source = useGenerationCanvasStore.getState().addNode({ kind: 'text', title: 'Source', prompt: 'context' })
    const target = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Target', prompt: 'image' })
    const input: CanvasWriteInput = {
      operation: 'connect_canvas_edges',
      edges: [{ sourceClientId: source.id, targetClientId: target.id, mode: 'reference' }],
    }

    const result = await executeCanvasWriteTarget(buildRequest(input), readGenerationCanvasSnapshot)
    const edge = readGenerationCanvasSnapshot().edges[0]
    expect(result).toEqual({
      applied: true,
      proposalId: RECEIPT_ID,
      operation: 'connect_canvas_edges',
      affectedNodeIds: [source.id, target.id],
      affectedEdgeIds: [edge?.id],
      connectedCount: 1,
      skippedEdges: [],
      reconciliation: { ok: true, deviationCount: 0 },
    })
  })

  it('returns an honest zero-effect result when every requested edge is skipped', async () => {
    const source = useGenerationCanvasStore.getState().addNode({ kind: 'text', title: 'Source', prompt: 'context' })
    const input: CanvasWriteInput = {
      operation: 'connect_canvas_edges',
      edges: [{ sourceClientId: source.id, targetClientId: 'missing-target', mode: 'reference' }],
    }

    const result = await executeCanvasWriteTarget(buildRequest(input), readGenerationCanvasSnapshot)
    expect(result).toMatchObject({
      applied: true,
      proposalId: RECEIPT_ID,
      operation: 'connect_canvas_edges',
      affectedNodeIds: [],
      affectedEdgeIds: [],
      connectedCount: 0,
      skippedEdges: [{ source: source.id, target: 'missing-target', reason: 'dangling' }],
    })
    expect(readGenerationCanvasSnapshot().edges).toEqual([])
  })

  it('tidies one category and reports exactly that category node set', async () => {
    const shotA = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Shot A', prompt: 'a' })
    const shotB = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: 'Shot B', prompt: 'b' })
    const cast = useGenerationCanvasStore.getState().addNode({ kind: 'character', title: 'Cast', prompt: 'cast' })
    const input: CanvasWriteInput = { operation: 'tidy_canvas', categoryId: 'shots' }

    const result = await executeCanvasWriteTarget(buildRequest(input), readGenerationCanvasSnapshot)
    expect(result).toEqual({
      applied: true,
      proposalId: RECEIPT_ID,
      operation: 'tidy_canvas',
      affectedNodeIds: [shotA.id, shotB.id],
      categoryId: 'shots',
      nodeCount: 2,
      reconciliation: { ok: true, deviationCount: 0 },
    })
    expect('affectedNodeIds' in result ? result.affectedNodeIds : []).not.toContain(cast.id)
  })

  it('rejects a stale Canvas mutation before durable receipt preparation', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Shot', prompt: 'old' })
    const input: CanvasWriteInput = { operation: 'set_node_prompt', nodeId: node.id, prompt: 'approved prompt' }
    const request = buildRequest(input)
    useGenerationCanvasStore.getState().updateNodePrompt(node.id, 'user changed it first')

    await expect(executeCanvasWriteTarget(request, readGenerationCanvasSnapshot)).rejects.toMatchObject({
      code: 'capability_target_stale',
    } satisfies Partial<SurfacePortWireError>)
    expect(receiptHarness.prepares).toEqual([])
    expect(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)?.prompt).toBe(
      'user changed it first',
    )
  })

  it('rejects a target locked after approval without preparing or mutating', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Shot', prompt: 'old' })
    const input: CanvasWriteInput = { operation: 'set_node_prompt', nodeId: node.id, prompt: 'approved prompt' }
    const request = buildRequest(input)
    useGenerationCanvasStore.getState().setNodeLocked(node.id, true)

    await expect(executeCanvasWriteTarget(request, readGenerationCanvasSnapshot)).rejects.toMatchObject({
      code: 'capability_target_stale',
    } satisfies Partial<SurfacePortWireError>)
    expect(receiptHarness.prepares).toEqual([])
    expect(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)).toMatchObject({
      prompt: 'old',
      locked: true,
    })
  })

  it('correlates the Host proposal, approval, and action hash through receipt commit', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Shot', prompt: 'old' })
    const input: CanvasWriteInput = { operation: 'set_node_prompt', nodeId: node.id, prompt: 'new' }

    await executeCanvasWriteTarget(buildRequest(input), readGenerationCanvasSnapshot)

    expect(receiptHarness.metadata).toEqual([
      expect.objectContaining({ hostApprovalId: APPROVAL_ID, hostActionHash: ACTION_HASH }),
    ])
    expect(receiptHarness.prepares).toEqual([expect.objectContaining({ proposalId: RECEIPT_ID })])
    expect(receiptHarness.commits).toEqual([expect.objectContaining({ proposalId: RECEIPT_ID })])
    expect(receiptHarness.aborts).toEqual([])
  })

  it('executes the real user task through nomi_canvas_plan + patch_shots and commits changed rows', async () => {
    const plan: StoryboardPlan = {
      title: '雨夜追凶',
      anchors: [],
      shots: [
        { index: 1, durationSec: 5, anchorIds: [], prompt: '推镜' },
        { index: 2, durationSec: 8, anchorIds: [], prompt: '跟拍', params: { aspect_ratio: '16:9', quality: 'high' } },
        { index: 3, durationSec: 5, anchorIds: [], prompt: '远景' },
      ],
    }
    useWorkbenchStore.getState().hydrateWorkbenchDocuments(
      [{ id: 'storyboard-doc', version: 1, title: '雨夜追凶', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
      'storyboard-doc',
    )
    useWorkbenchStore.getState().hydrateStoryboardPlans({ 'storyboard-doc': { plan, committed: false } })

    const input: CanvasWriteInput = {
      operation: 'patch_shots',
      select: { kind: 'indexes', indexes: [2] },
      patch: { promptAppend: '雨天', aspectRatio: '9:16' },
    }
    const result = await executeCanvasWriteTarget(buildRequest(input), readGenerationCanvasSnapshot)
    const persisted = useWorkbenchStore.getState().storyboardPlans['storyboard-doc']?.plan.shots ?? []
    expect(result).toMatchObject({
      applied: true,
      operation: 'patch_shots',
      proposalId: RECEIPT_ID,
      changedShotIndexes: [2],
      changedFields: ['prompt', 'aspectRatio'],
    })
    expect(persisted[0]).toEqual(plan.shots[0])
    expect(persisted[1]).toMatchObject({
      prompt: '跟拍，雨天',
      durationSec: 8,
      anchorIds: [],
      params: { aspect_ratio: '9:16', quality: 'high' },
    })
    expect(persisted[2]).toEqual(plan.shots[2])
    expect(receiptHarness.prepares).toEqual([expect.objectContaining({ proposalId: RECEIPT_ID })])
    expect(receiptHarness.commits).toEqual([expect.objectContaining({ proposalId: RECEIPT_ID })])
    expect(receiptHarness.aborts).toEqual([])
  })
})
