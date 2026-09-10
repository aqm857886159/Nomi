import { describe, expect, it } from 'vitest'
import { frameTimes } from './cameraMoveSchedule'

describe('frameTimes', () => {
  it('含两端、均匀、非零起点', () => {
    expect(frameTimes(0, 5, 6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(frameTimes(2, 8, 4)).toEqual([2, 4, 6, 8])
  })
  it('count 1 退化为起点；count ≤ 0 为空', () => {
    expect(frameTimes(3, 9, 1)).toEqual([3])
    expect(frameTimes(0, 5, 0)).toEqual([])
  })
  it('任意 count 首尾恒等于边界', () => {
    const times = frameTimes(1.5, 7.5, 13)
    expect(times[0]).toBe(1.5)
    expect(times[times.length - 1]).toBe(7.5)
    expect(times).toHaveLength(13)
  })
})
