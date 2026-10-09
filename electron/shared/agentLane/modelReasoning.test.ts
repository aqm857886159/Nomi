import { describe, expect, it } from 'vitest'
import { modelReasoning } from './modelReasoning'

describe('explicit model reasoning capability', () => {
  const meta = { reasoning: true, reasoningEffort: 'high', thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } }
  it('uses only declared supported choices and rejects stale unsupported preferences', () => {
    expect(modelReasoning(meta)?.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(modelReasoning(meta)?.thinkingLevel).toBe('high')
    expect(modelReasoning(meta, 'low')?.thinkingLevel).toBe('low')
    expect(modelReasoning(meta, 'off')?.thinkingLevel).toBe('high')
    expect(modelReasoning({ reasoning: true, thinkingLevelMap: { unknown: 'high' } })).toBeUndefined()
  })
  it('does not invent a selector for a model without an explicit declaration', () => {
    expect(modelReasoning({ reasoningEffort: 'high' })).toBeUndefined()
    expect(modelReasoning({ reasoning: false, thinkingLevelMap: meta.thinkingLevelMap })).toBeUndefined()
  })
})
