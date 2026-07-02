import { beforeEach, describe, expect, it } from 'vitest'
import { convertImageShotToVideo } from './convertShotToVideo'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { isShotNumberedNode } from '../model/shotNumbering'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'

beforeEach(() => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
})

function seedImageShot() {
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({ kind: 'image', title: '镜头 3', prompt: '静态画面', categoryId: 'shots' })
  // 模拟真实场景：这是第 3 号镜头（前面还有别的镜头占了 1/2）。
  useGenerationCanvasStore.getState().updateNode(node.id, {
    shotIndex: 3,
    result: { id: 'r1', type: 'image', url: 'nomi-local://fake.png' },
  })
  return useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)!
}

describe('convertImageShotToVideo（image-first 桥）', () => {
  it('建派生视频节点：继承镜号 + first_frame 边 + sourceNodeId 指回源图', () => {
    const image = seedImageShot()
    const { nodeId, existed } = convertImageShotToVideo(image)
    expect(existed).toBe(false)
    const state = useGenerationCanvasStore.getState()
    const video = state.nodes.find((n) => n.id === nodeId)!
    expect(video.kind).toBe('video')
    expect(video.shotIndex).toBe(3) // 继承源图镜号（同镜两阶段，排片落剧本位置）
    expect(video.meta?.sourceNodeId).toBe(image.id) // 整理布局紧跟源镜头
    expect(video.title).toBe('镜头 3 · 视频')
    expect(state.edges.some((e) => e.source === image.id && e.target === nodeId && e.mode === 'first_frame')).toBe(true)
  })

  it('幂等：已转过 → 返回已有视频节点，不重复建', () => {
    const image = seedImageShot()
    const first = convertImageShotToVideo(image)
    const again = convertImageShotToVideo(
      useGenerationCanvasStore.getState().nodes.find((n) => n.id === image.id)!,
    )
    expect(again.existed).toBe(true)
    expect(again.nodeId).toBe(first.nodeId)
    const videos = useGenerationCanvasStore.getState().nodes.filter((n) => n.kind === 'video')
    expect(videos).toHaveLength(1)
  })
})

describe('参考卡不占镜号（meta.referenceSheet，R13 走查抓出的编号错位）', () => {
  it('meta.referenceSheet=true 的 image 节点在 shots 分类不参与编号', () => {
    expect(isShotNumberedNode({ kind: 'image', categoryId: 'shots', meta: { referenceSheet: true } })).toBe(false)
    expect(isShotNumberedNode({ kind: 'image', categoryId: 'shots' })).toBe(true)
    expect(isShotNumberedNode({ kind: 'image', categoryId: 'shots', meta: {} })).toBe(true)
  })

  it('addNode 带 referenceSheet meta → 不分配 shotIndex；镜头节点照常从 1 编起', () => {
    const store = useGenerationCanvasStore.getState()
    const propCard = store.addNode({ kind: 'image', title: '道具卡', categoryId: 'shots', meta: { referenceSheet: true } })
    const shot1 = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: '镜头 1', categoryId: 'shots' })
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((n) => n.id === propCard.id)?.shotIndex).toBeUndefined()
    expect(state.nodes.find((n) => n.id === shot1.id)?.shotIndex).toBe(1) // 道具卡没吃掉 1 号
  })
})
