import { describe, expect, it } from 'vitest'
import { clampHistoryVideoTime, historyVideoTimeFromPointer, nudgeHistoryVideoTime } from './historyVideoScrub'

describe('history video scrub math', () => {
  it('maps pointer positions to bounded media time', () => {
    expect(historyVideoTimeFromPointer(150, { left: 100, width: 200 }, 12)).toBe(3)
    expect(historyVideoTimeFromPointer(20, { left: 100, width: 200 }, 12)).toBe(0)
    expect(historyVideoTimeFromPointer(400, { left: 100, width: 200 }, 12)).toBe(12)
  })

  it('rejects unusable media geometry and duration', () => {
    expect(historyVideoTimeFromPointer(100, { left: 100, width: 0 }, 12)).toBeNull()
    expect(historyVideoTimeFromPointer(100, { left: 100, width: 100 }, Number.NaN)).toBeNull()
  })

  it('nudges by exactly one second and clamps to the media boundary', () => {
    expect(nudgeHistoryVideoTime(4.25, 'ArrowLeft', 10)).toBe(3.25)
    expect(nudgeHistoryVideoTime(4.25, 'ArrowRight', 10)).toBe(5.25)
    expect(nudgeHistoryVideoTime(0.4, 'ArrowLeft', 10)).toBe(0)
    expect(nudgeHistoryVideoTime(9.6, 'ArrowRight', 10)).toBe(10)
    expect(nudgeHistoryVideoTime(4, 'Enter', 10)).toBeNull()
  })

  it('clamps non-finite and out-of-range values safely', () => {
    expect(clampHistoryVideoTime(Number.NaN, 10)).toBe(0)
    expect(clampHistoryVideoTime(20, 10)).toBe(10)
  })
})
