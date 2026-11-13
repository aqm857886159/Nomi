// 零花费：付费抽检的样本表在花钱之前就对得上目录与界面——型号真声明了、节点种类对、放好样本参考后底栏方式格就是要验的那一档、叫这个名字、
// 要放的参考正好是那一档的槽、只登记没脚本的那条在花钱之前就拒跑。buildMarkers 能不能在产品源码里找到由 _paidRun.test.mjs 盯。
import { describe, expect, it } from 'vitest'
import { APIMART_IMAGE_MODELS } from '../../electron/catalog/apimartImages.ts'
import { APIMART_VIDEO_MODELS } from '../../electron/catalog/apimartVideos.ts'
import { getArchetypeById } from '../../electron/shared/modelArchetypes/index.ts'
import { archetypeModeChoices } from '../../src/workbench/generationCanvas/nodes/controls/channelModeReach.ts'
import { buildModeMenu, modeRowName } from '../../src/workbench/generationCanvas/nodes/controls/modeMenuModel.ts'
import { modeForInputs } from '../../electron/shared/modelArchetypes/modeForInputs.ts'
import { EDGE_MODE_SLOTS } from '../../electron/shared/canvas/edgeAdmission.ts'
import { UI_LOCALES, uiTextWith } from './full-walk/invariants.mjs'
import { MEDIA_REST_PENDING_SAMPLES, MEDIA_REST_SAMPLES, mediaRestSampleFor, viduSampleWireReceipt, sampleModeRadioName } from './_catalogMediaRestSamples.mjs'

const declared = (kind, modelKey) => (kind === 'image' ? APIMART_IMAGE_MODELS : APIMART_VIDEO_MODELS).find((model) => model.modelKey === modelKey)
const archetypeOf = (kind, modelKey) => getArchetypeById(declared(kind, modelKey)?.archetypeId ?? '')

describe('付费抽检样本表 · catalog-media-rest-real.paid.mjs', () => {
  for (const [modelKey, sample] of Object.entries(MEDIA_REST_SAMPLES)) {
    it(`${modelKey}：在 APIMart ${sample.kind} 目录里声明了、带档案`, () => {
      expect(declared(sample.kind, modelKey), `${modelKey} 是 APIMart ${sample.kind} 型号`).toBeTruthy()
      expect(archetypeOf(sample.kind, modelKey), `${modelKey} 有档案`).toBeTruthy()
    })
  }

  // 生成框按节点当前方式列型号：没放参考 = 文生 / 文生图。没有文字那条 mapping 的型号，不先放参考就挑不到（11-08 演练实测：
  // Vidu Q4 不在菜单里）。所以 referencesFirst 必须和目录一致，而且这种样本必须带参考。
  for (const [modelKey, sample] of Object.entries(MEDIA_REST_SAMPLES)) {
    it(`${modelKey}：先放参考再挑型号（referencesFirst）和目录里有没有文字那条 mapping 一致`, () => {
      const textKind = sample.kind === 'image' ? 'text_to_image' : 'text_to_video'
      const hasText = (declared(sample.kind, modelKey)?.mappings ?? []).some((mapping) => mapping.taskKind === textKind)
      expect(Boolean(sample.referencesFirst), `${modelKey} ${hasText ? '有' : '没有'} ${textKind}`).toBe(!hasText)
      if (sample.referencesFirst) expect(sample.references?.length, `${modelKey} 先放参考，就得有参考`).toBeGreaterThan(0)
    })
  }

  const withMode = Object.entries(MEDIA_REST_SAMPLES).filter(([, sample]) => sample.modeId)
  for (const [modelKey, sample] of withMode) {
    it(`${modelKey}：放好样本参考后，底栏方式格就是「${sample.modeId}」，菜单里那一行能点，中英两轨都叫样本写的那个名字`, () => {
      const archetype = archetypeOf(sample.kind, modelKey)
      // 真人从「+」上传参考：每张都是一条上传输入（和 collectModeInputs 同一份槽表）。
      const inputs = (sample.references ?? []).map(() => ({ slots: EDGE_MODE_SLOTS.reference, asset: 'image' }))
      const resolved = modeForInputs(archetype, inputs, { modeId: sample.modeId, chosenBy: 'human' })
      expect(resolved.mode.id, `${modelKey} 放 ${inputs.length} 张、手选 ${sample.modeId} 时真按它发`).toBe(sample.modeId)
      const menu = buildModeMenu({ nodeKind: 'video', archetype, visible: archetypeModeChoices(archetype), inputs, resolvedModeId: resolved.mode.id })
      expect(menu, `${modelKey} 有不止一种方式，底栏有方式格`).toBeTruthy()
      const row = menu.rows.find((item) => item.id === sample.modeId)
      expect(row?.disabled, `${sample.modeId} 那一行能点`).toBe(false)
      for (const locale of UI_LOCALES) {
        const t = (key, values) => uiTextWith(locale, key, values ?? {})
        expect(modeRowName(t, row)).toMatch(sampleModeRadioName(sample))
        // 名字只认这一档：别的行不许也匹配上（点错档会花在别的方式上）。
        expect(menu.rows.filter((item) => sampleModeRadioName(sample).test(modeRowName(t, item))).map((item) => item.id)).toEqual([sample.modeId])
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
    expect(mediaRestSampleFor('gemini-omni-1.2-flash-ext')).toBe(MEDIA_REST_SAMPLES['gemini-omni-1.2-flash-ext'])
  })

  it('Vidu 样本要求一条明确角色且没有额外参考键的提交', () => {
    expect(mediaRestSampleFor('viduq4-preview')).toBe(MEDIA_REST_SAMPLES['viduq4-preview'])
    const url = 'https://assets.example.com/ref.png'
    const body = {model:'viduq4-preview', image_with_roles:[{url,role:'reference_image'}]}
    const entry = (data) => ({kind:'allowed-request', method:'POST', url:'https://api.apimart.ai/v1/videos/generations', body:{text: JSON.stringify(data)}})
    expect(viduSampleWireReceipt([entry(body)]).roles).toEqual(['reference_image'])
    for (const other of [{image_urls:[url]}, {first_frame_image:url}, {image_with_roles:[{url,role:'first_frame'}]}]) {
      expect(() => viduSampleWireReceipt([entry({...body,...other})])).toThrow(/单图参考/)
    }
    expect(() => viduSampleWireReceipt([entry(body), entry(body)])).toThrow(/一条完整/)
  })
})
