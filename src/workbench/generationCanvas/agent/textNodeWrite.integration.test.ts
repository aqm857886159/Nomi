import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { projectCanvasRead } from '../../../../electron/shared/agentCapabilities/canvasRead'
import { formatCanvasForAgent } from '../../../../electron/shared/agentCapabilities/canvasReadCompact'
import { buildCanvasWriteAdmissionForOperation } from '../../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import type { CanvasWriteInput } from '../../../../electron/shared/agentCapabilities/canvasWrite'
import { textNodeBody, tiptapDocFromPlainText } from '../../../../electron/shared/canvas/textNodeBody'
import { abandonPendingCanvasWrite } from '../events/canvasWriteBoundary'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { TiptapDocJson } from '../model/generationCanvasTypes'
import { projectConnectedTextInputs, withConnectedTextPrompts } from '../runner/connectedTextPrompt'
import { readGenerationCanvasSnapshot } from './generationCanvasTools'
import { resetClientIdRegistry } from './applyCanvasToolCall'

const receiptHarness = vi.hoisted(() => ({
  metadata: [] as Array<{ summary?: string; stepLabels?: string[] }>,
  commits: [] as Array<{ compensation: Array<Record<string, unknown>> }>,
}))

vi.mock('./proposalUndo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proposalUndo')>()
  return {
    ...actual,
    createProposalReceiptCoordinator(metadata: { summary?: string; stepLabels?: string[] }) {
      receiptHarness.metadata.push(metadata)
      return {
        async prepare() { return true },
        async commit(input: { compensation: Array<Record<string, unknown>> }) {
          receiptHarness.commits.push(input)
          return true
        },
        async abort() {},
        async disposition() { return 'committed' as const },
      }
    },
  }
})

import { applyCompensationOps } from './proposalUndo'
import { captureCanvasWriteRawEvidence, executeCanvasWriteTarget, type CanvasWriteTargetExecution } from './canvasWriteTarget'

function buildRequest(input: CanvasWriteInput): CanvasWriteTargetExecution {
  const nodeId = input.operation === 'set_node_text' ? input.nodeId : ''
  const evidence = captureCanvasWriteRawEvidence(readGenerationCanvasSnapshot(), nodeId)
  return {
    input,
    ...buildCanvasWriteAdmissionForOperation(evidence, input),
    receiptProposalId: 'receipt-text',
    approvalId: 'approval-text',
    actionHash: 'a'.repeat(64),
    signal: new AbortController().signal,
    assertCurrent: vi.fn(),
  }
}

const store = () => useGenerationCanvasStore.getState()
const bodyOf = (id: string) => textNodeBody(store().nodes.find((node) => node.id === id)!)

function addTextNode(text: string, title = '风格说明') {
  const node = store().addNode({ kind: 'text', title, prompt: '' })
  store().writeNodeBody(node.id, tiptapDocFromPlainText(text) as TiptapDocJson)
  return node
}

beforeEach(() => {
  abandonPendingCanvasWrite()
  store().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
  resetClientIdRegistry()
  receiptHarness.metadata.length = 0
  receiptHarness.commits.length = 0
})
afterEach(() => abandonPendingCanvasWrite())

describe('Agent 写文本节点正文（真实宿主执行路径）', () => {
  it('replace：正文落到节点上，回执带正文步骤名，对账通过', async () => {
    const node = addTextNode('旧的风格说明')
    const result = await executeCanvasWriteTarget(
      buildRequest({ operation: 'set_node_text', nodeId: node.id, text: '暖色胶片颗粒\n柔和逆光' }),
      readGenerationCanvasSnapshot,
    )
    expect(result).toMatchObject({ applied: true, operation: 'set_node_text', affectedNodeIds: [node.id], reconciliation: { ok: true } })
    expect(bodyOf(node.id)).toBe('暖色胶片颗粒\n柔和逆光')
    expect(receiptHarness.metadata[0]?.stepLabels?.join('|')).toContain('风格说明')
  })

  it('append：新段落接在原正文后面', async () => {
    const node = addTextNode('第一段')
    await executeCanvasWriteTarget(
      buildRequest({ operation: 'set_node_text', nodeId: node.id, text: '第二段', mode: 'append' }),
      readGenerationCanvasSnapshot,
    )
    expect(bodyOf(node.id)).toBe('第一段\n第二段')
  })

  it('整笔撤销（回执补偿）把正文放回写之前的样子', async () => {
    const node = addTextNode('原样')
    const before = JSON.parse(JSON.stringify(store().nodes.find((n) => n.id === node.id)!.contentJson))
    await executeCanvasWriteTarget(
      buildRequest({ operation: 'set_node_text', nodeId: node.id, text: 'Agent 改的' }),
      readGenerationCanvasSnapshot,
    )
    expect(bodyOf(node.id)).toBe('Agent 改的')
    const compensation = receiptHarness.commits[0]!.compensation
    expect(compensation).toEqual([expect.objectContaining({ kind: 'restore-text', nodeId: node.id })])
    applyCompensationOps(compensation as never)
    expect(store().nodes.find((n) => n.id === node.id)!.contentJson).toEqual(before)
  })

  it('用户 Ctrl+Z（画布撤销栈）也能把正文撤回', async () => {
    const node = addTextNode('撤销前')
    await executeCanvasWriteTarget(
      buildRequest({ operation: 'set_node_text', nodeId: node.id, text: '写入后' }),
      readGenerationCanvasSnapshot,
    )
    expect(bodyOf(node.id)).toBe('写入后')
    store().undo()
    expect(bodyOf(node.id)).toBe('撤销前')
  })

  it('批准之后用户又改了正文：这次写是过期的，不覆盖用户的字', async () => {
    const node = addTextNode('初稿')
    const request = buildRequest({ operation: 'set_node_text', nodeId: node.id, text: 'Agent 的版本' })
    store().writeNodeBody(node.id, tiptapDocFromPlainText('用户抢先改了') as TiptapDocJson, { persist: false })
    await expect(executeCanvasWriteTarget(request, readGenerationCanvasSnapshot)).rejects.toMatchObject({ code: 'capability_target_stale' })
    expect(bodyOf(node.id)).toBe('用户抢先改了')
    expect(receiptHarness.commits).toEqual([])
  })

  it('不是文本节点：拒绝，节点不被写出正文', async () => {
    const image = store().addNode({ kind: 'image', title: '图', prompt: 'p' })
    await expect(executeCanvasWriteTarget(
      buildRequest({ operation: 'set_node_text', nodeId: image.id, text: 'x' }), readGenerationCanvasSnapshot,
    )).rejects.toBeTruthy()
    expect(store().nodes.find((n) => n.id === image.id)!.contentJson).toBeUndefined()
  })

  it('说的 = 摆的：Agent 读到的正文、下游拼进去的文字、刚写入的文字是同一份', async () => {
    const text = addTextNode('旧')
    const image = store().addNode({ kind: 'image', title: '成片', prompt: '基础提示词' })
    store().connectNodes(text.id, image.id)
    await executeCanvasWriteTarget(
      buildRequest({ operation: 'set_node_text', nodeId: text.id, text: '冷蓝色夜景' }),
      readGenerationCanvasSnapshot,
    )
    const snapshot = readGenerationCanvasSnapshot()
    const read = projectCanvasRead(snapshot).nodes.find((n) => n.id === text.id)
    const target = snapshot.nodes.find((n) => n.id === image.id)!
    const context = { nodes: snapshot.nodes, edges: snapshot.edges }
    const inputs = projectConnectedTextInputs(target, context)
    expect(read?.text).toBe('冷蓝色夜景')
    expect(inputs.map((input) => input.text)).toEqual([read?.text])
    expect(withConnectedTextPrompts(target, context).prompt).toBe('基础提示词\n\n冷蓝色夜景')
    expect(formatCanvasForAgent(projectCanvasRead(snapshot))).toContain('冷蓝色夜景')
  })
})
