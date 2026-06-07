import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import {
  addClipAtFrame,
  applyClipStartFrames,
  duplicateClipById,
  moveClipToLegalFrame,
  nudgeClipById,
  removeClipById,
  removeClipsByIds,
  resizeClipEdge,
  setTimelinePlayheadFrame,
  setTimelineScale,
  splitClipAtFrame,
} from './timeline/timelineEdit'
import { createDefaultTimeline, normalizeTimeline } from './timeline/timelineMath'
import type { TimelineClip, TimelineState, TimelineTrackType } from './timeline/timelineTypes'
import { createDefaultWorkbenchDocument, normalizeWorkbenchDocument, type CreationDocumentTools, type PreviewAspectRatio, type WorkbenchDocument } from './workbenchTypes'
import type { WorkbenchAiMessage } from './ai/workbenchAiTypes'

/** 拖动中临时吸附辅助线（非持久化）。 */
export type TimelineSnapGuide = { frame: number; label: string }

export const WORKSPACE_MODES = ['creation', 'generation', 'preview'] as const

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number]

type GraphViewport = { zoom: number; offset: { x: number; y: number } }

type WorkbenchState = {
  persistRevision: number
  workspaceMode: WorkspaceMode
  /** Unified collapse for the single app-level assistant dock (C-2). */
  assistantCollapsed: boolean
  /** Phase E: which directory-tree category is currently selected */
  activeCategoryId: string
  /** Phase E: collapsed (icon-only) vs expanded sidebar */
  sidebarCollapsed: boolean
  /** Phase E: viewport (zoom + offset) per graph-canvas-type category */
  categoryViewports: Record<string, GraphViewport>
  setActiveCategoryId: (id: string) => void
  toggleSidebarCollapsed: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  rememberCategoryViewport: (categoryId: string, viewport: GraphViewport) => void
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
  /** 多选：选中 clip id 集合（单一真相源）。单片工具取末位为 primary。 */
  selectedTimelineClipIds: string[]
  /** 拖动中临时吸附辅助线（非持久化，停手即清） */
  timelineSnapGuide: TimelineSnapGuide | null
  setWorkspaceMode: (mode: unknown) => void
  setAssistantCollapsed: (collapsed: boolean) => void
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
  /** 移到离期望起点最近的合法位（撞了滑入空位，不弹回）。拖动中传 commit:false 不触发持久化，松手时 commit:true 落盘一次。 */
  moveTimelineClip: (clipId: string, startFrame: number, options?: { commit?: boolean }) => void
  /** 成组移动多选 clip（外部传期望绝对起点）。拖动中 commit:false，松手 commit:true 落盘。 */
  moveTimelineClips: (positions: Record<string, number>, options?: { commit?: boolean }) => void
  setTimelineSnapGuide: (guide: TimelineSnapGuide | null) => void
  removeTimelineClip: (clipId: string) => void
  removeSelectedTimelineClips: () => void
  resizeTimelineClip: (clipId: string, edge: 'left' | 'right', deltaFrame: number) => void
  splitTimelineClip: (clipId: string, frame: number) => void
  duplicateTimelineClip: (clipId: string) => void
  nudgeTimelineClip: (clipId: string, deltaFrame: number) => void
  /** additive(shift/⌘)：在集合中切换；否则替换为单选。 */
  selectTimelineClip: (clipId: string, options?: { additive?: boolean }) => void
  setTimelineSelection: (clipIds: string[]) => void
  setTimelinePlayhead: (frame: number) => void
  setTimelineZoom: (scale: number) => void
  restoreTimeline: (timeline: unknown) => void
}

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return typeof value === 'string' && WORKSPACE_MODES.includes(value as WorkspaceMode)
}

export const useWorkbenchStore = create<WorkbenchState>()(subscribeWithSelector((set) => ({
  persistRevision: 0,
  workspaceMode: 'generation',
  assistantCollapsed: true,
  activeCategoryId: 'shots',
  sidebarCollapsed: true,
  categoryViewports: {},
  setActiveCategoryId: (id) => {
    if (typeof id !== 'string' || !id.trim()) return
    set({ activeCategoryId: id })
  },
  toggleSidebarCollapsed: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed: Boolean(sidebarCollapsed) })
  },
  rememberCategoryViewport: (categoryId, viewport) => {
    if (!categoryId) return
    set((state) => ({
      categoryViewports: {
        ...state.categoryViewports,
        [categoryId]: viewport,
      },
    }))
  },
  workbenchDocument: createDefaultWorkbenchDocument(),
  creationDocumentTools: null,
  creationSelectionText: '',
  creationAiModeId: 'general',
  creationAiDraft: '',
  creationAiMessages: [],
  creationAiError: '',
  timeline: createDefaultTimeline(),
  timelinePlaying: false,
  previewAspectRatio: '16:9',
  selectedTimelineClipIds: [],
  timelineSnapGuide: null,
  setWorkspaceMode: (mode) => {
    if (!isWorkspaceMode(mode)) return
    set({ workspaceMode: mode })
  },
  setAssistantCollapsed: (collapsed) => set({ assistantCollapsed: Boolean(collapsed) }),
  setWorkbenchDocument: (workbenchDocument) => {
    set((state) => ({
      workbenchDocument: normalizeWorkbenchDocument(workbenchDocument),
      persistRevision: state.persistRevision + 1,
    }))
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
    set((state) => ({
      timeline: normalizeTimeline(timeline),
      persistRevision: state.persistRevision + 1,
    }))
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
        selectedTimelineClipIds: inserted ? [clip.id] : state.selectedTimelineClipIds,
        persistRevision: inserted ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  moveTimelineClip: (clipId, startFrame, options) => {
    const commit = options?.commit !== false
    set((state) => {
      const nextTimeline = moveClipToLegalFrame(state.timeline, clipId, startFrame)
      const changed = nextTimeline !== state.timeline
      return {
        timeline: nextTimeline,
        selectedTimelineClipIds: [String(clipId || '').trim()].filter(Boolean),
        // 拖动中(commit:false)不 bump persistRevision，避免每帧触发自动保存；松手 commit 一次
        persistRevision: commit && changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  moveTimelineClips: (positions, options) => {
    const commit = options?.commit !== false
    set((state) => {
      const nextTimeline = applyClipStartFrames(state.timeline, positions)
      const changed = nextTimeline !== state.timeline
      return {
        timeline: nextTimeline,
        persistRevision: commit && changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  setTimelineSnapGuide: (guide) => {
    set({ timelineSnapGuide: guide })
  },
  removeTimelineClip: (clipId) => {
    set((state) => {
      const id = String(clipId || '').trim()
      const hasClip = state.timeline.tracks.some((track) => track.clips.some((clip) => clip.id === id))
      return {
        timeline: hasClip ? removeClipById(state.timeline, id) : state.timeline,
        selectedTimelineClipIds: state.selectedTimelineClipIds.filter((current) => current !== id),
        timelinePlaying: false,
        persistRevision: hasClip ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  removeSelectedTimelineClips: () => {
    set((state) => {
      const ids = state.selectedTimelineClipIds
      if (ids.length === 0) return state
      const nextTimeline = removeClipsByIds(state.timeline, ids)
      const changed = nextTimeline !== state.timeline
      return {
        timeline: nextTimeline,
        selectedTimelineClipIds: [],
        timelinePlaying: false,
        persistRevision: changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  resizeTimelineClip: (clipId, edge, deltaFrame) => {
    set((state) => {
      const nextTimeline = resizeClipEdge(state.timeline, clipId, edge, deltaFrame)
      return {
        timeline: nextTimeline,
        selectedTimelineClipIds: [String(clipId || '').trim()].filter(Boolean),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  splitTimelineClip: (clipId, frame) => {
    set((state) => {
      const nextTimeline = splitClipAtFrame(state.timeline, clipId, frame)
      return {
        timeline: nextTimeline,
        selectedTimelineClipIds: [String(clipId || '').trim()].filter(Boolean),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  duplicateTimelineClip: (clipId) => {
    set((state) => {
      const nextTimeline = duplicateClipById(state.timeline, clipId)
      return {
        timeline: nextTimeline,
        selectedTimelineClipIds: [String(clipId || '').trim()].filter(Boolean),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  nudgeTimelineClip: (clipId, deltaFrame) => {
    set((state) => {
      const nextTimeline = nudgeClipById(state.timeline, clipId, deltaFrame)
      return {
        timeline: nextTimeline,
        selectedTimelineClipIds: [String(clipId || '').trim()].filter(Boolean),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  selectTimelineClip: (clipId, options) => {
    const id = String(clipId || '').trim()
    if (!id) return
    set((state) => {
      if (options?.additive) {
        const exists = state.selectedTimelineClipIds.includes(id)
        return {
          selectedTimelineClipIds: exists
            ? state.selectedTimelineClipIds.filter((current) => current !== id)
            : [...state.selectedTimelineClipIds, id],
        }
      }
      return { selectedTimelineClipIds: [id] }
    })
  },
  setTimelineSelection: (clipIds) => {
    const ids = Array.from(new Set((clipIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
    set({ selectedTimelineClipIds: ids })
  },
  setTimelinePlayhead: (frame) => {
    set((state) => ({ timeline: setTimelinePlayheadFrame(state.timeline, frame) }))
  },
  setTimelineZoom: (scale) => {
    set((state) => ({ timeline: setTimelineScale(state.timeline, scale) }))
  },
  restoreTimeline: (timeline) => {
    set((state) => ({
      timeline: normalizeTimeline(timeline),
      persistRevision: state.persistRevision + 1,
    }))
  },
})))
