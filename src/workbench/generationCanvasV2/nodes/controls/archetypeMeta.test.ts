import { describe, it, expect } from 'vitest'
import { getArchetypeById } from '../../../../config/modelArchetypes'
import { archetypeModeModelEnum } from './archetypeMeta'
import {
  applyArchetypeModeSwitch,
  archetypeModeArraySlots,
  archetypeModeChoices,
  archetypeModeSlots,
  buildArchetypeInputParams,
  currentArchetypeMode,
  ensureArchetypeNodeMeta,
  modeHasCharacterSlot,
} from './archetypeMeta'

// C2b：模式分段切换 + 命名空间 meta + flat 帧键投影（M2 互斥）的核心逻辑钉死。
// 关键不变量：当前 flat 帧键**只反映当前模式**（切到首帧 → lastFrameUrl 必清空），切回还原。

const SEEDANCE = getArchetypeById('seedance-2')!

describe('archetype 档案 — Seedance 模式', () => {
  it('档案有 首帧 / 首尾帧 / 全能参考 三模式（C3），分段标签用 vendor 真名（决策 #2）', () => {
    expect(SEEDANCE.modes.map((m) => m.id)).toEqual(['first', 'firstlast', 'omni'])
    // omni 显示「全能参考」而非「角色参考」——不把多模态能力说窄。
    expect(archetypeModeChoices(SEEDANCE)).toEqual([
      { id: 'first', vendorTerm: '首帧', hint: '单张首帧图驱动生成' },
      { id: 'firstlast', vendorTerm: '首尾帧', hint: '首帧 + 尾帧，过渡更可控' },
      { id: 'omni', vendorTerm: '全能参考', hint: '多模态参考；最多 9 角色 / 3 视频 / 3 音频' },
    ])
  })

  it('首尾帧模式声明 first_frame + last_frame 两槽', () => {
    const firstlast = SEEDANCE.modes.find((m) => m.id === 'firstlast')!
    expect(firstlast.slots).toEqual([
      { kind: 'first_frame', label: '首帧', min: 1, max: 1 },
      { kind: 'last_frame', label: '尾帧', min: 1, max: 1 },
    ])
  })

})

describe('archetypeModeSlots — 槽位映射到现有 flat 传输键', () => {
  it('首帧 → 仅 firstFrameUrl 槽', () => {
    const first = SEEDANCE.modes.find((m) => m.id === 'first')!
    expect(archetypeModeSlots(first)).toEqual([{ key: 'firstFrameUrl', label: '首帧', group: 'first_frame' }])
  })
  it('首尾帧 → firstFrameUrl + lastFrameUrl 两槽', () => {
    const firstlast = SEEDANCE.modes.find((m) => m.id === 'firstlast')!
    expect(archetypeModeSlots(firstlast)).toEqual([
      { key: 'firstFrameUrl', label: '首帧', group: 'first_frame' },
      { key: 'lastFrameUrl', label: '尾帧', group: 'last_frame' },
    ])
  })
})

describe('currentArchetypeMode — 当前模式解析', () => {
  it('无命名空间 meta → 落到默认模式', () => {
    expect(currentArchetypeMode(SEEDANCE, {}).id).toBe('first')
  })
  it('命名空间 meta 指定 firstlast → 命中', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'firstlast' } }
    expect(currentArchetypeMode(SEEDANCE, meta).id).toBe('firstlast')
  })
  it('modeId 失效 / 属于别的档案 → 回落默认模式', () => {
    expect(currentArchetypeMode(SEEDANCE, { archetype: { id: 'other', modeId: 'firstlast' } }).id).toBe('first')
    expect(currentArchetypeMode(SEEDANCE, { archetype: { id: 'seedance-2', modeId: 'ghost' } }).id).toBe('first')
  })
})

describe('ensureArchetypeNodeMeta — 初次落地', () => {
  it('无命名空间 → 写入默认模式的 archetype 命名空间', () => {
    const patch = ensureArchetypeNodeMeta({}, SEEDANCE)
    expect(patch).not.toBeNull()
    expect((patch!.archetype as { id: string; modeId: string }).id).toBe('seedance-2')
    expect((patch!.archetype as { modeId: string }).modeId).toBe('first')
  })
  it('已是该档案 → 幂等返回 null（不循环）', () => {
    expect(ensureArchetypeNodeMeta({ archetype: { id: 'seedance-2', modeId: 'firstlast' } }, SEEDANCE)).toBeNull()
  })
})

describe('applyArchetypeModeSwitch — 只改 modeId，参考值全局保留', () => {
  it('切模式不搬不清参考值（切回照片还在 = 真实用户 F4）', () => {
    let meta: Record<string, unknown> = ensureArchetypeNodeMeta({}, SEEDANCE)!
    meta = applyArchetypeModeSwitch(meta, SEEDANCE, 'firstlast')
    meta = { ...meta, firstFrameUrl: 'F.png', lastFrameUrl: 'L.png', lastFrameRef: 'n2' }
    meta = applyArchetypeModeSwitch(meta, SEEDANCE, 'first') // 离开
    // meta 里值仍在（全局存储），只是「首帧」模式不显示尾帧槽
    expect(meta.firstFrameUrl).toBe('F.png')
    expect(meta.lastFrameUrl).toBe('L.png')
    expect((meta.archetype as { modeId: string }).modeId).toBe('first')
    meta = applyArchetypeModeSwitch(meta, SEEDANCE, 'firstlast') // 回来
    expect(meta.lastFrameUrl).toBe('L.png')
    expect(meta.lastFrameRef).toBe('n2')
  })
})

describe('buildArchetypeInputParams — M2 互斥发生在档案驱动的 input 构建（snake 键）', () => {
  it('首帧模式：即便 meta 残留 lastFrameUrl，也只出 first_frame_url（不进 body，避免 422）', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'first' }, firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({ first_frame_url: 'F.png' })
  })
  it('首尾帧模式：first + last 两帧都出', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'firstlast' }, firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({ first_frame_url: 'F.png', last_frame_url: 'L.png' })
  })
  it('references（画布连线）优先于 meta 全局值', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'first' }, firstFrameUrl: 'stale.png' }
    expect(buildArchetypeInputParams(meta, SEEDANCE, { firstFrameUrl: 'edge.png' })).toEqual({ first_frame_url: 'edge.png' })
  })
  it('空值不出键；Seedance 各模式同 model → 不带 model（body 用 modelKey）', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'firstlast' }, firstFrameUrl: '  ' }
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({})
  })
})

// ───────────────────────── C3：全能参考数组槽 ─────────────────────────
const OMNI = SEEDANCE.modes.find((m) => m.id === 'omni')!

describe('C3 全能参考 — 数组槽声明', () => {
  it('omni 声明 image/video/audio 三类数组槽，character 槽按序编号', () => {
    expect(OMNI.slots).toEqual([
      { kind: 'image_ref', label: '角色参考', min: 0, max: 9 },
      { kind: 'video_ref', label: '参考视频', min: 0, max: 3 },
      { kind: 'audio_ref', label: '参考音频', min: 0, max: 3 },
    ])
    const arr = archetypeModeArraySlots(OMNI)
    expect(arr.map((s) => [s.metaKey, s.max, s.numbered])).toEqual([
      ['referenceImageUrls', 9, true],
      ['referenceVideoUrls', 3, false],
      ['referenceAudioUrls', 3, false],
    ])
    expect(arr[0].caption).toMatch(/character1/)
  })
  it('omni 无单图 frame 槽；首/尾帧模式无数组槽（互斥）', () => {
    expect(archetypeModeSlots(OMNI)).toEqual([])
    expect(archetypeModeArraySlots(SEEDANCE.modes.find((m) => m.id === 'first')!)).toEqual([])
  })
  it('modeHasCharacterSlot 只在 omni 为真', () => {
    expect(modeHasCharacterSlot(OMNI)).toBe(true)
    expect(modeHasCharacterSlot(SEEDANCE.modes.find((m) => m.id === 'first')!)).toBe(false)
  })
})

describe('C3 全能参考 — 数组 input 构建（M2 互斥含数组槽，snake 键）', () => {
  it('omni 模式：三个数组按 slot 的 inputKey 出（按序保留 character1..9 顺序）', () => {
    const meta = {
      archetype: { id: 'seedance-2', modeId: 'omni' },
      referenceImageUrls: ['c1.png', 'c2.png', 'c3.png'],
      referenceVideoUrls: ['v1.mp4'],
      referenceAudioUrls: [],
      firstFrameUrl: 'stale.png', // 别的模式残留 → 不该出
    }
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({
      reference_image_urls: ['c1.png', 'c2.png', 'c3.png'],
      reference_video_urls: ['v1.mp4'],
    })
  })
  it('首帧模式：即便 meta 残留 omni 的角色图数组，也不出（互斥）', () => {
    const meta = {
      archetype: { id: 'seedance-2', modeId: 'first' },
      firstFrameUrl: 'F.png',
      referenceImageUrls: ['c1.png', 'c2.png'],
    }
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({ first_frame_url: 'F.png' })
  })
})

// ───────────────────────── C4：HappyHorse 4 模式合 1 ─────────────────────────
const HAPPY = getArchetypeById('happyhorse')!

describe('C4 HappyHorse — 档案 + per-mode enum + 模型契约 input 键', () => {
  it('4 模式各有不同 modelEnum（M3）', () => {
    expect(HAPPY.modes.map((m) => [m.id, m.modelEnum])).toEqual([
      ['t2v', 'happyhorse/text-to-video'],
      ['i2v', 'happyhorse/image-to-video'],
      ['ref', 'happyhorse/reference-to-video'],
      ['edit', 'happyhorse/video-edit'],
    ])
  })

  it('archetypeModeModelEnum 取当前模式 enum（Seedance 无 enum → null）', () => {
    expect(archetypeModeModelEnum(HAPPY, { archetype: { id: 'happyhorse', modeId: 'ref' } })).toBe('happyhorse/reference-to-video')
    expect(archetypeModeModelEnum(SEEDANCE, { archetype: { id: 'seedance-2', modeId: 'first' } })).toBeNull()
  })

  it('i2v：单图首帧但 input 是 image_urls[正好 1]（asArray 包成数组）+ 带 model enum', () => {
    const meta = { archetype: { id: 'happyhorse', modeId: 'i2v' }, firstFrameUrl: 'F.png' }
    expect(buildArchetypeInputParams(meta, HAPPY)).toEqual({ image_urls: ['F.png'], model: 'happyhorse/image-to-video' })
  })

  it('ref：角色图走 reference_image（不是 Seedance 的 reference_image_urls）', () => {
    const meta = { archetype: { id: 'happyhorse', modeId: 'ref' }, referenceImageUrls: ['c1', 'c2'] }
    expect(buildArchetypeInputParams(meta, HAPPY)).toEqual({ reference_image: ['c1', 'c2'], model: 'happyhorse/reference-to-video' })
  })

  it('edit：source_video → video_url + 参考图 → reference_image', () => {
    const meta = { archetype: { id: 'happyhorse', modeId: 'edit' }, sourceVideoUrl: 'src.mp4', referenceImageUrls: ['r1'] }
    expect(buildArchetypeInputParams(meta, HAPPY)).toEqual({ video_url: 'src.mp4', reference_image: ['r1'], model: 'happyhorse/video-edit' })
  })

  it('t2v：无参考槽，只带 model enum', () => {
    const meta = { archetype: { id: 'happyhorse', modeId: 't2v' } }
    expect(buildArchetypeInputParams(meta, HAPPY)).toEqual({ model: 'happyhorse/text-to-video' })
  })

  it('i2v 模式标量参数无 aspect_ratio（U3：无比例时直接不渲染）', () => {
    const i2v = HAPPY.modes.find((m) => m.id === 'i2v')!
    expect(i2v.params.map((p) => p.key)).not.toContain('aspect_ratio')
    const t2v = HAPPY.modes.find((m) => m.id === 't2v')!
    expect(t2v.params.map((p) => p.key)).toContain('aspect_ratio')
  })
})
