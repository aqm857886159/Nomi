import { describe, expect, it } from 'vitest'
import { APIMART_IMAGE_MODELS } from '../../electron/catalog/apimartImages'
import { APIMART_VIDEO_MODELS } from '../../electron/catalog/apimartVideos'
import { getArchetypeById } from '../../electron/shared/modelArchetypes'
import type { ModelBoxPreferenceSettings } from '../../electron/shared/contracts/modelBoxPreference'
import { applyModelBoxDefaults, isModelBoxTouched, registeredModelBoxDefaultKeys } from './modelBoxDefaults'
import type { DedupedModel } from './modelIdentity'

const untouched: ModelBoxPreferenceSettings = { schemaVersion: 1, modelOrder: [], hiddenModelIds: [], preferredVendorByModel: {} }

/** 一行 = 一个模型（各家 modelKey 列出）+ 可选的变体 id。 */
function row(modelKey: string, variantId?: string, ...otherKeys: string[]) {
  const model: Pick<DedupedModel, 'providers'> = {
    providers: [modelKey, ...otherKeys].map((key) => ({ vendor: 'v', modelKey: key, option: { value: `v:${key}`, label: key, modelKey: key } })),
  }
  const id = [modelKey, variantId].filter(Boolean).join('#')
  return { id, model, ...(variantId ? { variant: { id: variantId } } : {}) }
}
const ids = (result: Array<{ row: { id: string } }>) => result.map(({ row: r }) => r.id)

describe('模型框默认顺序 / 默认收起（只给没整理过的创作者）', () => {
  it('没整理过：按默认顺序排，没列的排在后面且保持原序；默认收起的标出来', () => {
    const result = applyModelBoxDefaults(
      [row('some-new-model'), row('doubao-seedance-2.0', 'fast'), row('doubao-seedance-2.5'), row('pixverse-v6')],
      untouched,
    )
    expect(ids(result)).toEqual(['doubao-seedance-2.5', 'doubao-seedance-2.0#fast', 'some-new-model', 'pixverse-v6'])
    expect(result.map(({ collapsed }) => collapsed)).toEqual([false, false, false, true])
  })

  it('整理过（排过序 / 藏过任一）：一个字节不动——顺序原样、一个都不收', () => {
    const input = [row('pixverse-v6'), row('doubao-seedance-2.5'), row('doubao-seedance-2.0', 'fast')]
    for (const preference of [
      { ...untouched, modelOrder: ['pixverse v6'] },
      { ...untouched, hiddenModelIds: ['z-image turbo'] },
    ]) {
      expect(isModelBoxTouched(preference)).toBe(true)
      const result = applyModelBoxDefaults(input, preference)
      expect(ids(result)).toEqual(ids(input.map((r) => ({ row: r }))))
      expect(result.every(({ collapsed }) => !collapsed)).toBe(true)
    }
  })

  it('只记过「这个模型走哪家」不算整理过（那不是在整理模型框）', () => {
    expect(isModelBoxTouched({ ...untouched, preferredVendorByModel: { 'seedance 2.5': 'apimart' } })).toBe(false)
    expect(isModelBoxTouched(null)).toBe(false)
  })

  it('整模型一行（分镜 / 设置页不展开变体）：名下有一个变体默认显示，这个模型就显示；全收才收；按最靠前的变体位排', () => {
    const result = applyModelBoxDefaults([row('veo3.1-fast'), row('viduq3'), row('doubao-seedance-2.0')], undefined)
    const byId = new Map(result.map(({ row: r, collapsed }) => [r.id, collapsed]))
    expect(byId.get('veo3.1-fast')).toBe(false)
    expect(byId.get('viduq3')).toBe(true)
    expect(byId.get('doubao-seedance-2.0')).toBe(false)
    expect(ids(result).indexOf('doubao-seedance-2.0')).toBeLessThan(ids(result).indexOf('veo3.1-fast'))
  })

  it('同一个模型在别家的 modelKey 也认（跨家身份表）：Kie 上的 Seedream 4.5 和 APIMart 的同位', () => {
    const result = applyModelBoxDefaults([row('some-new-model'), row('seedream')], untouched)
    expect(ids(result)).toEqual(['seedream', 'some-new-model'])
  })

  it('名单里每一个标识都对得上真实的 APIMart 目录行（目录改名 / 删行 / 档案变体改名时这里会红，不再悄悄少一项）', () => {
    const real = new Set<string>()
    for (const model of [...APIMART_VIDEO_MODELS, ...APIMART_IMAGE_MODELS] as Array<{ modelKey: string; archetypeId: string }>) {
      real.add(model.modelKey)
      for (const variant of getArchetypeById(model.archetypeId)?.variants ?? []) real.add(`${model.modelKey}#${variant.id}`)
    }
    expect(registeredModelBoxDefaultKeys().filter((key) => !real.has(key))).toEqual([])
  })

  it('名单里没有重复项（同一行不能既排序又收起、也不能写两遍）', () => {
    const keys = registeredModelBoxDefaultKeys()
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([])
  })
})
