import { describe, it, expect } from 'vitest'
import { getArchetypeById } from '../../../../config/modelArchetypes'
import {
  applyArchetypeModeSwitch,
  archetypeManagedReferenceKeys,
  archetypeModeArraySlots,
  archetypeModeChoices,
  archetypeModeSlots,
  currentArchetypeMode,
  ensureArchetypeNodeMeta,
  intentLabel,
  modeHasCharacterSlot,
  projectArchetypeReferenceExtras,
} from './archetypeMeta'

// C2b：模式分段切换 + 命名空间 meta + flat 帧键投影（M2 互斥）的核心逻辑钉死。
// 关键不变量：当前 flat 帧键**只反映当前模式**（切到首帧 → lastFrameUrl 必清空），切回还原。

const SEEDANCE = getArchetypeById('seedance-2')!

describe('archetype 档案 — Seedance 模式', () => {
  it('档案有 首帧 / 首尾帧 / 全能参考 三模式（C3），意图词为统一主标签', () => {
    expect(SEEDANCE.modes.map((m) => m.id)).toEqual(['first', 'firstlast', 'omni'])
    expect(archetypeModeChoices(SEEDANCE)).toEqual([
      { id: 'first', label: '单图首帧', vendorTerm: '首帧', hint: '单张首帧图驱动生成' },
      { id: 'firstlast', label: '首尾帧', vendorTerm: '首尾帧', hint: '首帧 + 尾帧，过渡更可控' },
      { id: 'omni', label: '角色参考', vendorTerm: '全能参考', hint: '多模态参考；最多 9 角色 / 3 视频 / 3 音频' },
    ])
  })

  it('首尾帧模式声明 first_frame + last_frame 两槽', () => {
    const firstlast = SEEDANCE.modes.find((m) => m.id === 'firstlast')!
    expect(firstlast.slots).toEqual([
      { kind: 'first_frame', label: '首帧', min: 1, max: 1 },
      { kind: 'last_frame', label: '尾帧', min: 1, max: 1 },
    ])
  })

  it('intentLabel 跨模型统一', () => {
    expect(intentLabel('single')).toBe('单图首帧')
    expect(intentLabel('firstlast')).toBe('首尾帧')
    expect(intentLabel('character')).toBe('角色参考')
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

describe('projectArchetypeReferenceExtras — M2 互斥发生在传输投影', () => {
  it('首帧模式：即便 meta 里残留 lastFrameUrl，也只投影 firstFrameUrl（不进 body，避免 422）', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'first' }, firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }
    expect(projectArchetypeReferenceExtras(meta, SEEDANCE)).toEqual({ firstFrameUrl: 'F.png' })
  })
  it('首尾帧模式：first + last 两帧都投影', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'firstlast' }, firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }
    expect(projectArchetypeReferenceExtras(meta, SEEDANCE)).toEqual({ firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' })
  })
  it('references（画布连线）优先于 meta 全局值', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'first' }, firstFrameUrl: 'stale.png' }
    expect(projectArchetypeReferenceExtras(meta, SEEDANCE, { firstFrameUrl: 'edge.png' })).toEqual({ firstFrameUrl: 'edge.png' })
  })
  it('空值不投影', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'firstlast' }, firstFrameUrl: '  ' }
    expect(projectArchetypeReferenceExtras(meta, SEEDANCE)).toEqual({})
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

describe('C3 全能参考 — 数组投影（M2 互斥含数组槽）', () => {
  it('omni 模式：投影三个数组（按序保留 character1..9 顺序）', () => {
    const meta = {
      archetype: { id: 'seedance-2', modeId: 'omni' },
      referenceImageUrls: ['c1.png', 'c2.png', 'c3.png'],
      referenceVideoUrls: ['v1.mp4'],
      referenceAudioUrls: [],
      firstFrameUrl: 'stale.png', // 别的模式残留 → 不该投影
    }
    expect(projectArchetypeReferenceExtras(meta, SEEDANCE)).toEqual({
      referenceImageUrls: ['c1.png', 'c2.png', 'c3.png'],
      referenceVideoUrls: ['v1.mp4'],
    })
  })
  it('首帧模式：即便 meta 残留 omni 的角色图数组，也不投影（互斥）', () => {
    const meta = {
      archetype: { id: 'seedance-2', modeId: 'first' },
      firstFrameUrl: 'F.png',
      referenceImageUrls: ['c1.png', 'c2.png'],
    }
    expect(projectArchetypeReferenceExtras(meta, SEEDANCE)).toEqual({ firstFrameUrl: 'F.png' })
  })
  it('受管键涵盖帧键 + 三个数组 metaKey（请求构建据此 null 掉非活跃键）', () => {
    expect(archetypeManagedReferenceKeys(SEEDANCE).sort()).toEqual(
      ['firstFrameUrl', 'lastFrameUrl', 'referenceAudioUrls', 'referenceImageUrls', 'referenceVideoUrls'].sort(),
    )
  })
})
