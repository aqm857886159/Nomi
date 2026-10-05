import { beforeEach, describe, expect, it } from 'vitest'
import { encodeMention } from '../assets/promptMentions'
import { applyCanvasAutoReference, planCanvasAutoReference } from './canvasAutoReference'
import { useGenerationCanvasStore } from './store/generationCanvasStore'
import type { GenerationCanvasNode } from './model/generationCanvasTypes'

/**
 * 画布侧自动引用调用方：与分镜同一个 owner（insertAutoMentions），绑定走手动 @ 同一条路（真边 + 能力闸 + 落槽判据）。
 * 2026-10-05 用户：「画布里面我们也可以自动引用呀」。
 */
const URL = 'nomi-local://asset/xiaozhang.png'
const IGNORED = new Set(['参考图片', 'Reference image'])

function source(over: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id: 'src', kind: 'image', title: '小张', categoryId: 'shots', position: { x: 0, y: 0 }, status: 'success',
    result: { id: 'r1', type: 'image', url: URL, createdAt: 1 }, ...over,
  } as GenerationCanvasNode
}

function target(over: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id: 'tgt', kind: 'video', title: '镜头', categoryId: 'shots', position: { x: 400, y: 0 }, status: 'idle',
    prompt: '小张在雨里奔跑，镜头跟拍',
    meta: { modelKey: 'seedance-2-5', modelVendor: 'kie', archetype: { id: 'seedance-2.5', modeId: 'omni' } },
    ...over,
  } as GenerationCanvasNode
}

describe('planCanvasAutoReference', () => {
  it('提示词里写了出图节点的标题 → 标题后面补 @，走参考边', () => {
    const plans = planCanvasAutoReference([source(), target()], [], 'src', IGNORED)
    expect(plans).toHaveLength(1)
    expect(plans[0].prompt).toBe(`小张${encodeMention(URL)}在雨里奔跑，镜头跟拍`)
    expect(plans[0].autoReferenced).toEqual(['src'])
  })

  it('当前模式收不了参考图（文生视频）→ 与手动 @ 一样切到能收的模式', () => {
    const t2v = target({ meta: { modelKey: 'seedance-2-5', modelVendor: 'kie', archetype: { id: 'seedance-2.5', modeId: 't2v' } } })
    const plans = planCanvasAutoReference([source(), t2v], [], 'src', IGNORED)
    expect(plans[0]?.switchToModeId).toBe('omni')
  })

  it('不碰：已出图的节点、在跑的节点、分镜方案落出来的节点、别的分区、账本里补过的', () => {
    const cases: Partial<GenerationCanvasNode>[] = [
      { result: { id: 'x', type: 'video', url: 'nomi-local://asset/x.mp4', createdAt: 1 } } as Partial<GenerationCanvasNode>,
      { status: 'running' },
      { meta: { storyboardDesignId: 'd1', modelKey: 'seedance-2-5', modelVendor: 'kie' } },
      { categoryId: 'other' } as Partial<GenerationCanvasNode>,
      { meta: { modelKey: 'seedance-2-5', modelVendor: 'kie', archetype: { id: 'seedance-2.5', modeId: 'omni' }, autoReferenced: ['src'] } },
    ]
    for (const over of cases) expect(planCanvasAutoReference([source(), target(over)], [], 'src', IGNORED)).toEqual([])
  })

  it('标题太短或是系统默认标题 → 不当名字用', () => {
    expect(planCanvasAutoReference([source({ title: '张' }), target({ prompt: '张三在跑' })], [], 'src', IGNORED)).toEqual([])
    expect(planCanvasAutoReference([source({ title: '参考图片' }), target({ prompt: '按参考图片里的样子' })], [], 'src', IGNORED)).toEqual([])
  })

  it('名字不在提示词里 → 不往末尾塞', () => {
    expect(planCanvasAutoReference([source(), target({ prompt: '她在雨里奔跑' })], [], 'src', IGNORED)).toEqual([])
  })
})

describe('applyCanvasAutoReference', () => {
  beforeEach(() => {
    useGenerationCanvasStore.setState({ nodes: [source(), target()], edges: [], selectedNodeIds: [] })
  })

  it('写进画布：建一条 src → tgt 的参考边、提示词补 @、账本记来源节点；再触发一次不重复', () => {
    applyCanvasAutoReference('src', IGNORED)
    const state = useGenerationCanvasStore.getState()
    expect(state.edges.filter((edge) => edge.source === 'src' && edge.target === 'tgt')).toHaveLength(1)
    const node = state.nodes.find((candidate) => candidate.id === 'tgt')!
    expect(node.prompt).toBe(`小张${encodeMention(URL)}在雨里奔跑，镜头跟拍`)
    expect((node.meta as Record<string, unknown>).autoReferenced).toEqual(['src'])
    applyCanvasAutoReference('src', IGNORED)
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(1)
  })
})
