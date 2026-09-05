export type TimelineShortcutAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'exit-split-mode' }
  | { type: 'nudge-playhead'; delta: -1 | 1 }
  | { type: 'remove-text-selection' }
  | { type: 'remove-selection' }
  | { type: 'split-primary' }
  | { type: 'duplicate-primary' }
  | { type: 'nudge-primary'; delta: -1 | 1 }
  | { type: 'remove-left' }
  | { type: 'remove-right' }
  | { type: 'ripple-remove' }
  | { type: 'toggle-snap' }

export type TimelineShortcutInput = {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

export type TimelineShortcutContext = {
  hasSelection: boolean
  hasPrimaryClip: boolean
  hasSelectedTextClip: boolean
  splitMode: boolean
}

export function resolveTimelineShortcut(
  input: TimelineShortcutInput,
  context: TimelineShortcutContext,
): TimelineShortcutAction | null {
  const key = input.key.toLowerCase()
  const mod = Boolean(input.metaKey || input.ctrlKey)
  if (mod && key === 'z') return input.shiftKey ? { type: 'redo' } : { type: 'undo' }
  if (mod && input.key === '\\') return { type: 'toggle-snap' }
  if (input.key === 'Escape' && context.splitMode) return { type: 'exit-split-mode' }
  if (input.key === 'ArrowLeft' || input.key === 'ArrowRight') {
    return { type: 'nudge-playhead', delta: input.key === 'ArrowLeft' ? -1 : 1 }
  }
  if (context.hasSelectedTextClip && (input.key === 'Backspace' || input.key === 'Delete')) {
    return { type: 'remove-text-selection' }
  }
  if (!context.hasSelection) return null
  if (input.key === 'q' && !mod) return { type: 'remove-left' }
  if (input.key === 'w' && !mod) return { type: 'remove-right' }
  if (input.shiftKey && key === 'z' && !mod) return { type: 'ripple-remove' }
  if (input.key === 'Backspace' || input.key === 'Delete') return { type: 'remove-selection' }
  if (!context.hasPrimaryClip) return null
  if (key === 's' && !mod) return { type: 'split-primary' }
  if (mod && key === 'd') return { type: 'duplicate-primary' }
  if (input.shiftKey && (input.key === '<' || input.key === '>')) {
    return { type: 'nudge-primary', delta: input.key === '<' ? -1 : 1 }
  }
  return null
}

export function isTimelineShortcutEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function dispatchTimelineShortcut(
  event: KeyboardEvent,
  context: TimelineShortcutContext,
  onAction: (action: TimelineShortcutAction) => void,
): boolean {
  if (event.defaultPrevented || isTimelineShortcutEditingTarget(event.target)) return false
  const action = resolveTimelineShortcut(event, context)
  if (!action) return false
  event.preventDefault()
  onAction(action)
  return true
}
