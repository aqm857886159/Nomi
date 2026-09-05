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
    expect(resolveTimelineShortcut({ key: 'z', shiftKey: true }, base)).toEqual({ type: 'ripple-remove' })
    expect(resolveTimelineShortcut({ key: '\\', metaKey: true }, base)).toEqual({ type: 'toggle-snap' })
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
