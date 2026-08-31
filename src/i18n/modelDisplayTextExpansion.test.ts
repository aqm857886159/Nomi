import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import i18n, { DEFAULT_LOCALE } from './index'
import { translateModelDisplayText } from './modelDisplayText'

// Guards the provider/model-expansion batch of English labels: model parameter
// labels, mode hints and vendor terms that live in modelArchetypes/ and
// videoCapabilities/ and reach the UI through translateModelDisplayText.
// Before this batch these rendered as Chinese in the English UI (the resolver
// falls back to the raw source string when a key is missing). Assert at the
// real translation boundary — under an active `en` locale — that they now read
// English, and that the Chinese default is untouched.
describe('model display-text expansion (English rendering)', () => {
  const CJK = /[一-鿿]/

  describe('under the en locale', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('en')
    })
    afterAll(async () => {
      await i18n.changeLanguage(DEFAULT_LOCALE)
    })

    it('renders parameter labels in English', () => {
      expect(translateModelDisplayText('稳定度')).toBe('Stability')
      expect(translateModelDisplayText('风格强度')).toBe('Style strength')
      expect(translateModelDisplayText('采样率')).toBe('Sample rate')
      expect(translateModelDisplayText('推理步数')).toBe('Inference steps')
      expect(translateModelDisplayText('音调')).toBe('Pitch')
    })

    it('renders Runway vendor terms and mode hints in English', () => {
      expect(translateModelDisplayText('Runway 图像模型')).toBe('Runway image model')
      expect(translateModelDisplayText('Runway 文生视频模型')).toBe('Runway text-to-video model')
      expect(translateModelDisplayText('用文字生成视频')).toBe('Generate a video from text')
    })

    it('leaves no Chinese characters in the resolved expansion labels', () => {
      for (const source of ['稳定度', '风格强度', '相似度', 'Runway 音频模型', '高保真多语种配音']) {
        expect(CJK.test(translateModelDisplayText(source))).toBe(false)
      }
    })
  })

  it('keeps the Chinese source under the default locale', async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE)
    expect(translateModelDisplayText('稳定度')).toBe('稳定度')
    expect(translateModelDisplayText('Runway 图像模型')).toBe('Runway 图像模型')
  })
})
