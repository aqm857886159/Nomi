import { describe, expect, it } from 'vitest'
import { resolveTimelineFitScale } from './timelineMath'

describe('timeline fit-to-content default', () => {
  it('fits the content to the available track width with an 8 percent margin', () => {
    expect(resolveTimelineFitScale(270, 600)).toBeCloseTo((600 * 0.92) / 270, 6)
  })

  it('derives a new scale when content duration changes', () => {
    const short = resolveTimelineFitScale(270, 600)
    const long = resolveTimelineFitScale(540, 600)
    expect(long).toBeCloseTo(short / 2, 6)
  })
})
