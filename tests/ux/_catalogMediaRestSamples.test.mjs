// 零花费：付费抽检的样本表在花钱之前就对得上目录与界面——型号真声明了、节点种类对、要切的方式在参数面板里叫这个名字、
// 要放的参考正好是那一档的槽、只登记没脚本的那条在花钱之前就拒跑。buildMarkers 能不能在产品源码里找到由 _paidRun.test.mjs 盯。
import { describe, expect, it } from 'vitest'
import { APIMART_IMAGE_MODELS } from '../../electron/catalog/apimartImages.ts'
import { APIMART_VIDEO_MODELS } from '../../electron/catalog/apimartVideos.ts'
import { getArchetypeById } from '../../electron/shared/modelArchetypes/index.ts'
import { archetypeModeChoices } from '../../src/workbench/generationCanvas/nodes/controls/channelModeReach.ts'
import { modePresentationTexts, presentGenerationModes } from '../../src/workbench/generationCanvas/nodes/controls/generationModePresentation.ts'
import { UI_LOCALES, uiTextWith } from './full-walk/invariants.mjs'
import { MEDIA_REST_PENDING_SAMPLES, MEDIA_REST_SAMPLES, mediaRestSampleFor, sampleModeRadioName } from './_catalogMediaRestSamples.mjs'

const declared = (kind, modelKey) => (kind === 'image' ? APIMART_IMAGE_MODELS : APIMART_VIDEO_MODELS).find((model) => model.modelKey === modelKey)
const archetypeOf = (kind, modelKey) => getArchetypeById(declared(kind, modelKey)?.archetypeId ?? '')

describe('付费抽检样本表 · catalog-media-rest-real.paid.mjs', () => {
  for (const [modelKey, sample] of Object.entries(MEDIA_REST_SAMPLES)) {
    it(`${modelKey}：在 APIMart ${sample.kind} 目录里声明了、带档案`, () => {
      expect(declared(sample.kind, modelKey), `${modelKey} 是 APIMart ${sample.kind} 型号`).toBeTruthy()
      expect(archetypeOf(sample.kind, modelKey), `${modelKey} 有档案`).toBeTruthy()
    })
  }

  const withMode = Object.entries(MEDIA_REST_SAMPLES).filter(([, sample]) => sample.modeId)
  for (const [modelKey, sample] of withMode) {
    it(`${modelKey}：要切的「${sample.modeId}」在参数面板「生成方式」里，中英两轨都叫样本写的那个名字`, () => {
      const archetype = archetypeOf(sample.kind, modelKey)
      for (const locale of UI_LOCALES) {
        const presentation = presentGenerationModes({
          archetype, visibleChoices: archetypeModeChoices(archetype), activeModeId: archetype.defaultModeId, kind: sample.kind,
          texts: modePresentationTexts((key, values) => uiTextWith(locale, key, values ?? {})),
        })
        expect(presentation.where, `${modelKey} 的方式在参数面板里切`).toBe('panel')
        const choice = presentation.choices.find((item) => item.id === sample.modeId)
        expect(choice, `${locale}：分段里有 ${sample.modeId}`).toBeTruthy()
        expect(choice.label).toMatch(sampleModeRadioName(sample))
        // 名字只认这一档：别的分段不许也匹配上（点错档会花在别的方式上）。
        expect(presentation.choices.filter((item) => sampleModeRadioName(sample).test(item.label)).map((item) => item.id)).toEqual([sample.modeId])
      }
    })

    it(`${modelKey}：要放的参考正好是「${sample.modeId}」那一档的槽、张数在上下限内`, () => {
      const mode = archetypeOf(sample.kind, modelKey).modes.find((item) => item.id === sample.modeId)
      const wanted = sample.references ?? []
      for (const slot of mode.slots) {
        const count = wanted.filter((reference) => reference.slot === slot.kind).length
        expect(count, `${slot.kind} 至少 ${slot.min}`).toBeGreaterThanOrEqual(slot.min)
        if (slot.max !== undefined) expect(count, `${slot.kind} 至多 ${slot.max}`).toBeLessThanOrEqual(slot.max)
      }
      expect(wanted.every((reference) => mode.slots.some((slot) => slot.kind === reference.slot)), '没有放进这一档没有的槽').toBe(true)
      expect(new Set(wanted.map((reference) => reference.file)).size, '每张参考图文件名不同').toBe(wanted.length)
    })
  }

  it('按官方文档对齐的三处各有一条样本：Ext 首尾帧两张、Vidu Q4 参考生只放 1 张、Grok 图片官方通道', () => {
    expect(MEDIA_REST_SAMPLES['gemini-omni-1.2-flash-ext']).toMatchObject({ kind: 'video', modeId: 'firstlast' })
    expect(MEDIA_REST_SAMPLES['gemini-omni-1.2-flash-ext'].references.map((item) => item.slot)).toEqual(['first_frame', 'last_frame'])
    expect(MEDIA_REST_SAMPLES['viduq4-preview']).toMatchObject({ kind: 'video', modeId: 'ref' })
    expect(MEDIA_REST_SAMPLES['viduq4-preview'].references).toHaveLength(1)
    expect(MEDIA_REST_SAMPLES['grok-imagine-image-2.0']).toMatchObject({ kind: 'image' })
    for (const key of ['gemini-omni-1.2-flash-ext', 'viduq4-preview', 'grok-imagine-image-2.0']) {
      expect(MEDIA_REST_SAMPLES[key].buildMarkers?.length, `${key} 带修复标记（产物里没有就拒跑）`).toBeGreaterThan(0)
    }
  })

  it('Run 路角色参考只登记：型号与方式真存在，计划点到它在花钱之前就拒跑，写明归 A4h 线', () => {
    for (const [id, pending] of Object.entries(MEDIA_REST_PENDING_SAMPLES)) {
      const archetype = archetypeOf('video', pending.modelKey)
      expect(archetype?.modes.some((mode) => mode.id === pending.modeId), `${id}：${pending.modelKey}/${pending.modeId} 存在`).toBe(true)
      expect(pending.expectedUsd).toBeGreaterThan(0)
      expect(MEDIA_REST_SAMPLES[id], '不和可跑的样本同名').toBeUndefined()
      expect(() => mediaRestSampleFor(id)).toThrow(/脚本待写，归 A4h 线/)
    }
    expect(Object.keys(MEDIA_REST_PENDING_SAMPLES)).toContain('wan2.7#run-path-role-reference')
  })

  it('不在表里的型号花钱之前就拒跑', () => {
    expect(() => mediaRestSampleFor('not-a-sample')).toThrow(/不在付费抽检样本表里/)
    expect(mediaRestSampleFor('viduq4-preview')).toBe(MEDIA_REST_SAMPLES['viduq4-preview'])
  })
})
