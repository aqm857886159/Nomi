import { describe, expect, it } from 'vitest'
import { resolveTaskCenterPanelPosition } from './taskCenterPanelPosition'

describe('resolveTaskCenterPanelPosition', () => {
  it('opens below the task trigger and aligns to its right edge', () => {
    expect(resolveTaskCenterPanelPosition({ bottom: 92, right: 1380 }, 1440, 900)).toEqual({
      left: 1000,
      top: 100,
      width: 380,
      maxHeight: 788,
    })
  })

  it('keeps the panel inside a narrow viewport', () => {
    expect(resolveTaskCenterPanelPosition({ bottom: 76, right: 378 }, 390, 844)).toEqual({
      left: 12,
      top: 84,
      width: 366,
      maxHeight: 748,
    })
  })

  it('does not overlap a taller app bar', () => {
    expect(resolveTaskCenterPanelPosition({ bottom: 76, right: 1380 }, 1440, 900, 88)).toEqual({
      left: 1000,
      top: 88,
      width: 380,
      maxHeight: 800,
    })
  })
})
