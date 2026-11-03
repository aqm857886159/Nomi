import { describe, expect, it } from 'vitest'
import { projectShotNode, projectStoryboardDesign } from './storyboardProjection'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import { ASPECT_EXPLICIT_META_KEY } from '../../../generationCanvas/nodes/aspectExplicit'

/**
 * 写回节点这一条路（改了分镜表 → 把行投影进已存在的画布节点）与落画布建节点是
 * **同一个 bug 的两个出口**：两处都曾直接铺 `shot.params`，于是"继承整片默认"的行在这里
 * 同样把画幅丢了——先落画布后改画幅时，节点上永远不会出现那个值。
 * 根因合同：docs/fixes/2026-09-12-storyboard-plan-defaults-passthrough.root-cause.json
 */
const planOf = (aspectRatio?: string): StoryboardPlan => ({
  title: 't',
  anchors: [],
  shots: [
    { index: 1, shotId: 'shot-1', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '镜一' },
    { index: 2, shotId: 'shot-2', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '镜二', params: { aspect_ratio: '16:9' } },
    {
      index: 3,
      shotId: 'shot-3',
      shotKind: 'video',
      durationSec: 5,
      anchorIds: [],
      prompt: '镜三',
      keyframe: { enabled: true, prompt: '首帧' },
    },
  ],
  ...(aspectRatio !== undefined ? { aspectRatio } : {}),
})

const nodeOf = (): GenerationCanvasNode => ({
  id: 'n1',
  kind: 'video',
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  prompt: '',
  meta: {},
} as unknown as GenerationCanvasNode)

const meta = (plan: StoryboardPlan, index: number, part: 'shot' | 'keyframe' = 'shot'): Record<string, unknown> =>
  (projectShotNode(plan, plan.shots[index], nodeOf(), part, new Map()).meta ?? {}) as Record<string, unknown>

describe('projectShotNode · 整片默认写回节点', () => {
  it('继承整片默认的行写回节点时带上整片画幅', () => {
    expect(meta(planOf('9:16'), 0).aspect_ratio).toBe('9:16')
  })

  it('行覆盖赢整片默认', () => {
    expect(meta(planOf('9:16'), 1).aspect_ratio).toBe('16:9')
  })

  it('整片默认未定 → 节点 meta 不冒出一个 aspect_ratio（诚实缺席）', () => {
    expect('aspect_ratio' in meta(planOf(), 0)).toBe(false)
  })

  it('首帧图节点跟着同一个整片画幅走', () => {
    expect(meta(planOf('9:16'), 2, 'keyframe').aspect_ratio).toBe('9:16')
  })

  it('视频镜的 duration 仍照旧写回（resolver 不挤掉它）', () => {
    expect(meta(planOf('9:16'), 0).duration).toBe(5)
  })
})

// 分镜写回把画幅写进已有节点 = 明确选过（与落画布那一处同一条）：连线时视频比例的产品默认（首选 16:9、输入全竖 9:16）不改它。
// 判据是控件语义（写进来的键是这个模式的比例控件），不是键名：Agnes Video 2.5 的 `size` 是清晰度，不是比例。
describe('projectShotNode · 分镜写回的画幅记「明确选过」', () => {
  const onModel = (modelKey: string, modelVendor: string, archetype: { id: string; modeId: string }): GenerationCanvasNode =>
    ({ ...nodeOf(), meta: { modelKey, modelVendor, archetype } } as unknown as GenerationCanvasNode)
  const projected = (plan: StoryboardPlan, index: number, node: GenerationCanvasNode) =>
    (projectShotNode(plan, plan.shots[index], node, 'shot', new Map()).meta ?? {}) as Record<string, unknown>
  const kling = () => onModel('kling-v3', 'apimart', { id: 'kling-3.0', modeId: 't2v' })

  it('继承整片默认的行写回画幅 → 记明确选过', () => {
    const written = projected(planOf('9:16'), 0, kling())
    expect(written.aspect_ratio).toBe('9:16')
    expect(written[ASPECT_EXPLICIT_META_KEY]).toBe(true)
  })

  it('行覆盖的画幅 → 记明确选过', () => {
    const written = projected(planOf('9:16'), 1, kling())
    expect(written.aspect_ratio).toBe('16:9')
    expect(written[ASPECT_EXPLICIT_META_KEY]).toBe(true)
  })

  it('整片没定画幅、行也没写 → 不冒出比例，也不记（连线时照常按输入铺默认）', () => {
    const written = projected(planOf(), 0, kling())
    expect('aspect_ratio' in written).toBe(false)
    expect(written[ASPECT_EXPLICIT_META_KEY]).toBeUndefined()
  })

  it('行只写了清晰度 size: 960P（Agnes Video 2.5 的 size 不是比例）→ 写进去，但不记明确选过', () => {
    const plan = planOf()
    plan.shots[0] = { ...plan.shots[0], params: { size: '960P' } }
    const written = projected(plan, 0, onModel('agnes-video-2.5', 'agnes', { id: 'agnes-video-2.5', modeId: 'text' }))
    expect(written.size).toBe('960P')
    expect(written[ASPECT_EXPLICIT_META_KEY]).toBeUndefined()
  })
})

it('projects saved author edits into existing bound nodes only, retaining canvas overrides', async () => {
  const { useGenerationCanvasStore } = await import('../../../generationCanvas/store/generationCanvasStore')
  const store = useGenerationCanvasStore.getState()
  store.restoreSnapshot({ nodes: [{ id: 'bound', kind: 'video', title: 'Existing', position: { x: 0, y: 0 }, prompt: 'Canvas edit',
    meta: { storyboardDesignId: 'run', shotId: 'shot-1', overriddenFields: ['prompt'] } }], edges: [], groups: [] })
  projectStoryboardDesign({ id: 'run', plan: planOf('9:16') }, useGenerationCanvasStore.getState())
  const nodes = useGenerationCanvasStore.getState().nodes
  expect(nodes).toHaveLength(1)
  expect(nodes[0].id).toBe('bound')
  expect(nodes[0].prompt).toBe('Canvas edit')
  expect(nodes[0].meta?.aspect_ratio).toBe('9:16')
})

it('disabled keyframe drafts never project into a stored keyframe node', () => {
  const plan = planOf('9:16')
  plan.shots[2].keyframe = { enabled: false, prompt: 'retained', modelKey: 'old-image-model', params: { aspect_ratio: '1:1' } }
  expect(projectShotNode(plan, plan.shots[2], nodeOf(), 'keyframe', new Map())).toEqual({})
  expect(plan.shots[2].keyframe.prompt).toBe('retained')
})
