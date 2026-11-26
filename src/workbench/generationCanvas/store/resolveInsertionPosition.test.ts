import { describe, expect, it } from 'vitest'
import { occupiedSize, resolveGroupInsertionDelta, resolveInsertionPosition, type NodeBox } from './resolveInsertionPosition'
import { DEFAULT_NODE_SIZE } from '../model/generationNodeKinds'

const imageSize = DEFAULT_NODE_SIZE.image

function box(kind: NodeBox['kind'], x: number, y: number, size?: { width: number; height: number }): NodeBox {
  return { kind, position: { x, y }, size }
}

describe('resolveInsertionPosition (审计 A4 真碰撞避让)', () => {
  it('空画布：原样返回 base', () => {
    expect(resolveInsertionPosition('image', { x: 100, y: 100 }, [])).toEqual({ x: 100, y: 100 })
  })

  it('base 不压任何节点：原样返回（远处有节点不影响）', () => {
    const existing = [box('image', 2000, 2000)]
    expect(resolveInsertionPosition('image', { x: 100, y: 100 }, existing)).toEqual({ x: 100, y: 100 })
  })

  it('base 正落在已有节点上：必须挪到不重叠的空位', () => {
    const existing = [box('image', 100, 100)]
    const result = resolveInsertionPosition('image', { x: 100, y: 100 }, existing)
    // 结果不能再与该节点的 AABB 重叠
    const overlap =
      result.x < 100 + imageSize.width &&
      result.x + imageSize.width > 100 &&
      result.y < 100 + imageSize.height &&
      result.y + imageSize.height > 100
    expect(overlap).toBe(false)
  })

  it('部分重叠（错开几像素）也判为冲突并避让——旧整数点等值会漏掉', () => {
    const existing = [box('image', 100, 100)]
    // 错开 5px：旧实现 "105,105" ≠ "100,100" 会误判无冲突；新实现 AABB 必避让。
    const result = resolveInsertionPosition('image', { x: 105, y: 105 }, existing)
    expect(result).not.toEqual({ x: 105, y: 105 })
  })

  it('密集占用：螺旋找到的空位不与任何节点重叠', () => {
    // 在 base 周围铺一圈节点
    const existing: NodeBox[] = []
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        existing.push(box('image', 300 + dx * (imageSize.width + 48), 300 + dy * (imageSize.height + 48)))
      }
    }
    const result = resolveInsertionPosition('image', { x: 300, y: 300 }, existing)
    const collides = existing.some((node) => {
      const s = node.size ?? DEFAULT_NODE_SIZE[node.kind]
      return (
        result.x < node.position.x + s.width &&
        result.x + imageSize.width > node.position.x &&
        result.y < node.position.y + s.height &&
        result.y + imageSize.height > node.position.y
      )
    })
    expect(collides).toBe(false)
  })

  it('落点对名义边界留有余量（吸收渲染比名义高的增量，防 12px 残余重叠回归）', () => {
    const existing = [box('image', 100, 100)]
    const result = resolveInsertionPosition('image', { x: 100, y: 100 }, existing)
    // 与名义盒（imageSize）的最近间距应明显 > 0（不是边贴边），证明外扩余量生效。
    const dx = Math.max(100 - (result.x + imageSize.width), result.x - (100 + imageSize.width), 0)
    const dy = Math.max(100 - (result.y + imageSize.height), result.y - (100 + imageSize.height), 0)
    expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(40)
  })

  it('异尺寸节点：按各自 size 做 AABB，不会判过宽', () => {
    // 一个很矮的占用节点，新 image 节点在其下方足够远处应可放
    const existing = [box('image', 100, 100, { width: 280, height: 100 })]
    const result = resolveInsertionPosition('image', { x: 100, y: 100 }, existing)
    expect(result.y).toBeGreaterThanOrEqual(100)
    const overlap =
      result.x < 100 + 280 && result.x + imageSize.width > 100 && result.y < 100 + 100 && result.y + imageSize.height > 100
    expect(overlap).toBe(false)
  })
})

describe('resolveInsertionPosition × visible area（2026-09-25「新建尽量直接落在当前可见区域」）', () => {
  // 真机复现：可见区比两张卡宽一点，落点被一张已有卡占着，旧螺旋第一圈（跨一整张卡 + 48）就跨出了屏。
  // 尺寸从默认卡尺寸派生，不抄数字。
  const view = { x: 0, y: 0, width: Math.round(imageSize.width * 3.2), height: Math.round(imageSize.height * 1.6) }
  const inside = (pos: { x: number; y: number }) =>
    pos.x >= view.x && pos.y >= view.y && pos.x + imageSize.width <= view.x + view.width && pos.y + imageSize.height <= view.y + view.height

  it('reported case: a crowded view centre still lands the new card on screen', () => {
    const existing = [box('image', Math.round(view.width * 0.38), Math.round(view.height * 0.2))]
    const placed = resolveInsertionPosition('image', { x: Math.round(view.width * 0.38), y: Math.round(view.height * 0.28) }, existing, 6, view)
    expect(inside(placed)).toBe(true)
    expect(existing.some((node) => placed.x < node.position.x + imageSize.width && placed.x + imageSize.width > node.position.x
      && placed.y < node.position.y + imageSize.height && placed.y + imageSize.height > node.position.y)).toBe(false)
  })

  it('class: when the view has no free spot it falls back to the spiral instead of overlapping', () => {
    const full = [box('image', 0, 0, { width: view.width, height: view.height })]
    const placed = resolveInsertionPosition('image', { x: 300, y: 130 }, full, 6, view)
    expect(inside(placed)).toBe(false)
  })

  it('a base outside the view keeps the old spiral behaviour (callers placing next to a source node)', () => {
    expect(resolveInsertionPosition('image', { x: 3000, y: 3000 }, [], 6, view)).toEqual({ x: 3000, y: 3000 })
  })
})

describe('resolveInsertionPosition × 可见区按新节点自己的大小判装不装得下（2026-11-27 图层分离新节点落到原图左边）', () => {
  // 真窗口 1280×800、100%：可见区 1212 宽；原图 340×340 在 (461, 70)；派生节点要贴在它右边 461 + 340 + 64 = 865，
  // 右边缘 865 + 340 = 1205 ≤ 1212，放得下。旧算法拿足迹（+64）判，1269 > 1212 判成放不下，扫到了原图左边。
  const view1280 = { x: 0, y: 0, width: 1212, height: 656 }
  const source1280 = box('image', 461, 70, { width: 340, height: 340 })

  it('1280×800 字面量：右边放得下 → 就落在原图右边那一格（不被足迹余量挤到左边）', () => {
    expect(resolveInsertionPosition('image', { x: 865, y: 70 }, [source1280], 6, view1280, { width: 340, height: 340 })).toEqual({ x: 865, y: 70 })
  })

  it('不给 newSize：按这一种的名义大小判，结果同上（不拿带间距的足迹顶替）', () => {
    expect(resolveInsertionPosition('image', { x: 865, y: 70 }, [source1280], 6, view1280)).toEqual({ x: 865, y: 70 })
  })

  it('间距照旧按足迹：右边空地比卡宽、但离原图不到 64 的那一格不算空位', () => {
    const placed = resolveInsertionPosition('image', { x: 830, y: 70 }, [source1280], 6, view1280, { width: 340, height: 340 })
    const tooClose = placed.x < 461 + 340 + 64 && placed.x + 340 + 64 > 461 && placed.y < 70 + 340 + 64 && placed.y + 340 + 64 > 70
    expect(tooClose).toBe(false)
  })

  it('真放不下（卡比右侧空地宽，别处也没空位）→ 不扫到左边去，留在 base（原图右边，越出可见区那一截由边缘提示说）', () => {
    // 真窗口 700×720、80%：可见区 790×670（画布单位），原图在 (202, 0)；右边、左边、上下都装不下一张 340 的卡。
    const view700 = { x: -79, y: -80, width: 790, height: 670 }
    const source700 = box('image', 202, 0, { width: 340, height: 340 })
    expect(resolveInsertionPosition('image', { x: 606, y: 0 }, [source700], 6, view700, { width: 340, height: 340 })).toEqual({ x: 606, y: 0 })
  })
})

describe('resolveInsertionPosition × 渲染占位（2026-10-18：避让不能只认名义 node.size）', () => {
  const tallImage = (x: number, y: number): NodeBox => ({
    kind: 'image', position: { x, y }, size: { width: 320, height: 180 },
    result: { id: 'r', type: 'image', url: 'nomi-local://asset/p/a.png', createdAt: 1 },
    meta: { imageWidth: 1000, imageHeight: 1778, imageAspectRatio: 1000 / 1778 },
  })

  it('occupiedSize：竖版图按渲染高度占位，比名义高；没有媒体事实的盒子等于名义尺寸', () => {
    expect(occupiedSize(tallImage(0, 0)).height).toBeGreaterThan(180 + 64)
    expect(occupiedSize({ kind: 'image', position: { x: 0, y: 0 }, size: { width: 280, height: 200 } })).toEqual({ width: 280, height: 200 })
  })

  it('已有的竖图：新卡不落进它渲染出来的下半身', () => {
    const tall = tallImage(100, 100)
    const placed = resolveInsertionPosition('image', { x: 100, y: 100 }, [tall])
    const rendered = occupiedSize(tall)
    const overlap = placed.x < 100 + rendered.width && placed.x + imageSize.width > 100 && placed.y < 100 + rendered.height && placed.y + imageSize.height > 100
    expect(overlap).toBe(false)
  })

  it('newSize：新节点比名义大时，用它的真实占位找空位', () => {
    // 已有一张贴在 base 右下的小卡；新节点实际 900 宽，必须整块让开。
    const existing = [box('image', 700, 100)]
    const placed = resolveInsertionPosition('image', { x: 100, y: 100 }, existing, 6, null, { width: 900, height: 200 })
    const overlap = placed.x < 700 + imageSize.width && placed.x + 900 > 700 && placed.y < 100 + imageSize.height && placed.y + 200 > 100
    expect(overlap).toBe(false)
  })

  it('螺旋用尽：落到所有已有节点的下方，不再返回一个没验过的「最后一格」', () => {
    const huge = box('image', -50_000, -50_000, { width: 100_000, height: 100_000 })
    const placed = resolveInsertionPosition('image', { x: 100, y: 100 }, [huge])
    expect(placed.y).toBeGreaterThanOrEqual(-50_000 + 100_000)
    expect(placed.x).toBe(100)
  })

  it('整簇避让同理：螺旋用尽整簇下移到所有节点下方', () => {
    const huge = box('image', -50_000, -50_000, { width: 100_000, height: 100_000 })
    const delta = resolveGroupInsertionDelta([box('image', 100, 100), box('image', 500, 100)], [huge])
    expect(100 + delta.y).toBeGreaterThanOrEqual(-50_000 + 100_000)
    expect(delta.x).toBe(0)
  })
})
