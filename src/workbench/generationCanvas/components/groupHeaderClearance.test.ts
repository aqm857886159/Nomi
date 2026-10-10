import { describe, expect, it } from 'vitest'
import { getCanvasGroupBoxes } from './generationCanvasGeometry'
import { FRAME_CONTENT_PADDING, FRAME_HEADER_RESERVE } from '../model/canvasFrameBounds'
import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'

// D6（10-10 拍板）：框头不被成员压住。框头是框内一行（top 10 高 26，见 GroupFrameHeader.tsx 的 top-2.5 / h-[26px]）；
// 成员节点的名字标签画在卡上方约 24px（节点层，压在框头之上）。断言：成员标签顶边必须落在框头底边之下。
const HEADER_TOP = 10
const HEADER_HEIGHT = 26
const NODE_LABEL_REACH = 24

function member(id: string, x: number, y: number): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position: { x, y }, size: { width: 240, height: 120 }, categoryId: 'shots' } as GenerationCanvasNode
}

function group(nodeIds: string[]): NodeGroup {
  return { id: 'g', name: 'g', categoryId: 'shots', nodeIds, createdAt: 1, updatedAt: 1 } as NodeGroup
}

describe('group header clearance (D6)', () => {
  it('member cards start below the header band plus the node name label reach', () => {
    const nodes = [member('a', 200, 300), member('b', 500, 300), member('c', 200, 480)]
    const [box] = getCanvasGroupBoxes([group(['a', 'b', 'c'])], nodes)
    const headerBottom = box.top + HEADER_TOP + HEADER_HEIGHT
    for (const node of nodes) {
      const labelTop = node.position.y - NODE_LABEL_REACH
      expect(labelTop, `${node.id} 的名字标签不压框头`).toBeGreaterThan(headerBottom)
    }
  })

  it('the reserved band above members is the padding plus the header reserve', () => {
    const nodes = [member('a', 200, 300)]
    const [box] = getCanvasGroupBoxes([group(['a'])], nodes)
    expect(box.top).toBeLessThanOrEqual(300 - FRAME_CONTENT_PADDING - FRAME_HEADER_RESERVE + 0.5)
    expect(FRAME_CONTENT_PADDING + FRAME_HEADER_RESERVE).toBe(68)
  })
})
