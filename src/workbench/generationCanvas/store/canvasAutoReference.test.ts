import { beforeEach, describe, expect, it } from 'vitest'
import { encodeMention } from '../../assets/promptMentions'
import { applyCanvasAutoReference, planCanvasAutoReference } from './canvasAutoReference'
import { useGenerationCanvasStore } from './generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { GENERATION_NODE_KINDS, generationNodeDefaultTitles, getGenerationNodeDefaultTitle } from '../model/generationNodeKinds'
import { SUPPORTED_LOCALES } from '../../../i18n'

/**
 * 画布侧自动引用调用方：与分镜同一个 owner（insertAutoMentions），绑定走手动 @ 同一条路（真边 + 能力闸 + 落槽判据）。
 * 2026-10-05 用户：「画布里面我们也可以自动引用呀」。
 */
const URL = 'nomi-local://asset/xiaozhang.png'

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
    const plans = planCanvasAutoReference([source(), target()], [], 'src')
    expect(plans).toHaveLength(1)
    expect(plans[0].prompt).toBe(`小张${encodeMention(URL)}在雨里奔跑，镜头跟拍`)
    expect(plans[0].autoReferenced).toEqual(['src'])
  })

  it('当前模式收不了参考图（文生视频）→ 与手动 @ 一样切到能收的模式', () => {
    const t2v = target({ meta: { modelKey: 'seedance-2-5', modelVendor: 'kie', archetype: { id: 'seedance-2.5', modeId: 't2v' } } })
    const plans = planCanvasAutoReference([source(), t2v], [], 'src')
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
    for (const over of cases) expect(planCanvasAutoReference([source(), target(over)], [], 'src')).toEqual([])
  })

  it('标题太短或是系统默认标题 → 不当名字用', () => {
    expect(planCanvasAutoReference([source({ title: '张' }), target({ prompt: '张三在跑' })], [], 'src')).toEqual([])
    expect(planCanvasAutoReference([source({ title: '参考图片' }), target({ prompt: '按参考图片里的样子' })], [], 'src')).toEqual([])
  })

  /**
   * 2026-10-06 独立验收 V-1042：没改名的图片节点标题是「图片」，出图后把「让这张图片动起来」改成「让这张图片@动起来」，
   * 一张无关的图进了付费请求。清单从建节点用的同一个函数取（全部节点类型 × 全部界面语言），不手抄。
   */
  describe('普查：每一种节点类型的默认标题（中英）都不当名字', () => {
    const titles = [...new Set(SUPPORTED_LOCALES.flatMap((lng) => GENERATION_NODE_KINDS.map((kind) => getGenerationNodeDefaultTitle(kind, lng).trim())))]
      .filter((title) => title.length >= 2)
    it('清单不是空的，且都在 generationNodeDefaultTitles 里', () => {
      expect(titles.length).toBeGreaterThan(GENERATION_NODE_KINDS.length)
      for (const title of titles) expect(generationNodeDefaultTitles().has(title), title).toBe(true)
    })
    for (const title of titles) {
      it(`「${title}」`, () => {
        expect(planCanvasAutoReference([source({ title }), target({ prompt: `让这张${title}动起来` })], [], 'src')).toEqual([])
      })
    }
    it('对照：同一句话里换成用户起的名字就会补（这条普查不是空转）', () => {
      expect(planCanvasAutoReference([source({ title: '小张' }), target({ prompt: '让这张小张动起来' })], [], 'src')).toHaveLength(1)
    })
  })

  it('真建节点不改名（工厂给的默认标题）出图 → 不补', () => {
    const created = useGenerationCanvasStore.getState()
    created.restoreSnapshot({ nodes: [target({ prompt: `让这张${getGenerationNodeDefaultTitle('image')}动起来` })], edges: [], groups: [] })
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', categoryId: 'shots' })
    const state = useGenerationCanvasStore.getState()
    const withResult = state.nodes.map((candidate) => candidate.id === node.id ? { ...candidate, status: 'success', result: { id: 'r', type: 'image', url: URL, createdAt: 1 } } as GenerationCanvasNode : candidate)
    expect(planCanvasAutoReference(withResult, [], node.id)).toEqual([])
  })

  /** 名字互为前缀：「小张」出图、「小张三」不管出没出图，「小张三走进巷子」都不能变成「小张@三…」。 */
  describe('前缀名字 × 出图状态', () => {
    const XIAOZHANG3 = 'nomi-local://asset/xiaozhang3.png'
    for (const longerDone of [false, true]) {
      it(`「小张」出图、「小张三」${longerDone ? '已' : '未'}出图 → 「小张三走进巷子」不补「小张」`, () => {
        const longer = source({ id: 'src3', title: '小张三', ...(longerDone ? {} : { result: undefined, status: 'idle' }) } as Partial<GenerationCanvasNode>)
        if (longerDone) (longer as { result: unknown }).result = { id: 'r3', type: 'image', url: XIAOZHANG3, createdAt: 1 }
        const plans = planCanvasAutoReference([source(), longer, target({ prompt: '小张三走进巷子' })], [], 'src')
        expect(plans).toEqual([])
      })
    }
    it('「小张三」出图 → 补在「小张三」后面（不是「小张」后面）', () => {
      const longer = source({ id: 'src3', title: '小张三', result: { id: 'r3', type: 'image', url: XIAOZHANG3, createdAt: 1 } } as Partial<GenerationCanvasNode>)
      const plans = planCanvasAutoReference([source(), longer, target({ prompt: '小张三走进巷子' })], [], 'src3')
      expect(plans[0]?.prompt).toBe(`小张三${encodeMention(XIAOZHANG3)}走进巷子`)
    })
  })

  it('名字不在提示词里 → 不往末尾塞', () => {
    expect(planCanvasAutoReference([source(), target({ prompt: '她在雨里奔跑' })], [], 'src')).toEqual([])
  })
})

describe('applyCanvasAutoReference', () => {
  beforeEach(() => {
    useGenerationCanvasStore.setState({ nodes: [source(), target()], edges: [], selectedNodeIds: [] })
  })

  it('写进画布：建一条 src → tgt 的参考边、提示词补 @、账本记来源节点；再触发一次不重复', () => {
    applyCanvasAutoReference('src')
    const state = useGenerationCanvasStore.getState()
    expect(state.edges.filter((edge) => edge.source === 'src' && edge.target === 'tgt')).toHaveLength(1)
    const node = state.nodes.find((candidate) => candidate.id === 'tgt')!
    expect(node.prompt).toBe(`小张${encodeMention(URL)}在雨里奔跑，镜头跟拍`)
    expect((node.meta as Record<string, unknown>).autoReferenced).toEqual(['src'])
    applyCanvasAutoReference('src')
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(1)
  })
})
