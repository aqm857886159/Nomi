// 物化幂等章的类级测试：判据归**写边界**所有，而不是每个调用方各写一份。
//
// 2026-09-10 之前 capabilityApplyHandler 与 multiShotCanvasLanding 各手写了一份去重；
// 每多一个落地入口就多一份实现，漏掉任何一份，用户看到的就是 agent 重试堆出的重复节点。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./availableModels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./availableModels')>()),
  listAvailableModelsForAgent: vi.fn(async () => []),
}))

import { applyCanvasToolCall, resetClientIdRegistry, resolveCanvasToolNodeId } from './applyCanvasToolCall'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { indexMaterializedNodes, materializationKey, readNodeInputStamp } from './materializationStamp'

describe('materialization stamp (pure)', () => {
  it('章的身份是两段：同 clientId 落在不同 operation 下是两个节点', () => {
    const index = indexMaterializedNodes([
      { id: 'n1', meta: { materializationOperationId: 'op-a', materializationClientId: 's1' } },
      { id: 'n2', meta: { materializationOperationId: 'op-b', materializationClientId: 's1' } },
    ])
    expect(index.get(materializationKey({ operationId: 'op-a', clientId: 's1' }))).toBe('n1')
    expect(index.get(materializationKey({ operationId: 'op-b', clientId: 's1' }))).toBe('n2')
  })

  it('缺任一段的节点不进索引（半个章不是身份）', () => {
    const index = indexMaterializedNodes([
      { id: 'n1', meta: { materializationOperationId: 'op-a' } },
      { id: 'n2', meta: { materializationClientId: 's1' } },
      { id: 'n3', meta: {} },
    ])
    expect(index.size).toBe(0)
  })

  it('入参里的脏 operationId 被挡住（不让脏章污染画布 meta）', () => {
    expect(readNodeInputStamp({ metadata: { materializationOperationId: 'op a b', materializationClientId: 's1' } })).toBeNull()
    expect(readNodeInputStamp({ metadata: { materializationOperationId: 'canvas-landing:run-1', materializationClientId: 's1' } }))
      .toEqual({ operationId: 'canvas-landing:run-1', clientId: 's1' })
  })
})

describe('create_canvas_nodes idempotency lives in the write boundary', () => {
  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  })

  const args = () => ({
    nodes: [
      { clientId: 'a1', kind: 'image', title: '锚', metadata: { materializationOperationId: 'op-x', materializationClientId: 'a1' } },
      { clientId: 's1', kind: 'video', title: '镜 1', metadata: { materializationOperationId: 'op-x', materializationClientId: 's1' } },
    ],
    edges: [{ sourceClientId: 'a1', targetClientId: 's1', mode: 'reference' }],
    anchorCount: 1,
  })

  it('同一批重放两次：节点不翻倍，clientId 仍指得到已有节点', async () => {
    const first = (await applyCanvasToolCall('create_canvas_nodes', args())) as {
      createdNodeIds: string[]
      clientIdToNodeId: Record<string, string>
    }
    expect(first.createdNodeIds).toHaveLength(2)

    const second = (await applyCanvasToolCall('create_canvas_nodes', args())) as {
      createdNodeIds: string[]
      clientIdToNodeId: Record<string, string>
    }
    expect(second.createdNodeIds).toHaveLength(0)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
    // 复用的映射照样回给调用方 + 进 clientId 注册表（后续连边 / set_prompt 指得到）。
    expect(second.clientIdToNodeId.s1).toBe(first.clientIdToNodeId.s1)
    expect(resolveCanvasToolNodeId('s1')).toBe(first.clientIdToNodeId.s1)
  })

  it('只有一半带章已存在：补建缺的那半，锚数跟着重算（布局不把镜头当成锚）', async () => {
    const first = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [args().nodes[0]],
      edges: [],
      anchorCount: 1,
    })) as { createdNodeIds: string[] }
    expect(first.createdNodeIds).toHaveLength(1)

    const second = (await applyCanvasToolCall('create_canvas_nodes', args())) as {
      createdNodeIds: string[]
      clientIdToNodeId: Record<string, string>
    }
    expect(second.createdNodeIds).toHaveLength(1)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
    // 边在补建之后仍然连得上（复用节点已登记进注册表）。
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(1)
  })

  it('不带章的节点不受影响（agent 直接建卡照旧每次都建）', async () => {
    const plain = { nodes: [{ clientId: 'p1', kind: 'image', title: '卡' }], edges: [] }
    await applyCanvasToolCall('create_canvas_nodes', plain)
    await applyCanvasToolCall('create_canvas_nodes', plain)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
  })
})
