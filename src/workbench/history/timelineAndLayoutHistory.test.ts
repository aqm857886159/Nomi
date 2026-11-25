import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showUndoToast } from '../../utils/showUndoToast'
import { createWorkbenchAdoptionPorts } from '../adoption/adoptionStorePorts'
import { TimelineAgentReceiptEffect } from '../ai/resident/TimelineAgentReceiptEffect'
import { executeTimelineWriteTarget } from '../timeline/agent/timelineCapabilityTarget'
import { timelineRevision } from '../timeline/kernel/timelineKernel'
import { revertCapturedTimelineEdit } from '../timeline/timelineGesture'
import { useWorkbenchStore } from '../workbenchStore'
import { registerPreviewLayoutHistoryShortcut } from './historyMiddleware'
import { registerTimelineHistoryShortcut } from '../timeline/timelineShortcuts'
import { registerHistoryShortcut, resetShortcutSurfaceForTest } from '../shortcutSurface'
import { releaseWorkbenchProjectRuntimeState } from '../project/releaseWorkbenchProjectSession'
import { workbenchStoreLifetime } from '../workbenchStoreLifetime'

vi.mock('../../utils/showUndoToast', () => ({ showUndoToast: vi.fn() }))
const state = useWorkbenchStore.getState

beforeEach(() => workbenchStoreLifetime.releaseProject!())
afterEach(() => vi.unstubAllGlobals())

describe('timeline and layout session history', () => {
  it('retains exactly the last 30 timeline edits in both directions', () => {
    const id = state().addTimelineTextClip('caption', 0)
    for (let n = 1; n <= 32; n++) state().updateTimelineTextClip(id, String(n))
    for (let n = 31; n >= 2; n--) {
      state().undoTimeline()
      expect(state().timeline.textClips[0].text).toBe(String(n))
    }
    state().undoTimeline()
    expect(state().timeline.textClips[0].text).toBe('2')
    for (let n = 3; n <= 32; n++) {
      state().redoTimeline()
      expect(state().timeline.textClips[0].text).toBe(String(n))
    }
  })

  it('coalesces a continuous trim, discards a cancelled trim and ignores an empty gesture', () => {
    const id = state().addTimelineTextClip('caption', 0)
    const before = state().timeline
    state().captureTimelineUndo()
    for (const end of [10, 11, 12]) state().resizeTimelineTextClip(id, 'right', end)
    const trimmed = state().timeline
    expect(trimmed.textClips[0].endFrame).toBe(12)
    state().undoTimeline()
    expect(state().timeline).toBe(before)
    state().redoTimeline()
    expect(state().timeline).toBe(trimmed)
    const captured = state().captureTimelineUndo()
    state().resizeTimelineTextClip(id, 'right', 20)
    revertCapturedTimelineEdit(captured)
    state().redoTimeline()
    revertCapturedTimelineEdit(undefined)
    expect(state().timeline).toBe(trimmed)
    state().undoTimeline()
    expect(state().timeline).toBe(before)
  })

  it('cancelling a trim preserves an existing redo and a late cancel cannot roll back another session', () => {
    const id = state().addTimelineTextClip('caption', 0)
    state().updateTimelineTextClip(id, 'later')
    state().undoTimeline()
    const original = state().timeline
    const token = state().captureTimelineUndo()
    state().resizeTimelineTextClip(id, 'right', 12)
    state().cancelTimelineGesture(token)
    expect(state().timeline).toBe(original)
    state().redoTimeline()
    expect(state().timeline.textClips[0].text).toBe('later')
    workbenchStoreLifetime.releaseProject!()
    const nextId = state().addTimelineTextClip('caption', 0)
    const nextToken = state().captureTimelineUndo()
    state().resizeTimelineTextClip(nextId, 'right', 18)
    revertCapturedTimelineEdit(token)
    expect(state().timeline.textClips[0].endFrame).toBe(18)
    revertCapturedTimelineEdit(nextToken)
    expect(state().timeline.textClips[0].endFrame).not.toBe(18)
  })

  it('clears retained timeline and layout history instances when the project closes', () => {
    const { timelineHistory, editingPanelHistory } = state()
    state().addTimelineTextClip('caption', 0)
    state().showEditingPanel('source', false)
    expect(timelineHistory.entries.pastStates).toHaveLength(1)
    expect(editingPanelHistory.entries.pastStates).toHaveLength(1)
    releaseWorkbenchProjectRuntimeState()
    expect(timelineHistory.entries.pastStates).toHaveLength(0)
    expect(editingPanelHistory.entries.pastStates).toHaveLength(0)
    expect(state().timelineHistory).not.toBe(timelineHistory)
    expect(state().editingPanelHistory).not.toBe(editingPanelHistory)
  })

  it('compensates a failed adoption without a ghost undo or a lost redo at capacity', () => {
    const id = state().addTimelineTextClip('caption', 0)
    for (let n = 1; n <= 32; n++) state().updateTimelineTextClip(id, String(n))
    state().undoTimeline()
    const base = state().timeline
    const workbenchAdoptionPorts = createWorkbenchAdoptionPorts()
    workbenchAdoptionPorts.commitTimeline({ ...base, textClips: [] }, base)
    expect(workbenchAdoptionPorts.restoreTimeline(base)).toBe(true)
    state().redoTimeline()
    expect(state().timeline.textClips[0].text).toBe('32')
    for (let n = 31; n >= 2; n--) {
      state().undoTimeline()
      expect(state().timeline.textClips[0].text).toBe(String(n))
    }
  })

  it('retains 20 layout edits and excludes hydration and live drag widths', () => {
    state().setEditingPanelLayout({ sourceWidth: 300 }, false)
    state().syncEditingPanelSize({ sourceWidth: 301 })
    expect(state().undoEditingPanelLayout()).toBe(false)
    for (let width = 302; width <= 323; width++) state().setEditingPanelLayout({ sourceWidth: width })
    for (let width = 322; width >= 303; width--) {
      expect(state().undoEditingPanelLayout()).toBe(true)
      expect(state().editingPanelLayout.sourceWidth).toBe(width)
    }
    expect(state().undoEditingPanelLayout()).toBe(false)
  })

  it('undoes only the targeted preview command, restores keep and recalls the agent once', () => {
    state().addTimelineTextClip('caption', 0)
    state().setEditingPanelLayout({ visibility: { inspector: false, assistant: false } })
    const nonce = state().agentRecallNonce
    state().undoEditingPanelLayout()
    expect(state().editingPanelKeep).toBe('inspector')
    expect(state().agentRecallNonce).toBe(nonce + 1)
    expect(state().timeline.textClips).toHaveLength(1)
    const layout = state().editingPanelLayout
    state().undoTimeline()
    expect(state().timeline.textClips).toHaveLength(0)
    expect(state().editingPanelLayout).toBe(layout)
    expect(state().agentRecallNonce).toBe(nonce + 1)
  })

  it.each([true, false])('routes each keyboard chord once with both preview targets populated (layout registered first = %s)', layoutFirst => {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    vi.stubGlobal('HTMLElement', class {})
    const surface = { closest: (selector: string) => selector.includes('="false"') ? null : surface } as unknown as Element
    const layout = () => registerPreviewLayoutHistoryShortcut({ current: surface }, state)
    const timeline = () => registerTimelineHistoryShortcut(() => surface, state().undoTimeline, state().redoTimeline)
    const off = (layoutFirst ? [layout, timeline] : [timeline, layout]).map(register => register())
    const press = (key: string, modifiers: Partial<KeyboardEvent>) => {
      const event = new Event('keydown', { cancelable: true })
      Object.defineProperty(event, 'key', { value: key })
      Object.assign(event, modifiers)
      win.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    try {
      const id = state().addTimelineTextClip('caption', 0)
      state().showEditingPanel('source', false)
      press('z', { metaKey: true })
      expect(state().editingPanelLayout.visibility.source).toBe(true)
      expect(state().timeline.textClips).toHaveLength(1)
      state().showEditingPanel('source', false)
      state().timelineHistory.activate()
      state().writeEditingPanelLayoutFromAgent({ sourceWidth: 380 })
      press('z', { ctrlKey: true })
      expect(state().timeline.textClips).toHaveLength(0)
      expect(state().editingPanelLayout.visibility.source).toBe(false)
      state().editingPanelHistory.activate()
      press('z', { metaKey: true, shiftKey: true })
      expect(state().timeline.textClips).toHaveLength(0)
      expect(state().editingPanelLayout.visibility.source).toBe(false)
      state().timelineHistory.activate()
      press('y', { ctrlKey: true })
      expect(state().timeline.textClips[0].id).toBe(id)
      press('z', { metaKey: true })
      press('Z', { ctrlKey: true, shiftKey: true })
      expect(state().timeline.textClips[0].id).toBe(id)
      const director = vi.fn()
      off.push(registerHistoryShortcut('director', () => true, director))
      press('z', { metaKey: true })
      expect(director).toHaveBeenCalledOnce()
      expect(state().timeline.textClips[0].id).toBe(id)
    } finally {
      off.forEach(unregister => unregister())
      resetShortcutSurfaceForTest()
    }
  })

  it('binds the receipt and capability to the current head, project and revision', async () => {
    // This effect renders no DOM. It needs a React root to observe the actual store.
    const doc = Object.assign(new EventTarget(), { activeElement: null })
    const container = Object.assign(new EventTarget(), { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', ownerDocument: doc })
    vi.stubGlobal('window', { HTMLIFrameElement: class {} })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const root = createRoot(container as unknown as HTMLElement)
    try {
      await act(() => root.render(React.createElement(TimelineAgentReceiptEffect)))
      const revision = timelineRevision(state().timeline)
      const request = {
        projectId: 'A', target: { kind: 'timeline' as const, clipIds: [] },
        preconditions: { timeline: { revision } }, receiptProposalId: 'receipt', approvalId: 'approval',
        actionHash: 'a'.repeat(64), signal: new AbortController().signal, assertCurrent() {},
        input: { operation: 'apply_edit_plan' as const, planId: 'caption', summary: 'Add caption', baseRevision: revision,
          operations: [{ kind: 'text' as const, action: 'add' as const, id: 'caption', style: 'caption' as const, text: 'first', startFrame: 0, endFrame: 12 }] },
      }
      const apply = () => executeTimelineWriteTarget(request)
      await act(() => { expect(apply()).toMatchObject({ applied: true }) })
      expect(apply()).toMatchObject({ replayed: true })
      const receipt = vi.mocked(showUndoToast).mock.lastCall![0]
      const after = state().timeline
      const expectedRevision = timelineRevision(after)
      const undo = (projectId: string) => executeTimelineWriteTarget({ ...request, projectId,
        preconditions: { timeline: { revision: expectedRevision } },
        input: { operation: 'undo_timeline_edit', undoToken: 'timeline-undo:v1:receipt', expectedRevision } })
      expect(receipt.isUndoable!()).toBe(true)
      expect(undo('B')).toMatchObject({ code: 'undo_token_invalid' })
      state().moveTimelineTextClip('caption', 24)
      expect(receipt.isUndoable!()).toBe(false)
      expect(undo('A')).toMatchObject({ code: 'undo_stale_revision' })
      // Same content again, but another edit owns the head.
      await act(() => { state().captureTimelineUndo(); useWorkbenchStore.setState({ timeline: after }) })
      expect(receipt.isUndoable!()).toBe(false)
      expect(undo('A')).toMatchObject({ code: 'undo_token_invalid' })
      await act(() => { workbenchStoreLifetime.releaseProject!(); useWorkbenchStore.setState({ timeline: after }) })
      expect(undo('A')).toMatchObject({ code: 'undo_token_invalid' })
    } finally {
      await act(() => root.unmount())
    }
  })
})
