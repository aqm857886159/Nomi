import { describe, expect, it } from 'vitest'
import { approvalPolicyForLabel, shouldSubmitComposer, useComposerHeight } from './agentPanelV4Logic'

describe('agent panel v4 logic', () => {
  it.each([
    ['每步问', 'step', 'confirm'], ['自动改', 'safe-auto', 'confirm'], ['全自动', 'project', 'within-budget'],
  ] as const)('maps %s to the host policy', (label, mode, spend) => {
    expect(approvalPolicyForLabel(label)).toEqual({ mode, spend })
  })
  it('derives composer caps from panel height', () => {
    expect(useComposerHeight(900, 'idle', 20)).toBe(360)
    expect(useComposerHeight(700, 'idle', 20)).toBe(210)
    expect(useComposerHeight(500, 'idle', 20)).toBe(194)
    expect(useComposerHeight(500, 'idle', 1)).toBe(84)
  })
  it('keeps IME and shift enter from submitting', () => {
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
  })
})
