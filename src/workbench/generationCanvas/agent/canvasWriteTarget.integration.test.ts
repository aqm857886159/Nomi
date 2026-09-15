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
  onPrepare: undefined as (() => void) | undefined,
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
          receiptHarness.onPrepare?.()
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
  receiptHarness.onPrepare = undefined
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
    useWorkbenchStore.getState().hydrateStoryboardDesigns({ 'storyboard-doc': [{ id: 'test-storyboard-doc', documentId: 'storyboard-doc', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })

    const input: CanvasWriteInput = {
      operation: 'patch_shots',
      select: { kind: 'indexes', indexes: [2] },
      patch: { promptAppend: '雨天', aspectRatio: '9:16' },
    }
    const result = await executeCanvasWriteTarget(buildRequest(input), readGenerationCanvasSnapshot)
    const persisted = useWorkbenchStore.getState().storyboardDesignsByDocumentId['storyboard-doc']?.[0]?.plan.shots ?? []
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

describe('storyboard target identity across the shared proposal boundary', () => {
  const plan: StoryboardPlan = { title: 'Same story', anchors: [], shots: [
    { index: 1, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'Opening' },
    { index: 2, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'Closing' },
  ] }
  beforeEach(() => {
    useWorkbenchStore.getState().hydrateWorkbenchDocuments([
      { id: 'identity-doc', version: 1, title: 'Story', contentJson: { type: 'doc', content: [] }, updatedAt: 1 },
    ], 'identity-doc')
    useWorkbenchStore.getState().hydrateStoryboardDesigns({ 'identity-doc': [
      { id: 'identity-board', documentId: 'identity-doc', title: plan.title, plan, committed: false,
        status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 },
    ] })
    useWorkbenchStore.setState({ activeStoryboardId: 'identity-board' })
  })

  it('replaces the selected plan and patches that same plan without making duplicate designs', async () => {
    const replacement: Extract<CanvasWriteInput, { operation: 'propose_storyboard_plan' }> = { operation: 'propose_storyboard_plan', title: plan.title,
      anchors: [{ id: 'hero', kind: 'character', name: 'Hero', description: 'Blue coat', carrier: 'text' }],
      shots: plan.shots.map(({ index, shotKind, durationSec, anchorIds, prompt }) => ({ index, shotKind, durationSec, anchorIds: ['hero'], prompt })),
    }
    await executeCanvasWriteTarget(buildRequest(replacement), readGenerationCanvasSnapshot)
    const patch: CanvasWriteInput = { operation: 'patch_shots', select: { kind: 'indexes', indexes: [2] }, patch: { prompt: 'Night closing' } }
    await executeCanvasWriteTarget(buildRequest(patch), readGenerationCanvasSnapshot)
    const designs = useWorkbenchStore.getState().storyboardDesignsByDocumentId['identity-doc']
    expect(designs).toHaveLength(1)
    expect(designs[0]).toMatchObject({ id: 'identity-board', plan: { anchors: replacement.anchors,
      shots: [{ prompt: 'Opening', anchorIds: ['hero'] }, { prompt: 'Night closing', anchorIds: ['hero'] }] } })
  })

  it.each(['selection', 'content'] as const)('rejects an approval when storyboard %s changes but the canvas stays empty', async change => {
    const input: CanvasWriteInput = { operation: 'patch_shots', select: { kind: 'all' }, patch: { promptAppend: 'Rain' } }
    const request = buildRequest(input)
    if (change === 'selection') useWorkbenchStore.getState().addStoryboardDesign('identity-doc', { ...plan, title: 'Other' })
    else useWorkbenchStore.getState().setStoryboardPlan({ ...plan, title: 'Edited while awaiting approval' }, 'identity-doc', 'identity-board')
    const before = structuredClone(useWorkbenchStore.getState().storyboardDesignsByDocumentId)
    await expect(executeCanvasWriteTarget(request, readGenerationCanvasSnapshot)).rejects.toMatchObject({ code: 'capability_target_stale' })
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId).toEqual(before)
    expect(receiptHarness.commits).toEqual([])
  })
})


describe('storyboard receipt preparation race', () => {
  it('does not apply an approved replacement after selection changes while preparing its receipt', async () => {
    const plan: StoryboardPlan = { title: 'Before', anchors: [], shots: [
      { index: 1, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'Original' },
    ] }
    useWorkbenchStore.getState().hydrateWorkbenchDocuments([
      { id: 'race-doc', version: 1, title: 'Race', contentJson: { type: 'doc', content: [] }, updatedAt: 1 },
    ], 'race-doc')
    useWorkbenchStore.getState().hydrateStoryboardDesigns({})
    useWorkbenchStore.getState().setStoryboardPlan(plan, 'race-doc')
    const originalId = useWorkbenchStore.getState().activeStoryboardId
    // Creating a design now projects a canvas table. Seed both before the
    // receipt owns the write boundary; the race under test is selection only.
    useWorkbenchStore.getState().addStoryboardDesign('race-doc', { ...plan, title: 'Other' })
    const otherId = useWorkbenchStore.getState().activeStoryboardId
    useWorkbenchStore.getState().setActiveStoryboardId(originalId, 'race-doc')
    const request = buildRequest({ operation: 'propose_storyboard_plan', title: 'Replacement', anchors: [], shots: plan.shots.map(({ index, shotKind, durationSec, anchorIds, prompt }) => ({ index, shotKind, durationSec, anchorIds, prompt })) })
    receiptHarness.onPrepare = () => { useWorkbenchStore.getState().setActiveStoryboardId(otherId, 'race-doc') }
    await expect(executeCanvasWriteTarget(request, readGenerationCanvasSnapshot)).rejects.toMatchObject({ code: 'capability_target_stale' })
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId['race-doc'].map(d => d.plan.shots[0].prompt)).toEqual(['Original', 'Original'])
    expect(receiptHarness.commits).toEqual([])
    expect(receiptHarness.aborts).toEqual([RECEIPT_ID])
  })
  it('does not apply an approved replacement after a design is created while preparing its receipt', async () => {
    const plan: StoryboardPlan = { title: 'Before', anchors: [], shots: [
      { index: 1, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'Original' },
    ] }
    useWorkbenchStore.getState().hydrateWorkbenchDocuments([
      { id: 'race-doc', version: 1, title: 'Race', contentJson: { type: 'doc', content: [] }, updatedAt: 1 },
    ], 'race-doc')
    useWorkbenchStore.getState().hydrateStoryboardDesigns({})
    useWorkbenchStore.getState().setStoryboardPlan(plan, 'race-doc')
    const request = buildRequest({ operation: 'propose_storyboard_plan', title: 'Replacement', anchors: [], shots: plan.shots.map(({ index, shotKind, durationSec, anchorIds, prompt }) => ({ index, shotKind, durationSec, anchorIds, prompt })) })
    receiptHarness.onPrepare = () => { useWorkbenchStore.getState().addStoryboardDesign('race-doc', { ...plan, title: 'Other' }) }
    await expect(executeCanvasWriteTarget(request, readGenerationCanvasSnapshot)).rejects.toMatchObject({ code: 'capability_target_stale' })
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId['race-doc'].map(d => d.plan.shots[0].prompt)).toEqual(['Original', 'Original'])
    expect(receiptHarness.commits).toEqual([])
    expect(receiptHarness.aborts).toEqual([RECEIPT_ID])
  })
})
