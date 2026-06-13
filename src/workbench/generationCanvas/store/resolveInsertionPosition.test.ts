import { describe, expect, it } from 'vitest'
import { resolveInsertionPosition, type NodeBox } from './resolveInsertionPosition'
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
