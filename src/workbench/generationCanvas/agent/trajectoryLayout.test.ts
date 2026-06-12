import { describe, expect, it } from 'vitest'
import { layoutPlannedNodes, trajectoryOrigin } from './trajectoryLayout'
import { DEFAULT_NODE_SIZE } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'

const kinds = (list: string[]): GenerationNodeKind[] => list as GenerationNodeKind[]

describe('trajectoryLayout（T4：分层布局 + 避让已有节点）', () => {
  it('三层轨迹按列分层：参考列 < 关键帧列 < 视频列，层内竖排', () => {
    const planned = kinds(['character', 'scene', 'image', 'image', 'image', 'video', 'video', 'video'])
    const positions = layoutPlannedNodes(planned, [])
    const xs = positions.map((p) => p.x)
    // 三个不同列 x
    expect(new Set(xs).size).toBe(3)
    const [refX, kfX, videoX] = [xs[0], xs[2], xs[5]]
    expect(refX).toBeLessThan(kfX)
    expect(kfX).toBeLessThan(videoX)
    // 同层竖排不重叠（y 间距 ≥ 默认最大节点高 280）
    const kfYs = positions.slice(2, 5).map((p) => p.y)
    expect(new Set(kfYs).size).toBe(3)
    expect(Math.min(kfYs[1] - kfYs[0], kfYs[2] - kfYs[1])).toBeGreaterThanOrEqual(280)
    // 参考层第 1/2 个同列不同行
    expect(positions[0].x).toBe(positions[1].x)
    expect(positions[1].y).toBeGreaterThan(positions[0].y)
  })

  it('原点避让：新计划永远落在已有节点包围盒下方（修审计 bug D）', () => {
    const existing = [
      { kind: 'image' as GenerationNodeKind, position: { x: 546, y: 194 } },
      { kind: 'video' as GenerationNodeKind, position: { x: 200, y: 600 } },
    ]
    const origin = trajectoryOrigin(existing)
    const lowestBottom = 600 + DEFAULT_NODE_SIZE.video.height
    expect(origin.y).toBeGreaterThanOrEqual(lowestBottom + 80)

    const positions = layoutPlannedNodes(kinds(['character', 'image', 'video']), existing)
    for (const p of positions) expect(p.y).toBeGreaterThanOrEqual(origin.y)
  })

  it('单层计划退回紧凑网格（形状不变，原点平移避让）', () => {
    const planned = kinds(['image', 'image', 'image', 'image', 'image', 'image'])
    const clean = layoutPlannedNodes(planned, [])
    // 3 列 2 行（与 gridPosition 既有断言一致）
    expect(new Set(clean.map((p) => p.y)).size).toBe(2)
    expect(new Set(clean.map((p) => p.x)).size).toBe(3)

    const shifted = layoutPlannedNodes(planned, [
      { kind: 'image' as GenerationNodeKind, position: { x: 100, y: 1000 } },
    ])
    // 形状一致，只是整体下移
    const dy = shifted[0].y - clean[0].y
    expect(dy).toBeGreaterThan(0)
    shifted.forEach((p, i) => {
      expect(p.x).toBe(clean[i].x)
      expect(p.y).toBe(clean[i].y + dy)
    })
  })

  it('混入不可推导 kind（text）→ 整批退网格，不半层半网格', () => {
    const planned = kinds(['character', 'image', 'video', 'text'])
    const positions = layoutPlannedNodes(planned, [])
    // 网格形态：2 列 2 行（ceil(sqrt(4))=2）
    expect(new Set(positions.map((p) => p.x)).size).toBe(2)
    expect(new Set(positions.map((p) => p.y)).size).toBe(2)
  })

  it('网格横向跨度收敛，不随 index 线性发散（继承 gridPosition 回归意图）', () => {
    const planned = kinds(Array.from({ length: 9 }, () => 'image'))
    const xs = layoutPlannedNodes(planned, []).map((p) => p.x)
    // 9 节点 3 列 → 跨度 = 2 格，远小于旧单行实现的 8 格
    const cell = DEFAULT_NODE_SIZE.image.width + 48
    expect(Math.max(...xs) - Math.min(...xs)).toBe(2 * cell)
    expect(new Set(xs).size).toBe(3)
  })

  // —— 审计 A3 根治断言：步距由节点尺寸 derive，任意两节点 AABB 零重叠 ——

  function assertNoOverlap(planned: GenerationNodeKind[], positions: Array<{ x: number; y: number }>) {
    const rects = positions.map((p, i) => {
      const size = DEFAULT_NODE_SIZE[planned[i]]
      return { x: p.x, y: p.y, w: size.width, h: size.height, kind: planned[i] }
    })
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlaps, `节点 ${i}(${a.kind}) 与 ${j}(${b.kind}) 重叠：${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(false)
      }
    }
  }

  it('19 节点混合批（审计 A3 实测场景）分层布局零重叠——视频 420×340 不再被 420/320 步距压住', () => {
    const planned = kinds([
      'character', 'character', 'scene',
      'image', 'image', 'image', 'image', 'image', 'image', 'image', 'image',
      'video', 'video', 'video', 'video', 'video', 'video', 'video', 'video',
    ])
    const existing = [{ kind: 'image' as GenerationNodeKind, position: { x: 440, y: 380 } }]
    const positions = layoutPlannedNodes(planned, existing)
    assertNoOverlap(planned, positions)
    // 也不压已有节点
    const origin = trajectoryOrigin(existing)
    for (const p of positions) expect(p.y).toBeGreaterThanOrEqual(origin.y)
  })

  it('纯视频批走网格回退同样零重叠（格子从批内最大尺寸 derive）', () => {
    const planned = kinds(['video', 'video', 'video', 'video', 'video'])
    assertNoOverlap(planned, layoutPlannedNodes(planned, []))
  })
})
