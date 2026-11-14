import { describe, expect, it } from 'vitest'
import {
  FLAT_OPTION_LIMIT,
  localizeAutoOption,
  parameterOptionLayout,
  resolveParameterOptionPurpose,
} from './parameterOptionPresentation'

describe('localizeAutoOption', () => {
  it('localizes the visible label without changing the internal auto value', () => {
    expect(localizeAutoOption('auto', 'auto', '自动')).toEqual({
      value: 'auto',
      text: '自动',
      isAuto: true,
    })
  })

  it('recognizes an auto label even when the value comes from another binding', () => {
    expect(localizeAutoOption('adaptive', 'Auto', '自动')).toEqual({
      value: 'adaptive',
      text: '自动',
      isAuto: true,
    })
  })

  it('uses the English translation and leaves numeric ratios untouched', () => {
    expect(localizeAutoOption('auto', 'auto', 'Auto').text).toBe('Auto')
    expect(localizeAutoOption('16:9', '16:9', '自动')).toEqual({
      value: '16:9',
      text: '16:9',
      isAuto: false,
    })
  })
})

describe('parameterOptionLayout', () => {
  const options = (...text: string[]) => text.map((label) => ({ value: label, text: label }))

  it('keeps small resolution and ratio groups as a single row of chips', () => {
    expect(parameterOptionLayout(options('1K', '2K', '4K'))).toBe('chips-row')
    expect(parameterOptionLayout(options('自动', '16:9', '9:16', '1:1', '4:3', '3:4'))).toBe('chips-row')
  })

  // 长标签仍然**摊开**，只是改成一项一行：挤进等宽格子只会各自 truncate 成一排读不出的省略号。
  it.each([
    ['model.safetensors', 'second.safetensors'],
    ['模型名称非常长而且没有空格', '另一个模型'],
    ['LTX\\ltx-2.3\\model.safetensors', 'MiniMax/H3/model.safetensors'],
  ])('stacks long labels into one column instead of hiding them behind a dropdown: %j', (...labels) => {
    expect(parameterOptionLayout(options(...labels))).toBe('chips-column')
  })

  // 超过一屏（8 项）才给搜索框；**列表本身默认就展开**，搜索是用来缩短它的，不是用来藏起它的。
  it('switches to a searchable list only past the flat limit', () => {
    expect(parameterOptionLayout(options(...Array.from({ length: FLAT_OPTION_LIMIT }, (_, i) => `o${i}`)))).toBe('chips-row')
    expect(parameterOptionLayout(options(...Array.from({ length: FLAT_OPTION_LIMIT + 1 }, (_, i) => `o${i}`)))).toBe('searchable-list')
    expect(parameterOptionLayout(options(...Array.from({ length: 25 }, (_, i) => `opt${i}`)))).toBe('searchable-list')
  })

  it('uses visible labels, not opaque wire values, to decide layout', () => {
    const entries = [{ value: 'very-long-internal-provider-value', text: '1K' }]
    expect(parameterOptionLayout(entries)).toBe('chips-row')
  })

  it('keeps semantic aspect ratios explicit even when the model declares fifteen choices', () => {
    const ratios = options('auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '9:21', '2:1', '1:2', '3:1')
    expect(resolveParameterOptionPurpose(ratios)).toBe('aspect-ratio')
    expect(parameterOptionLayout(ratios, 'aspect-ratio')).toBe('chips-row')
  })

  it('recognizes ratio labels even when wire values are pixel buckets', () => {
    const pixelBuckets = [
      { value: '1024x1024', text: '1:1' },
      { value: '1536x1024', text: '3:2' },
      { value: '1024x1536', text: '2:3' },
    ]
    expect(resolveParameterOptionPurpose(pixelBuckets)).toBe('aspect-ratio')
  })

  it('keeps supplier selection explicit instead of changing with label length', () => {
    const providers = options('Kie', 'APIMart', 'A user-defined relay with a long name')
    expect(parameterOptionLayout(providers, 'provider')).toBe('chips-row')
  })

  it('does not mistake a generic automatic resolution group for aspect ratios', () => {
    expect(resolveParameterOptionPurpose(options('auto', '1K', '2K', '4K'))).toBe('generic')
  })
})
