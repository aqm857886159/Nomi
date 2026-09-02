// U4 · 模式栏按可达性收窄的判据钉死。
//
// 为什么单独一份而不是塞进 archetypeMeta.test：这条判据的**爆炸半径**是「用户看不到某个模式」——
// 收窄错了没有任何报错，只是模式栏悄悄少一格，谁也不会注意到。所以它的三个边界（(a) 无 mapping、
// (b) 全 none、fail-open）必须逐条有自己的用例，而不是混在一大堆槽映射断言里；外加一条**回归锁**，
// 钉住「承载力缩水不是隐藏理由」（曾经的判据 (c)，实测会误杀真功能，已删——详见下方用例注释）。
//
// 判据本身复用 electron/catalog/referenceReachability（与第三闸同一把尺子），这里只测「模式级」那层包装。
import { describe, it, expect } from 'vitest'
import type { ArchetypeMode } from '../../../../config/modelArchetypes'
import { getArchetypeById } from '../../../../config/modelArchetypes'
import { modeSlotReach } from '../../../../../electron/catalog/referenceReachability'
import {
  archetypeModeChoices,
  archetypeModeIsVisible,
  archetypeVariantAxisIsLive,
  fallbackVisibleModeId,
} from './channelModeReach'

/** 最小合法模式（只填判据用得上的字段，其余走档案类型的必填缺省）。 */
function mode(id: string, slots: ArchetypeMode['slots'], extra: Partial<ArchetypeMode> = {}): ArchetypeMode {
  return {
    id,
    intent: 'text',
    vendorTerm: id,
    hint: '',
    slots,
    params: [],
    promptRequired: true,
    ...extra,
  }
}

// 一条「只有单图聚合位」的渠道 body：通用中转最小模板。多图槽在它上面只过得去 1 张。
const AGGREGATE_ONLY_BODY = { image: '{{request.params.image_url}}', prompt: '{{request.prompt}}' }
// 一条真的带多图数组键的 body。
const MULTI_IMAGE_BODY = { reference_image_urls: '{{request.params.reference_image_urls}}' }
// 一条完全不带任何参考键、只发提示词的 body。
const TEXT_ONLY_BODY = { prompt: '{{request.prompt}}', duration: '{{request.params.duration}}' }

/**
 * 造一条 `ModeChannelBody`。`wireParamKeys` = 这条 create op 真正引用的 canonical 键
 * （生产里由 wireReferencedParamKeys 从 body + 进程 args 并集算出）；模式收窄用不到它，
 * 只有变体轴收窄看它里面有没有 `model`，所以这里默认给空、按用例显式传。
 */
function channel(body: unknown, wireParamKeys: string[] = []) {
  return { body, wireParamKeys }
}

describe('archetypeModeIsVisible — 模式栏收窄判据', () => {
  // ⚠️ 回归锁：曾有第三条判据「多图槽（max>1）塌成单图聚合位 → 隐藏」，全仓实测后**删除**。
  // 它只命中一个目标：runway/grok_imagine_1_5/i2v —— Runway 的 Grok **确实支持**图生视频（一次一张），
  // 档案里的 max=7 是 apimart 那条线的容量。按那条判据它会被隐藏 = 删掉一个真能用的功能。
  // 真正名不副实的那些（happyhorse 的多图参考等）在 U1/U3 之后压根没有自己的 mapping，落判据 (a)。
  // 结论：承载力缩水是**槽级**的事（槽如实收成 1 张），不是隐藏整个模式的理由。
  it('多图槽（max>1）只拿到单图聚合位 → **仍然可见**（回归锁：别再按缩水隐藏，会误杀真功能）', () => {
    const i2vLike = mode('i2v', [{ kind: 'image_ref', label: '参考图', min: 1, max: 7 }])
    // 先证明现场：这条渠道确实只给了它单图聚合位（reach=single，不是「完全发不出」）——否则这条用例
    // 会被 (b) 顺手判掉，锁的就不是「不再按缩水隐藏」这件事。
    expect(modeSlotReach(i2vLike.slots, AGGREGATE_ONLY_BODY)).toEqual(['single'])
    expect(archetypeModeIsVisible(i2vLike, channel(AGGREGATE_ONLY_BODY))).toBe(true)
    expect(archetypeModeIsVisible(i2vLike, channel(MULTI_IMAGE_BODY))).toBe(true)
  })

  it('max=1 的单图槽拿到单图聚合位是**如实兑现**，不隐藏', () => {
    const i2v = mode('i2v', [{ kind: 'first_frame', label: '首帧', min: 1, max: 1 }])
    expect(archetypeModeIsVisible(i2v, channel(AGGREGATE_ONLY_BODY))).toBe(true)
  })

  it('(b) 声明了参考槽却**全部** reach=none → 隐藏', () => {
    const ref = mode('reference', [{ kind: 'video_ref', label: '参考视频', min: 1, max: 3 }])
    expect(archetypeModeIsVisible(ref, channel(TEXT_ONLY_BODY))).toBe(false)
  })

  it('(b) 只要**有一个**槽发得出就不隐藏（首尾帧只过得去首帧时，模式仍在，收窄交给槽级）', () => {
    const firstlast = mode('firstlast', [
      { kind: 'first_frame', label: '首帧', min: 1, max: 1 },
      { kind: 'last_frame', label: '尾帧', min: 1, max: 1 },
    ])
    expect(archetypeModeIsVisible(firstlast, channel(AGGREGATE_ONLY_BODY))).toBe(true)
  })

  it('(a) 桶已知但这个模式没有自己的 mapping（null）→ 隐藏', () => {
    const omni = mode('omni', [{ kind: 'image_ref', label: '角色参考', min: 1, max: 10 }])
    expect(archetypeModeIsVisible(omni, null)).toBe(false)
  })

  it('零槽的纯文生模式**永不**隐藏——哪怕 body 一个参考键都没有', () => {
    const t2v = mode('t2v', [])
    expect(archetypeModeIsVisible(t2v, channel(TEXT_ONLY_BODY))).toBe(true)
    expect(archetypeModeIsVisible(t2v, channel(AGGREGATE_ONLY_BODY))).toBe(true)
    expect(archetypeModeIsVisible(t2v, channel({}))).toBe(true)
  })

  it('(a) 例外：零槽文生模式即使 mapping 取不到也隐藏——它确实发不出去', () => {
    // 判据 (a) 先于「零槽豁免」：没有线缆就是没有线缆，与槽无关。
    expect(archetypeModeIsVisible(mode('t2v', []), null)).toBe(false)
  })

  it('fail-open：拿不到 body（undefined）→ 一个都不收窄', () => {
    const omni = mode('omni', [{ kind: 'image_ref', label: '角色参考', min: 1, max: 10 }])
    const ref = mode('reference', [{ kind: 'video_ref', label: '参考视频', min: 1, max: 3 }])
    expect(archetypeModeIsVisible(omni, undefined)).toBe(true)
    expect(archetypeModeIsVisible(ref, undefined)).toBe(true)
    expect(archetypeModeIsVisible(mode('t2v', []), undefined)).toBe(true)
  })

  it('body 完全不引用任何参数（纯静态）→ 判不出来，不收窄（与第三闸同口径）', () => {
    const omni = mode('omni', [{ kind: 'image_ref', label: '角色参考', min: 1, max: 10 }])
    expect(archetypeModeIsVisible(omni, channel({ model: 'x', prompt: 'literal' }))).toBe(true)
  })
})

describe('archetypeModeChoices — 收窄接进模式栏', () => {
  const SEEDANCE = getArchetypeById('seedance-2')!

  it('不传 bodyForMode → 原样返回全部模式（老调用方零行为变化）', () => {
    expect(archetypeModeChoices(SEEDANCE).map((c) => c.id)).toEqual(SEEDANCE.modes.map((m) => m.id))
  })

  it('全部 undefined（拿不到 body）→ 仍是全部模式，绝不因为查不到就藏用户的模式', () => {
    expect(archetypeModeChoices(SEEDANCE, () => undefined).map((c) => c.id)).toEqual(
      SEEDANCE.modes.map((m) => m.id),
    )
  })

  it('只有单图聚合位的渠道：能挤进单图位的模式全部留下，缩水交给槽级如实收成 1 张', () => {
    const ids = archetypeModeChoices(SEEDANCE, () => (channel(AGGREGATE_ONLY_BODY))).map((c) => c.id)
    expect(ids).toContain('t2v')
    expect(ids).toContain('first')
    // omni 在这条渠道上只过得去 1 张，但它**不该**因此被摘掉（见上方回归锁）。
    expect(ids).toContain('omni')
  })

  it('这条渠道一个参考键都不带 → 有槽的模式全被摘掉，只剩纯文生', () => {
    const ids = archetypeModeChoices(SEEDANCE, () => (channel(TEXT_ONLY_BODY))).map((c) => c.id)
    expect(ids).toEqual(['t2v'])
  })

  it('这个模式在这家没有自己的 mapping（null）→ 摘掉；判据 (a) 接进模式栏', () => {
    const ids = archetypeModeChoices(SEEDANCE, (m) => (m.id === 'omni' ? null : channel(MULTI_IMAGE_BODY))).map((c) => c.id)
    expect(ids).not.toContain('omni')
    expect(ids).toContain('t2v')
  })
})

describe('archetypeVariantAxisIsLive — 变体选择器该不该出现', () => {
  it('渠道把 model 参数化 → 变体真的会改发出去的串 → 显示', () => {
    expect(archetypeVariantAxisIsLive(channel({ model: '{{request.params.model}}' }, ['model']))).toBe(true)
  })

  it('渠道把 model 写成字面量 → 切变体什么也不会发生 → 藏掉（Runway 的情形）', () => {
    expect(archetypeVariantAxisIsLive(channel({ model: 'veo3.1' }, ['duration', 'ratio']))).toBe(false)
  })

  // 即梦（dreamina）没有 body，参数全在 create.process.args 里（--model_version={{request.params.model}}）。
  // 生产侧 wireReferencedParamKeys 取 body ∪ process.args 的并集，所以它的 6 个变体照常显示。
  // 只扫 body 的话这里会是 false = 把一个活着的变体选择器藏掉——实测差点踩中，故单列一条锁住。
  it('进程型渠道（无 body、model 在 CLI args 里）→ 仍算活，别把即梦的变体藏掉', () => {
    expect(archetypeVariantAxisIsLive(channel(undefined, ['duration', 'ratio', 'model']))).toBe(true)
  })

  it('fail-open：查不到（undefined）或该模式无线缆（null）→ 都不收窄', () => {
    expect(archetypeVariantAxisIsLive(undefined)).toBe(true)
    expect(archetypeVariantAxisIsLive(null)).toBe(true)
  })
})

describe('fallbackVisibleModeId — 选中的模式被收窄掉时的落点', () => {
  const SEEDANCE = getArchetypeById('seedance-2')!
  const metaOn = (modeId: string) => ({ archetype: { id: SEEDANCE.id, modeId } })

  it('当前模式仍可见 → null（幂等，不写 meta、不占撤销）', () => {
    expect(fallbackVisibleModeId(SEEDANCE, metaOn('first'), ['t2v', 'first'])).toBeNull()
  })

  it('当前模式被藏掉 → 落到档案 defaultModeId（若它可见）', () => {
    expect(SEEDANCE.defaultModeId).toBe('t2v')
    expect(fallbackVisibleModeId(SEEDANCE, metaOn('omni'), ['t2v', 'first'])).toBe('t2v')
  })

  it('defaultModeId 也被藏掉 → 落到第一个可见模式', () => {
    expect(fallbackVisibleModeId(SEEDANCE, metaOn('omni'), ['first', 'firstlast'])).toBe('first')
  })

  it('一个可见的都没有 → null：收窄已不可信，宁可原样留着也不把节点钉到另一个发不出的模式上', () => {
    expect(fallbackVisibleModeId(SEEDANCE, metaOn('omni'), [])).toBeNull()
  })
})
