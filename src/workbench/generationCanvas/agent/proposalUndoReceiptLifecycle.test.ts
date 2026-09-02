import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  projection: {
    binding: null as null | {
      projectId: string
      immutableProjectUuid: string
      projectGeneration: number
    },
    subscriptionId: null as string | null,
  },
  read: vi.fn(),
  write: vi.fn(),
  transition: vi.fn(),
  clear: vi.fn(),
  activeProposal: null as null | CommittedProposalRecord,
}))

vi.mock('../../ai/projectAgentClient', () => ({
  projectAgentClient: {
    readProposalReceipt: deps.read,
    writeProposalReceipt: deps.write,
    transitionProposalReceipt: deps.transition,
    clearProposalReceipt: deps.clear,
  },
}))
vi.mock('../../ai/projectAgentProjectionStore', () => ({
  projectAgentProjectionStore: { getState: () => deps.projection },
}))

import type { ProjectAgentProposalReceiptLifecycle } from '../../../../electron/shared/projectAgentProposalReceipt'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { abandonPendingCanvasWrite } from '../events/canvasWriteBoundary'
import {
  clearCommittedProposal,
  commitProposalReceipt,
  createProposalReceiptCoordinator,
  getCommittedProposal,
  hydrateCommittedProposalReceipt,
  prepareProposalReceipt,
  recoverPendingProposalReceipt,
  runProposalUndo,
  type CommittedProposalRecord,
} from './proposalUndo'

const bindingA = {
  projectId: 'project-a',
  immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
  projectGeneration: 1,
} as const
const bindingB = {
  projectId: 'project-b',
  immutableProjectUuid: '22222222-2222-4222-8222-222222222222',
  projectGeneration: 1,
} as const
const record: CommittedProposalRecord = {
  proposalId: 'proposal-a',
  summary: 'created node',
  stepLabels: ['created node'],
  categoryCounts: [{ categoryId: 'shots', label: 'Shots', count: 1 }],
  compensation: [{ kind: 'delete-nodes', nodeIds: ['node-a'] }],
  watchNodes: [{ nodeId: 'node-a', title: 'Node A', prompt: 'prompt' }],
  reconciliationOk: false,
  anchorMessageId: 'assistant-a',
  anchorTextOffset: 12,
}

function receipt(
  lifecycle: ProjectAgentProposalReceiptLifecycle,
  revision: number,
  proposal: CommittedProposalRecord = record,
  operationId = `${lifecycle}-${proposal.proposalId}`,
) {
  return { binding: bindingA, revision, lifecycle, proposalId: proposal.proposalId, operationId, proposal }
}

beforeEach(() => {
  abandonPendingCanvasWrite()
  clearCommittedProposal()
  deps.projection = { binding: bindingA, subscriptionId: 'subscription-a' }
  deps.read.mockReset().mockResolvedValue(null)
  deps.activeProposal = record
  deps.write.mockReset().mockImplementation(async (_subscriptionId, input) =>
    receipt(input.lifecycle, input.expectedRevision + 1, input.proposal, input.operationId),
  )
  deps.transition.mockReset().mockImplementation(async (_subscriptionId, input) =>
    receipt(input.lifecycle, input.expectedRevision + 1, deps.activeProposal ?? record, input.operationId),
  )
  deps.clear.mockReset()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
})

describe('committed proposal receipt renderer lifecycle', () => {
  it('persists an explicitly non-Canvas preparation with no restore snapshot', async () => {
    const coordinator = createProposalReceiptCoordinator({
      summary: 'export_timeline',
      stepLabels: ['export_timeline'],
      prepareCompensation: 'none',
    })

    await expect(coordinator.prepare('export-receipt-a', {
      nodes: [{ id: 'unrelated-node' }],
      edges: [{ id: 'unrelated-edge' }],
      groups: [{ id: 'unrelated-group' }],
    })).resolves.toBe(true)
    expect(deps.write).toHaveBeenCalledWith('subscription-a', expect.objectContaining({
      proposalId: 'export-receipt-a',
      lifecycle: 'preparing',
      proposal: expect.objectContaining({ compensation: [] }),
    }))
  })

  it('keeps preparing invisible and publishes Undo only after the committed receipt is acknowledged', async () => {
    await expect(prepareProposalReceipt(record)).resolves.toBe(true)
    expect(getCommittedProposal()).toBeNull()
    expect(deps.write).toHaveBeenNthCalledWith(1, 'subscription-a', expect.objectContaining({
      expectedRevision: 0,
      proposalId: record.proposalId,
      lifecycle: 'preparing',
    }))

    await expect(commitProposalReceipt(record)).resolves.toBe(true)
    expect(getCommittedProposal()).toEqual(record)
    expect(deps.write).toHaveBeenNthCalledWith(2, 'subscription-a', expect.objectContaining({
      expectedRevision: 1,
      proposalId: record.proposalId,
      lifecycle: 'committed',
    }))

    clearCommittedProposal()
    deps.read.mockResolvedValueOnce(null)
    await prepareProposalReceipt(record)
    deps.write.mockRejectedValueOnce(new Error('receipt persistence unavailable'))
    deps.read.mockResolvedValueOnce(receipt('preparing', 1))
    await expect(commitProposalReceipt(record)).rejects.toThrow('receipt persistence unavailable')
    expect(getCommittedProposal()).toBeNull()
  })

  it('adopts a matching committed readback when the durable write acknowledgement is lost', async () => {
    await prepareProposalReceipt(record)
    deps.write.mockRejectedValueOnce(new Error('response lost after durable commit'))
    deps.read.mockResolvedValueOnce(receipt('committed', 2, record, `proposal-commit:${record.proposalId}`))

    await expect(commitProposalReceipt(record)).resolves.toBe(true)
    expect(getCommittedProposal()).toEqual(record)
  })

  it('drops a late prepare response after project B supersedes project A', async () => {
    let finish!: (value: unknown) => void
    deps.write.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = prepareProposalReceipt(record)
    deps.projection = { binding: bindingB, subscriptionId: 'subscription-b' }
    finish(receipt('preparing', 1))

    await expect(pending).resolves.toBe(false)
    expect(getCommittedProposal()).toBeNull()
  })

  it('hydrates only exact-binding committed receipts into the Undo-visible slot', () => {
    expect(hydrateCommittedProposalReceipt({ ...receipt('committed', 2), binding: bindingB })).toBe(false)
    expect(getCommittedProposal()).toBeNull()
    expect(hydrateCommittedProposalReceipt(receipt('preparing', 1))).toBe(true)
    expect(getCommittedProposal()).toBeNull()
    expect(hydrateCommittedProposalReceipt(receipt('committed', 2))).toBe(true)
    expect(getCommittedProposal()).toEqual(record)
    expect(hydrateCommittedProposalReceipt(receipt('undone', 4))).toBe(true)
    expect(getCommittedProposal()).toBeNull()
  })

  it('durably enters undoing before compensation and hides only after durable completion', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Node A', prompt: 'prompt' })
    const applied = { ...record, compensation: [{ kind: 'delete-nodes' as const, nodeIds: [node.id] }] }
    deps.activeProposal = applied
    hydrateCommittedProposalReceipt(receipt('committed', 2, applied))

    await expect(runProposalUndo(applied)).resolves.toBeUndefined()
    expect(deps.transition.mock.calls[0]).toEqual(['subscription-a', expect.objectContaining({
      expectedRevision: 2,
      proposalId: applied.proposalId,
      lifecycle: 'undoing',
    })])
    expect(deps.transition.mock.calls[1]).toEqual(['subscription-a', expect.objectContaining({
      expectedRevision: 3,
      proposalId: applied.proposalId,
      lifecycle: 'undone',
    })])
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
    expect(getCommittedProposal()).toBeNull()

    const retryNode = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Node B', prompt: 'prompt' })
    const retry = { ...record, proposalId: 'proposal-b', compensation: [{ kind: 'delete-nodes' as const, nodeIds: [retryNode.id] }] }
    deps.activeProposal = retry
    hydrateCommittedProposalReceipt(receipt('committed', 5, retry))
    deps.transition.mockRejectedValueOnce(new Error('undo marker unavailable'))
    await expect(runProposalUndo(retry)).rejects.toThrow('undo marker unavailable')
    expect(useGenerationCanvasStore.getState().nodes.some((item) => item.id === retryNode.id)).toBe(true)
    expect(getCommittedProposal()).toEqual(retry)
  })

  it('blocks Canvas writes before the committed to undoing transition is acknowledged', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Node A', prompt: 'AI value' })
    const applied = {
      ...record,
      compensation: [{ kind: 'restore-prompt' as const, nodeId: node.id, prompt: 'before AI' }],
      watchNodes: [{ nodeId: node.id, title: 'Node A', prompt: 'AI value' }],
    }
    deps.activeProposal = applied
    hydrateCommittedProposalReceipt(receipt('committed', 2, applied))
    let finishUndoing!: (value: unknown) => void
    deps.transition.mockReturnValueOnce(new Promise((resolve) => { finishUndoing = resolve }))

    const undoing = runProposalUndo(applied)
    await vi.waitFor(() => expect(deps.transition).toHaveBeenCalledTimes(1))
    expect(() => useGenerationCanvasStore.getState().updateNodePrompt(node.id, 'user during IPC')).toThrow(
      'Canvas proposal receipt commit is in progress',
    )

    finishUndoing(receipt('undoing', 3, applied, `proposal-undo:${applied.proposalId}`))
    await expect(undoing).resolves.toBeUndefined()
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('before AI')
  })

  it('replays compensation idempotently after crashes before, during, and after its last step', async () => {
    const first = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'One', prompt: 'one' })
    const second = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Two', prompt: 'two' })
    const undoing = {
      ...record,
      compensation: [{ kind: 'delete-nodes' as const, nodeIds: [first.id, second.id] }],
    }
    deps.activeProposal = undoing
    // The first deletion represents a renderer crash in the middle of the
    // idempotent compensation plan.
    useGenerationCanvasStore.getState().deleteNode(first.id)
    hydrateCommittedProposalReceipt(receipt('undoing', 3, undoing))
    deps.transition.mockRejectedValueOnce(new Error('completion marker unavailable'))

    await expect(recoverPendingProposalReceipt()).rejects.toThrow('completion marker unavailable')
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
    expect(getCommittedProposal()).toEqual(undoing)
    expect(() =>
      useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Must wait', prompt: 'blocked' }),
    ).toThrow('Canvas proposal receipt commit is in progress')

    // Restart/reopen after the last compensation step replays no-ops and then
    // writes the missing durable completion marker exactly once.
    deps.transition.mockResolvedValueOnce(receipt('undone', 4, undoing, `recover-${undoing.proposalId}`))
    await expect(recoverPendingProposalReceipt()).resolves.toBe(true)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
    expect(deps.transition).toHaveBeenLastCalledWith('subscription-a', expect.objectContaining({
      expectedRevision: 3,
      proposalId: undoing.proposalId,
      lifecycle: 'undone',
    }))
    useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'After recovery', prompt: 'kept' })
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.title)).toEqual(['After recovery'])
  })

  it('recovers a preparing apply window and refuses to undo a superseded proposal', async () => {
    useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'Partially applied', prompt: 'partial' })
    const preparing = {
      ...record,
      compensation: [{ kind: 'restore-snapshot' as const, snapshot: { nodes: [], edges: [], groups: [] } }],
      watchNodes: [],
      reconciliationOk: true,
    }
    deps.activeProposal = preparing
    hydrateCommittedProposalReceipt(receipt('preparing', 1, preparing))
    await expect(recoverPendingProposalReceipt()).resolves.toBe(true)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)

    const newer = { ...record, proposalId: 'proposal-newer' }
    hydrateCommittedProposalReceipt(receipt('committed', 6, newer))
    await expect(runProposalUndo(record)).rejects.toThrow('proposal')
    expect(deps.transition).not.toHaveBeenCalledWith('subscription-a', expect.objectContaining({
      proposalId: record.proposalId,
      lifecycle: 'undoing',
    }))
  })
})
