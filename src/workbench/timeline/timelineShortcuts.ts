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
  | { type: 'zoom'; direction: 'in' | 'out' | 'fit' }

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
  // 吸附归 N，不再占 ⌘\：⌘\ 是全站「收起 / 展开 Nomi」（合同 §2.1），两边都监听 window
  // 时用户按一次会同时翻吸附和翻面板——两个功能各自「偶尔自己变了」，谁都查不出为什么。
  if (key === 'n' && !mod && !input.shiftKey) return { type: 'toggle-snap' }
  // 缩放三键：工具条 tooltip 一直写着「（−）」「（＋）」「（0）」，但从来没有人绑过它们。
  if (!mod && (input.key === '-' || input.key === '_')) return { type: 'zoom', direction: 'out' }
  if (!mod && (input.key === '=' || input.key === '+')) return { type: 'zoom', direction: 'in' }
  if (!mod && input.key === '0') return { type: 'zoom', direction: 'fit' }
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
  // ⇧⌫ 就是右键菜单和快捷键面板上写的那个涟漪删除。上一版把它绑在没人写出来的 ⇧Z 上，
  // ⇧⌫ 落到下面的普通删除——菜单上的键位是假的，用户按了以为涟漪、其实只是删。
  if (input.shiftKey && !mod && (input.key === 'Backspace' || input.key === 'Delete')) return { type: 'ripple-remove' }
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
