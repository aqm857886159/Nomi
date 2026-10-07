import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('saved feedback clock ownership', () => {
  it('uses the external-store clock for both the window gate and derived feedback', () => {
    const source = readFileSync(new URL('./useGenerationFeedback.ts', import.meta.url), 'utf8')
    expect(source).toContain('savedFeedbackWindowOpen(current, generationFeedbackClockNow())')
    expect(source).not.toContain('savedFeedbackWindowOpen(current, Date.now())')
  })
})
