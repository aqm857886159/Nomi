// 画布写边界：每一扇「整图 / 整节点写回」的门都不许盖掉事实层（花了钱的结局、运行态、跟主图走的媒体尺寸）。
// 方向检查 docs/plan/2026-10-07-canvas-landing-direction-check.md §3 预测 ②（V-1072 那扇门）与特征测试清单第 3 条：
// - 提案的 restore-snapshot 补偿：提案之后落在**提案没碰过的节点**上的结果，撤销 / 恢复时不许被整图放回盖掉；
// - restoreGraph 放回（提案 restore-graph、分镜删行撤销）：节点不在期间到达的结局，放回时要叠上；
// - restore-node-fields 整节点放回：提案之后落地的结果和它的媒体尺寸不许被放回的旧 meta 盖掉，
//   事实层的后续变化也不再让「撤销这批」拒绝（冲突检查只管编辑层）。
// 断言的都是用户看得见的东西：主图、版本列表、状态、节点在不在、提示词。
// 钉靶子那一提交（83282a0e5）里整份是 `it.fails`，在 main 上 7 条全红；统一提交口那一提交改回 `it`。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../project/projectCanvasReadSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../project/projectCanvasReadSurface')>()),
  isProjectBindingOpen: () => true,
}))

import { useGenerationCanvasStore } from './generationCanvasStore'
import { deliverRunOutcome, type RunProjectTarget } from '../runner/runProjectDelivery'
import { laneClient } from '../../ai/lane/laneClient'
import { abandonPendingCanvasWrite } from '../events/canvasWriteBoundary'
import { withCanvasGestureContext } from '../events/canvasGestureContext'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { pushUndoSnapshot } from '../events/canvasUndoJournal'
import {
  clearCommittedProposal,
  hydrateCommittedProposalReceipt,
  recoverPendingProposalReceipt,
  runProposalUndo,
  runProposalUndoByChangeId,
  setCommittedProposal,
  wholeNodeRestoreConflict,
  type CommittedProposalRecord,
} from '../agent/proposalUndo'
import { makeChangeId } from '../../../../electron/shared/agentCapabilities/changeId'
import { deleteStoryboardRows, restoreStoryboardDeletion } from '../../creation/storyboard/storyboardDeleteUndo'
import type { StoryboardPlan } from '../agent/storyboardPlan'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

const TARGET = { projectId: 'p-whole', immutableProjectUuid: 'u-whole', projectGeneration: 1 } as RunProjectTarget
const LANDED: GenerationNodeResult = { id: 'r-landed', type: 'image', url: 'nomi-local://landed.png', createdAt: 2 }
const store = () => useGenerationCanvasStore.getState()
const node = (id: string) => store().nodes.find((candidate) => candidate.id === id)
const snapshotOf = () => JSON.parse(JSON.stringify(store().readDocumentSnapshot())) as { nodes: GenerationCanvasNode[]; edges: unknown[]; groups: unknown[] }

function imageNode(id: string, x: number, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position: { x, y: 40 }, prompt: `${id} prompt`, categoryId: 'shots', ...extra }
}

async function startRun(nodeId: string, runId: string): Promise<void> {
  await deliverRunOutcome(TARGET, nodeId, { kind: 'run-started', run: { id: runId, status: 'running', startedAt: 10, updatedAt: 10 } })
}

async function land(nodeId: string, mediaDimensions?: { width: number; height: number }): Promise<void> {
  await deliverRunOutcome(TARGET, nodeId, { kind: 'result', result: LANDED, ...(mediaDimensions ? { mediaDimensions } : {}) })
}

function expectLanded(nodeId: string): void {
  const landed = node(nodeId)
  expect(landed, `${nodeId} is on the canvas`).toBeDefined()
  expect(landed?.result?.id).toBe('r-landed')
  expect(landed?.history?.map((entry) => entry.id)).toContain('r-landed')
  expect(landed?.status).toBe('success')
}

const BINDING = { projectId: 'project-a', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 } as const
const receipts = vi.hoisted(() => ({ transition: vi.fn() }))

beforeEach(async () => {
  abandonPendingCanvasWrite()
  clearCommittedProposal()
  receipts.transition.mockReset()
  laneClient.connect({
    onProjection: () => () => undefined,
    send: async (command) => {
      if (command.kind === 'workspace-open') return { ok: true, workspaceId: 'subscription-a' }
      if (command.kind === 'receipt-read') return { ok: true, receipt: null }
      if (command.kind === 'receipt-transition') return { ok: true, receipt: await receipts.transition(command.workspaceId, command.input) }
      throw new Error(`Unexpected lane command: ${command.kind}`)
    },
  })
  await laneClient.open(BINDING)
  store().restoreSnapshot({ nodes: [imageNode('kept', 100), imageNode('other', 600)], edges: [], groups: [], selectedNodeIds: [] })
})

afterEach(() => { laneClient.connect(undefined) })

/** 一笔提议在 prepare 时只留下「提议之前的整张图」作补偿（canvasWriteTarget 默认 canvas_snapshot），随后建了节点 A。 */
function proposalWithBeforeImage(proposalId: string): CommittedProposalRecord {
  const before = snapshotOf()
  withCanvasGestureContext({ source: 'agent', txnId: `txn_${proposalId}`, proposalId }, () => {
    store().addNode({ kind: 'image', title: 'agent-created', prompt: 'agent prompt' })
  })
  return {
    proposalId,
    hostApprovalId: `approval-${proposalId}`,
    hostActionHash: 'a'.repeat(64),
    summary: 'agent created a node',
    stepLabels: ['create node'],
    compensation: [{ kind: 'restore-snapshot', snapshot: { nodes: before.nodes, edges: before.edges, groups: before.groups } }],
    watchNodes: [],
    reconciliationOk: true,
  }
}

describe('prediction ②: a before-image compensation never takes back results landed on nodes the proposal did not touch', () => {
  it('Agent undo by change id keeps the later result on an untouched node and still removes the proposal node', async () => {
    await startRun('kept', 'run-kept')
    const record = proposalWithBeforeImage('prop-snap-a')
    await land('kept')
    setCommittedProposal(record)

    runProposalUndoByChangeId(makeChangeId('canvas', record.proposalId))

    expectLanded('kept')
    expect(store().nodes.some((candidate) => candidate.title === 'agent-created')).toBe(false)
    expect(node('other')).toBeDefined()
  })

  it('reopen recovery of an interrupted apply keeps the result that landed meanwhile', async () => {
    await startRun('kept', 'run-kept')
    const record = proposalWithBeforeImage('prop-snap-b')
    await land('kept')
    receipts.transition.mockImplementation(async (_subscription, input) => ({
      binding: BINDING, revision: input.expectedRevision + 1, lifecycle: input.lifecycle, proposalId: record.proposalId, operationId: input.operationId, proposal: record,
    }))
    expect(hydrateCommittedProposalReceipt({ binding: BINDING, revision: 1, lifecycle: 'preparing', proposalId: record.proposalId, operationId: 'prepare', proposal: record })).toBe(true)

    await expect(recoverPendingProposalReceipt()).resolves.toBe(true)

    expectLanded('kept')
    expect(store().nodes.some((candidate) => candidate.title === 'agent-created')).toBe(false)
  })

  it('a node the proposal deleted comes back, carrying what landed on it while it was gone', async () => {
    await startRun('kept', 'run-kept')
    const before = snapshotOf()
    withCanvasGestureContext({ source: 'agent', txnId: 'txn_prop-snap-c', proposalId: 'prop-snap-c' }, () => store().deleteNode('kept'))
    await land('kept')
    setCommittedProposal({
      proposalId: 'prop-snap-c', summary: 'deleted', stepLabels: ['delete'], watchNodes: [], reconciliationOk: true,
      compensation: [{ kind: 'restore-snapshot', snapshot: { nodes: before.nodes, edges: before.edges, groups: before.groups } }],
    })

    runProposalUndoByChangeId(makeChangeId('canvas', 'prop-snap-c'))

    expectLanded('kept')
  })

  it('the before-image still takes back every edit the proposal made: created node, connected edge, rewritten prompt and meta', async () => {
    store().connectNodes('kept', 'other')
    const before = snapshotOf()
    withCanvasGestureContext({ source: 'agent', txnId: 'txn_prop-snap-d', proposalId: 'prop-snap-d' }, () => {
      const created = store().addNode({ kind: 'image', title: 'agent-created', prompt: 'agent prompt' })
      store().connectNodes('other', created.id)
      store().disconnectEdge(store().edges.find((edge) => edge.source === 'kept')!.id)
      store().connectNodes('other', 'kept')
      store().updateNode('kept', { prompt: 'agent rewrote', meta: { directorPlan: 'agent plan' } })
    })
    await land('other')
    setCommittedProposal({
      proposalId: 'prop-snap-d', summary: 'mixed', stepLabels: ['mixed'], watchNodes: [], reconciliationOk: true,
      compensation: [{ kind: 'restore-snapshot', snapshot: { nodes: before.nodes, edges: before.edges, groups: before.groups } }],
    })

    runProposalUndoByChangeId(makeChangeId('canvas', 'prop-snap-d'))

    expect(store().nodes.map((candidate) => candidate.id).sort()).toEqual(['kept', 'other'])
    expect(store().edges.map((edge) => `${edge.source}→${edge.target}`)).toEqual(['kept→other'])
    expect(node('kept')?.prompt).toBe('kept prompt')
    expect(node('kept')?.meta?.directorPlan).toBeUndefined()
    expectLanded('other')
  })
})

describe('putting deleted nodes back lays the outcomes that arrived meanwhile on them', () => {
  it('Agent "undo this batch" of a deletion (restore-graph) brings the node back landed, not spinning', async () => {
    await startRun('kept', 'run-kept')
    const deleted = snapshotOf().nodes.filter((candidate) => candidate.id === 'kept')
    withCanvasGestureContext({ source: 'agent', txnId: 'txn_prop-graph', proposalId: 'prop-graph' }, () => {
      store().deleteNode('kept')
      emitCanvasGesture([{ type: 'agent.txn.committed', payload: { proposalId: 'prop-graph', changeId: makeChangeId('canvas', 'prop-graph'), objectIds: ['kept'] } }])
    })
    await land('kept')
    setCommittedProposal({
      proposalId: 'prop-graph', summary: 'deleted', stepLabels: ['delete'], watchNodes: [], reconciliationOk: true,
      compensation: [{ kind: 'restore-graph', nodes: deleted, edges: [] }],
    })

    runProposalUndoByChangeId(makeChangeId('canvas', 'prop-graph'))

    expectLanded('kept')
    expect(node('kept')?.runs?.[0]).toMatchObject({ id: 'run-kept', status: 'success' })
  })

  it('undoing a storyboard row deletion brings its shot node back landed', async () => {
    const plan: StoryboardPlan = { title: 'Plan', anchors: [], shots: [1, 2].map((index) => ({ index, shotId: `s${index}`, prompt: `Prompt ${index}`, durationSec: 3, anchorIds: [] })) }
    await startRun('kept', 'run-kept')
    const { plan: after, undo } = deleteStoryboardRows(plan, [plan.shots[0]], ['kept'], store())
    expect(node('kept')).toBeUndefined()
    await land('kept')

    restoreStoryboardDeletion(after, undo, store())

    expectLanded('kept')
  })

  it('a failure that arrived while the node was gone is what the node shows once put back', async () => {
    await startRun('kept', 'run-kept')
    const deleted = snapshotOf().nodes.filter((candidate) => candidate.id === 'kept')
    store().deleteNode('kept')
    await deliverRunOutcome(TARGET, 'kept', { kind: 'status', status: 'error', error: 'upstream refused' })

    store().restoreGraph(deleted, [])

    expect(node('kept')?.status).toBe('error')
    expect(node('kept')?.runs?.[0]).toMatchObject({ id: 'run-kept', status: 'error' })
  })
})

describe('putting a node\'s fields back (restore-node-fields) only reverts edits', () => {
  function proposalThatRewroteFields(proposalId: string): CommittedProposalRecord {
    const before = node('kept')!
    withCanvasGestureContext({ source: 'agent', txnId: `txn_${proposalId}`, proposalId }, () => {
      pushUndoSnapshot()
      store().updateNode('kept', { meta: { ...(before.meta ?? {}), directorPlan: 'agent plan' }, prompt: 'agent prompt' })
      emitCanvasGesture([{ type: 'agent.txn.committed', payload: { proposalId, changeId: makeChangeId('canvas', proposalId), objectIds: ['kept'] } }])
    })
    return {
      proposalId, summary: 'rewrote', stepLabels: ['rewrite'], watchNodes: [], reconciliationOk: true,
      compensation: [{ kind: 'restore-node-fields', nodeId: 'kept', meta: JSON.parse(JSON.stringify(before.meta ?? {})), prompt: before.prompt ?? '' }],
    }
  }

  it('"undo this batch": a result that landed after the proposal stays, with its media size, while meta and prompt go back', async () => {
    const record = proposalThatRewroteFields('prop-fields')
    await startRun('kept', 'run-kept')
    await land('kept', { width: 1920, height: 1080 })
    // 事实层的后续落地不再让整节点放回被拒：放回经统一提交口，事实取活的。
    expect(wholeNodeRestoreConflict(record)).toBeNull()
    receipts.transition.mockImplementation(async (_subscription, input) => ({
      binding: BINDING, revision: input.expectedRevision + 1, lifecycle: input.lifecycle, proposalId: record.proposalId, operationId: input.operationId, proposal: record,
    }))
    expect(hydrateCommittedProposalReceipt({ binding: BINDING, revision: 2, lifecycle: 'committed', proposalId: record.proposalId, operationId: 'commit', proposal: record })).toBe(true)

    await runProposalUndo(record)

    expectLanded('kept')
    expect(node('kept')?.prompt).toBe('kept prompt')
    expect(node('kept')?.meta?.directorPlan).toBeUndefined()
    expect(node('kept')?.meta).toMatchObject({ imageWidth: 1920, imageHeight: 1080 })
  })

  it('a later edit-layer change on the same node still refuses the whole-node put-back (unchanged guard)', async () => {
    const record = proposalThatRewroteFields('prop-fields-edited')
    store().updateNode('kept', { title: 'user retitled' })
    expect(wholeNodeRestoreConflict(record)).toMatch(/撤销会把那些改动一起抹掉/)
  })
})
