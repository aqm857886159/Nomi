// 契约钉子：Seedance 2.0 的参考槽上限、跨槽依赖，以及**「没有跨模态合计上限」这条否定结论**。
//
// 2026-08-20 的核实起因：有人照 fal 的模型页
//   https://fal.ai/models/bytedance/seedance-2.0/reference-to-video
//   "Total files across all modalities must not exceed 12."
// 提出「我们的档案漏了合计 ≤12」。按 seedance25Contract.test.ts 头部定下的判据（三家一致才算模型级、
// 才该钉在共享档案上）逐项核实我们真正在用的三条渠道，结论是**证伪**：
//
//   火山方舟（字节自家，模型的一手出处）  https://docs.volcengine.com/docs/82379/2607688?lang=zh
//     「参考素材数量上限 | Seedance 2.0 | 15（9张图+3个视频+3个音频）」  ← 15，不是 12
//   APIMart   https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md
//     全文只分别写 9/3/3，无任何跨模态合计条款
//   即梦 Dreamina  无公开 API 文档
//
// 两点：① 字节自己写的 15 恰好等于 9+3+3，即合计上限与各槽上限之和相等 —— 这条约束**永不咬合**；
//       2.5 同理（方舟 50 = 30+10+10）。② electron/catalog 的 vendor 只有 agnes/apimart/dreamina/
//       modelscope/volcengine，**没有 fal**，那个 12 打不到任何一个 Nomi 用户身上。
// 照 12 钉下去就是重演 2026-08-12 那次「能力是模型有的、被我们的档案掐窄」：用户放满 9 图 + 3 视频后，
// 方舟文档白纸黑字说还能加 3 段音频，我们却在第 12 个拦死。所以本文件也把这条**否定结论**钉住，
// 免得下一个人看到 fal 页面又来加一遍。
import { describe, expect, it } from 'vitest'
import {
  DREAMINA_SEEDANCE_ARCHETYPE,
  SEEDANCE_2_ARCHETYPE,
  SEEDANCE_2_5_ARCHETYPE,
  SEEDANCE_2_5_APIMART_ARCHETYPE,
  SEEDANCE_2_APIMART_ARCHETYPE,
  SEEDANCE_VOLCENGINE_ARCHETYPE,
} from '../../../electron/shared/videoCapabilities'
import type { ModelArchetype } from './types'

/**
 * 逐项抄自官方文档（2026-08-20 核实）：
 *   火山方舟 https://docs.volcengine.com/docs/82379/2298881?lang=zh
 *            「图片数量：seedance 2.0 全模态参考生视频：1~9 张」
 *            「Seedance 2.0 系列：…最多传入 3 个参考视频，所有视频总时长不超过 15 s」
 *            「Seedance 2.0 系列：…最多传入 3 段参考音频，所有音频总时长不超过 15 s」
 *   APIMart  https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md
 *            "Maximum of 9 reference images" / "Maximum of 3 reference videos" / "Maximum of 3 reference audio files"
 * 两家一致 —— 模型级能力，钉在共享档案上是对的。
 */
const DOC_LIMITS = { image_ref: 9, video_ref: 3, audio_ref: 3 } as const

/**
 * **四条**渠道全部走同一套模型级契约（P4 通用第一：档案按模型身份认，供应商只管传输）。
 * kie 那条（seedance.ts）是 2026-08-20 全仓实扫 `kind: "audio_ref"` 才发现的 —— 起初只盯着
 * apimart/volcengine/dreamina 三个档案，漏了它。同一个模型换个中转不会改变「不收纯音频」这件事，
 * 所以四条都得带。**改这里时先扫一遍全仓，别照着记忆里的清单改。**
 */
const CHANNELS_2_0: Array<[string, ModelArchetype, string]> = [
  ['apimart', SEEDANCE_2_APIMART_ARCHETYPE, 'omni'],
  ['volcengine', SEEDANCE_VOLCENGINE_ARCHETYPE, 'omni'],
  ['dreamina', DREAMINA_SEEDANCE_ARCHETYPE, 'multimodal'],
  ['kie', SEEDANCE_2_ARCHETYPE, 'omni'],
]

/** 2.5 的两条渠道 —— 都**不该**有伴随要求（文档已解除），负向钉子对它们一起生效。 */
const CHANNELS_2_5: Array<[string, ModelArchetype]> = [
  ['2.5 kie', SEEDANCE_2_5_ARCHETYPE],
  ['2.5 apimart', SEEDANCE_2_5_APIMART_ARCHETYPE],
]

const omniOf = (archetype: ModelArchetype, modeId: string) => archetype.modes.find((mode) => mode.id === modeId)

describe('Seedance 2.0 archetype vs official docs', () => {
  describe.each(CHANNELS_2_0)('%s', (_vendor, archetype, modeId) => {
    const omni = omniOf(archetype, modeId)

    it('has the multimodal reference mode', () => {
      expect(omni).toBeDefined()
    })

    it.each(Object.entries(DOC_LIMITS))('allows the documented maximum for %s', (kind, max) => {
      const slot = omni?.slots.find((s) => s.kind === kind)
      expect(slot, `全能参考模式缺少 ${kind} 槽`).toBeDefined()
      expect(slot?.max, `${kind} 上限与官方文档不一致`).toBe(max)
    })

    /**
     * 三家一致 = 模型级契约：
     *   火山方舟 https://docs.volcengine.com/docs/82379/2291680?lang=zh
     *            「您可任意组合以下模态内容，注意不支持"文本+音频"、"纯音频" 输入。」
     *   APIMart  "Must be used together with reference images or reference videos"
     *   fal      "requires at least one image or video"
     * 缺了它 → 用户只放一段音频，UI 判定可生成、发出去被服务商拒（原 canRunGenerationNode 只问
     * 「任一数组槽非空」）。声明成 requiresAnyOf 而非写死 if，是因为 2.5 已解除此限（见下一个 describe）。
     */
    it('requires reference audio to be accompanied by an image or a video', () => {
      const audio = omni?.slots.find((s) => s.kind === 'audio_ref')
      expect(audio?.requiresAnyOf, 'audio_ref 未声明跨槽依赖 → 纯音频会被放行到服务商').toBeDefined()
      expect(audio?.requiresAnyOf).toEqual(expect.arrayContaining(['image_ref', 'video_ref']))
    })
  })

  /**
   * 负向钉子。2.5 **解除**了 2.0 的纯音频限制，别在"对齐两代"时手贱补回来：
   *   火山方舟 https://docs.volcengine.com/docs/82379/2607688?lang=zh
   *            「Seedance 2.5 新增支持纯音频参考生成视频，无需搭配图片或视频素材。」
   *   APIMart  "Reference audio: ≤3, total ≤15s → ≤10, total ≤30s; audio-only OK"
   * （fal 的 2.5 页仍写 "at least one reference image or video is required"，与字节自家 + APIMart 相左，
   *  判为陈旧拷贝 —— 一手出处优先于中转转述。）
   */
  it.each(CHANNELS_2_5)('does NOT carry the audio companion requirement on %s — the docs lifted it', (_label, archetype) => {
    const audio = omniOf(archetype, 'omni')?.slots.find((s) => s.kind === 'audio_ref')
    expect(audio, '2.5 omni 缺少 audio_ref 槽').toBeDefined()
    expect(audio?.requiresAnyOf, '2.5 支持纯音频参考，不该有伴随要求').toBeUndefined()
  })

  /**
   * 负向钉子（本轮证伪的结论）：**两代都不该有「跨模态合计上限」**。
   * fal 写 2.0=12 / 2.5=50，但字节自家写 2.0=15（=9+3+3）、2.5=50（=30+10+10）——合计恒等于各槽之和，
   * 永不咬合；且我们没有 fal 渠道。任何形如 maxTotalReferences 的字段出现 = 有人又照 fal 抄了一遍。
   */
  it('carries no cross-modality total cap — fal-only, and non-binding even there', () => {
    const suspects = ['maxTotalReferences', 'maxTotalFiles', 'totalMax', 'maxCombined']
    const all: Array<[string, ModelArchetype, string]> = [
      ...CHANNELS_2_0,
      ...CHANNELS_2_5.map(([label, archetype]): [string, ModelArchetype, string] => [label, archetype, 'omni']),
    ]
    for (const [vendor, archetype, modeId] of all) {
      const omni = omniOf(archetype, modeId)
      for (const key of suspects) {
        expect(omni, `${vendor} 缺少全能参考模式`).toBeDefined()
        expect(Object.hasOwn(omni as object, key), `${vendor} 出现了 ${key}：合计上限已于 2026-08-20 证伪`).toBe(false)
      }
      // 各槽上限之和就是文档写的「参考素材数量上限」（2.0=15、2.5=50），不存在更紧的合计约束。
      const sum = (omni?.slots ?? []).reduce((total, slot) => total + (slot.max ?? 0), 0)
      expect(sum, `${vendor} 各槽上限之和应等于文档的参考素材数量上限`).toBe(vendor.startsWith('2.5') ? 50 : 15)
    }
  })
})
