import { describe, expect, it } from 'vitest'
import {
  GENERATION_VARIANT_COUNTS,
  parseGenerationVariantCount,
  supportsGenerationVariants,
} from './generationVariantCount'
import type { GenerationNodeExecutionKind } from './registry'

describe('generation variant count choices', () => {
  it('exposes every explicit choice from one through four', () => {
    expect(GENERATION_VARIANT_COUNTS).toEqual([1, 2, 3, 4])
  })

  it.each([
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['4', 4],
  ] as const)('parses %s as %s', (raw, expected) => {
    expect(parseGenerationVariantCount(raw)).toBe(expected)
  })

  it('falls back to one for unsupported values', () => {
    expect(parseGenerationVariantCount('5')).toBe(1)
    expect(parseGenerationVariantCount('')).toBe(1)
  })
})

describe('supportsGenerationVariants', () => {
  it.each(['image', 'video', 'audio', 'model3d'] as const satisfies readonly GenerationNodeExecutionKind[])(
    'offers ×N to %s, because its results stack into the node history',
    (executionKind) => {
      expect(supportsGenerationVariants(executionKind)).toBe(true)
    },
  )

  it('withholds ×N from text, whose result is overwritten in place rather than stacked', () => {
    expect(supportsGenerationVariants('text')).toBe(false)
  })

  it('withholds ×N when the node declares no execution kind at all', () => {
    expect(supportsGenerationVariants(undefined)).toBe(false)
  })
})
