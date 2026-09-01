import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { clampTimelinePanelHeight, TIMELINE_PANEL_DEFAULT, TIMELINE_PANEL_MAX, TIMELINE_PANEL_MIN, useWorkbenchStore } from '../workbenchStore'
import { timelineResizeKeyboardHeight } from './TimelineResizeHandle'

const source = fs.readFileSync(path.join(process.cwd(), 'src/workbench/timeline/TimelineResizeHandle.tsx'), 'utf8')

describe('TimelineResizeHandle contract', () => {
  it('exposes an accessible horizontal separator with the shared bounds', () => {
    expect(source).toContain('role="separator"')
    expect(source).toContain('aria-orientation="horizontal"')
    expect(source).toContain('aria-valuemin={TIMELINE_PANEL_MIN}')
    expect(source).toContain('aria-valuemax={TIMELINE_PANEL_MAX}')
    expect(source).toContain('aria-valuenow={height}')
    expect(source).toContain('tabIndex={0}')
  })

  it('maps keyboard and pointer gestures to the shared height setter', () => {
    expect(source).toContain("key === 'ArrowUp'")
    expect(source).toContain("key === 'ArrowDown'")
    expect(source).toContain("key === 'Home'")
    expect(source).toContain("key === 'End'")
    expect(source).toContain('onPointerDown={onPointerDown}')
    expect(source).toContain('onPointerMove={onPointerMove}')
    expect(source).toContain('onPointerUp={endDrag}')
    expect(source).toContain('onDoubleClick={() => adjust(TIMELINE_PANEL_DEFAULT)}')
  })

  it('keeps every input inside the 140–300px contract and restores the 188px default', () => {
    expect(clampTimelinePanelHeight(-1)).toBe(TIMELINE_PANEL_MIN)
    expect(clampTimelinePanelHeight(999)).toBe(TIMELINE_PANEL_MAX)
    expect(clampTimelinePanelHeight(206.4)).toBe(206)
    expect(clampTimelinePanelHeight(Number.NaN)).toBe(TIMELINE_PANEL_DEFAULT)
    // Default expanded-timeline height aligns with origin/main's fixed 188px stage allocation.
    expect(TIMELINE_PANEL_DEFAULT).toBe(188)
  })

  it('derives the expected keyboard transitions before the store clamps them', () => {
    expect(timelineResizeKeyboardHeight(206, 'ArrowUp')).toBe(222)
    expect(timelineResizeKeyboardHeight(206, 'ArrowDown')).toBe(190)
    expect(timelineResizeKeyboardHeight(206, 'Home')).toBe(140)
    expect(timelineResizeKeyboardHeight(206, 'End')).toBe(300)
    expect(timelineResizeKeyboardHeight(206, 'Escape')).toBeNull()
  })

  it('stores only the clamped layout value without changing timeline content', () => {
    const before = useWorkbenchStore.getState()
    const timelineBefore = before.timeline
    before.setTimelinePanelHeight(999)
    expect(useWorkbenchStore.getState().timelinePanelHeight).toBe(TIMELINE_PANEL_MAX)
    expect(useWorkbenchStore.getState().timeline).toBe(timelineBefore)
    before.setTimelinePanelHeight(TIMELINE_PANEL_DEFAULT)
  })
})
