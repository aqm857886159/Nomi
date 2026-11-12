// 参考行行尾「X 最多用 N 张」里的模型名 = 底栏模型钮上的名字（2026-11-12 验收 C1：英文界面混进「可灵 4.0」）。
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { dedupeModelOptions } from '../../config/modelIdentity'
import type { ModelOption } from '../../config/models'
import { modelDisplayLabel, modelOptionDisplayLabel } from './useDedupedModelSelect'

const CJK = /[㐀-鿿]/

function option(canonicalId: string, vendor: string, label: string): ModelOption {
  return { value: `${vendor}:${canonicalId}`, label, modelKey: `${vendor}:${canonicalId}`, vendor, kind: 'video', meta: { canonicalModelId: canonicalId } } as ModelOption
}
const kling = option('kling-4.0', 'apimart', '可灵 4.0')
const options = [option('seedance-2.5', 'apimart', 'Seedance 2.5'), kling, option('kling-4.0', 'kie', '可灵 4.0')]

describe('modelOptionDisplayLabel — 别处写模型名都问底栏模型钮那一份', () => {
  afterEach(async () => { await i18n.changeLanguage('zh-CN') })

  it('两种语言都和模型框里那一组的显示名逐字相同', async () => {
    for (const language of ['zh-CN', 'en']) {
      await i18n.changeLanguage(language)
      const group = dedupeModelOptions([...options]).find((model) => model.providers.some((provider) => provider.option === kling))
      expect(modelOptionDisplayLabel(options, kling)).toBe(modelDisplayLabel(group!))
    }
  })

  it('英文界面：行尾那句话里不出现中文模型名', async () => {
    await i18n.changeLanguage('en')
    const model = modelOptionDisplayLabel(options, kling)
    const sentence = i18n.t('assetLibrary.refRow.modelLimitRange', { model, max: 2, rest: 28 })
    expect(sentence).not.toMatch(CJK)
    expect(sentence).toContain('Kling 4.0')
  })

  it('没选模型给空串，目录里找不到的照原名翻译', async () => {
    await i18n.changeLanguage('en')
    expect(modelOptionDisplayLabel(options, null)).toBe('')
    expect(modelOptionDisplayLabel([], kling)).toBe('Kling 4.0')
  })
})
