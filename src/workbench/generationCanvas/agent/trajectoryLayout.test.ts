import { describe, expect, it } from 'vitest'
import { layoutPlannedNodes, layoutStoryboardNodes, trajectoryOrigin } from './trajectoryLayout'
import { DEFAULT_NODE_SIZE, NODE_RENDER_SAFETY } from '../model/generationNodeKinds'
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
    const cell = DEFAULT_NODE_SIZE.image.width + NODE_RENDER_SAFETY
    expect(Math.max(...xs) - Math.min(...xs)).toBe(2 * cell)
    expect(new Set(xs).size).toBe(3)
  })

  // —— 审计 A5② 续：批量布局间距必须 ≥ 渲染足迹（名义+NODE_RENDER_SAFETY），与单插避让同余量 ——
  // 名义间距吸收不了「渲染>名义」的高度漂移就会重叠（审计实测的镜头重叠正是此类）。批量布局
  // 不能比单插避让(resolveInsertionPosition 用 64)更松——否则就是两套余量、批量路径漏网。

  it('分层列内竖排间距 ≥ 渲染足迹高（吸收渲染>名义漂移）', () => {
    const planned = kinds(['character', 'image', 'image', 'image', 'video']) // 三层 → 分层形态
    const positions = layoutPlannedNodes(planned, [])
    const imageYs = [positions[1].y, positions[2].y, positions[3].y]
    const footH = DEFAULT_NODE_SIZE.image.height + NODE_RENDER_SAFETY
    expect(imageYs[1] - imageYs[0]).toBeGreaterThanOrEqual(footH)
    expect(imageYs[2] - imageYs[1]).toBeGreaterThanOrEqual(footH)
  })

  it('网格行距/列距 ≥ 渲染足迹（纯视频批走网格回退）', () => {
    const positions = layoutPlannedNodes(kinds(['video', 'video', 'video', 'video']), [])
    const xs = Array.from(new Set(positions.map((p) => p.x))).sort((a, b) => a - b)
    const ys = Array.from(new Set(positions.map((p) => p.y))).sort((a, b) => a - b)
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(DEFAULT_NODE_SIZE.video.width + NODE_RENDER_SAFETY)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(DEFAULT_NODE_SIZE.video.height + NODE_RENDER_SAFETY)
  })

  it('异高混批走网格（混入 text/output 等 null 层）名义零重叠', () => {
    const planned = kinds(['image', 'text', 'video', 'output', 'image', 'text'])
    assertNoOverlap(planned, layoutPlannedNodes(planned, []))
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

  // —— 分镜布局（用户拍板 2026-06-15：参考行在上 + 镜头折行网格，治「都是竖排、线乱」）——

  it('分镜布局：参考卡顶部一排（同 y、x 递增），镜头不与参考卡同列竖挤', () => {
    // 2 参考卡（角色/场景）+ 6 镜头
    const planned = kinds(['character', 'scene', 'image', 'image', 'image', 'image', 'image', 'image'])
    const pos = layoutStoryboardNodes(planned, 2, [])
    // 参考行：前 2 个同一 y、x 递增（横排）
    expect(pos[0].y).toBe(pos[1].y)
    expect(pos[1].x).toBeGreaterThan(pos[0].x)
    // 镜头都在参考行下方
    const refBottom = pos[0].y
    for (let i = 2; i < pos.length; i++) expect(pos[i].y).toBeGreaterThan(refBottom)
  })

  it('分镜布局：镜头横向折行网格——每排 4 个，第 5 个换行（非全竖排）', () => {
    const planned = kinds(['character', ...Array.from({ length: 6 }, () => 'image')])
    const pos = layoutStoryboardNodes(planned, 1, [])
    const shots = pos.slice(1) // 6 镜头
    // 第 1 排 4 个：同 y、x 严格递增（横排，非竖排）
    expect(new Set(shots.slice(0, 4).map((p) => p.y)).size).toBe(1)
    expect(shots[0].x).toBeLessThan(shots[1].x)
    expect(shots[3].x).toBeGreaterThan(shots[0].x)
    // 第 5 个换行：回到第 1 列 x、y 更大
    expect(shots[4].x).toBe(shots[0].x)
    expect(shots[4].y).toBeGreaterThan(shots[0].y)
    // 不是「全挤一列竖排」：至少 2 个不同 x
    expect(new Set(shots.map((p) => p.x)).size).toBeGreaterThan(1)
  })

  it('分镜布局：原点避让已有节点（落在包围盒下方，不压旧内容）', () => {
    const existing = [{ kind: 'image' as GenerationNodeKind, position: { x: 200, y: 900 } }]
    const planned = kinds(['character', 'image', 'image'])
    const pos = layoutStoryboardNodes(planned, 1, existing)
    const origin = trajectoryOrigin(existing)
    for (const p of pos) expect(p.y).toBeGreaterThanOrEqual(origin.y)
  })

  it('分镜布局：任意两节点 AABB 零重叠（参考行 + 镜头网格）', () => {
    const planned = kinds(['character', 'scene', 'image', 'image', 'image', 'image', 'image', 'image', 'image'])
    assertNoOverlap(planned, layoutStoryboardNodes(planned, 2, []))
  })

  it('分镜布局：无参考卡（anchorCount=0）时镜头从原点起的纯网格', () => {
    const planned = kinds(['image', 'image', 'image'])
    const pos = layoutStoryboardNodes(planned, 0, [])
    const origin = trajectoryOrigin([])
    expect(pos[0]).toEqual({ x: origin.x, y: origin.y })
    assertNoOverlap(planned, pos)
  })
})
