import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../electron/shared/modelArchetypes'
import type { DedupedModel } from './modelIdentity'
import { modelBrandIcon, modelFamilyOf, modelNameInitial, registeredModelFamilies } from './modelFamilyIcons'

function model(archetypeId?: string, label = 'Custom Model'): DedupedModel {
  return {
    canonicalId: label.toLowerCase().replaceAll(' ', '-'),
    label,
    recognized: Boolean(archetypeId),
    providers: [{
      vendor: 'custom-provider',
      modelKey: 'custom-model',
      option: { value: 'custom-provider:custom-model', label, modelKey: 'custom-model', vendor: 'custom-provider', ...(archetypeId ? { meta: { archetypeId } } : {}) },
    }],
  }
}

describe('modelBrandIcon（家族 → 品牌图的唯一对照表）', () => {
  it('认得家族的模型画单色品牌图，同家族的不同版本共用一枚', () => {
    const a = modelBrandIcon(model('seedance-2.5-apimart', 'Seedance 2.5'))
    const b = modelBrandIcon(model('seedream', 'Seedream 4.5'))
    expect(a).toMatchObject({ kind: 'model', monochrome: true, fallback: 'S' })
    expect(a.src).toBeTruthy()
    expect(a.src).toBe(b.src)
  })

  it('对照表里没登记的家族 → 名字首字母字块（没图、不借别家的图）', () => {
    expect(modelBrandIcon(model('agnes-image', 'Agnes Image 2.0'))).toEqual({ kind: 'model', fallback: 'A' })
    expect(modelBrandIcon(model('higgsfield-dop', 'DoP'))).toEqual({ kind: 'model', fallback: 'D' })
  })

  it('自定义模型即使名字像别人家的，也不借牌子', () => {
    expect(modelBrandIcon(model(undefined, 'Seedream lookalike'))).toEqual({ kind: 'model', fallback: 'S' })
    expect(modelBrandIcon(model(undefined, '可灵仿品'))).toEqual({ kind: 'model', fallback: '可' })
  })

  it('字块首字：英文大写、汉字取首字、空名不画字', () => {
    expect(modelNameInitial('wan 3.0')).toBe('W')
    expect(modelNameInitial('万相 2.7')).toBe('万')
    expect(modelNameInitial('  ')).toBe('')
  })

  it('对照表里每一项都对应一个真实存在的档案家族（改名 / 删档案时这里会红）', () => {
    const families = new Set(MODEL_ARCHETYPES.map((archetype) => archetype.family))
    expect(registeredModelFamilies().filter((family) => !families.has(family))).toEqual([])
  })

  it('视频 / 图片默认菜单里的主力家族都登记了图（缺一项 → 掉成字块，这里能看见）', () => {
    for (const id of ['seedance-2.5-apimart', 'wan-3.0-apimart', 'kling-v4', 'minimax-h3-apimart', 'happyhorse-1.1', 'veo-3.1', 'hailuo-2.3', 'viduq3-pro', 'gpt-image-2.6-flare', 'gemini-nano-banana-2.1', 'gemini-image-3-pro', 'seedream-5-pro', 'flux-3-image', 'qwen-image-3', 'z-image-turbo']) {
      expect(modelBrandIcon(model(id, id)).src, id).toBeTruthy()
    }
    expect(modelFamilyOf(model('kling-v4'))).toBe('kling')
  })
})
