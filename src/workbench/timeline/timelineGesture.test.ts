import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginPointerSession, revertCapturedTimelineEdit } from './timelineGesture'
import { useWorkbenchStore } from '../workbenchStore'
import { createDefaultTimeline } from './timelineMath'

class FakeElement extends EventTarget {
  captured = new Set<number>()
  closest() { return null }
  setPointerCapture(id: number) { this.captured.add(id) }
  hasPointerCapture(id: number) { return this.captured.has(id) }
  releasePointerCapture(id: number) {
    // 真实 DOM 里 lostpointercapture 会冒泡到 window；EventTarget 桩不冒泡，直接派给 window。
    if (this.captured.delete(id)) window.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: id }))
  }
}

function pointerEvent(type: string, pointerId = 1, extra: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type, { bubbles: true }), { pointerId, clientX: 0, clientY: 0, ...extra })
}

let win: EventTarget
beforeEach(() => {
  win = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }))
  vi.stubGlobal('Element', FakeElement)
})
afterEach(() => { vi.unstubAllGlobals() })

function start() {
  const target = new FakeElement()
  const calls: string[] = []
  const session = beginPointerSession({
    event: { pointerId: 1, currentTarget: target },
    onMove: () => calls.push('move'),
    onCommit: () => calls.push('commit'),
    onCancel: (reason) => calls.push(`cancel:${reason}`),
    onEnd: () => calls.push('end'),
  })
  return { target, calls, session }
}

describe('pointer session lifecycle', () => {
  it('captures the pointer and commits once on release', () => {
    const { target, calls, session } = start()
    expect(target.captured.has(1)).toBe(true)
    win.dispatchEvent(pointerEvent('pointermove'))
    win.dispatchEvent(pointerEvent('pointerup'))
    win.dispatchEvent(pointerEvent('pointerup'))
    expect(calls).toEqual(['move', 'commit', 'end'])
    expect(session.active).toBe(false)
    expect(target.captured.size).toBe(0)
  })

  it('ignores other pointers', () => {
    const { calls } = start()
    win.dispatchEvent(pointerEvent('pointermove', 2))
    win.dispatchEvent(pointerEvent('pointerup', 2))
    expect(calls).toEqual([])
  })

  it.each([
    ['pointercancel', () => win.dispatchEvent(pointerEvent('pointercancel'))],
    ['window blur', () => win.dispatchEvent(new Event('blur'))],
    ['lost pointer capture', (target: FakeElement) => target.releasePointerCapture(1)],
    ['Escape', () => win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape', preventDefault() {} }))],
  ] as const)('reverts and ends cleanly on %s', (_name, interrupt) => {
    const { target, calls, session } = start()
    win.dispatchEvent(pointerEvent('pointermove'))
    interrupt(target)
    expect(calls).toEqual(['move', 'cancel:' + (_name === 'Escape' ? 'escape' : 'interrupted'), 'end'])
    expect(session.active).toBe(false)
    // 打断之后，再动鼠标 / 松手都不再有任何回调：不会卡在拖动中，也不会补一次提交。
    win.dispatchEvent(pointerEvent('pointermove'))
    win.dispatchEvent(pointerEvent('pointerup'))
    expect(calls).toHaveLength(3)
  })

  it('cancels a still-active session when its owner disposes it', () => {
    const { calls, session } = start()
    session.cancel('dispose')
    session.cancel('dispose')
    expect(calls).toEqual(['cancel:dispose', 'end'])
  })

  it('does not treat the browser-initiated capture release after pointerup as an interruption', () => {
    const { target, calls } = start()
    win.dispatchEvent(pointerEvent('pointerup'))
    target.dispatchEvent(pointerEvent('lostpointercapture'))
    win.dispatchEvent(pointerEvent('lostpointercapture'))
    expect(calls).toEqual(['commit', 'end'])
  })
})

describe('reverting an interrupted workbench timeline edit', () => {
  const clip = (id: string, startFrame: number) => ({
    id, type: 'image' as const, sourceNodeId: id, label: id, startFrame, endFrame: startFrame + 30,
    frameCount: 30, offsetStartFrame: 0, offsetEndFrame: 0, url: 'data:image/png;base64,AAAA',
  })

  it('restores the pre-gesture timeline and leaves no redo entry', () => {
    const base = createDefaultTimeline()
    const original = { ...base, tracks: base.tracks.map((track) => track.type === 'image' ? { ...track, clips: [clip('a', 0)] } : track) }
    useWorkbenchStore.setState({ timeline: original, timelineUndoStack: [], timelineRedoStack: [] })
    const store = useWorkbenchStore.getState()
    store.captureTimelineUndo()
    store.moveTimelineClip('a', 90, { commit: false })
    expect(useWorkbenchStore.getState().timeline).not.toBe(original)
    revertCapturedTimelineEdit(true)
    const after = useWorkbenchStore.getState()
    expect(after.timeline).toBe(original)
    expect(after.timelineUndoStack).toHaveLength(0)
    expect(after.timelineRedoStack).toHaveLength(0)
  })

  it('does nothing when the gesture never changed anything (never undoes an unrelated edit)', () => {
    const base = createDefaultTimeline()
    const earlier = { ...base, fps: 25 }
    useWorkbenchStore.setState({ timeline: base, timelineUndoStack: [earlier], timelineRedoStack: [] })
    revertCapturedTimelineEdit(false)
    const after = useWorkbenchStore.getState()
    expect(after.timeline).toBe(base)
    expect(after.timelineUndoStack).toEqual([earlier])
  })
})
