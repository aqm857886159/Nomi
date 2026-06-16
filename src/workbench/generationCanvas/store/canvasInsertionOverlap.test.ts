import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { setClipboard } from './canvasClipboard'
import { DEFAULT_NODE_SIZE } from '../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 卡片对用户可见的「名义」尺寸（registry defaultSize）。落点解算器内部还会外扩 RENDER_SAFETY，
// 名义不重叠是更强保证：解算器外扩盒不压 → 名义盒一定不压。这里只断言用户真正看到的名义盒。
function sizeOf(node: GenerationCanvasNode): { width: number; height: number } {
  return node.size ?? DEFAULT_NODE_SIZE[node.kind] ?? { width: 340, height: 280 }
}

function overlaps(a: GenerationCanvasNode, b: GenerationCanvasNode): boolean {
  const sa = sizeOf(a)
  const sb = sizeOf(b)
  return (
    a.position.x < b.position.x + sb.width &&
    a.position.x + sa.width > b.position.x &&
    a.position.y < b.position.y + sb.height &&
    a.position.y + sa.height > b.position.y
  )
}

// 同分类内任意两张卡是否重叠（跨分类不同屏、不算遮挡）。
function hasOverlapWithinCategory(nodes: GenerationCanvasNode[]): boolean {
  const byCat = new Map<string, GenerationCanvasNode[]>()
  for (const n of nodes) {
    const cat = n.categoryId || 'shots'
    const list = byCat.get(cat) ?? []
    list.push(n)
    byCat.set(cat, list)
  }
  for (const list of byCat.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (overlaps(list[i], list[j])) return true
      }
    }
  }
  return false
}

function resetCanvas(): void {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
}

describe('画布插入避让：所有交互式入口都不让卡片相互遮挡', () => {
  beforeEach(resetCanvas)

  it('addNode：传入与已有卡相同的落点，被挪开不重叠', () => {
    const store = useGenerationCanvasStore.getState()
    store.addNode({ kind: 'image', position: { x: 100, y: 100 }, categoryId: 'shots' })
    store.addNode({ kind: 'image', position: { x: 100, y: 100 }, categoryId: 'shots' })
    expect(hasOverlapWithinCategory(useGenerationCanvasStore.getState().nodes)).toBe(false)
  })

  it('addNode exactPosition：成组紧凑布局信任原值、不被避让推散', () => {
    const store = useGenerationCanvasStore.getState()
    store.addNode({ kind: 'image', position: { x: 100, y: 100 }, categoryId: 'shots' })
    // 切图瓦片式：落点与已有卡重叠，但 exactPosition 要求原地放置（不挪）。
    const tile = store.addNode({ kind: 'image', position: { x: 120, y: 110 }, categoryId: 'shots', exactPosition: true })
    expect(tile.position).toEqual({ x: 120, y: 110 })
  })

  it('addNode：连续多次不传落点，互不重叠', () => {
    const store = useGenerationCanvasStore.getState()
    for (let i = 0; i < 6; i += 1) store.addNode({ kind: 'image', categoryId: 'shots' })
    expect(hasOverlapWithinCategory(useGenerationCanvasStore.getState().nodes)).toBe(false)
  })

  it('定妆式右侧贴卡：右槽被占也不重叠（addNode 总闸覆盖）', () => {
    const store = useGenerationCanvasStore.getState()
    const src = store.addNode({ kind: 'image', position: { x: 0, y: 0 }, categoryId: 'cast' })
    // 模拟 buildFixationNode 的「源右侧 + 64」落点，且该处已被占
    const rightSlot = { x: src.position.x + (src.size?.width || 300) + 64, y: src.position.y }
    store.addNode({ kind: 'image', position: rightSlot, categoryId: 'cast' })
    store.addNode({ kind: 'image', position: rightSlot, categoryId: 'cast' })
    expect(hasOverlapWithinCategory(useGenerationCanvasStore.getState().nodes)).toBe(false)
  })

  it('duplicateNodeForRegeneration：变体不压住原卡', () => {
    const store = useGenerationCanvasStore.getState()
    const src = store.addNode({ kind: 'image', position: { x: 50, y: 50 }, categoryId: 'shots' })
    store.duplicateNodeForRegeneration(src.id)
    expect(hasOverlapWithinCategory(useGenerationCanvasStore.getState().nodes)).toBe(false)
  })

  it('copyNodeToCategory：跨分类副本在目标分类内不重叠', () => {
    const store = useGenerationCanvasStore.getState()
    const src = store.addNode({ kind: 'image', position: { x: 50, y: 50 }, categoryId: 'shots' })
    // 目标分类已有一张卡正好坐在副本默认落点上
    store.addNode({ kind: 'image', position: { x: 50 + 36, y: 50 + 36 }, categoryId: 'scene' })
    store.copyNodeToCategory(src.id, 'scene')
    expect(hasOverlapWithinCategory(useGenerationCanvasStore.getState().nodes)).toBe(false)
  })

  it('paste：整簇粘贴避开已有内容，且保住簇内相对排布', () => {
    const store = useGenerationCanvasStore.getState()
    // 画布已有一张卡，落在粘贴簇 +36 偏移后的落点上
    store.addNode({ kind: 'image', position: { x: 36, y: 36 }, categoryId: 'shots' })
    const a: GenerationCanvasNode = { id: 'clip-a', kind: 'image', title: 'A', prompt: '', categoryId: 'shots', position: { x: 0, y: 0 } }
    const b: GenerationCanvasNode = { id: 'clip-b', kind: 'image', title: 'B', prompt: '', categoryId: 'shots', position: { x: 0, y: 320 } }
    setClipboard({ nodes: [a, b], edges: [] })
    store.pasteNodes()
    const nodes = useGenerationCanvasStore.getState().nodes
    expect(hasOverlapWithinCategory(nodes)).toBe(false)
    // 簇内相对位移保持：两张粘贴卡的 y 差仍是 320（刚体平移，不变形）
    const pa = nodes.find((n) => n.title === 'A 副本')
    const pb = nodes.find((n) => n.title === 'B 副本')
    expect(pa && pb).toBeTruthy()
    if (pa && pb) expect(pb.position.y - pa.position.y).toBe(320)
  })
})
