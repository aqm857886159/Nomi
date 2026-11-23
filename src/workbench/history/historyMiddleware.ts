import { registerHistoryShortcut, workspaceInputSurfaceIsActive } from '../shortcutSurface'
import { isTimelineShortcutEditingTarget } from '../timeline/timelineShortcuts'
import { createStore } from 'zustand/vanilla'
import { temporal } from 'zundo'
import type { EditingPanelLayout } from '../preview/panelLayout'
import type { TimelineState } from '../timeline/timelineTypes'

export type TimelineAgentUndoMetadata = Readonly<{
  projectId: string
  planId: string
  planSignature: string
  beforeRevision: string
  afterRevision: string
  undoToken: string
  changeId?: string
  receiptProposalId: string
  approvalId: string
  actionHash: string
}>

type Frame<T> = { value?: T; metadata?: TimelineAgentUndoMetadata }
export type HistoryDirection = 'undo' | 'redo'

let targetSequence = 0

// Only explicit domain commands record. Before travelling, supply the live value,
// including any untracked playhead, gesture or panel-size writes since the last step.
function createSessionHistory<T>(limit: number) {
  const sessionFrameStore = createStore(temporal<Frame<T>>(() => ({ value: undefined, metadata: undefined }), { limit }))
  let lastTarget = 0
  function activate() { lastTarget = ++targetSequence }
  const journal = sessionFrameStore.temporal
  function sync(value?: T, metadata?: TimelineAgentUndoMetadata) {
    const present = sessionFrameStore.getState()
    if (present.value === value && present.metadata === metadata) return
    journal.getState().pause()
    try { sessionFrameStore.setState({ value, metadata }, true) } finally { journal.getState().resume() }
  }
  return {
    activate,
    release() {
      sync(undefined)
      journal.getState().clear()
      lastTarget = 0
    },
    get lastTarget() { return lastTarget },
    temporal: journal,
    // Enumerable session material for the project asset-liveness scan.
    get entries() { return journal.getState() },
    record(before: T, after: T, options: { metadata?: TimelineAgentUndoMetadata; target?: boolean } = {}) {
      if (options.target !== false) activate()
      const { metadata } = options
      sync(before, metadata)
      sessionFrameStore.setState({ value: after, metadata: undefined }, true)
    },
    travel(current: T, direction: HistoryDirection, discardRedo = false): T | undefined {
      const history = journal.getState()
      if (!(direction === 'undo' ? history.pastStates : history.futureStates).length) return
      activate()
      sync(current)
      history[direction]()
      if (discardRedo) journal.setState({ futureStates: [] })
      return sessionFrameStore.getState().value
    },
    checkpoint(current: T) {
      // zundo 2.3 mutates the outgoing array during eviction and travel.
      const { pastStates, futureStates } = journal.getState()
      const previousTarget = lastTarget
      const saved = { pastStates: [...pastStates], futureStates: [...futureStates] }
      return () => {
        sync(current)
        lastTarget = previousTarget
        journal.setState(saved)
      }
    },
  }
}

export function createTimelineHistory() {
  const history = createSessionHistory<TimelineState>(30)
  let gesture: { token: symbol; base: TimelineState; restore: () => void; head: object } | undefined
  const releaseFrames = history.release
  return Object.assign(history, {
    release() { gesture = undefined; releaseFrames() },
    capture(base: TimelineState) {
      if (gesture?.base === base && gesture.head === history.entries.pastStates.at(-1)) return gesture.token
      const restore = history.checkpoint(base)
      history.record(base, base)
      const token = Symbol('timeline gesture')
      gesture = { token, base, restore, head: history.entries.pastStates.at(-1)! }
      return token
    },
    finishGesture(token: symbol | undefined) {
      if (gesture?.token === token) gesture = undefined
    },
    cancelGesture(token = gesture?.token) {
      if (!gesture || token !== gesture.token || gesture.head !== history.entries.pastStates.at(-1)) return
      const { base, restore } = gesture
      gesture = undefined
      restore()
      return base
    },
  })
}
export const createLayoutHistory = () => createSessionHistory<EditingPanelLayout>(20)

type PreviewHistory = {
  editingPanelHistory: ReturnType<typeof createLayoutHistory>
  timelineHistory: ReturnType<typeof createTimelineHistory>
  undoEditingPanelLayout(): boolean
}

export function registerPreviewLayoutHistoryShortcut(host: { current: Element | null }, read: () => PreviewHistory) {
  return registerHistoryShortcut('layout', () => {
    const { editingPanelHistory, timelineHistory } = read()
    return workspaceInputSurfaceIsActive(host.current) && editingPanelHistory.lastTarget > timelineHistory.lastTarget
  }, (direction, event) => {
    if (isTimelineShortcutEditingTarget(event.target)) return false
    // Layout is undo-only. Its redo chord must not reach the timeline.
    if (direction === 'undo') read().undoEditingPanelLayout()
  })
}
