import { describe, expect, it } from 'vitest'
import type { ArchetypeMode } from '../../../../config/modelArchetypes/types'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { aspectControlOf, missingRequiredSlots, referencedVisualAnchors, referenceZoneView } from './shotRowModel'

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
  it('具名帧槽 min≥1 → 表层无来源，恒缺', () => {
    const mode = modeOf({ slots: [{ kind: 'first_frame', label: '首帧', min: 1, max: 1 }] })
    expect(missingRequiredSlots(mode, shotOf(), ANCHORS).map((s) => s.kind)).toEqual(['first_frame'])
  })

  it('image_ref min≥1 可被引用的视觉锚满足；不足才缺', () => {
    const mode = modeOf({ slots: [{ kind: 'image_ref', label: '角色参考', min: 1, max: 9 }] })
    expect(missingRequiredSlots(mode, shotOf(), ANCHORS)).toHaveLength(1)
    expect(missingRequiredSlots(mode, shotOf({ anchorIds: ['a-hero'] }), ANCHORS)).toHaveLength(0)
    // text 锚不算数
    expect(missingRequiredSlots(mode, shotOf({ anchorIds: ['a-style'] }), ANCHORS)).toHaveLength(1)
  })

  it('min=0 的槽从不缺；无档案（默认模型）无契约可判 → []', () => {
    const mode = modeOf({ slots: [{ kind: 'image_ref', label: '角色参考', min: 0, max: 9 }] })
    expect(missingRequiredSlots(mode, shotOf(), ANCHORS)).toHaveLength(0)
    expect(missingRequiredSlots(null, shotOf(), ANCHORS)).toHaveLength(0)
  })
})

describe('shotRowModel — 参考区三形态', () => {
  it('slots 为空 → 此模型不吃参考', () => {
    expect(referenceZoneView(modeOf(), shotOf({ anchorIds: ['a-hero'] }), ANCHORS)).toEqual({ kind: 'none-accepted' })
  })

  it('具名帧槽逐格展示；数组槽给「@」入口；引用的视觉锚随行带出', () => {
    const mode = modeOf({
      slots: [
        { kind: 'first_frame', label: '首帧', min: 1, max: 1 },
        { kind: 'last_frame', label: '尾帧', min: 0, max: 1 },
        { kind: 'image_ref', label: '角色参考', min: 0, max: 9 },
      ],
    })
    const view = referenceZoneView(mode, shotOf({ anchorIds: ['a-hero'] }), ANCHORS)
    expect(view).toMatchObject({ kind: 'slots', hasArrayIntake: true })
    if (view.kind === 'slots') {
      expect(view.namedSlots.map((s) => s.kind)).toEqual(['first_frame', 'last_frame'])
      expect(view.referencedAnchors.map((a) => a.id)).toEqual(['a-hero'])
    }
  })

  it('纯具名槽（首尾帧）不给「@」入口', () => {
    const mode = modeOf({
      slots: [
        { kind: 'first_frame', label: '首帧', min: 1, max: 1 },
        { kind: 'last_frame', label: '尾帧', min: 1, max: 1 },
      ],
    })
    const view = referenceZoneView(mode, shotOf(), ANCHORS)
    expect(view).toMatchObject({ kind: 'slots', hasArrayIntake: false })
  })

  it('无档案（默认模型）→ 最宽形态：无具名槽 + 「@」入口 + 已引用锚', () => {
    const view = referenceZoneView(null, shotOf({ anchorIds: ['a-hero'] }), ANCHORS)
    expect(view).toMatchObject({ kind: 'slots', namedSlots: [], hasArrayIntake: true })
    if (view.kind === 'slots') expect(view.referencedAnchors).toHaveLength(1)
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
