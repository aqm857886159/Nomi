// 契约钉子：Seedance 2.5 的参考上限与默认比例，必须等于两家官方文档写的数。
//
// 2026-08-12 抓到的真实缺陷：档案里写的是 9 图 / 3 视频 / 3 音频、比例默认 16:9，
// 而 kie 与 apimart 官方文档都是 30 / 10 / 10、默认 adaptive。四个数没一个对的，
// 但文件头注释写着「契约逐项对账自 kie 官方文档」——**注释声称对过，实际没有**。
// 后果不是抽象的：用户想连多段 3D 白膜做分镜，第 4 段就加不进去（白膜正是走参考图/参考视频，
// 两家文档都没有白膜专用字段）。能力是模型有的，是我们的档案把它掐窄了。
//
// 所以这里钉的不只是数字，是「数字类契约必须能追到文档出处」这条纪律。
import { describe, expect, it } from 'vitest'
import { SEEDANCE_2_5_ARCHETYPE } from '../../../electron/shared/videoCapabilities'

/**
 * 逐项抄自官方文档（2026-08-12）：
 *   kie     https://docs.kie.ai/market/bytedance/seedance-2-5
 *           input.reference_image_urls ≤30 / reference_video_urls ≤10 / reference_audio_urls ≤10
 *   apimart https://docs.apimart.ai/cn/api-reference/videos/doubao-seedance-2-5
 *           image_urls ≤30 / video_urls ≤10 / audio_urls ≤10
 * 两家一致 —— 说明这是模型级能力，不是某家中转的限制，所以钉在共享档案上是对的。
 */
const DOC_LIMITS = { image_ref: 30, video_ref: 10, audio_ref: 10 } as const

describe('Seedance 2.5 archetype vs official docs', () => {
  const omni = SEEDANCE_2_5_ARCHETYPE.modes.find((mode) => mode.id === 'omni')

  it('has the omni mode that carries the multimodal references', () => {
    expect(omni).toBeDefined()
  })

  it.each(Object.entries(DOC_LIMITS))('allows the documented maximum for %s', (kind, max) => {
    const slot = omni?.slots.find((s) => s.kind === kind)
    expect(slot, `omni 模式缺少 ${kind} 槽`).toBeDefined()
    expect(slot?.max, `${kind} 上限与官方文档不一致`).toBe(max)
  })

  // 两家文档都写 default=adaptive。曾经默认 16:9 是我们自己填的：首帧/首尾帧场景下
  // 输出比例本就该跟随输入图，写死 16:9 会让用户的竖图被硬掰成横的。
  it('defaults aspect ratio to adaptive, as both docs specify', () => {
    for (const mode of SEEDANCE_2_5_ARCHETYPE.modes) {
      const ratio = mode.params.find((p) => p.key === 'aspect_ratio')
      expect(ratio?.defaultValue, `模式 ${mode.id} 的比例默认值不是 adaptive`).toBe('adaptive')
    }
  })

  // 白膜没有专用字段（两家文档均无），走参考图/参考视频。这条钉住「别再有人以为要加新槽」。
  it('carries no dedicated 3D white-model slot — blockouts ride the normal reference channels', () => {
    const kinds = SEEDANCE_2_5_ARCHETYPE.modes.flatMap((mode) => mode.slots.map((s) => s.kind))
    expect(kinds).not.toContain('mesh_ref')
    expect(omni?.hint).toContain('白膜')
  })

  it('keeps resolution to the two values the API actually accepts', () => {
    const resolution = omni?.params.find((p) => p.key === 'resolution')
    expect(resolution?.options.map((o) => o.value)).toEqual(['480p', '720p'])
  })
})
