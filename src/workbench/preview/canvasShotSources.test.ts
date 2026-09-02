import { describe, it, expect } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import {
  __resetStableCanvasNodesCacheForTests,
  selectStableCanvasNodes,
} from '../generationCanvas/store/canvasNodeProjection'
import {
  __resetCanvasShotSourcesCacheForTests,
  selectCanvasShotSources,
  selectCanvasShotSourcesFromStore,
} from './canvasShotSources'

// 剪辑页左栏「镜头」的数据口径锁：
// ① 只收已出片（result.url）的图/视频；② 镜号读 shotIndex 存储身份，不按位置自造；
// ③ 参考卡/首帧图不占号但仍可入轨；④ 有号在前按号排，无号按画布位置稳定排。

function node(partial: Partial<GenerationCanvasNode> & { id: string }): GenerationCanvasNode {
  return {
    kind: 'video',
    title: partial.id,
    position: { x: 0, y: 0 },
    categoryId: 'shots',
    ...partial,
  } as GenerationCanvasNode
}

const withResult = (id: string, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode =>
  node({ id, result: { id: `r-${id}`, type: 'video', url: `nomi-local://asset/p/${id}.mp4`, createdAt: 0 }, ...extra })

describe('selectCanvasShotSources', () => {
  it('只收有产物 url 的图/视频节点', () => {
    const nodes = [
      withResult('a', { shotIndex: 1 }),
      node({ id: 'no-result', shotIndex: 2 }),
      node({ id: 'empty-url', shotIndex: 3, result: { id: 'r', type: 'video', url: '   ', createdAt: 0 } }),
      node({ id: 'text', kind: 'text', shotIndex: 4, result: { id: 'r', type: 'text', text: 'hi', createdAt: 0 } }),
      node({ id: 'audio', kind: 'audio', result: { id: 'r', type: 'audio', url: 'a.mp3', createdAt: 0 } }),
    ]
    expect(selectCanvasShotSources(nodes).map((s) => s.nodeId)).toEqual(['a'])
  })

  it('镜号读 shotIndex 存储身份，按号升序（不按画布位置重排）', () => {
    const nodes = [
      withResult('third', { shotIndex: 3, position: { x: 0, y: 0 } }),
      withResult('first', { shotIndex: 1, position: { x: 0, y: 900 } }),
      withResult('second', { shotIndex: 2, position: { x: 0, y: 400 } }),
    ]
    const sources = selectCanvasShotSources(nodes)
    expect(sources.map((s) => s.shotIndex)).toEqual([1, 2, 3])
    expect(sources.map((s) => s.nodeId)).toEqual(['first', 'second', 'third'])
  })

  it('参考卡与首帧图不占镜号，但仍列出可入轨', () => {
    const nodes = [
      withResult('ref', { kind: 'image', meta: { referenceSheet: true } }),
      withResult('keyframe', { kind: 'image', meta: { storyboardKeyframe: true } }),
      withResult('shot', { shotIndex: 1 }),
    ]
    const sources = selectCanvasShotSources(nodes)
    expect(sources).toHaveLength(3)
    expect(sources[0]).toMatchObject({ nodeId: 'shot', shotIndex: 1 })
    expect(sources.filter((s) => s.shotIndex === null).map((s) => s.nodeId).sort()).toEqual(['keyframe', 'ref'])
  })

  it('无号的按画布位置（y 后 x）稳定排在有号之后', () => {
    const nodes = [
      withResult('low', { categoryId: 'assets', position: { x: 10, y: 500 } }),
      withResult('high', { categoryId: 'assets', position: { x: 10, y: 100 } }),
      withResult('numbered', { shotIndex: 7 }),
    ]
    expect(selectCanvasShotSources(nodes).map((s) => s.nodeId)).toEqual(['numbered', 'high', 'low'])
  })

  it('空画布返回空数组（左栏据此出空态）', () => {
    expect(selectCanvasShotSources([])).toEqual([])
  })

  it('带出封面与媒体类型供格子渲染', () => {
    const nodes = [
      withResult('v', { shotIndex: 1, result: { id: 'r', type: 'video', url: 'v.mp4', thumbnailUrl: 'cover.jpg', createdAt: 0 } }),
      withResult('i', { kind: 'image', shotIndex: 2, result: { id: 'r2', type: 'image', url: 'i.png', createdAt: 0 } }),
    ]
    const sources = selectCanvasShotSources(nodes)
    expect(sources[0]).toMatchObject({ mediaType: 'video', thumbnailUrl: 'cover.jpg', url: 'v.mp4' })
    expect(sources[1]).toMatchObject({ mediaType: 'image', thumbnailUrl: '', url: 'i.png' })
  })
})

// F1 回归（S3 REJECT 修复）：PreviewSourcePanel 曾把「位置无关投影」(selectStableCanvasNodes)
// 喂给「按 node.position.y/x 排序」的 selectCanvasShotSources。投影对 position-only 变更复用旧
// 节点引用 → 无号镜头（参考卡/首帧图/非分镜分类产物）拖动重排后，镜头栏顺序停留旧位置。
// 根因边界（P2）：读 position 的消费者不许喂位置无关投影。下面用真 store 的 moveNode 复刻拖动，
// 证明「投影 → 排序」这条路会冻结顺序（红），而「读真节点 → 排序」反映新位置（绿）。
describe('F1 · 剪辑页镜头栏顺序必须反映拖动后的真实位置', () => {
  const shotNode = (id: string, y: number): GenerationCanvasNode => ({
    id,
    kind: 'image',
    title: id,
    position: { x: 0, y },
    categoryId: 'assets', // 非分镜分类 → 不领镜号 → 走 position 排序分支（F1 命中面）
    result: { id: `r-${id}`, type: 'image', url: `nomi-local://asset/p/${id}.png`, createdAt: 0 },
  })

  it('拖动无号镜头交换上下位置后，镜头栏顺序跟着变（不被投影冻住）', () => {
    __resetStableCanvasNodesCacheForTests()
    __resetCanvasShotSourcesCacheForTests()
    // 初始：top(y=0) 在 bottom(y=500) 之上。
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [shotNode('top', 0), shotNode('bottom', 500)],
      edges: [],
      groups: [],
    })

    // 复刻 REJECT 前的错误接法：位置无关投影 → 位置排序。面板先在拖动前渲染一次（投影记下
    // 旧位置），拖动中再取一次——投影复用旧引用把顺序冻死。这一步是原真机 bug 的忠实复现。
    const projectedBefore = selectCanvasShotSources(
      selectStableCanvasNodes(useGenerationCanvasStore.getState()),
    ).map((source) => source.nodeId)
    expect(projectedBefore).toEqual(['top', 'bottom'])
    // 拖动 'top' 到 'bottom' 下方（y: 0 → 900），完全复刻 onNodeDrag → moveNode 的写路径。
    useGenerationCanvasStore.getState().moveNode('top', { x: 0, y: 900 }, { persist: false, emit: false })
    const projectedAfter = selectCanvasShotSources(
      selectStableCanvasNodes(useGenerationCanvasStore.getState()),
    ).map((source) => source.nodeId)
    // 证明「投影 → 排序」这条路确实是坏的（冻在 ['top','bottom']）——防回归到旧接法。
    expect(projectedAfter).toEqual(['top', 'bottom'])

    // 正解：面板改订读真节点的 store selector。同一次拖动后，顺序反映新位置。
    const orderAfter = selectCanvasShotSourcesFromStore(useGenerationCanvasStore.getState()).map(
      (source) => source.nodeId,
    )
    expect(orderAfter).toEqual(['bottom', 'top'])
  })

  it('位置无关的拖动帧不给面板发新引用（保住 S3 画布外零重渲）', () => {
    __resetCanvasShotSourcesCacheForTests()
    // 全是有号镜头 → 顺序只由 shotIndex 决定，与位置无关。
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { ...shotNode('s1', 0), categoryId: 'shots', shotIndex: 1 },
        { ...shotNode('s2', 100), categoryId: 'shots', shotIndex: 2 },
      ],
      edges: [],
      groups: [],
    })
    const before = selectCanvasShotSourcesFromStore(useGenerationCanvasStore.getState())
    // 拖动 s1（immer 换 nodes 顶层引用），但可见列表（id/号/封面/url）一字未变。
    useGenerationCanvasStore.getState().moveNode('s1', { x: 0, y: 700 }, { persist: false, emit: false })
    const after = selectCanvasShotSourcesFromStore(useGenerationCanvasStore.getState())
    // 输出稳定：同一引用 → Zustand Object.is 短路订阅 → 面板不重渲。
    expect(after).toBe(before)
  })

  it('真发生重排时发新引用（面板据此重渲反映新顺序）', () => {
    __resetCanvasShotSourcesCacheForTests()
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [shotNode('top', 0), shotNode('bottom', 500)],
      edges: [],
      groups: [],
    })
    const before = selectCanvasShotSourcesFromStore(useGenerationCanvasStore.getState())
    useGenerationCanvasStore.getState().moveNode('top', { x: 0, y: 900 }, { persist: false, emit: false })
    const after = selectCanvasShotSourcesFromStore(useGenerationCanvasStore.getState())
    expect(after).not.toBe(before)
    expect(after.map((source) => source.nodeId)).toEqual(['bottom', 'top'])
  })
})
