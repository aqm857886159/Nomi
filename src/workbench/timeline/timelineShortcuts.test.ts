import { describe, expect, it } from 'vitest'
import { resolveTimelineShortcut } from './timelineShortcuts'

const base = {
  hasSelection: true,
  hasPrimaryClip: true,
  hasSelectedTextClip: false,
  splitMode: false,
}

describe('timeline shortcuts', () => {
  it('keeps editing commands identical for every timeline surface', () => {
    expect(resolveTimelineShortcut({ key: 's' }, base)).toEqual({ type: 'split-primary' })
    expect(resolveTimelineShortcut({ key: 'd', metaKey: true }, base)).toEqual({ type: 'duplicate-primary' })
    expect(resolveTimelineShortcut({ key: 'Delete' }, base)).toEqual({ type: 'remove-selection' })
    expect(resolveTimelineShortcut({ key: '>', shiftKey: true }, base)).toEqual({ type: 'nudge-primary', delta: 1 })
    expect(resolveTimelineShortcut({ key: '<', shiftKey: true }, base)).toEqual({ type: 'nudge-primary', delta: -1 })
    expect(resolveTimelineShortcut({ key: 'q' }, base)).toEqual({ type: 'remove-left' })
    expect(resolveTimelineShortcut({ key: 'w' }, base)).toEqual({ type: 'remove-right' })
    // 涟漪删除的键位就是右键菜单与快捷键面板上写的那个 ⇧⌫。它一度绑在没人写出来的 ⇧Z 上，
    // 而 ⇧⌫ 落到普通删除——菜单上的键位是假的（2026-09-06 收官走查）。
    expect(resolveTimelineShortcut({ key: 'Backspace', shiftKey: true }, base)).toEqual({ type: 'ripple-remove' })
    expect(resolveTimelineShortcut({ key: 'Delete', shiftKey: true }, base)).toEqual({ type: 'ripple-remove' })
    // 吸附归 N。⌘\ 是全站「收起 / 展开 Nomi」，时间轴不许再抢它：两边都监听 window 时，
    // 按一次会同时翻吸附和翻面板。
    expect(resolveTimelineShortcut({ key: 'n' }, base)).toEqual({ type: 'toggle-snap' })
    expect(resolveTimelineShortcut({ key: '\\', metaKey: true }, base)).toBeNull()
    // 工具条 tooltip 上写了很久的缩放键位，现在真的绑上了。
    expect(resolveTimelineShortcut({ key: '-' }, base)).toEqual({ type: 'zoom', direction: 'out' })
    expect(resolveTimelineShortcut({ key: '=' }, base)).toEqual({ type: 'zoom', direction: 'in' })
    expect(resolveTimelineShortcut({ key: '0' }, base)).toEqual({ type: 'zoom', direction: 'fit' })
  })

  it('keeps transport and history commands independent from clip selection', () => {
    const empty = { ...base, hasSelection: false, hasPrimaryClip: false }
    expect(resolveTimelineShortcut({ key: 'ArrowLeft' }, empty)).toEqual({ type: 'nudge-playhead', delta: -1 })
    expect(resolveTimelineShortcut({ key: 'ArrowRight' }, empty)).toEqual({ type: 'nudge-playhead', delta: 1 })
    expect(resolveTimelineShortcut({ key: 'z', ctrlKey: true }, empty)).toEqual({ type: 'undo' })
    expect(resolveTimelineShortcut({ key: 'z', ctrlKey: true, shiftKey: true }, empty)).toEqual({ type: 'redo' })
  })

  it('does not expose clip commands without a valid selection', () => {
    const empty = { ...base, hasSelection: false, hasPrimaryClip: false }
    expect(resolveTimelineShortcut({ key: 's' }, empty)).toBeNull()
    expect(resolveTimelineShortcut({ key: 'd', metaKey: true }, empty)).toBeNull()
    expect(resolveTimelineShortcut({ key: 'Delete' }, empty)).toBeNull()
  })
})
