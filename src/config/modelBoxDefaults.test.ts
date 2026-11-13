import { describe, expect, it } from 'vitest'
import { APIMART_IMAGE_MODELS } from '../../electron/catalog/apimartImages'
import { APIMART_VIDEO_MODELS } from '../../electron/catalog/apimartVideos'
import { CANONICAL_MODEL_IDS } from '../../electron/catalog/seedModelIdentity'
import { getArchetypeById } from '../../electron/shared/modelArchetypes'
import type { ModelBoxPreferenceSettings } from '../../electron/shared/contracts/modelBoxPreference'
import { applyModelBoxDefaults, isModelBoxTouched, registeredModelBoxDefaultKeys } from './modelBoxDefaults'

const untouched: ModelBoxPreferenceSettings = { schemaVersion: 1, modelOrder: [], hiddenModelIds: [], preferredVendorByModel: {} }
const rows = (...keys: string[]) => keys.map((key) => ({ key }))

describe('模型框默认顺序 / 默认收起（只给没整理过的创作者）', () => {
  it('没整理过：按默认顺序排，没列的排在后面且保持原序；默认收起的标出来', () => {
    const result = applyModelBoxDefaults(rows('some-new-model', 'seedance 2.0#fast', 'seedance 2.5', 'pixverse v6'), untouched)
    expect(result.map(({ row }) => row.key)).toEqual(['seedance 2.5', 'seedance 2.0#fast', 'some-new-model', 'pixverse v6'])
    expect(result.map(({ collapsed }) => collapsed)).toEqual([false, false, false, true])
  })

  it('整理过（排过序 / 藏过任一）：一个字节不动——顺序原样、一个都不收', () => {
    const input = rows('pixverse v6', 'seedance 2.5', 'seedance 2.0#fast')
    for (const preference of [
      { ...untouched, modelOrder: ['pixverse v6'] },
      { ...untouched, hiddenModelIds: ['z-image turbo'] },
    ]) {
      expect(isModelBoxTouched(preference)).toBe(true)
      const result = applyModelBoxDefaults(input, preference)
      expect(result.map(({ row }) => row.key)).toEqual(input.map(({ key }) => key))
      expect(result.every(({ collapsed }) => !collapsed)).toBe(true)
    }
  })

  it('只记过「这个模型走哪家」不算整理过（那不是在整理模型框）', () => {
    expect(isModelBoxTouched({ ...untouched, preferredVendorByModel: { 'seedance 2.5': 'apimart' } })).toBe(false)
    expect(isModelBoxTouched(null)).toBe(false)
  })

  it('整模型一行（分镜等不展开变体的页面）：名下有一个变体默认显示，这个模型就显示；全收才收', () => {
    const result = applyModelBoxDefaults(rows('veo 3.1', 'vidu q3', 'seedance 2.0'), undefined)
    const byKey = new Map(result.map(({ row, collapsed }) => [row.key, collapsed]))
    expect(byKey.get('veo 3.1')).toBe(false)
    expect(byKey.get('vidu q3')).toBe(true)
    expect(byKey.get('seedance 2.0')).toBe(false)
    // 整模型键按它名下最靠前的变体位排。
    expect(result.map(({ row }) => row.key).indexOf('seedance 2.0')).toBeLessThan(result.map(({ row }) => row.key).indexOf('veo 3.1'))
  })

  it('名单里写了、仓库里没有的名字：什么也不发生（只按行键匹配）', () => {
    expect(applyModelBoxDefaults(rows('seedance 2.5'), untouched)).toEqual([{ row: { key: 'seedance 2.5' }, collapsed: false }])
  })

  it('名单里每一个键都对得上真实的 APIMart 目录行（档案改名 / 删行时这里会红）', () => {
    const real = new Set<string>()
    for (const model of [...APIMART_VIDEO_MODELS, ...APIMART_IMAGE_MODELS] as Array<{ modelKey: string; labelZh: string; archetypeId: string }>) {
      const canon = CANONICAL_MODEL_IDS[model.modelKey] ?? model.labelZh.trim().toLowerCase().replace(/\s+/g, ' ')
      real.add(canon)
      for (const variant of getArchetypeById(model.archetypeId)?.variants ?? []) real.add(`${canon}#${variant.id}`)
    }
    expect(registeredModelBoxDefaultKeys().filter((key) => !real.has(key))).toEqual([])
  })
})
