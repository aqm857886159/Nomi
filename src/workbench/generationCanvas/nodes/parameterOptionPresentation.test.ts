import { describe, expect, it } from 'vitest'
import {
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

  it('keeps small resolution and ratio groups segmented', () => {
    expect(parameterOptionLayout(options('1K', '2K', '4K'))).toBe('segmented')
    expect(parameterOptionLayout(options('自动', '16:9', '9:16', '1:1', '4:3', '3:4'))).toBe('segmented')
  })

  it.each([
    ['model.safetensors', 'second.safetensors'],
    ['模型名称非常长而且没有空格', '另一个模型'],
    ['LTX\\ltx-2.3\\model.safetensors', 'MiniMax/H3/model.safetensors'],
    Array.from({ length: 25 }, (_, index) => `opt${index}`),
  ])('uses a list for long labels or many choices: %j', (...labels) => {
    expect(parameterOptionLayout(options(...labels))).toBe('select')
  })

  it('uses visible labels, not opaque wire values, to decide layout', () => {
    const entries = [{ value: 'very-long-internal-provider-value', text: '1K' }]
    expect(parameterOptionLayout(entries)).toBe('segmented')
  })

  it('keeps semantic aspect ratios explicit even when the model declares fifteen choices', () => {
    const ratios = options('auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '9:21', '2:1', '1:2', '3:1')
    expect(resolveParameterOptionPurpose(ratios)).toBe('aspect-ratio')
    expect(parameterOptionLayout(ratios, 'aspect-ratio')).toBe('segmented')
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
    expect(parameterOptionLayout(providers, 'provider')).toBe('segmented')
  })

  it('does not mistake a generic automatic resolution group for aspect ratios', () => {
    expect(resolveParameterOptionPurpose(options('auto', '1K', '2K', '4K'))).toBe('generic')
  })
})
