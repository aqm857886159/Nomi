import { describe, expect, it } from 'vitest'

import { applyPerformanceVerdict } from '../../scripts/canvas-performance-verdict.mjs'

describe('canvas performance process verdict', () => {
  it('allows success only for an explicit persisted pass', () => {
    const processState = {}
    expect(applyPerformanceVerdict({ pass: true }, processState)).toBe(true)
    expect(processState.exitCode).toBeUndefined()
  })

  it.each([{ pass: false }, {}, null])('sets a nonzero exit code for a failed or missing verdict', (results) => {
    const processState = {}
    expect(applyPerformanceVerdict(results, processState)).toBe(false)
    expect(processState.exitCode).toBe(1)
  })
})
