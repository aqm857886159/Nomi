import { describe, expect, it } from 'vitest'
import { frameTimes } from './cameraMoveSchedule'

describe('frameTimes', () => {
  it('includes both endpoints and is evenly spaced', () => {
    expect(frameTimes(0, 5, 6)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('handles a non-zero start time', () => {
    expect(frameTimes(2, 8, 4)).toEqual([2, 4, 6, 8])
  })

  it('degenerates to the start time for count 1', () => {
    expect(frameTimes(3, 9, 1)).toEqual([3])
  })

  it('returns empty for count <= 0', () => {
    expect(frameTimes(0, 5, 0)).toEqual([])
  })

  it('first and last always equal the bounds for any count', () => {
    const times = frameTimes(1.5, 7.5, 13)
    expect(times[0]).toBe(1.5)
    expect(times[times.length - 1]).toBe(7.5)
    expect(times).toHaveLength(13)
  })
})
