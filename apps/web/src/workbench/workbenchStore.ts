import { create } from 'zustand'
import {
  addClipAtFrame,
  duplicateClipById,
  moveClipToFrame,
  nudgeClipById,
  removeClipById,
  resizeClipEdge,
  setTimelinePlayheadFrame,
  setTimelineScale,
  splitClipAtFrame,
} from './timeline/timelineEdit'
import { createDefaultTimeline, normalizeTimeline } from './timeline/timelineMath'
import type { TimelineClip, TimelineState, TimelineTrackType } from './timeline/timelineTypes'
import { createDefaultWorkbenchDocument, type CreationDocumentTools, type PreviewAspectRatio, type WorkbenchDocument } from './workbenchTypes'
import type { WorkbenchAiMessage } from './ai/workbenchAiTypes'

export const WORKSPACE_MODES = ['creation', 'generation', 'preview'] as const

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number]

type WorkbenchState = {
  workspaceMode: WorkspaceMode
  workbenchDocument: WorkbenchDocument
  creationDocumentTools: CreationDocumentTools | null
  creationSelectionText: string
  creationAiModeId: string
  creationAiDraft: string
  creationAiMessages: WorkbenchAiMessage[]
  creationAiError: string
  timeline: TimelineState
  timelinePlaying: boolean
  previewAspectRatio: PreviewAspectRatio
  selectedTimelineClipId: string
  setWorkspaceMode: (mode: unknown) => void
  setWorkbenchDocument: (document: WorkbenchDocument) => void
  setCreationDocumentTools: (tools: CreationDocumentTools | null) => void
  setCreationSelectionText: (text: string) => void
  setCreationAiModeId: (modeId: string) => void
  setCreationAiDraft: (draft: string) => void
  setCreationAiMessages: (messages: WorkbenchAiMessage[] | ((messages: WorkbenchAiMessage[]) => WorkbenchAiMessage[])) => void
  setCreationAiError: (error: string) => void
  resetCreationAiConversation: () => void
  setTimeline: (timeline: TimelineState) => void
  setTimelinePlaying: (playing: boolean) => void
  setPreviewAspectRatio: (ratio: PreviewAspectRatio) => void
  addTimelineClipAtFrame: (clip: TimelineClip, trackType: TimelineTrackType, startFrame: number) => void
  moveTimelineClip: (clipId: string, startFrame: number) => void
  removeTimelineClip: (clipId: string) => void
  resizeTimelineClip: (clipId: string, edge: 'left' | 'right', deltaFrame: number) => void
  splitTimelineClip: (clipId: string, frame: number) => void
  duplicateTimelineClip: (clipId: string) => void
  nudgeTimelineClip: (clipId: string, deltaFrame: number) => void
  selectTimelineClip: (clipId: string) => void
  setTimelinePlayhead: (frame: number) => void
  setTimelineZoom: (scale: number) => void
  restoreTimeline: (timeline: unknown) => void
}

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return typeof value === 'string' && WORKSPACE_MODES.includes(value as WorkspaceMode)
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  workspaceMode: 'generation',
  workbenchDocument: createDefaultWorkbenchDocument(),
  creationDocumentTools: null,
  creationSelectionText: '',
  creationAiModeId: 'story',
  creationAiDraft: '',
  creationAiMessages: [],
  creationAiError: '',
  timeline: createDefaultTimeline(),
  timelinePlaying: false,
  previewAspectRatio: '16:9',
  selectedTimelineClipId: '',
  setWorkspaceMode: (mode) => {
    if (!isWorkspaceMode(mode)) return
    set({ workspaceMode: mode })
  },
  setWorkbenchDocument: (workbenchDocument) => {
    set({ workbenchDocument })
  },
  setCreationDocumentTools: (creationDocumentTools) => {
    set({ creationDocumentTools })
  },
  setCreationSelectionText: (text) => {
    set({ creationSelectionText: typeof text === 'string' ? text.trim() : '' })
  },
  setCreationAiModeId: (creationAiModeId) => {
    set({ creationAiModeId })
  },
  setCreationAiDraft: (creationAiDraft) => {
    set({ creationAiDraft })
  },
  setCreationAiMessages: (messages) => {
    set((state) => ({
      creationAiMessages: typeof messages === 'function' ? messages(state.creationAiMessages) : messages,
    }))
  },
  setCreationAiError: (creationAiError) => {
    set({ creationAiError })
  },
  resetCreationAiConversation: () => {
    set({ creationAiDraft: '', creationAiMessages: [], creationAiError: '' })
  },
  setTimeline: (timeline) => {
    set({ timeline: normalizeTimeline(timeline) })
  },
  setTimelinePlaying: (timelinePlaying) => {
    set({ timelinePlaying: Boolean(timelinePlaying) })
  },
  setPreviewAspectRatio: (previewAspectRatio) => {
    set({ previewAspectRatio })
  },
  addTimelineClipAtFrame: (clip, trackType, startFrame) => {
    set((state) => {
      const nextTimeline = addClipAtFrame(state.timeline, clip, trackType, startFrame)
      const inserted = nextTimeline !== state.timeline
        && nextTimeline.tracks.some((track) => track.clips.some((current) => current.id === clip.id))
      return {
        timeline: nextTimeline,
        selectedTimelineClipId: inserted ? clip.id : state.selectedTimelineClipId,
      }
    })
  },
  moveTimelineClip: (clipId, startFrame) => {
    set((state) => ({
      timeline: moveClipToFrame(state.timeline, clipId, startFrame),
      selectedTimelineClipId: String(clipId || '').trim(),
    }))
  },
  removeTimelineClip: (clipId) => {
    set((state) => ({
      timeline: removeClipById(state.timeline, clipId),
      selectedTimelineClipId: state.selectedTimelineClipId === clipId ? '' : state.selectedTimelineClipId,
      timelinePlaying: false,
    }))
  },
  resizeTimelineClip: (clipId, edge, deltaFrame) => {
    set((state) => ({
      timeline: resizeClipEdge(state.timeline, clipId, edge, deltaFrame),
      selectedTimelineClipId: String(clipId || '').trim(),
    }))
  },
  splitTimelineClip: (clipId, frame) => {
    set((state) => ({
      timeline: splitClipAtFrame(state.timeline, clipId, frame),
      selectedTimelineClipId: String(clipId || '').trim(),
    }))
  },
  duplicateTimelineClip: (clipId) => {
    set((state) => ({
      timeline: duplicateClipById(state.timeline, clipId),
      selectedTimelineClipId: String(clipId || '').trim(),
    }))
  },
  nudgeTimelineClip: (clipId, deltaFrame) => {
    set((state) => ({
      timeline: nudgeClipById(state.timeline, clipId, deltaFrame),
      selectedTimelineClipId: String(clipId || '').trim(),
    }))
  },
  selectTimelineClip: (clipId) => {
    set({ selectedTimelineClipId: String(clipId || '').trim() })
  },
  setTimelinePlayhead: (frame) => {
    set((state) => ({ timeline: setTimelinePlayheadFrame(state.timeline, frame) }))
  },
  setTimelineZoom: (scale) => {
    set((state) => ({ timeline: setTimelineScale(state.timeline, scale) }))
  },
  restoreTimeline: (timeline) => {
    set({ timeline: normalizeTimeline(timeline) })
  },
}))
