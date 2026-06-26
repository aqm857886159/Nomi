import { describe, it, expect } from 'vitest'
import { getArchetypeById, specializeArchetypeForVariant, type ModelArchetype } from '../../../../config/modelArchetypes'
import { archetypeModeModelEnum } from './archetypeMeta'
import {
  type ArchetypeArraySlot,
  appendArchetypeArrayValue,
  applyArchetypeModeSwitch,
  applyArchetypeVariantSwitch,
  archetypeModeArraySlots,
  archetypeModeChoices,
  archetypeModeSlots,
  archetypeVariantChoices,
  buildArchetypeInputParams,
  currentArchetypeMode,
  currentArchetypeVariant,
  ensureArchetypeNodeMeta,
  hasArchetypeArrayReferences,
  mergeOrderedReferenceImageUrls,
  modeHasCharacterSlot,
  normalizeArchetypeVariantMeta,
  orderedSentImageReferenceUrls,
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
  it('已是该档案（含 variantId）→ 幂等返回 null（不循环）', () => {
    expect(ensureArchetypeNodeMeta({ archetype: { id: 'seedance-2', modeId: 'firstlast', variantId: 'standard' } }, SEEDANCE)).toBeNull()
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
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({ first_frame_url: 'F.png', model: 'bytedance/seedance-2' })
  })
  it('首尾帧模式：first + last 两帧都出', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'firstlast' }, firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({ first_frame_url: 'F.png', last_frame_url: 'L.png', model: 'bytedance/seedance-2' })
  })
  it('references（画布连线）优先于 meta 全局值', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'first' }, firstFrameUrl: 'stale.png' }
    expect(buildArchetypeInputParams(meta, SEEDANCE, { firstFrameUrl: 'edge.png' })).toEqual({ first_frame_url: 'edge.png', model: 'bytedance/seedance-2' })
  })
  it('空值不出键；Seedance 有变体 → 带 model=默认变体 modelKey（body 用 {{request.params.model}}）', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'firstlast' }, firstFrameUrl: '  ' }
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({ model: 'bytedance/seedance-2' })
  })
})

// ───────────────────────── C3：全能参考数组槽 ─────────────────────────
const OMNI = SEEDANCE.modes.find((m) => m.id === 'omni')!

describe('C3 全能参考 — 数组槽声明', () => {
  it('omni 声明 image/video/audio 三类数组槽，character 槽按序编号', () => {
    expect(OMNI.slots).toEqual([
      { kind: 'image_ref', label: '角色参考', min: 0, max: 9, characterIndexed: true },
      { kind: 'video_ref', label: '参考视频', min: 0, max: 3 },
      { kind: 'audio_ref', label: '参考音频', min: 0, max: 3 },
    ])
    const arr = archetypeModeArraySlots(OMNI)
    expect(arr.map((s) => [s.metaKey, s.max, s.numbered])).toEqual([
      ['referenceImageUrls', 9, true],
      ['referenceVideoUrls', 3, false],
      ['referenceAudioUrls', 3, false],
    ])
    expect(arr[0].caption).toMatch(/编号/)
  })
  it('omni 无单图 frame 槽；首/尾帧模式无数组槽（互斥）', () => {
    expect(archetypeModeSlots(OMNI)).toEqual([])
    expect(archetypeModeArraySlots(SEEDANCE.modes.find((m) => m.id === 'first')!)).toEqual([])
  })
  it('modeHasCharacterSlot 只在 omni 为真', () => {
    expect(modeHasCharacterSlot(OMNI)).toBe(true)
    expect(modeHasCharacterSlot(SEEDANCE.modes.find((m) => m.id === 'first')!)).toBe(false)
  })
  it('hasArchetypeArrayReferences：omni 放了参考数组 → true（修复 omni 误判"需要首帧"锁死生成）', () => {
    const empty = { archetype: { id: 'seedance-2', modeId: 'omni' } }
    expect(hasArchetypeArrayReferences(empty, SEEDANCE)).toBe(false)
    const withImg = { ...empty, referenceImageUrls: ['c1.png'] }
    expect(hasArchetypeArrayReferences(withImg, SEEDANCE)).toBe(true)
    // nomi-local:// 也算「有参考」（传输前 R1 本地化），不做 http 过滤
    const withLocal = { ...empty, referenceVideoUrls: ['nomi-local://asset/p/v.mp4'] }
    expect(hasArchetypeArrayReferences(withLocal, SEEDANCE)).toBe(true)
    // 首帧模式无数组槽 → 即便 meta 残留 referenceImageUrls 也不算（互斥）
    const firstMode = { archetype: { id: 'seedance-2', modeId: 'first' }, referenceImageUrls: ['c1.png'] }
    expect(hasArchetypeArrayReferences(firstMode, SEEDANCE)).toBe(false)
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
      model: 'bytedance/seedance-2',
    })
  })
  it('首帧模式：即便 meta 残留 omni 的角色图数组，也不出（互斥）', () => {
    const meta = {
      archetype: { id: 'seedance-2', modeId: 'first' },
      firstFrameUrl: 'F.png',
      referenceImageUrls: ['c1.png', 'c2.png'],
    }
    expect(buildArchetypeInputParams(meta, SEEDANCE)).toEqual({ first_frame_url: 'F.png', model: 'bytedance/seedance-2' })
  })
})

describe('切片1 — 画布边参考图喂进档案 image 槽（修边投递裂开）', () => {
  // option 2（2026-06-25 用户拍板）：合并顺序统一成「连线在前、上传在后」——与面板编号①②③、@ 候选、
  // @ 投影 character{N} 同口径，杜绝「面板①与模型 character1 不是同一张」。
  it('omni：边参考图并入 reference_image_urls，连线在前+上传去重保序', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'omni' }, referenceImageUrls: ['c1.png', 'c2.png'] }
    expect(buildArchetypeInputParams(meta, SEEDANCE, { referenceImages: ['c2.png', 'e1.png'] })).toEqual({
      reference_image_urls: ['c2.png', 'e1.png', 'c1.png'], // 边 c2/e1 在前，上传 c1 追加，c2 去重
      model: 'bytedance/seedance-2',
    })
  })
  it('纯边参考（meta 无数组）也进槽——agent 连 character_ref 边的常见场景，此前被丢', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'omni' } }
    expect(buildArchetypeInputParams(meta, SEEDANCE, { referenceImages: ['e1.png'] })).toEqual({
      reference_image_urls: ['e1.png'],
      model: 'bytedance/seedance-2',
    })
  })
  it('截到 slot.max（omni image ≤9）：边 3 + meta 8 → 9（连线在前优先保留），封死 vendor 422', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'omni' }, referenceImageUrls: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'] }
    const result = buildArchetypeInputParams(meta, SEEDANCE, { referenceImages: ['e1', 'e2', 'e3'] })
    expect(result.reference_image_urls).toEqual(['e1', 'e2', 'e3', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'])
  })
  it('图片边不污染 video/audio 槽', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'omni' }, referenceVideoUrls: ['v1.mp4'] }
    expect(buildArchetypeInputParams(meta, SEEDANCE, { referenceImages: ['e1.png'] })).toEqual({
      reference_image_urls: ['e1.png'],
      reference_video_urls: ['v1.mp4'],
      model: 'bytedance/seedance-2',
    })
  })
  it('M2：首帧模式无 image_ref 槽，边参考图不泄漏进 body', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'first' }, firstFrameUrl: 'F.png' }
    expect(buildArchetypeInputParams(meta, SEEDANCE, { referenceImages: ['e1.png'] })).toEqual({ first_frame_url: 'F.png', model: 'bytedance/seedance-2' })
  })
})

describe('D1 — 切变体夹取越界参数值（4k→fast 不再漏发被供应商打回）', () => {
  const APIMART = getArchetypeById('seedance-2-apimart')!
  it('标准(含4k) → 快速(仅480/720)：存量 4k 夹回默认 720p', () => {
    const meta = { archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId: 'standard' }, resolution: '4k', size: '21:9' }
    const next = applyArchetypeVariantSwitch(meta, APIMART, 'fast')
    expect(next.resolution).toBe('720p') // 4k 不在 fast 选项内 → 夹回 defaultValue
    expect((next.archetype as { variantId: string }).variantId).toBe('fast')
    expect(next.size).toBe('21:9') // size 在 fast 仍允许（同选项）→ 不动
  })
  it('标准 → 真人(含1080,无4k)：1080p 保留、4k 才夹回', () => {
    expect(applyArchetypeVariantSwitch({ archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId: 'standard' }, resolution: '1080p' }, APIMART, 'face').resolution).toBe('1080p')
    expect(applyArchetypeVariantSwitch({ archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId: 'standard' }, resolution: '4k' }, APIMART, 'face').resolution).toBe('720p')
  })
  it('切回标准(含全集)：不夹取（4k 合法保留）', () => {
    expect(applyArchetypeVariantSwitch({ archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId: 'fast' }, resolution: '720p' }, APIMART, 'standard').resolution).toBe('720p')
  })
})

describe('option 2 单源 — 「有序参考图」连线在前、上传在后（面板/@/发送共用）', () => {
  it('mergeOrderedReferenceImageUrls：边在前、上传在后、去重、截到 maxCap', () => {
    expect(mergeOrderedReferenceImageUrls(['e1', 'e2'], ['u1', 'u2'], 9)).toEqual(['e1', 'e2', 'u1', 'u2'])
    expect(mergeOrderedReferenceImageUrls(['e1', 'u1'], ['u1', 'u2'], 9)).toEqual(['e1', 'u1', 'u2']) // u1 去重
    expect(mergeOrderedReferenceImageUrls(['e1', 'e2', 'e3'], ['u1', 'u2'], 4)).toEqual(['e1', 'e2', 'e3', 'u1']) // 截到 4，连线优先
    expect(mergeOrderedReferenceImageUrls([], ['u1'], 0)).toEqual(['u1']) // maxCap≤0 不截
    expect(mergeOrderedReferenceImageUrls([' ', 'e1', ''], ['u1'], 9)).toEqual(['e1', 'u1']) // 空白过滤
  })

  it('orderedSentImageReferenceUrls = buildArchetypeInputParams 给 image 槽的同一份列表（character{N} 编号锚点）', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'omni' }, referenceImageUrls: ['u1.png', 'u2.png'] }
    const edges = ['e1.png', 'u2.png']
    const ordered = orderedSentImageReferenceUrls(meta, SEEDANCE, edges)
    expect(ordered).toEqual(['e1.png', 'u2.png', 'u1.png']) // 连线在前、u2 去重、上传 u1 追加
    // 与实际发送的 reference_image_urls 逐位一致——@ 投影 character{N} 才不会张冠李戴。
    expect(buildArchetypeInputParams(meta, SEEDANCE, { referenceImages: edges }).reference_image_urls).toEqual(ordered)
  })

  it('当前模式无 image 数组槽（首帧模式）→ []（@ 投影回退 no-op）', () => {
    const meta = { archetype: { id: 'seedance-2', modeId: 'first' }, firstFrameUrl: 'F.png' }
    expect(orderedSentImageReferenceUrls(meta, SEEDANCE, ['e1.png'])).toEqual([])
  })
})

describe('appendArchetypeArrayValue — 单源去重/上限（拖入/连线/手动加共用）', () => {
  const slot: ArchetypeArraySlot = { metaKey: 'referenceImageUrls', label: '角色参考', min: 0, max: 2, accept: 'image', numbered: true }
  it('空 → empty；空白串也算空', () => {
    expect(appendArchetypeArrayValue({}, slot, '').status).toBe('empty')
    expect(appendArchetypeArrayValue({}, slot, '   ').status).toBe('empty')
  })
  it('正常追加 → added + 带 next（trim 后入列）', () => {
    expect(appendArchetypeArrayValue({ referenceImageUrls: ['a.png'] }, slot, ' b.png ')).toEqual({ status: 'added', next: ['a.png', 'b.png'] })
  })
  it('已存在 → duplicate（静默，不重复）', () => {
    expect(appendArchetypeArrayValue({ referenceImageUrls: ['a.png'] }, slot, 'a.png').status).toBe('duplicate')
  })
  it('到上限 → full（调用方 toast，别静默丢）', () => {
    expect(appendArchetypeArrayValue({ referenceImageUrls: ['a.png', 'b.png'] }, slot, 'c.png').status).toBe('full')
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

  it('video-edit 的「参考图」不是角色槽：不编号、无 character 说明、不触发 prompt 提示', () => {
    const edit = HAPPY.modes.find((m) => m.id === 'edit')!
    const refSlot = archetypeModeArraySlots(edit).find((s) => s.metaKey === 'referenceImageUrls')!
    expect(refSlot.numbered).toBe(false)
    expect(refSlot.caption).toBeUndefined()
    expect(modeHasCharacterSlot(edit)).toBe(false)
    // 而「角色参考」模式是角色槽
    expect(modeHasCharacterSlot(HAPPY.modes.find((m) => m.id === 'ref')!)).toBe(true)
  })

  it('i2v 模式标量参数无 aspect_ratio（U3：无比例时直接不渲染）', () => {
    const i2v = HAPPY.modes.find((m) => m.id === 'i2v')!
    expect(i2v.params.map((p) => p.key)).not.toContain('aspect_ratio')
    const t2v = HAPPY.modes.find((m) => m.id === 't2v')!
    expect(t2v.params.map((p) => p.key)).toContain('aspect_ratio')
  })
})

describe('combineSlotsInto — 角色对象数组合并（通用原语）', () => {
  // 假想第二个「role-数组」模型：键名与 Seedance 不同（frames_with_roles ≠ image_with_roles）。
  // 它只靠档案声明就能用，buildArchetypeInputParams 零改动 → 证明通用、非 Seedance 专用（P4）。
  const FAKE_ROLE_MODEL: ModelArchetype = {
    id: 'fake-roles', family: 'fake', label: 'Fake', kind: 'video',
    defaultModeId: 'fl', transportTaskKind: 'image_to_video', identifierPatterns: ['fake-roles'],
    modes: [{
      id: 'fl', intent: 'firstlast', vendorTerm: 'FL', hint: '', promptRequired: true,
      transportTaskKind: 'image_to_video',
      slots: [
        { kind: 'first_frame', label: 'F', min: 1, max: 1 },
        { kind: 'last_frame', label: 'L', min: 0, max: 1 },
      ],
      combineSlotsInto: { key: 'frames_with_roles' },
      params: [],
    }],
  }

  it('合并键名来自档案声明（不写死 image_with_roles）+ role 由 kind 派生 + 删扁平键', () => {
    const meta = { archetype: { id: 'fake-roles', modeId: 'fl' } }
    const out = buildArchetypeInputParams(meta, FAKE_ROLE_MODEL, { firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' })
    expect(out).toEqual({
      frames_with_roles: [
        { url: 'F.png', role: 'first_frame' },
        { url: 'L.png', role: 'last_frame' },
      ],
    })
    expect(out.first_frame_url).toBeUndefined()
    expect(out.last_frame_url).toBeUndefined()
  })

  it('只有有 url 的槽进数组（尾帧空 → 数组只含首帧，绝不放 {url:undefined}）', () => {
    const meta = { archetype: { id: 'fake-roles', modeId: 'fl' } }
    const out = buildArchetypeInputParams(meta, FAKE_ROLE_MODEL, { firstFrameUrl: 'F.png' })
    expect(out).toEqual({ frames_with_roles: [{ url: 'F.png', role: 'first_frame' }] })
  })

  it('slot.roleName 覆盖 kind 派生的 role（vendor 措辞不同时）', () => {
    const custom: ModelArchetype = {
      ...FAKE_ROLE_MODEL,
      modes: [{
        ...FAKE_ROLE_MODEL.modes[0],
        slots: [{ kind: 'first_frame', label: 'F', min: 1, max: 1, roleName: 'opening' }],
      }],
    }
    const out = buildArchetypeInputParams({ archetype: { id: 'fake-roles', modeId: 'fl' } }, custom, { firstFrameUrl: 'F.png' })
    expect(out).toEqual({ frames_with_roles: [{ url: 'F.png', role: 'opening' }] })
  })
})

describe('apimart Seedance 首尾帧 — image_with_roles（combineSlotsInto 落地）', () => {
  const SEEDANCE_APIMART = getArchetypeById('seedance-2-apimart')!

  it('首尾帧模式 → image_with_roles:[首帧,尾帧]，无扁平键、无 image_urls（与 image_urls 互斥）；带默认变体 model', () => {
    const meta = { archetype: { id: 'seedance-2-apimart', modeId: 'firstlast' } }
    const out = buildArchetypeInputParams(meta, SEEDANCE_APIMART, { firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' })
    expect(out).toEqual({
      // 变体合并后：无 variantId → 回落默认变体 standard → out.model = 基础 modelKey。
      model: 'doubao-seedance-2.0',
      image_with_roles: [
        { url: 'F.png', role: 'first_frame' },
        { url: 'L.png', role: 'last_frame' },
      ],
    })
    expect(out.image_urls).toBeUndefined()
    expect(out.first_frame_url).toBeUndefined()
  })

  it('只首帧 → image_with_roles 只含首帧（+ 默认变体 model）', () => {
    const meta = { archetype: { id: 'seedance-2-apimart', modeId: 'firstlast' } }
    const out = buildArchetypeInputParams(meta, SEEDANCE_APIMART, { firstFrameUrl: 'F.png' })
    expect(out).toEqual({ model: 'doubao-seedance-2.0', image_with_roles: [{ url: 'F.png', role: 'first_frame' }] })
  })

  it('档案有 文生/图生/全能参考/首尾帧 四模式 + seed 参数全模式可见', () => {
    expect(SEEDANCE_APIMART.modes.map((m) => m.id)).toEqual(['t2v', 'i2v', 'omni', 'firstlast'])
    for (const mode of SEEDANCE_APIMART.modes) {
      expect(mode.params.map((p) => p.key)).toContain('seed')
    }
  })
})

// ───────────────────────── S1/S2：变体轴（Seedance 合并）─────────────────────────
const SEEDANCE_APIMART = getArchetypeById('seedance-2-apimart')!

describe('变体轴 — currentArchetypeVariant 回落', () => {
  it('无 variantId → 回落默认变体 standard', () => {
    expect(currentArchetypeVariant(SEEDANCE_APIMART, {})?.id).toBe('standard')
    expect(currentArchetypeVariant(SEEDANCE_APIMART, { archetype: { id: 'seedance-2-apimart', modeId: 't2v' } })?.id).toBe('standard')
  })
  it('显式 variantId 命中', () => {
    const meta = { archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId: 'fast' } }
    expect(currentArchetypeVariant(SEEDANCE_APIMART, meta)?.id).toBe('fast')
  })
  it('失效 variantId / 属于别的档案 → 回落默认', () => {
    expect(currentArchetypeVariant(SEEDANCE_APIMART, { archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId: 'ghost' } })?.id).toBe('standard')
    expect(currentArchetypeVariant(SEEDANCE_APIMART, { archetype: { id: 'other', modeId: 't2v', variantId: 'fast' } })?.id).toBe('standard')
  })
  it('无 variants 档案 → null（如 HappyHorse）', () => {
    expect(currentArchetypeVariant(getArchetypeById('happyhorse')!, {})).toBeNull()
  })
  it('kie Seedance 合并后有标准/快速两变体（默认标准）', () => {
    const kie = getArchetypeById('seedance-2')!
    expect(currentArchetypeVariant(kie, {})?.id).toBe('standard')
    expect(currentArchetypeVariant(kie, { archetype: { id: 'seedance-2', modeId: 'first', variantId: 'fast' } })?.id).toBe('fast')
  })
  it('archetypeVariantChoices 列出 4 变体（标签用变体自己的名字）', () => {
    expect(archetypeVariantChoices(SEEDANCE_APIMART)).toEqual([
      { id: 'standard', label: '标准' },
      { id: 'fast', label: '快速' },
      { id: 'face', label: '真人' },
      { id: 'fast-face', label: '真人快速' },
    ])
    // kie Seedance 合并后 3 变体（标准 / 快速 / Mini）。
    expect(archetypeVariantChoices(getArchetypeById('seedance-2')!)).toEqual([
      { id: 'standard', label: '标准' },
      { id: 'fast', label: '快速' },
      { id: 'mini', label: 'Mini' },
    ])
    // 无 variants → 空（UI 不显示该段）。
    expect(archetypeVariantChoices(getArchetypeById('happyhorse')!)).toEqual([])
  })
})

describe('变体轴 — 发出的 model（buildArchetypeInputParams out.model）', () => {
  // 钉死：4 变体各发对自己的 modelKey（用户真机会逐个抓请求体确认）。
  it.each([
    ['standard', 'doubao-seedance-2.0'],
    ['fast', 'doubao-seedance-2.0-fast'],
    ['face', 'doubao-seedance-2.0-face'],
    ['fast-face', 'doubao-seedance-2.0-fast-face'],
  ])('变体 %s → out.model = %s', (variantId, expected) => {
    const meta = { archetype: { id: 'seedance-2-apimart', modeId: 't2v', variantId } }
    expect(buildArchetypeInputParams(meta, SEEDANCE_APIMART).model).toBe(expected)
  })
  it('无 variantId → out.model 取默认变体 modelKey（绝不缺 model 键，否则 apimart body 丢 model）', () => {
    const meta = { archetype: { id: 'seedance-2-apimart', modeId: 't2v' } }
    expect(buildArchetypeInputParams(meta, SEEDANCE_APIMART).model).toBe('doubao-seedance-2.0')
  })
  it('变体优先于 per-mode modelEnum（变体是更外层身份）', () => {
    // 构造一个既有变体又有 modelEnum 的假档案，证明变体优先。
    const fake: ModelArchetype = {
      id: 'fake-v', family: 'f', label: 'F', kind: 'video', defaultModeId: 'm',
      transportTaskKind: 'text_to_video', identifierPatterns: ['fake-v'],
      modes: [{ id: 'm', intent: 'text', vendorTerm: 'M', hint: '', promptRequired: true, slots: [], params: [], modelEnum: 'enum-model' }],
      variants: [{ id: 'v1', label: 'V1', modelKey: 'variant-model' }],
      defaultVariantId: 'v1',
    }
    const out = buildArchetypeInputParams({ archetype: { id: 'fake-v', modeId: 'm', variantId: 'v1' } }, fake)
    expect(out.model).toBe('variant-model')
  })
})

describe('变体轴 — params 收窄（specializeArchetypeForVariant）', () => {
  it('fast 变体：resolution 选项收窄到 480/720（无 1080）', () => {
    const fast = specializeArchetypeForVariant(SEEDANCE_APIMART, 'fast')
    for (const mode of fast.modes) {
      const res = mode.params.find((p) => p.key === 'resolution')
      expect(res?.options.map((o) => o.value)).toEqual(['480p', '720p'])
    }
  })
  it('fast-face 变体：同样收窄 480/720', () => {
    const ff = specializeArchetypeForVariant(SEEDANCE_APIMART, 'fast-face')
    const res = ff.modes[0].params.find((p) => p.key === 'resolution')
    expect(res?.options.map((o) => o.value)).toEqual(['480p', '720p'])
  })
  it('standard 变体：resolution 含 4k（基础档独占的 2026-06 4K 升级）', () => {
    const arch = specializeArchetypeForVariant(SEEDANCE_APIMART, 'standard')
    const res = arch.modes[0].params.find((p) => p.key === 'resolution')
    expect(res?.options.map((o) => o.value)).toEqual(['480p', '720p', '1080p', '4k'])
  })
  it('face 变体：保留 1080p、去 4k（apimart 约束：4k 仅基础档）', () => {
    const arch = specializeArchetypeForVariant(SEEDANCE_APIMART, 'face')
    const res = arch.modes[0].params.find((p) => p.key === 'resolution')
    expect(res?.options.map((o) => o.value)).toEqual(['480p', '720p', '1080p'])
  })
  it('无 variantId → 取默认 standard（含 4k）', () => {
    const arch = specializeArchetypeForVariant(SEEDANCE_APIMART, undefined)
    const res = arch.modes[0].params.find((p) => p.key === 'resolution')
    expect(res?.options.map((o) => o.value)).toEqual(['480p', '720p', '1080p', '4k'])
  })
})

describe('变体轴 — 切换 applyArchetypeVariantSwitch', () => {
  it('切变体只改 variantId，保留 modeId 与参考值', () => {
    let meta: Record<string, unknown> = { archetype: { id: 'seedance-2-apimart', modeId: 'firstlast' }, firstFrameUrl: 'F.png' }
    meta = applyArchetypeVariantSwitch(meta, SEEDANCE_APIMART, 'fast')
    expect((meta.archetype as { modeId: string; variantId: string })).toEqual({ id: 'seedance-2-apimart', modeId: 'firstlast', variantId: 'fast' })
    expect(meta.firstFrameUrl).toBe('F.png')
  })
  it('无效 variantId → 回落默认 standard', () => {
    const meta = applyArchetypeVariantSwitch({ archetype: { id: 'seedance-2-apimart', modeId: 't2v' } }, SEEDANCE_APIMART, 'ghost')
    expect((meta.archetype as { variantId: string }).variantId).toBe('standard')
  })
  it('切模式后变体跟随保留（正交，互不影响）', () => {
    let meta: Record<string, unknown> = applyArchetypeVariantSwitch({ archetype: { id: 'seedance-2-apimart', modeId: 't2v' } }, SEEDANCE_APIMART, 'face')
    meta = applyArchetypeModeSwitch(meta, SEEDANCE_APIMART, 'i2v')
    expect((meta.archetype as { modeId: string; variantId: string })).toEqual({ id: 'seedance-2-apimart', modeId: 'i2v', variantId: 'face' })
  })
})

describe('变体轴 — 旧项目迁移 normalizeArchetypeVariantMeta（最大风险点）', () => {
  // 旧项目钉死的变体全串 → 归一成**基础 modelKey**（= 折叠后 picker 唯一选项，否则选择显示空）+ variantId 承载变体。
  it.each([
    ['doubao-seedance-2.0-fast', 'fast'],
    ['doubao-seedance-2.0-face', 'face'],
    ['doubao-seedance-2.0-fast-face', 'fast-face'],
  ])('旧变体全串 %s → modelKey 折叠成基础 doubao-seedance-2.0 + variantId=%s', (oldKey, expectedVariant) => {
    const meta = { modelKey: oldKey, archetype: { id: 'seedance-2-apimart', modeId: 'i2v' } }
    const patch = normalizeArchetypeVariantMeta(meta, SEEDANCE_APIMART)
    expect(patch?.modelKey).toBe('doubao-seedance-2.0') // 基础串，能在折叠后的 picker 命中
    expect(patch?.archetype).toEqual({ id: 'seedance-2-apimart', modeId: 'i2v', variantId: expectedVariant })
  })
  it('旧标准节点 modelKey 已是基础 → 不迁移（variantId 缺由 currentArchetypeVariant 回落 standard）', () => {
    const meta = { modelKey: 'doubao-seedance-2.0', archetype: { id: 'seedance-2-apimart', modeId: 't2v' } }
    expect(normalizeArchetypeVariantMeta(meta, SEEDANCE_APIMART)).toBeNull()
  })
  it('旧无连字符变体串 doubao-seedance-2-0-fast → 基础 + fast（identifierPatterns 收纳）', () => {
    const patch = normalizeArchetypeVariantMeta({ modelKey: 'doubao-seedance-2-0-fast' }, SEEDANCE_APIMART)
    expect(patch?.modelKey).toBe('doubao-seedance-2.0')
    expect(patch?.archetype.variantId).toBe('fast')
  })
  it('已归一（基础 modelKey + variantId）→ 幂等 null（不循环写、不冲掉已选变体）', () => {
    const meta = { modelKey: 'doubao-seedance-2.0', archetype: { id: 'seedance-2-apimart', modeId: 'i2v', variantId: 'fast' } }
    expect(normalizeArchetypeVariantMeta(meta, SEEDANCE_APIMART)).toBeNull()
  })
  it('无 variants 档案 / 认不出的 modelKey → null', () => {
    expect(normalizeArchetypeVariantMeta({ modelKey: 'whatever' }, getArchetypeById('happyhorse')!)).toBeNull()
    expect(normalizeArchetypeVariantMeta({ modelKey: 'unknown' }, SEEDANCE_APIMART)).toBeNull()
  })
})

describe('KIE Seedance 标准/Fast 合并到变体轴（2026-06-16）', () => {
  const KIE = getArchetypeById('seedance-2')!
  it('旧 fast 节点 bytedance/seedance-2-fast → 折叠成基础 + variantId=fast', () => {
    const patch = normalizeArchetypeVariantMeta({ modelKey: 'bytedance/seedance-2-fast', archetype: { id: 'seedance-2', modeId: 'first' } }, KIE)
    expect(patch?.modelKey).toBe('bytedance/seedance-2')
    expect(patch?.archetype).toEqual({ id: 'seedance-2', modeId: 'first', variantId: 'fast' })
  })
  it('旧标准节点 modelKey 已是基础 → 不迁移（回落 standard）', () => {
    expect(normalizeArchetypeVariantMeta({ modelKey: 'bytedance/seedance-2', archetype: { id: 'seedance-2', modeId: 'first' } }, KIE)).toBeNull()
  })
  it('变体 model 串：标准发 bytedance/seedance-2、快速发 -fast（body {{request.params.model}} 读它）', () => {
    const std = { archetype: { id: 'seedance-2', modeId: 'first', variantId: 'standard' }, firstFrameUrl: 'F.png' }
    const fast = { archetype: { id: 'seedance-2', modeId: 'first', variantId: 'fast' }, firstFrameUrl: 'F.png' }
    expect(buildArchetypeInputParams(std, KIE).model).toBe('bytedance/seedance-2')
    expect(buildArchetypeInputParams(fast, KIE).model).toBe('bytedance/seedance-2-fast')
  })
})

describe('变体轴 — ensureArchetypeNodeMeta 初始化变体', () => {
  it('首次落地：写默认模式 + 默认变体', () => {
    const patch = ensureArchetypeNodeMeta({}, SEEDANCE_APIMART)
    expect((patch!.archetype as { id: string; modeId: string; variantId: string })).toEqual({ id: 'seedance-2-apimart', modeId: 't2v', variantId: 'standard' })
  })
  it('旧 meta 有档案但缺 variantId → 补默认变体（升级）', () => {
    const patch = ensureArchetypeNodeMeta({ archetype: { id: 'seedance-2-apimart', modeId: 'i2v' } }, SEEDANCE_APIMART)
    expect((patch!.archetype as { variantId: string }).variantId).toBe('standard')
    expect((patch!.archetype as { modeId: string }).modeId).toBe('i2v')
  })
  it('已有有效 variantId → 幂等 null', () => {
    expect(ensureArchetypeNodeMeta({ archetype: { id: 'seedance-2-apimart', modeId: 'i2v', variantId: 'fast' } }, SEEDANCE_APIMART)).toBeNull()
  })
})

// ───── apimart 参数补全（2026-06-16）：fixedParams 注入 + flat 合并 + 新变体 model 串 ─────
describe('apimart 参数补全 — fixedParams / flat 合并 / 变体 model', () => {
  const VEO = getArchetypeById('veo-3.1')!
  const SORA = getArchetypeById('sora-2')!
  const HAILUO = getArchetypeById('hailuo-2.3')!
  const QWEN = getArchetypeById('qwen-image')!
  const OMNI = getArchetypeById('omni-flash-ext')!

  it('Veo 参考图模式：fixedParams 注入 generation_type=reference + 默认变体 model', () => {
    const meta = { archetype: { id: 'veo-3.1', modeId: 'reference', variantId: 'fast' } }
    expect(buildArchetypeInputParams(meta, VEO, { referenceImages: ['a.png'] })).toEqual({
      image_urls: ['a.png'], generation_type: 'reference', model: 'veo3.1-fast',
    })
  })

  it('Veo 首尾帧模式：flat 合并 → image_urls 有序 [首,尾] + generation_type=frame', () => {
    const meta = { archetype: { id: 'veo-3.1', modeId: 'frame', variantId: 'fast' }, firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }
    expect(buildArchetypeInputParams(meta, VEO)).toEqual({
      image_urls: ['F.png', 'L.png'], generation_type: 'frame', model: 'veo3.1-fast',
    })
  })

  it('Veo 首尾帧：只有首帧 → image_urls 仅 [首]', () => {
    const meta = { archetype: { id: 'veo-3.1', modeId: 'frame', variantId: 'fast' }, firstFrameUrl: 'F.png' }
    expect(buildArchetypeInputParams(meta, VEO)).toEqual({ image_urls: ['F.png'], generation_type: 'frame', model: 'veo3.1-fast' })
  })

  it('变体 model 串：选 Pro/quality/Fast → out.model = 变体 modelKey', () => {
    expect(buildArchetypeInputParams({ archetype: { id: 'sora-2', modeId: 't2v', variantId: 'pro' } }, SORA).model).toBe('sora-2-pro')
    expect(buildArchetypeInputParams({ archetype: { id: 'veo-3.1', modeId: 't2v', variantId: 'quality' } }, VEO).model).toBe('veo3.1-quality')
    expect(buildArchetypeInputParams({ archetype: { id: 'hailuo-2.3', modeId: 't2v', variantId: 'fast' } }, HAILUO).model).toBe('MiniMax-Hailuo-2.3-Fast')
    expect(buildArchetypeInputParams({ archetype: { id: 'qwen-image', modeId: 't2i', variantId: 'pro' } }, QWEN).model).toBe('qwen-image-2.0-pro')
  })

  it('Sora Pro 变体：resolution 经 paramOverrides 放宽到 1080p（标准只 720p）', () => {
    const std = specializeArchetypeForVariant(SORA, 'standard')
    const pro = specializeArchetypeForVariant(SORA, 'pro')
    const resOf = (a: ModelArchetype) => a.modes[0].params.find((p) => p.key === 'resolution')!.options.map((o) => o.value)
    expect(resOf(std)).toEqual(['720p'])
    expect(resOf(pro)).toEqual(['720p', '1024p', '1080p'])
  })

  it('Omni 参考图融合：fixedParams 注入 generation_type=reference（避 3 图被拒）', () => {
    const meta = { archetype: { id: 'omni-flash-ext', modeId: 'i2v' } }
    expect(buildArchetypeInputParams(meta, OMNI, { referenceImages: ['a.png', 'b.png', 'c.png'] })).toEqual({
      image_urls: ['a.png', 'b.png', 'c.png'], generation_type: 'reference',
    })
  })

  it('duration 用数值 option 的 select：option value 是 number（发整数避 400）', () => {
    const dur = SORA.modes[0].params.find((p) => p.key === 'duration')!
    expect(dur.type).toBe('select')
    expect(dur.options.map((o) => o.value)).toEqual([4, 8, 12, 16, 20])
  })
})

describe('火山方舟 Seedance — 档案投影', () => {
  const VOLC = getArchetypeById('volcengine-seedance-2')!

  it('四模式：文生 / 首帧 / 首尾帧 / 全能参考；变体为标准/Fast/Mini', () => {
    expect(VOLC.modes.map((m) => m.id)).toEqual(['t2v', 'first', 'firstlast', 'omni'])
    expect(archetypeVariantChoices(VOLC)).toEqual([
      { id: 'standard', label: '标准' },
      { id: 'fast', label: '快速' },
      { id: 'mini', label: 'Mini' },
    ])
  })

  it('首帧模式：ratio 字段 + 默认变体 model 使用火山官方 Model ID', () => {
    const meta = { archetype: { id: 'volcengine-seedance-2', modeId: 'first' }, firstFrameUrl: 'F.png' }
    expect(buildArchetypeInputParams(meta, VOLC)).toEqual({
      volcengine_first_image_content: { type: 'image_url', image_url: { url: 'F.png' }, role: 'first_frame' },
      model: 'doubao-seedance-2-0-260128',
    })
    expect(VOLC.modes[0].params.map((p) => p.key)).toEqual(['ratio', 'resolution', 'duration', 'generate_audio'])
  })

  it('fast 变体：out.model 发 fast Model ID', () => {
    const meta = { archetype: { id: 'volcengine-seedance-2', modeId: 't2v', variantId: 'fast' } }
    expect(buildArchetypeInputParams(meta, VOLC).model).toBe('doubao-seedance-2-0-fast-260128')
  })

  it('mini 变体：out.model 发 mini Model ID', () => {
    const meta = { archetype: { id: 'volcengine-seedance-2', modeId: 't2v', variantId: 'mini' } }
    expect(buildArchetypeInputParams(meta, VOLC).model).toBe('doubao-seedance-2-0-mini-260615')
  })

  it('首尾帧：图像 item 带 first_frame / last_frame role', () => {
    const meta = { archetype: { id: 'volcengine-seedance-2', modeId: 'firstlast' }, firstFrameUrl: 'F.png', lastFrameUrl: 'L.png' }
    expect(buildArchetypeInputParams(meta, VOLC)).toEqual({
      volcengine_first_role_image_content: { type: 'image_url', image_url: { url: 'F.png' }, role: 'first_frame' },
      volcengine_last_role_image_content: { type: 'image_url', image_url: { url: 'L.png' }, role: 'last_frame' },
      model: 'doubao-seedance-2-0-260128',
    })
  })

  it('全能参考：数组参考转成火山 content item 数组，供模板扁平展开', () => {
    const meta = {
      archetype: { id: 'volcengine-seedance-2', modeId: 'omni' },
      referenceImageUrls: ['c1.png'],
      referenceVideoUrls: ['v1.mp4'],
      referenceAudioUrls: ['a1.mp3'],
    }
    expect(buildArchetypeInputParams(meta, VOLC)).toEqual({
      volcengine_image_contents: [{ type: 'image_url', image_url: { url: 'c1.png' }, role: 'reference_image' }],
      volcengine_video_contents: [{ type: 'video_url', video_url: { url: 'v1.mp4' } }],
      volcengine_audio_contents: [{ type: 'audio_url', audio_url: { url: 'a1.mp3' } }],
      model: 'doubao-seedance-2-0-260128',
    })
  })
})
