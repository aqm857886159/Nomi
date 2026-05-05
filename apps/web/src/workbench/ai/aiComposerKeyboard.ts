import type { KeyboardEvent } from 'react'

export function shouldSubmitAiComposerOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (event.key !== 'Enter') return false
  if (event.shiftKey) return false
  if (event.nativeEvent.isComposing) return false
  return true
}

export function handleAiComposerKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>,
  submit: () => void,
): void {
  if (!shouldSubmitAiComposerOnEnter(event)) return
  event.preventDefault()
  submit()
}
