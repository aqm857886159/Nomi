import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { estimateBatchGenerationCost, estimateGenerationCost, formatGenerationCredits } from './generationCost'

const option = (cost: number, specCosts: NonNullable<ModelOption['pricing']>['specCosts'] = []): ModelOption => ({
  value: 'seedance',
  label: 'Seedance',
  vendor: 'apimart',
  pricing: { cost, enabled: true, specCosts },
})

describe('estimateGenerationCost', () => {
  it('adds matching bare and key:value spec costs, then multiplies variants', () => {
    expect(estimateGenerationCost({
      option: option(7.1, [
        { specKey: 'duration:6', cost: 1.42, enabled: true },
        { specKey: '720p', cost: 3, enabled: true },
        { specKey: 'ignored', cost: 100, enabled: false },
      ]),
      params: { duration: 6, resolution: '720p' },
      multiplier: 2,
    })).toEqual({ amount: 23.04, unit: 'credits', source: 'catalog' })
  })

  it('returns null when the model cannot provide a calculation', () => {
    expect(estimateGenerationCost({ option: undefined, params: {} })).toBeNull()
    expect(estimateGenerationCost({ option: option(5), params: {}, multiplier: 0 })).toBeNull()
    expect(estimateGenerationCost({ option: { value: 'free', label: 'Free' }, params: {} })).toBeNull()
  })

  it('keeps zero and decimal credits as known values', () => {
    expect(estimateGenerationCost({ option: option(0.06), params: {} })).toEqual({
      amount: 0.06,
      unit: 'credits',
      source: 'catalog',
    })
  })
})

describe('estimateBatchGenerationCost', () => {
  it('sums only when every item is calculable', () => {
    expect(estimateBatchGenerationCost([
      { option: option(7.1), params: {} },
      { option: option(8.52), params: {} },
    ])).toEqual({ amount: 15.62, unit: 'credits', source: 'catalog' })
    expect(estimateBatchGenerationCost([
      { option: option(7.1), params: {} },
      { option: undefined, params: {} },
    ])).toBeNull()
    expect(estimateBatchGenerationCost([])).toBeNull()
  })
})

it('formats credits without losing useful decimals', () => {
  expect(formatGenerationCredits(8.52)).toBe('8.52')
  expect(formatGenerationCredits(7)).toBe('7')
  expect(formatGenerationCredits(0.06)).toBe('0.06')
})
