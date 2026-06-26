import { describe, it, expect } from 'vitest'
import { tidyCanvasLayout, type TidyNode, type TidyEdge } from './tidyCanvasLayout'
import { getNodeSize } from '../model/generationNodeKinds'

// 视觉不重叠用**名义尺寸**判（足迹的 +安全余量是主网格的保守间距，切片簇刻意压更紧，不该用足迹判）。
function nominal(node: TidyNode): { width: number; height: number } {
  return getNodeSize({ kind: node.kind, size: node.size })
}

function overlaps(
  a: { node: TidyNode; pos: { x: number; y: number } },
  b: { node: TidyNode; pos: { x: number; y: number } },
): boolean {
  const fa = nominal(a.node)
  const fb = nominal(b.node)
  return (
    a.pos.x < b.pos.x + fb.width &&
    a.pos.x + fa.width > b.pos.x &&
    a.pos.y < b.pos.y + fb.height &&
    a.pos.y + fa.height > b.pos.y
  )
}

describe('tidyCanvasLayout', () => {
  it('材料在镜头上方 · 全程无重叠 · 镜头按 shotIndex · 切片贴父', () => {
    const nodes: TidyNode[] = [
      { id: 'mat', kind: 'image', size: { width: 200, height: 140 }, position: { x: 700, y: 400 } },
      { id: 's1', kind: 'image', size: { width: 200, height: 140 }, position: { x: 100, y: 50 }, shotIndex: 0 },
      { id: 's2', kind: 'image', size: { width: 200, height: 140 }, position: { x: 400, y: 300 }, shotIndex: 1 },
      { id: 'sl', kind: 'asset', size: { width: 80, height: 60 }, position: { x: 120, y: 120 }, meta: { sourceNodeId: 's1' } },
    ]
    const edges: TidyEdge[] = [
      { source: 'mat', target: 's1' },
      { source: 'mat', target: 's2' },
      { source: 's1', target: 'sl' },
    ]
    const pos = tidyCanvasLayout(nodes, edges, 1.8)
    expect(pos.size).toBe(4)

    const at = (id: string) => ({ node: nodes.find((n) => n.id === id)!, pos: pos.get(id)! })

    // 材料在镜头上方
    expect(pos.get('mat')!.y).toBeLessThan(pos.get('s1')!.y)
    expect(pos.get('mat')!.y).toBeLessThan(pos.get('s2')!.y)

    // 镜头阅读序：s1 在 s2 之前（同排靠左，或在上一排）
    const a = pos.get('s1')!
    const b = pos.get('s2')!
    expect(a.y < b.y || (a.y === b.y && a.x < b.x)).toBe(true)

    // 全程无重叠
    const ids = ['mat', 's1', 's2', 'sl']
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        expect(overlaps(at(ids[i]), at(ids[j]))).toBe(false)
      }
    }

    // 切片紧跟源：sl 与 s1 同在镜头区（y ≥ s1.y），且在流里排在 s1 之后（同行靠右 或 换到下一行）
    const slp = pos.get('sl')!
    const s1p = pos.get('s1')!
    expect(slp.y).toBeGreaterThanOrEqual(s1p.y)
    expect(slp.y > s1p.y || slp.x > s1p.x).toBe(true)
  })

  it('目标宽高比越宽 → 折越少行（宽块、不高瘦）', () => {
    const nodes: TidyNode[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      id: `s${i}`,
      kind: 'image' as const,
      size: { width: 200, height: 140 },
      position: { x: i * 10, y: i * 10 },
      shotIndex: i,
    }))
    const wide = tidyCanvasLayout(nodes, [], 4) // 宽屏目标
    const tall = tidyCanvasLayout(nodes, [], 0.8) // 竖向目标
    const rowsWide = new Set([...wide.values()].map((p) => p.y)).size
    const rowsTall = new Set([...tall.values()].map((p) => p.y)).size
    expect(rowsWide).toBeLessThan(rowsTall)
  })

  it('嵌套切片（切片的切片）归到根镜头、不掉队', () => {
    const nodes: TidyNode[] = [
      { id: 's1', kind: 'image', size: { width: 200, height: 140 }, position: { x: 0, y: 0 }, shotIndex: 0 },
      { id: 'sl', kind: 'asset', size: { width: 80, height: 60 }, position: { x: -500, y: 300 }, meta: { sourceNodeId: 's1' } },
      { id: 'slsl', kind: 'asset', size: { width: 60, height: 50 }, position: { x: -900, y: 900 }, meta: { sourceNodeId: 'sl' } },
    ]
    const pos = tidyCanvasLayout(nodes, [], 1.8)
    expect(pos.size).toBe(3)
    // 所有节点都被重排到非负区（根 ORIGIN 起），孙切片不再留在老负坐标
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
    }
    // 孙切片落在镜头簇范围内（x 不小于镜头 x）
    expect(pos.get('slsl')!.x).toBeGreaterThanOrEqual(pos.get('s1')!.x)
  })

  it('切片的根祖先是材料（被切片的纯输入图）也要被摆放、不掉队', () => {
    const nodes: TidyNode[] = [
      // mat 是纯输入（喂 shot），且被切片
      { id: 'mat', kind: 'image', size: { width: 200, height: 140 }, position: { x: 0, y: 0 } },
      { id: 'shot', kind: 'image', size: { width: 200, height: 140 }, position: { x: 0, y: 0 }, shotIndex: 0 },
      { id: 'matSlice', kind: 'asset', size: { width: 80, height: 60 }, position: { x: -800, y: 700 }, meta: { sourceNodeId: 'mat' } },
    ]
    const edges: TidyEdge[] = [{ source: 'mat', target: 'shot' }]
    const pos = tidyCanvasLayout(nodes, edges, 1.8)
    expect(pos.size).toBe(3)
    // 材料的切片被重排到非负区（不再留老负坐标 -800）
    expect(pos.get('matSlice')!.x).toBeGreaterThanOrEqual(0)
    expect(pos.get('matSlice')!.y).toBeGreaterThanOrEqual(0)
  })

  it('连接链优先于原始坐标：A→B→C 时 B 必须排在 C 前', () => {
    const nodes: TidyNode[] = [
      { id: 'a', kind: 'image', size: { width: 200, height: 140 }, position: { x: 900, y: 500 } },
      { id: 'b', kind: 'image', size: { width: 200, height: 140 }, position: { x: 800, y: 900 } },
      { id: 'c', kind: 'image', size: { width: 200, height: 140 }, position: { x: 100, y: 100 } },
    ]
    const edges: TidyEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const pos = tidyCanvasLayout(nodes, edges, 1.8)
    const b = pos.get('b')!
    const c = pos.get('c')!
    expect(b.y < c.y || (b.y === c.y && b.x < c.x)).toBe(true)
  })

  it('有连接线的主节点优先于孤立节点，孤立节点再按 shotIndex 兜底', () => {
    const nodes: TidyNode[] = [
      { id: 'ref', kind: 'image', size: { width: 200, height: 140 }, position: { x: 900, y: 500 } },
      { id: 'connected-late-shot', kind: 'image', size: { width: 200, height: 140 }, position: { x: 700, y: 600 }, shotIndex: 9 },
      { id: 'orphan-early-shot', kind: 'image', size: { width: 200, height: 140 }, position: { x: 0, y: 0 }, shotIndex: 0 },
    ]
    const edges: TidyEdge[] = [{ source: 'ref', target: 'connected-late-shot' }]
    const pos = tidyCanvasLayout(nodes, edges, 1.8)
    const connected = pos.get('connected-late-shot')!
    const orphan = pos.get('orphan-early-shot')!
    expect(connected.y < orphan.y || (connected.y === orphan.y && connected.x < orphan.x)).toBe(true)
  })

  it('空输入返回空映射', () => {
    expect(tidyCanvasLayout([], [], 1000).size).toBe(0)
  })
})
