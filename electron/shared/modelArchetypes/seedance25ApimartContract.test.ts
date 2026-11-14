// 契约钉子：Seedance 2.5 · apimart 通道。数字与约束逐项对账自
// https://docs.apimart.ai/cn/api-reference/videos/doubao-seedance-2-5（2026-08-12）。
//
// 这条与 kie 版（seedance25Contract.test.ts）成对：同一个模型、两条通道，能力形状必须一致，
// 差的只该是字段名与供应商硬约束。谁哪天只改了一边，这两个文件会分叉——那正是要被发现的。
import { describe, expect, it } from 'vitest'
import {
  SEEDANCE_2_5_APIMART_ARCHETYPE,
  SEEDANCE_2_5_ARCHETYPE,
} from '../videoCapabilities'
import { resolveArchetypeForModel } from './index'

const DOC_LIMITS = { image_ref: 30, video_ref: 10, audio_ref: 10 } as const
/** apimart 官方字段名（与 kie 的 reference_*_urls 不同——这正是要独立档案的原因）。 */
const DOC_INPUT_KEYS = { image_ref: 'image_urls', video_ref: 'video_urls', audio_ref: 'audio_urls' } as const

const omni = SEEDANCE_2_5_APIMART_ARCHETYPE.modes.find((m) => m.id === 'omni')

describe('Seedance 2.5 · apimart vs official docs', () => {
  it.each(Object.entries(DOC_LIMITS))('allows the documented maximum for %s', (kind, max) => {
    expect(omni?.slots.find((s) => s.kind === kind)?.max).toBe(max)
  })

  it.each(Object.entries(DOC_INPUT_KEYS))('sends %s under the apimart field name', (kind, key) => {
    expect(omni?.slots.find((s) => s.kind === kind)?.inputKey).toBe(key)
  })

  // 官方硬约束：首尾帧类模式 size 必须 adaptive。用 fixedParams 发常量，而不是留一个
  // 只有一个选项的假下拉——「可点即有效」（设计系统 C1），不能选的东西就别渲染成能选的。
  it.each(['first', 'firstlast'])('pins size to adaptive in %s mode and shows no ratio control', (modeId) => {
    const mode = SEEDANCE_2_5_APIMART_ARCHETYPE.modes.find((m) => m.id === modeId)
    expect(mode?.fixedParams?.size, `${modeId} 模式没把 size 钉成 adaptive`).toBe('adaptive')
    expect(mode?.params.some((p) => p.key === 'size'), `${modeId} 模式仍渲染了比例控件（用户选了也无效）`).toBe(false)
  })

  // apimart 用 image_with_roles 角色数组表达首尾帧，不是 kie 的独立 first_frame_url/last_frame_url。
  it.each(['first', 'firstlast'])('combines %s frames into image_with_roles', (modeId) => {
    const mode = SEEDANCE_2_5_APIMART_ARCHETYPE.modes.find((m) => m.id === modeId)
    expect(mode?.combineSlotsInto?.key).toBe('image_with_roles')
  })

  it('uses size (not aspect_ratio) and defaults it to adaptive', () => {
    const size = SEEDANCE_2_5_APIMART_ARCHETYPE.modes.find((m) => m.id === 't2v')?.params.find((p) => p.key === 'size')
    expect(size?.defaultValue).toBe('adaptive')
  })

  // 文档页（2026-11-12 取）原文：「Resolution supports 480p / 720p / 1080p」「(2.0’s 4k is not available on 2.5)」；
  // 参数节：「Resolution — only: 480p / 720p (default) / 1080p. Unsupported values like 2k / 4k return a sync 400.」
  // 8 月那版页面只写 480p / 720p，档案跟着只有两档；页面现已加上 1080p。每一种方式（含首帧 / 首尾帧）都带清晰度控件。
  it('offers exactly 480p / 720p / 1080p, default 720p (2k / 4k are rejected upstream)', () => {
    for (const mode of SEEDANCE_2_5_APIMART_ARCHETYPE.modes) {
      const resolution = mode.params.find((p) => p.key === 'resolution')
      expect(resolution?.options.map((o) => o.value), `${mode.id} 清晰度档位`).toEqual(['480p', '720p', '1080p'])
      expect(resolution?.defaultValue, `${mode.id} 清晰度默认值`).toBe('720p')
    }
  })
})

// 文档页（2026-11-12 取）原文：
//   「`edit` | Video edit | At least one item in `video_urls`; `size` must be `adaptive` (or omitted); `duration` must be `-1` (or omitted)」
//   「`extend` | Video extend | At least one item in `video_urls`; `size` must be `adaptive` (or omitted)」
//   「If `edit` omits `duration`, the platform sets it to `-1`.」「Output container: `mp4` (default) / `mov`」「watermark … Default `false`」
describe('Seedance 2.5 · apimart whole-page alignment (edit / extend / watermark / output_format)', () => {
  const mode = (id: string) => SEEDANCE_2_5_APIMART_ARCHETYPE.modes.find((m) => m.id === id)

  it.each(['edit', 'extend'])('%s mode declares the sub-task type, adaptive size and a required source video', (id) => {
    expect(mode(id)?.fixedParams?.omni_reference_task_type).toBe(id)
    expect(mode(id)?.fixedParams?.size).toBe('adaptive')
    expect(mode(id)?.params.some((p) => p.key === 'size')).toBe(false)
    const video = mode(id)?.slots.find((s) => s.kind === 'video_ref')
    expect(video?.min).toBe(1)
    expect(video?.inputKey).toBe('video_urls')
  })

  it('edit mode has no duration control (platform fills -1); extend keeps 4-30 seconds', () => {
    expect(mode('edit')?.params.some((p) => p.key === 'duration')).toBe(false)
    const duration = mode('extend')?.params.find((p) => p.key === 'duration')
    expect([duration?.min, duration?.max]).toEqual([4, 30])
  })

  it.each(['t2v', 'first', 'firstlast', 'omni', 'edit', 'extend'])('%s exposes watermark (default off) and output container mp4 / mov', (id) => {
    const params = mode(id)?.params ?? []
    expect(params.find((p) => p.key === 'watermark')?.defaultValue).toBe(false)
    const format = params.find((p) => p.key === 'output_format')
    expect(format?.options.map((o) => o.value)).toEqual(['mp4', 'mov'])
    expect(format?.defaultValue).toBe('mp4')
  })
})

describe('Seedance 2.5 identity routing', () => {
  // 末段匹配抢档案是这套解析栽过的坑（"Tongyi-MAI/Z-Image-Turbo" 被 z-image-turbo 抢走）。
  // 2.5 现在有 kie / apimart 两个档案 + 2.0 也有 apimart 档案，三者 key 形近，钉死各归各。
  it.each([
    ['doubao-seedance-2.5', 'seedance-2.5-apimart'],
    ['bytedance/seedance-2-5', 'seedance-2.5'],
    ['doubao-seedance-2.0', 'seedance-2-apimart'],
  ])('routes %s to %s', (modelKey, expectedId) => {
    expect(resolveArchetypeForModel({ modelKey, vendorKey: null })?.id).toBe(expectedId)
  })

  // 同一个模型两条通道，能力形状必须一致——差的只该是字段名与供应商硬约束。
  it('keeps the same capability shape as the kie channel', () => {
    // apimart 官方页多两个方式（视频编辑 / 续写，2026-11-12 整页对齐），kie 那条通道没有：kie 有的方式 apimart 都必须有。
    const modeIds = (a: typeof SEEDANCE_2_5_ARCHETYPE) => a.modes.map((m) => m.id).sort()
    expect(modeIds(SEEDANCE_2_5_APIMART_ARCHETYPE)).toEqual([...modeIds(SEEDANCE_2_5_ARCHETYPE), 'edit', 'extend'].sort())

    const kieOmni = SEEDANCE_2_5_ARCHETYPE.modes.find((m) => m.id === 'omni')
    const limit = (mode: typeof kieOmni, kind: string) => mode?.slots.find((s) => s.kind === kind)?.max
    for (const kind of Object.keys(DOC_LIMITS)) {
      expect(limit(omni, kind), `${kind} 上限两条通道不一致`).toBe(limit(kieOmni, kind))
    }
  })
})
