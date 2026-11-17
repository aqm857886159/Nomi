import { describe, expect, it } from 'vitest'
import { replayCanvasEvents, type CanvasProjection } from './canvasEventReducer'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 节点锁已撤掉：旧版写进事件日志的 canvas.node.locked / canvas.node.unlocked，重放时静默跳过——
// 不报错、不把 locked 写回节点，别的事件照常重放。
const base = (): CanvasProjection => ({
  nodes: [{ id: 'a', title: 'a', kind: 'image', categoryId: 'shots', position: { x: 0, y: 0 } } as GenerationCanvasNode],
  edges: [],
  groups: [],
})

describe('replayCanvasEvents — 旧版节点锁事件', () => {
  it('locked / unlocked 事件被跳过，后面的事件照常生效', () => {
    const result = replayCanvasEvents([
      { type: 'canvas.node.locked', payload: { nodeId: 'a', title: 'a' } },
      { type: 'canvas.node.updated', payload: { nodeId: 'a', patch: { title: 'renamed' } } },
      { type: 'canvas.node.unlocked', payload: { nodeId: 'a', title: 'a' } },
      { type: 'canvas.node.locked', payload: { nodeId: 'a', title: 'a' } },
    ] as never, base())
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toMatchObject({ id: 'a', title: 'renamed' })
    expect(result.nodes[0]).not.toHaveProperty('locked')
  })
})
