import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const receiptDeps = vi.hoisted(() => ({
  read: vi.fn(),
  transition: vi.fn(),
  proposal: null as null | Record<string, unknown>,
  state: {
    binding: {
      projectId: 'proposal-undo-test',
      immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
      projectGeneration: 1,
    },
    subscriptionId: 'proposal-undo-subscription',
  },
}))

vi.mock('../../ai/projectAgentClient', () => ({
  projectAgentClient: {
    readProposalReceipt: receiptDeps.read,
    transitionProposalReceipt: receiptDeps.transition,
  },
}))
vi.mock('../../ai/projectAgentProjectionStore', () => ({
  projectAgentProjectionStore: { getState: () => receiptDeps.state },
}))
import { applyProposalBatch } from './proposalTxn'
import {
  detectLostUserEdits,
  hydrateCommittedProposalReceipt,
  parseCommittedProposalRecord,
  runProposalUndo,
  type CommittedProposalRecord,
} from './proposalUndo'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests, type CanvasShadowEvent } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'

function projection() {
  const state = useGenerationCanvasStore.getState()
  return JSON.parse(JSON.stringify({ nodes: state.nodes, edges: state.edges, groups: state.groups }))
}

let captured: CanvasShadowEvent[] = []

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
  captured = []
  setCanvasEventSinkForTests((events) => captured.push(...events))
  receiptDeps.read.mockReset().mockResolvedValue(null)
  receiptDeps.transition.mockReset().mockImplementation(async (_subscriptionId, input) => ({
    binding: receiptDeps.state.binding,
    revision: input.expectedRevision + 1,
    lifecycle: input.lifecycle,
    proposalId: input.proposalId,
    operationId: input.operationId,
    proposal: receiptDeps.proposal,
  }))
})

function hydrate(record: CommittedProposalRecord, revision = 2): void {
  receiptDeps.proposal = record as unknown as Record<string, unknown>
  hydrateCommittedProposalReceipt({
    binding: receiptDeps.state.binding,
    revision,
    lifecycle: 'committed',
    proposalId: record.proposalId,
    operationId: `commit-${record.proposalId}`,
    proposal: record,
  })
}

afterEach(() => {
  setCanvasEventSinkForTests(null)
})

async function commitCreateConnect(): Promise<CommittedProposalRecord> {
  const outcome = await applyProposalBatch([
    {
      toolCallId: 'tc-create',
      toolName: 'create_canvas_nodes',
      effectiveArgs: {
        nodes: [
          { clientId: 'c1', kind: 'image', title: '镜头 1', prompt: 'p1' },
          { clientId: 'c2', kind: 'video', title: '镜头 2', prompt: 'p2' },
        ],
      },
    },
    { toolCallId: 'tc-connect', toolName: 'connect_canvas_edges', effectiveArgs: { edges: [{ sourceClientId: 'c1', targetClientId: 'c2' }] } },
  ])
  if (outcome.status !== 'committed') throw new Error('expected committed')
  return {
    proposalId: outcome.proposalId,
    summary: 'test',
    stepLabels: ['创建 2 个节点', '连接 1 条边'],
    compensation: outcome.compensation,
    watchNodes: outcome.watchNodes,
    reconciliationOk: outcome.reconciliation.ok,
  }
}

describe('runProposalUndo — S6-5 整笔撤销(补偿事务,非前缀重放)', () => {
  it('回退本笔提议,期间用户自己的工作保留', async () => {
    const record = await commitCreateConnect()
    // 用户在 commit 之后建了自己的节点——整笔撤销不能伤它(这是与 Cmd+Z 的本质区别)。
    const mine = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '我自己的', prompt: 'mine' })
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(3)

    hydrate(record)
    await runProposalUndo(record)

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.map((node) => node.id)).toEqual([mine.id])
    expect(state.edges).toHaveLength(0)
    const reverted = captured.find((event) => event.type === 'agent.txn.reverted')
    expect(reverted!.payload.proposalId).toBe(record.proposalId)
    expect(reverted!.proposalId).toBe(record.proposalId)
  })

  it('撤销「撤销」= 一次 Cmd+Z,AI 节点回来(补偿进栈一个 barrier)', async () => {
    const record = await commitCreateConnect()
    hydrate(record)
    await runProposalUndo(record)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(1)
  })

  it('用户已删掉部分 AI 节点 → 撤销容忍 no-op 不失败', async () => {
    const record = await commitCreateConnect()
    const aiNode = useGenerationCanvasStore.getState().nodes[0]
    useGenerationCanvasStore.getState().deleteNode(aiNode.id)
    hydrate(record)
    await runProposalUndo(record)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('delete 提议的整笔撤销 = 原 id 复活节点与边', async () => {
    // 先有一张用户图(创建+连接),AI 提议删掉其中一个节点。
    const a = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'A', prompt: 'a' })
    const b = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: 'B', prompt: 'b' })
    useGenerationCanvasStore.getState().connectNodes(a.id, b.id)
    const before = projection()

    const outcome = await applyProposalBatch([
      { toolCallId: 'tc-del', toolName: 'delete_canvas_nodes', effectiveArgs: { nodeIds: [a.id] } },
    ])
    expect(outcome.status).toBe('committed')
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
    if (outcome.status !== 'committed') return

    const record = {
      proposalId: outcome.proposalId,
      summary: 'del',
      stepLabels: ['删除 1 个节点'],
      compensation: outcome.compensation,
      watchNodes: outcome.watchNodes,
      reconciliationOk: true,
    }
    hydrate(record)
    await runProposalUndo(record)
    // 复活节点按原 id/内容回归;数组顺序非语义(绝对定位渲染),排序后比对。
    const sortById = (snapshot: { nodes: { id: string }[]; edges: { id: string }[]; groups: unknown[] }) => ({
      ...snapshot,
      nodes: [...snapshot.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...snapshot.edges].sort((a, b) => a.id.localeCompare(b.id)),
    })
    expect(sortById(projection())).toEqual(sortById(before))
  })

  it('set_node_prompt 提议的整笔撤销 = 恢复原提示词', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'A', prompt: '原词' })
    const outcome = await applyProposalBatch([
      { toolCallId: 'tc-sp', toolName: 'set_node_prompt', effectiveArgs: { nodeId: node.id, prompt: 'AI 改的' } },
    ])
    expect(outcome.status).toBe('committed')
    if (outcome.status !== 'committed') return
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('AI 改的')
    const record = {
      proposalId: outcome.proposalId,
      summary: 'sp',
      stepLabels: ['改写提示词'],
      compensation: outcome.compensation,
      watchNodes: outcome.watchNodes,
      reconciliationOk: true,
    }
    hydrate(record)
    await runProposalUndo(record)
    expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('原词')
  })
})

describe('detectLostUserEdits — 选择性撤销列明(N13)', () => {
  it('用户 commit 后改过提议节点 → 点名列出;没改 → 空', async () => {
    const record = await commitCreateConnect()
    expect(detectLostUserEdits(record)).toEqual([])
    const aiNode = useGenerationCanvasStore.getState().nodes[0]
    useGenerationCanvasStore.getState().updateNodePrompt(aiNode.id, '用户改过的')
    const lost = detectLostUserEdits(record)
    expect(lost).toHaveLength(1)
    expect(lost[0]).toContain(aiNode.title)
  })
})

describe('committed proposal persistence', () => {
  it('restores the immutable timeline text anchor used by the undo-visible card', () => {
    expect(parseCommittedProposalRecord({
      proposalId: 'proposal-a',
      summary: 'updated node',
      stepLabels: ['updated node'],
      compensation: [],
      watchNodes: [],
      reconciliationOk: true,
      anchorMessageId: 'assistant-a',
      anchorTextOffset: 12,
    })).toMatchObject({ anchorMessageId: 'assistant-a', anchorTextOffset: 12 })
  })
})
