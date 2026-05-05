import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { handleAiComposerKeyDown, shouldSubmitAiComposerOnEnter } from '../../src/workbench/ai/aiComposerKeyboard'

function keyboardEvent(input: {
  key: string
  shiftKey?: boolean
  isComposing?: boolean
}): React.KeyboardEvent<HTMLTextAreaElement> {
  return {
    key: input.key,
    shiftKey: input.shiftKey === true,
    nativeEvent: {
      isComposing: input.isComposing === true,
    },
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>
}

describe('AI composer keyboard contract', () => {
  it('submits on plain Enter', () => {
    const submit = vi.fn()
    const event = keyboardEvent({ key: 'Enter' })

    handleAiComposerKeyDown(event, submit)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('keeps Shift+Enter, composing Enter, and other keys as text input', () => {
    expect(shouldSubmitAiComposerOnEnter(keyboardEvent({ key: 'Enter', shiftKey: true }))).toBe(false)
    expect(shouldSubmitAiComposerOnEnter(keyboardEvent({ key: 'Enter', isComposing: true }))).toBe(false)
    expect(shouldSubmitAiComposerOnEnter(keyboardEvent({ key: 'a' }))).toBe(false)
  })
})
