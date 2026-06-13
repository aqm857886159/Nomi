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
import {
  addTextClip,
  moveTextClip,
  removeTextClip,
  resizeTextClip,
  updateTextClipText,
} from './timeline/timelineTextEdit'
import { createDefaultTimeline, normalizeTimeline } from './timeline/timelineMath'
import type { TimelineClip, TimelineState, TimelineTextStyle, TimelineTrackType } from './timeline/timelineTypes'
import { createDefaultWorkbenchDocument, normalizeWorkbenchDocument, type CreationDocumentTools, type PreviewAspectRatio, type WorkbenchDocument } from './workbenchTypes'
import type { WorkbenchAiMessage } from './ai/workbenchAiTypes'
import type { StoryboardPlan } from './generationCanvas/agent/storyboardPlan'
import type { ComposerAttachment } from './ai/composer/composerAttachmentTypes'
import { createConversationBuckets } from './aiConversationBuckets'

// 创作面板会话「会话域」per-project 桶(S1 治串台)。
// 注:messages 已迁出本桶,改由 conversationThreads 模型按项目寻址(会话历史,2026-06-14);
// 本桶只管 draft/附件/error 这些「不落盘的 session 态」的切项目交换。
const creationAiBuckets = createConversationBuckets(() => ({
  creationAiDraft: '',
  creationAiAttachments: [] as ComposerAttachment[],
  creationAiError: '',
}))
import {
  cloneBuiltinCategories,
  createCustomCategory,
  createCustomCategoryId,
  isBuiltinCategoryId,
  normalizeCategories,
  DEFAULT_CATEGORY_ID,
  type ProjectCategory,
} from './project/projectCategories'
import { useGenerationCanvasStore } from './generationCanvas/store/generationCanvasStore'

/** 拖动中临时吸附辅助线（非持久化）。 */
export type TimelineSnapGuide = { frame: number; label: string }

export const WORKSPACE_MODES = ['creation', 'generation', 'preview'] as const

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number]

type GraphViewport = { zoom: number; offset: { x: number; y: number } }

type WorkbenchState = {
  persistRevision: number
  workspaceMode: WorkspaceMode
  /** 生成/预览区右侧助手侧栏宽度（px，可拖宽）。 */
  assistantWidth: number
  /** Phase E: which directory-tree category is currently selected */
  activeCategoryId: string
  /** 顶层分类列表（内置 5 + 用户自定义）。单一真相源，持久化随项目。 */
  categories: ProjectCategory[]
  /** Phase E: collapsed (icon-only) vs expanded sidebar */
  sidebarCollapsed: boolean
  /** Phase E: viewport (zoom + offset) per graph-canvas-type category */
  categoryViewports: Record<string, GraphViewport>
  setActiveCategoryId: (id: string) => void
  /** 读盘恢复整套分类（含自定义）。 */
  setCategories: (categories: unknown) => void
  /** 新建一个自定义顶层分类（通用外观），返回新分类供调用方进入行内改名。 */
  addCategory: (name?: string) => ProjectCategory | null
  /** 改自定义分类名（内置只读，忽略）。 */
  renameCategory: (id: string, name: string) => void
  /** 删自定义分类（内置不可删）：其下节点改派回「分镜」、子组解散，不丢节点。 */
  deleteCategory: (id: string) => void
  toggleSidebarCollapsed: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  rememberCategoryViewport: (categoryId: string, viewport: GraphViewport) => void
  workbenchDocument: WorkbenchDocument
  creationDocumentTools: CreationDocumentTools | null
  creationSelectionText: string
  creationAiModeId: string
  creationAiDraft: string
  creationAiMessages: WorkbenchAiMessage[]
  creationAiAttachments: ComposerAttachment[]
  creationAiError: string
  /** 分镜方案对象（planner 产出，创作区审/改后确认落画布）。null=本项目暂无方案。切项目清空。 */
  storyboardPlan: StoryboardPlan | null
  timeline: TimelineState
  timelinePlaying: boolean
  previewAspectRatio: PreviewAspectRatio
  /** 多选：选中 clip id 集合（单一真相源）。单片工具取末位为 primary。 */
  selectedTimelineClipIds: string[]
  /** 选中的文字（字幕/标题卡）clip id。与媒体 clip 选择互斥，避免 Delete 歧义。 */
  selectedTextClipId: string
  /** 拖动中临时吸附辅助线（非持久化，停手即清） */
  timelineSnapGuide: TimelineSnapGuide | null
  setWorkspaceMode: (mode: unknown) => void
  setAssistantWidth: (width: number) => void
  setWorkbenchDocument: (document: WorkbenchDocument) => void
  setCreationDocumentTools: (tools: CreationDocumentTools | null) => void
  setCreationSelectionText: (text: string) => void
  setCreationAiModeId: (modeId: string) => void
  setCreationAiDraft: (draft: string) => void
  setCreationAiMessages: (messages: WorkbenchAiMessage[] | ((messages: WorkbenchAiMessage[]) => WorkbenchAiMessage[])) => void
  setCreationAiAttachments: (attachments: ComposerAttachment[] | ((attachments: ComposerAttachment[]) => ComposerAttachment[])) => void
  setCreationAiError: (error: string) => void
  /** 写入/清空分镜方案对象（propose_storyboard_plan 落库、确认落画布后清）。 */
  setStoryboardPlan: (plan: StoryboardPlan | null) => void
  /** 切项目时交换对话桶(S1 治串台):存旧项目的对话,载入新项目的(没有则空)。 */
  swapCreationAiProject: (prevId: string | null, nextId: string | null) => void
  /** 一次性信号：打开示例/新项目时请求创作助手默认展开（让「拆镜头」CTA 一眼可见），消费后清掉。 */
  creationAssistantAutoOpen: boolean
  setCreationAssistantAutoOpen: (open: boolean) => void
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
  /** 文字轨（字幕/标题卡）。在 playhead 处加一条，选中并返回 id。 */
  addTimelineTextClip: (style: TimelineTextStyle, startFrame: number) => string
  updateTimelineTextClip: (id: string, text: string) => void
  /** 拖动中传 commit:false 不落盘，松手 commit:true 落盘一次。 */
  moveTimelineTextClip: (id: string, startFrame: number, options?: { commit?: boolean }) => void
  resizeTimelineTextClip: (id: string, edge: 'left' | 'right', frame: number, options?: { commit?: boolean }) => void
  removeTimelineTextClip: (id: string) => void
  selectTimelineTextClip: (id: string) => void
}

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return typeof value === 'string' && WORKSPACE_MODES.includes(value as WorkspaceMode)
}

export const useWorkbenchStore = create<WorkbenchState>()(subscribeWithSelector((set, get) => ({
  persistRevision: 0,
  workspaceMode: 'generation',
  assistantWidth: 340,
  activeCategoryId: 'shots',
  categories: cloneBuiltinCategories(),
  sidebarCollapsed: true,
  categoryViewports: {},
  setActiveCategoryId: (id) => {
    if (typeof id !== 'string' || !id.trim()) return
    set({ activeCategoryId: id })
  },
  setCategories: (categories) => {
    set({ categories: normalizeCategories(categories) })
  },
  addCategory: (name) => {
    const current = get().categories
    const id = createCustomCategoryId(current.map((c) => c.id))
    const order = current.reduce((max, c) => Math.max(max, c.order), 0) + 1
    const category = createCustomCategory({ id, name: (name || '').trim() || '新分类', order })
    set((state) => ({
      categories: [...state.categories, category],
      persistRevision: state.persistRevision + 1,
    }))
    return category
  },
  renameCategory: (id, name) => {
    const trimmed = (name || '').trim()
    if (!trimmed || isBuiltinCategoryId(id)) return // 空名或内置 → 忽略
    set((state) => {
      if (!state.categories.some((c) => c.id === id && !c.isBuiltin)) return state
      return {
        categories: state.categories.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  deleteCategory: (id) => {
    if (isBuiltinCategoryId(id)) return // 内置不可删
    if (!get().categories.some((c) => c.id === id && !c.isBuiltin)) return
    // 节点回家：其下节点改派回「分镜」，子组解散（保留节点）——用户拍板「节点回家」。
    const canvas = useGenerationCanvasStore.getState()
    canvas.nodes
      .filter((n) => (n.categoryId || DEFAULT_CATEGORY_ID) === id)
      .forEach((n) => canvas.reassignNodeCategory(n.id, DEFAULT_CATEGORY_ID))
    canvas.groups
      .filter((g) => g.categoryId === id)
      .forEach((g) => canvas.deleteGroup(g.id, false))
    set((state) => ({
      categories: state.categories.filter((c) => c.id !== id),
      activeCategoryId: state.activeCategoryId === id ? DEFAULT_CATEGORY_ID : state.activeCategoryId,
      persistRevision: state.persistRevision + 1,
    }))
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
  creationAiAttachments: [],
  creationAiError: '',
  storyboardPlan: null,
  creationAssistantAutoOpen: false,
  timeline: createDefaultTimeline(),
  timelinePlaying: false,
  previewAspectRatio: '16:9',
  selectedTimelineClipIds: [],
  selectedTextClipId: '',
  timelineSnapGuide: null,
  setWorkspaceMode: (mode) => {
    if (!isWorkspaceMode(mode)) return
    set({ workspaceMode: mode })
  },
  setAssistantWidth: (width) => set({ assistantWidth: Math.max(300, Math.min(600, Math.round(width))) }),
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
  setCreationAiAttachments: (attachments) => {
    set((state) => ({
      creationAiAttachments: typeof attachments === 'function' ? attachments(state.creationAiAttachments) : attachments,
    }))
  },
  setCreationAiError: (creationAiError) => {
    set({ creationAiError })
  },
  setStoryboardPlan: (storyboardPlan) => {
    set({ storyboardPlan })
  },
  setCreationAssistantAutoOpen: (creationAssistantAutoOpen) => {
    set({ creationAssistantAutoOpen })
  },
  swapCreationAiProject: (prevId, nextId) => {
    const state = get()
    set({
      ...creationAiBuckets.swap(prevId, nextId, {
        creationAiDraft: state.creationAiDraft,
        creationAiAttachments: state.creationAiAttachments,
        creationAiError: state.creationAiError,
      }),
      // messages 由 conversationThreads 模型按项目持有;切项目先清空,载入由 loadProjectConversations 投影回。
      creationAiMessages: [],
      // 方案是 per-project 工作产物,不入对话桶——切项目直接清,防跨项目串台(2026-06-10 走查教训)。
      storyboardPlan: null,
    })
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
          selectedTextClipId: '',
        }
      }
      return { selectedTimelineClipIds: [id], selectedTextClipId: '' }
    })
  },
  setTimelineSelection: (clipIds) => {
    const ids = Array.from(new Set((clipIds || []).map((id) => String(id || '').trim()).filter(Boolean)))
    set({ selectedTimelineClipIds: ids, selectedTextClipId: '' })
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
  addTimelineTextClip: (style, startFrame) => {
    const { timeline, id } = addTextClip(get().timeline, style, startFrame)
    set((state) => ({
      timeline,
      selectedTextClipId: id,
      selectedTimelineClipIds: [],
      persistRevision: state.persistRevision + 1,
    }))
    return id
  },
  updateTimelineTextClip: (id, text) => {
    set((state) => {
      const next = updateTextClipText(state.timeline, id, text)
      return next === state.timeline
        ? state
        : { timeline: next, persistRevision: state.persistRevision + 1 }
    })
  },
  moveTimelineTextClip: (id, startFrame, options) => {
    const commit = options?.commit !== false
    set((state) => {
      const next = moveTextClip(state.timeline, id, startFrame)
      const changed = next !== state.timeline
      return {
        timeline: next,
        selectedTextClipId: String(id || '').trim(),
        selectedTimelineClipIds: [],
        persistRevision: commit && changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  resizeTimelineTextClip: (id, edge, frame, options) => {
    const commit = options?.commit !== false
    set((state) => {
      const next = resizeTextClip(state.timeline, id, edge, frame)
      const changed = next !== state.timeline
      return {
        timeline: next,
        persistRevision: commit && changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  removeTimelineTextClip: (id) => {
    set((state) => {
      const next = removeTextClip(state.timeline, id)
      const changed = next !== state.timeline
      return {
        timeline: next,
        selectedTextClipId: state.selectedTextClipId === id ? '' : state.selectedTextClipId,
        timelinePlaying: false,
        persistRevision: changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  selectTimelineTextClip: (id) => {
    const next = String(id || '').trim()
    set({ selectedTextClipId: next, selectedTimelineClipIds: [] })
  },
})))
