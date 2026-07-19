import { describe, expect, it } from 'vitest'
import { canvasZoomShortcutDirection } from './useCanvasShortcuts'

function shortcut(overrides: Partial<Parameters<typeof canvasZoomShortcutDirection>[0]> = {}) {
  return canvasZoomShortcutDirection({
    key: '',
    code: '',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    ...overrides,
  })
}

describe('canvasZoomShortcutDirection', () => {
  it('兼容主键盘与小键盘加减号', () => {
    expect(shortcut({ key: '+', code: 'Equal' })).toBe(1)
    expect(shortcut({ key: '=', code: 'Equal' })).toBe(1)
    expect(shortcut({ key: '+', code: 'NumpadAdd' })).toBe(1)
    expect(shortcut({ key: '-', code: 'Minus' })).toBe(-1)
    expect(shortcut({ key: '-', code: 'NumpadSubtract' })).toBe(-1)
  })

  it('兼容 Cmd，并忽略无修饰键与 Alt 组合', () => {
    expect(shortcut({ key: '+', code: 'Equal', ctrlKey: false, metaKey: true })).toBe(1)
    expect(shortcut({ key: '+', code: 'Equal', ctrlKey: false })).toBe(0)
    expect(shortcut({ key: '+', code: 'Equal', altKey: true })).toBe(0)
  })
})
