import { describe, expect, it } from 'vitest'
import { resolveWindowZoomShortcut } from './windowZoomShortcuts'

function shortcut(overrides: Partial<Parameters<typeof resolveWindowZoomShortcut>[0]> = {}) {
  return resolveWindowZoomShortcut({
    type: 'keyDown',
    key: '',
    code: '',
    control: true,
    meta: false,
    alt: false,
    ...overrides,
  })
}

describe('window zoom shortcuts', () => {
  it('识别主键盘、小键盘与 Cmd 缩放', () => {
    expect(shortcut({ key: '+', code: 'Equal' })).toBe('in')
    expect(shortcut({ key: '=', code: 'Equal' })).toBe('in')
    expect(shortcut({ key: '+', code: 'NumpadAdd' })).toBe('in')
    expect(shortcut({ key: '-', code: 'Minus' })).toBe('out')
    expect(shortcut({ key: '-', code: 'NumpadSubtract' })).toBe('out')
    expect(shortcut({ key: '+', code: 'Equal', control: false, meta: true })).toBe('in')
  })

  it('Ctrl/Cmd+0 恢复 100%，并忽略无修饰键与 Alt 组合', () => {
    expect(shortcut({ key: '0', code: 'Digit0' })).toBe('reset')
    expect(shortcut({ key: '+', code: 'Equal', control: false })).toBeNull()
    expect(shortcut({ key: '+', code: 'Equal', alt: true })).toBeNull()
    expect(shortcut({ type: 'keyUp', key: '+', code: 'Equal' })).toBeNull()
  })
})
