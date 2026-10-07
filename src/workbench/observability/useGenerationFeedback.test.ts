import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { generationFeedback } from './generationFeedback'
import {
  generationFeedbackClockNow,
  setGenerationFeedbackClockForTests,
  shouldKeepGenerationFeedbackClock,
} from './useGenerationFeedback'

const savedNode = (completedAt: number): GenerationCanvasNode => ({
  id: 'saved-boundary', kind: 'image', title: '', position: { x: 0, y: 0 }, status: 'success',
  runs: [{ id: 'run', status: 'success', startedAt: completedAt, updatedAt: completedAt, completedAt }],
})

describe('saved feedback clock behavior', () => {
  afterEach(() => {
    vi.useRealTimers()
    setGenerationFeedbackClockForTests(Date.now())
  })

  it('keeps the boundary frame alive, then removes the receipt at the exact deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(4_000)
    const node = savedNode(1_000)

    // The external-store snapshot is one millisecond before expiry while wall time is already past it.
    setGenerationFeedbackClockForTests(3_999)
    expect(shouldKeepGenerationFeedbackClock(node, false)).toBe(true)
    expect(generationFeedback(node, generationFeedbackClockNow())?.saved).toBe(true)

    // The next store tick crosses the boundary; the shared gate and derived feedback agree to remove it.
    setGenerationFeedbackClockForTests(4_000)
    expect(shouldKeepGenerationFeedbackClock(node, false)).toBe(false)
    expect(generationFeedback(node, generationFeedbackClockNow())).toBeNull()
  })
})
