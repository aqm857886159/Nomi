import { describe, expect, it } from 'vitest'
import { localizeAutoOption } from './parameterOptionPresentation'

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
