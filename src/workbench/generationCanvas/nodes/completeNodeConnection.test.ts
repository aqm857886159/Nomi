import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { completeNodeConnection } from './completeNodeConnection'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 捷径 B 集成测试（真 store + 真 orchestrator + 真路由，不 mock）。
// 地基收口（audit 2026-06-16 §1d）：**所有参考连线一律建有序持久边**——含数组参考槽（omni 角色参考）。
// 旧的 meta-only 写入 referenceImageUrls + cancelConnection 早退 + 权宜 toast 已删（P1）。

function imageNode(id: string, url?: string): GenerationCanvasNode {
  return {
    id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt: '',
    ...(url ? { result: { id: `${id}-r`, url } } : {}),
  } as GenerationCanvasNode
}
function textNode(id: string, text = ''): GenerationCanvasNode {
  return {
    id,
    kind: 'text',
    title: id,
    position: { x: 0, y: 0 },
    prompt: '',
    contentJson: { type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [] },
  } as GenerationCanvasNode
}
function omniVideoNode(id: string): GenerationCanvasNode {
  return {
    id, kind: 'video', title: id, position: { x: 400, y: 0 }, prompt: '',
    meta: { modelKey: 'seedance-2', archetype: { id: 'seedance-2', modeId: 'omni' } },
  } as GenerationCanvasNode
}
function plainVideoNode(id: string): GenerationCanvasNode {
  return { id, kind: 'video', title: id, position: { x: 400, y: 0 }, prompt: '', meta: {} } as GenerationCanvasNode
}

function seed(nodes: GenerationCanvasNode[]) {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], selectedNodeIds: [], groups: [] })
}
const refImages = (id: string) =>
  (useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.meta?.referenceImageUrls as string[] | undefined)
const edgesTo = (id: string) => useGenerationCanvasStore.getState().edges.filter((e) => e.target === id)

beforeEach(() => seed([]))

describe('completeNodeConnection — 捷径 B（地基收口：数组参考也建有序边）', () => {
  it('image source(有结果) → omni target：建有序 character_ref 边(order 0)，不写 meta-only，不弹 toast', () => {
    seed([imageNode('src', 'https://cdn/x.png'), omniVideoNode('dst')])
    useGenerationCanvasStore.getState().startConnection('src')
    completeNodeConnection('dst')
    const edges = edgesTo('dst')
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'src', target: 'dst', mode: 'character_ref', order: 0 })
    expect(refImages('dst')).toBeUndefined() // 不再写 meta-only
    expect(useGenerationCanvasStore.getState().pendingConnectionSourceId).toBe('')
  })

  it('N 张图连 omni target → N 条 character_ref 边、order 递增(0,1,2)保 character1..N', () => {
    seed([
      imageNode('a', 'https://cdn/a.png'),
      imageNode('b', 'https://cdn/b.png'),
      imageNode('c', 'https://cdn/c.png'),
      omniVideoNode('dst'),
    ])
    const store = useGenerationCanvasStore.getState()
    for (const src of ['a', 'b', 'c']) { store.startConnection(src); completeNodeConnection('dst') }
    const edges = edgesTo('dst')
    expect(edges.map((e) => [e.source, e.order])).toEqual([['a', 0], ['b', 1], ['c', 2]])
    expect(edges.every((e) => e.mode === 'character_ref')).toBe(true)
  })

  it('普通 video target(无档案) → 回退首帧边（单帧 i2v 行为不变）', () => {
    seed([imageNode('src', 'https://cdn/x.png'), plainVideoNode('dst')])
    useGenerationCanvasStore.getState().startConnection('src')
    completeNodeConnection('dst')
    const edges = edgesTo('dst')
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'src', target: 'dst', mode: 'first_frame', order: 0 })
    expect(refImages('dst')).toBeUndefined()
  })

  it('source 还没生成(无结果 URL) → 仍建边（按能力校验通过，槽显示「已连接·待生成」），清 pending', () => {
    // 收口后：边语义按 kind（image 可作参考）校验，与「源是否已出图」解耦——边先建，
    // resolveReferenceSlots 显示为 pending-generation（不再「连线没用」）。
    seed([imageNode('src'), omniVideoNode('dst')])
    useGenerationCanvasStore.getState().startConnection('src')
    completeNodeConnection('dst')
    expect(edgesTo('dst')).toMatchObject([{ source: 'src', target: 'dst', mode: 'character_ref' }])
    expect(refImages('dst')).toBeUndefined()
    expect(useGenerationCanvasStore.getState().pendingConnectionSourceId).toBe('')
  })

  it('text source → image target：建 prompt 上下文边，不要求文本有参考结果', () => {
    seed([textNode('txt', '画面说明'), imageNode('dst')])
    useGenerationCanvasStore.getState().startConnection('txt')
    completeNodeConnection('dst')
    expect(edgesTo('dst')).toMatchObject([{ source: 'txt', target: 'dst', mode: 'reference' }])
    expect(useGenerationCanvasStore.getState().pendingConnectionSourceId).toBe('')
  })

  it('同一 source 连两次 → connectNodes 去重(同 source+target+mode)，只一条边', () => {
    seed([imageNode('src', 'https://cdn/x.png'), omniVideoNode('dst')])
    const store = useGenerationCanvasStore.getState()
    store.startConnection('src'); completeNodeConnection('dst')
    store.startConnection('src'); completeNodeConnection('dst')
    expect(edgesTo('dst')).toHaveLength(1)
  })
})
