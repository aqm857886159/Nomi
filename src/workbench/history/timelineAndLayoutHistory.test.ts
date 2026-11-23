import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showUndoToast } from '../../utils/showUndoToast'
import { workbenchAdoptionPorts } from '../adoption/adoptionStorePorts'
import { TimelineAgentReceiptEffect } from '../ai/resident/TimelineAgentReceiptEffect'
import { executeTimelineWriteTarget } from '../timeline/agent/timelineCapabilityTarget'
import { timelineRevision } from '../timeline/kernel/timelineKernel'
import { revertCapturedTimelineEdit } from '../timeline/timelineGesture'
import { useWorkbenchStore } from '../workbenchStore'
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
    state().captureTimelineUndo()
    state().resizeTimelineTextClip(id, 'right', 20)
    revertCapturedTimelineEdit(true)
    state().redoTimeline()
    revertCapturedTimelineEdit(false)
    expect(state().timeline).toBe(trimmed)
    state().undoTimeline()
    expect(state().timeline).toBe(before)
  })

  it('compensates a failed adoption without a ghost undo or a lost redo at capacity', () => {
    const id = state().addTimelineTextClip('caption', 0)
    for (let n = 1; n <= 32; n++) state().updateTimelineTextClip(id, String(n))
    state().undoTimeline()
    const base = state().timeline
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
