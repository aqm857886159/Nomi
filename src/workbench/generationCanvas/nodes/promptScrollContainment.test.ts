import { describe, expect, it, vi } from 'vitest'
import { stopPromptWheelPropagation } from './promptScrollContainment'

describe('prompt scroll containment', () => {
  it('consumes wheel events before they reach the canvas pan handler', () => {
    const stopPropagation = vi.fn()
    stopPromptWheelPropagation({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
  })
})
