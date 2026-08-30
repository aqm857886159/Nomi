import { beforeEach, describe, expect, it } from 'vitest'

import { attachShotResult, materializeShots } from './multiShotCanvasLanding'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'

// P4 S5 — attach-shot-result 的运行时断言（result.url 必须 nomi-local://）+ 节点已删静默跳过。

function shotNode(id: string): GenerationCanvasNode {
  return { id, kind: 'video', title: id, position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots' }
}

describe('attachShotResult', () => {
  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [shotNode('node-1')], edges: [], groups: [] })
  })

  it('本地 url（nomi-local://）→ 回填成功，节点拿到 result', () => {
    const outcome = attachShotResult({
      nodeId: 'node-1',
      shotId: 's1',
      result: { id: 'production-job-s1', type: 'video', url: 'nomi-local://production-preview/p/r/a/x.mp4?preview=t', createdAt: 1 },
    })
    expect(outcome).toEqual({ attached: true, nodeId: 'node-1' })
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'node-1')?.result?.url).toContain('nomi-local://')
  })

  it('非本地 url（https CDN）→ **当场抛**（R17 运行时断言，grep 棘轮抓不住）', () => {
    expect(() => attachShotResult({
      nodeId: 'node-1',
      shotId: 's1',
      result: { id: 'r', type: 'video', url: 'https://cdn.example.com/x.mp4', createdAt: 1 },
    })).toThrow(/nomi-local/)
    // 断言拦下 → 节点不该被写入脏 url。
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'node-1')?.result).toBeUndefined()
  })

  it('节点已删（整批撤销）→ 静默跳过（返回 skipped:node-removed），不抛', () => {
    const outcome = attachShotResult({
      nodeId: 'node-gone',
      shotId: 's1',
      result: { id: 'r', type: 'video', url: 'nomi-local://x', createdAt: 1 },
    })
    expect(outcome).toEqual({ skipped: 'node-removed' })
  })

  it('无 result → skipped:no-result', () => {
    expect(attachShotResult({ nodeId: 'node-1', shotId: 's1' })).toEqual({ skipped: 'no-result' })
  })

  it('文本结果（无 url）→ 放行（不强制本地协议）', () => {
    const outcome = attachShotResult({
      nodeId: 'node-1',
      shotId: 's1',
      result: { id: 'r', type: 'text', text: '一段字', createdAt: 1 } as never,
    })
    expect(outcome).toEqual({ attached: true, nodeId: 'node-1' })
  })
})

describe('materializeShots undo transaction', () => {
  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  })

  it('removes every materialized node and its group with one undo', async () => {
    const operationId = 'canvas-landing:unit-undo'
    const result = await materializeShots({
      materializationOperationId: operationId,
      groupName: '一批镜头',
      shots: [
        { shotId: 'anchor-1', role: 'anchor', kind: 'image' },
        { shotId: 'shot-1', role: 'shot', kind: 'video' },
        { shotId: 'shot-2', role: 'shot', kind: 'video' },
        { shotId: 'shot-3', role: 'shot', kind: 'video' },
      ],
    })

    expect(result.createdNodeIds).toHaveLength(4)
    expect(result.groupId).toBeTruthy()
    expect(useGenerationCanvasStore.getState().canUndo).toBe(true)

    // Real generation cards normalize model/archetype/aspect metadata after mount.
    // Those lifecycle writes belong to the materialization step and must not split Undo.
    for (const nodeId of result.createdNodeIds) {
      useGenerationCanvasStore.getState().updateNode(nodeId, {
        meta: {
          ...(useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta || {}),
          modelKey: 'auto-selected-model',
          modelVendor: 'auto-selected-provider',
          aspect_ratio: '16:9',
        },
      }, { history: false })
    }

    const shotNodeId = result.bindings.find((binding) => binding.shotId === 'shot-1')?.nodeId
    expect(shotNodeId).toBeTruthy()
    attachShotResult({
      nodeId: shotNodeId,
      shotId: 'shot-1',
      result: { id: 'shot-1-result', type: 'video', url: 'nomi-local://shot-1.mp4', createdAt: 1 },
    })

    useGenerationCanvasStore.getState().undo()
    const afterUndo = useGenerationCanvasStore.getState()
    expect(afterUndo.nodes.filter((node) => node.meta?.materializationOperationId === operationId)).toEqual([])
    expect(afterUndo.groups.filter((group) => group.materializationOperationId === operationId)).toEqual([])
  })
})
