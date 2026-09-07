import { describe, expect, it } from 'vitest'
import { SEEDANCE_2_5_ARCHETYPE } from '../../../../../electron/shared/videoCapabilities/seedance25'
import { VEO_3_1_ARCHETYPE } from '../../../../../electron/shared/videoCapabilities/veo31'
import { NANO_BANANA_2_ARCHETYPE } from '../../../../config/modelArchetypes/nanoBanana2'
import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes/types'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { buildArchetypeInputParams } from '../../../generationCanvas/nodes/controls/archetypeMeta'
import { missingRequiredSlots } from './shotRowModel'
import { referenceColumnOf } from './shotReferenceCells'
import {
  appendShotBinding,
  removeShotBinding,
  reorderShotBinding,
  shotReferenceMetaPatch,
  storyboardAssetSlots,
} from './shotReferenceSlots'

/**
 * 分镜行参考槽的**契约测试**：六种真实模式（Seedance t2v/first/firstlast/omni、Veo frame、Nano edit）
 * 逐项对 brief §D5 的槽矩阵。这里刻意用**真档案**而非夹具——夹具能陪着代码一起错，档案不会。
 */

const modeOf = (archetype: ModelArchetype, id: string): ArchetypeMode => {
  const mode = archetype.modes.find((m) => m.id === id)
  if (!mode) throw new Error(`archetype ${archetype.id} has no mode ${id}`)
  return mode
}

const SEEDANCE_T2V = modeOf(SEEDANCE_2_5_ARCHETYPE, 't2v')
const SEEDANCE_FIRST = modeOf(SEEDANCE_2_5_ARCHETYPE, 'first')
const SEEDANCE_FIRSTLAST = modeOf(SEEDANCE_2_5_ARCHETYPE, 'firstlast')
const SEEDANCE_OMNI = modeOf(SEEDANCE_2_5_ARCHETYPE, 'omni')
const VEO_FRAME = modeOf(VEO_3_1_ARCHETYPE, 'frame')
const NANO_EDIT = modeOf(NANO_BANANA_2_ARCHETYPE, 'edit')

const shotOf = (over: Partial<PlanShot> = {}): PlanShot => ({
  index: 1,
  durationSec: 5,
  anchorIds: [],
  prompt: 'p',
  ...over,
})

const bound = (shot: PlanShot, patch: { referenceBindings?: PlanShot['referenceBindings'] }): PlanShot => ({
  ...shot,
  ...patch,
})

describe('storyboardAssetSlots — 按声明逐槽出（不再压成一个匿名 @ 格）', () => {
  it('Seedance 全能参考：三种槽各一个，kind/上限/编号各自独立', () => {
    expect(storyboardAssetSlots(SEEDANCE_OMNI)).toEqual([
      { key: 'image_ref', label: '角色参考', accept: 'image', form: 'array', persistAsEdge: false, numbered: true, max: 30 },
      { key: 'video_ref', label: '参考视频', accept: 'video', form: 'array', persistAsEdge: false, numbered: false, max: 10 },
      { key: 'audio_ref', label: '参考音频', accept: 'audio', form: 'array', persistAsEdge: false, numbered: false, max: 10 },
    ])
  })

  it('Seedance 首尾帧：两个单槽（form=single），都收图', () => {
    expect(storyboardAssetSlots(SEEDANCE_FIRSTLAST).map((s) => [s.key, s.form, s.accept, s.max])).toEqual([
      ['first_frame', 'single', 'image', 1],
      ['last_frame', 'single', 'image', 1],
    ])
  })

  it('Seedance 文生视频：无槽', () => {
    expect(storyboardAssetSlots(SEEDANCE_T2V)).toEqual([])
  })

  it('Veo 首尾帧 / Nano 改图：单槽与数组槽的分界只问 asArray（不是写死的 kind 集合）', () => {
    expect(storyboardAssetSlots(VEO_FRAME).map((s) => [s.key, s.form])).toEqual([
      ['first_frame', 'single'],
      ['last_frame', 'single'],
    ])
    expect(storyboardAssetSlots(NANO_EDIT).map((s) => [s.key, s.form, s.max])).toEqual([['image_ref', 'array', 14]])
  })

  it('每个 mode 的槽 kind 唯一 —— 拿 kind 当持久化键的前提', () => {
    for (const archetype of [SEEDANCE_2_5_ARCHETYPE, VEO_3_1_ARCHETYPE, NANO_BANANA_2_ARCHETYPE]) {
      for (const mode of archetype.modes) {
        const kinds = mode.slots.map((slot) => slot.kind)
        expect(new Set(kinds).size, `${archetype.id}/${mode.id}`).toBe(kinds.length)
      }
    }
  })
})

describe('appendShotBinding — 容量与类型闸', () => {
  const imageSlot = SEEDANCE_OMNI.slots.find((s) => s.kind === 'image_ref')!
  const videoSlot = SEEDANCE_OMNI.slots.find((s) => s.kind === 'video_ref')!
  const firstFrame = SEEDANCE_FIRSTLAST.slots.find((s) => s.kind === 'first_frame')!

  it('视频槽拒图片、图片槽拒视频', () => {
    expect(appendShotBinding(shotOf(), videoSlot, { url: 'a.png' }, 'image')).toEqual({ status: 'wrong-kind', accept: 'video' })
    expect(appendShotBinding(shotOf(), imageSlot, { url: 'a.mp4' }, 'video')).toEqual({ status: 'wrong-kind', accept: 'image' })
    expect(appendShotBinding(shotOf(), imageSlot, { url: 'a.wav' }, 'audio')).toEqual({ status: 'wrong-kind', accept: 'image' })
  })

  it('超上限拒绝，并报出声明的上限', () => {
    const full = shotOf({ referenceBindings: { video_ref: Array.from({ length: 10 }, (_, i) => ({ url: `v${i}.mp4` })) } })
    expect(appendShotBinding(full, videoSlot, { url: 'v10.mp4' }, 'video')).toEqual({ status: 'full', max: 10 })
  })

  it('同 url 重复拒绝；数组槽保序追加', () => {
    const one = appendShotBinding(shotOf(), imageSlot, { url: 'a.png' }, 'image')
    expect(one.status).toBe('added')
    const shot = bound(shotOf(), one.status === 'added' ? one.patch : {})
    expect(appendShotBinding(shot, imageSlot, { url: 'a.png' }, 'image')).toEqual({ status: 'duplicate' })
    const two = appendShotBinding(shot, imageSlot, { url: 'b.png' }, 'image')
    expect(two.status === 'added' && two.patch.referenceBindings?.image_ref?.map((r) => r.url)).toEqual(['a.png', 'b.png'])
  })

  it('单槽是「替换」不是「满了」——首帧就一张，再选一张换掉它', () => {
    const first = appendShotBinding(shotOf(), firstFrame, { url: 'a.png' }, 'image')
    const shot = bound(shotOf(), first.status === 'added' ? first.patch : {})
    const second = appendShotBinding(shot, firstFrame, { url: 'b.png' }, 'image')
    expect(second.status === 'added' && second.patch.referenceBindings?.first_frame?.map((r) => r.url)).toEqual(['b.png'])
  })

  it('未被当前 mode 声明的键原样保留（切模式不删绑定 / 前向兼容）', () => {
    const shot = shotOf({ referenceBindings: { audio_ref: [{ url: 'keep.wav' }], future_slot: [{ url: 'x' }] } })
    const added = appendShotBinding(shot, imageSlot, { url: 'a.png' }, 'image')
    expect(added.status === 'added' && Object.keys(added.patch.referenceBindings ?? {}).sort())
      .toEqual(['audio_ref', 'future_slot', 'image_ref'])
  })
})

describe('removeShotBinding / reorderShotBinding', () => {
  const shot = shotOf({ referenceBindings: { image_ref: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] } })

  it('删指定位置；越界不动', () => {
    expect(removeShotBinding(shot, 'image_ref', 1)?.referenceBindings?.image_ref?.map((r) => r.url)).toEqual(['a', 'c'])
    expect(removeShotBinding(shot, 'image_ref', 9)).toBeNull()
  })

  it('重排改的是发送顺序（characterIndexed 的 ①②③ 是语义不是装饰）', () => {
    expect(reorderShotBinding(shot, 'image_ref', 2, 0)?.referenceBindings?.image_ref?.map((r) => r.url)).toEqual(['c', 'a', 'b'])
    expect(reorderShotBinding(shot, 'image_ref', 1, 1)).toBeNull()
  })
})

describe('missingRequiredSlots — 按声明算，绑定能让它变绿', () => {
  it('Seedance 首尾帧：空 → 两个都缺；填了首帧 → 只剩尾帧；都填 → 不缺', () => {
    expect(missingRequiredSlots(SEEDANCE_FIRSTLAST, shotOf(), []).map((s) => s.kind)).toEqual(['first_frame', 'last_frame'])
    const half = shotOf({ referenceBindings: { first_frame: [{ url: 'a.png' }] } })
    expect(missingRequiredSlots(SEEDANCE_FIRSTLAST, half, []).map((s) => s.kind)).toEqual(['last_frame'])
    const full = shotOf({ referenceBindings: { first_frame: [{ url: 'a.png' }], last_frame: [{ url: 'b.png' }] } })
    expect(missingRequiredSlots(SEEDANCE_FIRSTLAST, full, [])).toEqual([])
  })

  it('Seedance 首帧模式：一个必填槽，绑定后清零', () => {
    expect(missingRequiredSlots(SEEDANCE_FIRST, shotOf(), []).map((s) => s.kind)).toEqual(['first_frame'])
    expect(missingRequiredSlots(SEEDANCE_FIRST, shotOf({ referenceBindings: { first_frame: [{ url: 'a.png' }] } }), []))
      .toEqual([])
  })

  it('Veo 首尾帧：同一 mode 内必填度不同 —— 首帧必填、尾帧可选', () => {
    expect(missingRequiredSlots(VEO_FRAME, shotOf(), []).map((s) => s.kind)).toEqual(['first_frame'])
  })

  it('Seedance 文生视频 / 全能参考：无必填槽，恒不红', () => {
    expect(missingRequiredSlots(SEEDANCE_T2V, shotOf(), [])).toEqual([])
    expect(missingRequiredSlots(SEEDANCE_OMNI, shotOf(), [])).toEqual([])
  })

  it('Nano 改图：image_ref min=1，一条绑定即满足', () => {
    expect(missingRequiredSlots(NANO_EDIT, shotOf(), []).map((s) => s.kind)).toEqual(['image_ref'])
    expect(missingRequiredSlots(NANO_EDIT, shotOf({ referenceBindings: { image_ref: [{ url: 'a.png' }] } }), []))
      .toEqual([])
  })
})

describe('shotReferenceColumn — 三形态（v6：一个槽一个格）', () => {
  it('无槽 → 不吃参考；无档案 → 契约未知；有槽 → 逐槽一格 + 当前绑定', () => {
    // 不吃参考的是**这个模式**，不是这个模型（2026-09-06 用户在打包版上读到「此模型不吃参考」）。
    // 不给档案 = 指不出去处，只说模式名——不编一个不存在的替代模式。
    expect(referenceColumnOf(SEEDANCE_T2V, shotOf().referenceBindings))
      .toEqual({ kind: 'none-accepted', modeLabel: SEEDANCE_T2V.vendorTerm })
    // 给了档案，而这个档案里确实有吃参考的模式 → 把去处和能挂什么一起说清。
    const withArchetype = referenceColumnOf(SEEDANCE_T2V, shotOf().referenceBindings, SEEDANCE_2_5_ARCHETYPE)
    if (withArchetype.kind !== 'none-accepted') throw new Error('t2v 应当是不吃参考那一态')
    expect(withArchetype.switchTo?.modeLabel).toBeTruthy()
    expect(withArchetype.switchTo?.slotLabel).toBeTruthy()
    expect(withArchetype.switchTo?.modeLabel).not.toBe(SEEDANCE_T2V.vendorTerm)
    expect(referenceColumnOf(null, shotOf().referenceBindings)).toEqual({ kind: 'unknown-contract' })
    const column = referenceColumnOf(SEEDANCE_OMNI, shotOf({ referenceBindings: { video_ref: [{ url: 'v.mp4' }] } }).referenceBindings)
    expect(column.kind).toBe('cells')
    if (column.kind === 'cells') {
      expect(column.cells.map((cell) => cell.key)).toEqual(['image_ref', 'video_ref', 'audio_ref'])
      expect(column.cells.map((cell) => cell.bindings.length)).toEqual([0, 1, 0])
    }
  })

  it('已知六种真实档案的槽数都 ≤ 3——参考列「固定单行三格」是按真实数据定的上限，不是拍脑袋', () => {
    for (const mode of [SEEDANCE_T2V, SEEDANCE_FIRST, SEEDANCE_FIRSTLAST, SEEDANCE_OMNI, VEO_FRAME, NANO_EDIT]) {
      expect(mode.slots.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('请求体构造 —— 走档案的 inputKey / asArray，分镜侧零供应商分支', () => {
  const bodyFor = (archetype: ModelArchetype, modeId: string, shot: PlanShot): Record<string, unknown> => {
    const mode = modeOf(archetype, modeId)
    const meta = { archetype: { id: archetype.id, modeId, variantId: '' }, ...shotReferenceMetaPatch(mode, shot) }
    return buildArchetypeInputParams(meta, archetype)
  }

  it('Seedance 首尾帧：两个单槽各发单值（asArray=false）', () => {
    const shot = shotOf({ referenceBindings: { first_frame: [{ url: 'a.png' }], last_frame: [{ url: 'b.png' }] } })
    expect(bodyFor(SEEDANCE_2_5_ARCHETYPE, 'firstlast', shot)).toMatchObject({
      first_frame_url: 'a.png',
      last_frame_url: 'b.png',
    })
  })

  it('Seedance 全能参考：三个数组槽各发各的键，保序', () => {
    const shot = shotOf({
      referenceBindings: {
        image_ref: [{ url: 'i1.png' }, { url: 'i2.png' }],
        video_ref: [{ url: 'v1.mp4' }],
        audio_ref: [{ url: 'a1.wav' }],
      },
    })
    const body = bodyFor(SEEDANCE_2_5_ARCHETYPE, 'omni', shot)
    expect(body.reference_image_urls).toEqual(['i1.png', 'i2.png'])
    expect(body.reference_video_urls).toEqual(['v1.mp4'])
    expect(body.reference_audio_urls).toEqual(['a1.wav'])
  })

  it('Veo 首尾帧：档案声明 combineSlotsInto.flat → 合成有序 image_urls，不发扁平键', () => {
    const shot = shotOf({ referenceBindings: { first_frame: [{ url: 'a.png' }], last_frame: [{ url: 'b.png' }] } })
    const body = bodyFor(VEO_3_1_ARCHETYPE, 'frame', shot)
    expect(body.image_urls).toEqual(['a.png', 'b.png'])
    expect(body.first_frame_url).toBeUndefined()
  })

  it('Nano 改图：inputKey 覆盖 → image_urls 数组', () => {
    const shot = shotOf({ referenceBindings: { image_ref: [{ url: 'a.png' }] } })
    expect(bodyFor(NANO_BANANA_2_ARCHETYPE, 'edit', shot).image_urls).toEqual(['a.png'])
  })

  it('只发当前 mode 声明的槽：切到文生视频后，别的模式的绑定不进请求体', () => {
    const shot = shotOf({ referenceBindings: { first_frame: [{ url: 'a.png' }], image_ref: [{ url: 'i.png' }] } })
    const body = bodyFor(SEEDANCE_2_5_ARCHETYPE, 't2v', shot)
    expect(body.first_frame_url).toBeUndefined()
    expect(body.reference_image_urls).toBeUndefined()
  })

  it('删掉绑定后 meta 写空 —— 不让刚删的首帧还留在节点上被发出去', () => {
    expect(shotReferenceMetaPatch(SEEDANCE_FIRSTLAST, shotOf())).toEqual({ firstFrameUrl: '', lastFrameUrl: '' })
    expect(shotReferenceMetaPatch(SEEDANCE_OMNI, shotOf()))
      .toEqual({ referenceImageUrls: [], referenceVideoUrls: [], referenceAudioUrls: [] })
  })
})
