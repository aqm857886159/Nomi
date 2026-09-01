import type { TimelineState } from './timelineTypes'

export type TimelineAgentUndoMetadata = Readonly<{
  projectId: string
  planId: string
  planSignature: string
  beforeRevision: string
  afterRevision: string
  undoToken: string
  receiptProposalId: string
  approvalId: string
  actionHash: string
}>

export type TimelineAgentUndoEntry = Readonly<{
  timeline: TimelineState
  agentMetadata: TimelineAgentUndoMetadata
}>

/** Legacy/session entries remain readable; only annotated entries authorize Agent undo. */
export type TimelineUndoEntry = TimelineState | TimelineAgentUndoEntry

function isAgentEntry(entry: TimelineUndoEntry | undefined): entry is TimelineAgentUndoEntry {
  return Boolean(
    entry &&
      typeof entry === 'object' &&
      'timeline' in entry &&
      'agentMetadata' in entry &&
      entry.timeline &&
      entry.agentMetadata,
  )
}

export function timelineUndoTimeline(entry: TimelineUndoEntry): TimelineState {
  return isAgentEntry(entry) ? entry.timeline : entry
}

export function timelineAgentUndoMetadata(
  entry: TimelineUndoEntry | undefined,
): TimelineAgentUndoMetadata | undefined {
  return isAgentEntry(entry) ? entry.agentMetadata : undefined
}

export function createTimelineAgentUndoEntry(
  timeline: TimelineState,
  agentMetadata: TimelineAgentUndoMetadata,
): TimelineAgentUndoEntry {
  return { timeline, agentMetadata }
}
