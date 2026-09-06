import { describe, expect, it } from 'vitest'
import type { ArchetypeMode } from '../../../../config/modelArchetypes/types'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { aspectControlOf, missingRequiredSlots, referencedVisualAnchors } from './shotRowModel'

const shotOf = (over: Partial<PlanShot> = {}): PlanShot => ({
  index: 1,
  durationSec: 5,
  anchorIds: [],
  prompt: 'p',
  ...over,
})

/**
 * 前 carrier 时代的旧持久化方案没有 carrier 字段（持久化再水化不过 zod），
 * 运行时靠 referencedVisualAnchors 的 `?? defaultCarrierForKind(kind)` 分支按 kind 推断。
 * 夹具刻意保持缺省形态来测这条腿，故用断言建模「旧数据以 PlanAnchor 身份进入运行时」。
 */
const legacyAnchor = (anchor: Omit<PlanAnchor, 'carrier'>): PlanAnchor => anchor as PlanAnchor

const ANCHORS: PlanAnchor[] = [
  legacyAnchor({ id: 'a-hero', kind: 'character', name: '林薇', description: '' }), // carrier 缺省 → visual
  legacyAnchor({ id: 'a-style', kind: 'style', name: '全片风格', description: '' }), // carrier 缺省 → text
  { id: 'a-prop', kind: 'prop', name: '怀表', description: '', carrier: 'text' }, // 显式 text
]

const modeOf = (over: Partial<ArchetypeMode> = {}): ArchetypeMode => ({
  id: 'm',
  intent: 'text',
  vendorTerm: 't',
  hint: '',
  slots: [],
  params: [],
  promptRequired: true,
  ...over,
})

describe('shotRowModel — 视觉锚投影', () => {
  it('只计视觉锚（carrier 缺省按 kind 推断；text 锚不占参考槽）', () => {
    const shot = shotOf({ anchorIds: ['a-hero', 'a-style', 'a-prop', 'ghost'] })
    expect(referencedVisualAnchors(shot, ANCHORS).map((a) => a.id)).toEqual(['a-hero'])
  })
})

describe('shotRowModel — 缺必填判定（画面格红态 + 组头计数共用）', () => {
  it('具名帧槽按声明算：没绑定 → 缺；绑上了 → 不缺（曾经是「恒缺、行内永远变不绿」）', () => {
    const mode = modeOf({ slots: [{ kind: 'first_frame', label: '首帧', min: 1, max: 1 }] })
    expect(missingRequiredSlots(mode, shotOf(), ANCHORS).map((s) => s.kind)).toEqual(['first_frame'])
    const bound = shotOf({ referenceBindings: { first_frame: [{ url: 'a.png' }] } })
    expect(missingRequiredSlots(mode, bound, ANCHORS)).toEqual([])
  })

  it('image_ref min≥1 可被引用的视觉锚满足；也可被直接绑定满足；不足才缺', () => {
    const mode = modeOf({ slots: [{ kind: 'image_ref', label: '角色参考', min: 1, max: 9 }] })
    expect(missingRequiredSlots(mode, shotOf(), ANCHORS)).toHaveLength(1)
    expect(missingRequiredSlots(mode, shotOf({ anchorIds: ['a-hero'] }), ANCHORS)).toHaveLength(0)
    expect(missingRequiredSlots(mode, shotOf({ referenceBindings: { image_ref: [{ url: 'a.png' }] } }), ANCHORS)).toHaveLength(0)
    // text 锚不算数
    expect(missingRequiredSlots(mode, shotOf({ anchorIds: ['a-style'] }), ANCHORS)).toHaveLength(1)
  })

  it('视频/音频参考槽 min≥1 时也按绑定数算，不再无条件报缺', () => {
    const mode = modeOf({ slots: [{ kind: 'video_ref', label: '参考视频', min: 2, max: 10 }] })
    expect(missingRequiredSlots(mode, shotOf({ referenceBindings: { video_ref: [{ url: 'v.mp4' }] } }), ANCHORS)).toHaveLength(1)
    expect(missingRequiredSlots(mode, shotOf({ referenceBindings: { video_ref: [{ url: 'v.mp4' }, { url: 'w.mp4' }] } }), ANCHORS)).toHaveLength(0)
  })

  it('min=0 的槽从不缺；无档案（默认模型）无契约可判 → []', () => {
    const mode = modeOf({ slots: [{ kind: 'image_ref', label: '角色参考', min: 0, max: 9 }] })
    expect(missingRequiredSlots(mode, shotOf(), ANCHORS)).toHaveLength(0)
    expect(missingRequiredSlots(null, shotOf(), ANCHORS)).toHaveLength(0)
  })
})

describe('shotRowModel — 画幅控件提取', () => {
  it('取 aspect_ratio select；没有 → null', () => {
    const aspect = { key: 'aspect_ratio', label: '比例', type: 'select' as const, options: [{ value: '16:9', label: '16:9' }] }
    expect(aspectControlOf(modeOf({ params: [aspect] }))).toEqual(aspect)
    expect(aspectControlOf(modeOf())).toBeNull()
    expect(aspectControlOf(null)).toBeNull()
  })
})
