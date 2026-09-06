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
  removeClipsBySourceNodeIds,
  resizeClipEdge,
  setTimelinePlayheadFrame,
  setTimelineScale,
  splitClipAtFrame,
  updateClipsBySourceNodeId,
} from './timeline/timelineEdit'
import { applyRegeneratedResultToClip } from './generationCanvas/model/buildClipFromGenerationNode'
import type { GenerationNodeResult } from './generationCanvas/model/generationCanvasTypes'
import {
  addTextClip,
  moveTextClip,
  removeTextClip,
  resizeTextClip,
  updateTextClipFont,
  updateTextClipText,
  updateTextClipTransform,
} from './timeline/timelineTextEdit'
import type { Vec2 } from './timeline/overlayTransform'
import { createDefaultTimeline, normalizeTimeline } from './timeline/timelineMath'
import type { TimelineClip, TimelineState, TimelineTextStyle, TimelineTrackType } from './timeline/timelineTypes'
import type { TimelineTransition } from './timeline/timelineTypes'
import { applyTimelineOperation } from './timeline/kernel/timelineKernel'
import { timelineUndoTimeline, type TimelineUndoEntry } from './timeline/timelineUndoHistory'
import { normalizeWorkbenchDocument, type CreationDocumentTools, type PreviewAspectRatio, type WorkbenchDocument } from './workbenchTypes'
import type { ComposerAttachment } from './ai/composer/composerAttachmentTypes'
import { createWorkbenchDocumentSlice, type WorkbenchDocumentSlice } from './workbenchDocumentSlice'
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
import type { AgentContextHandle } from '../../electron/shared/agentContextSnapshot'
import {
  DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
  DEFAULT_PROJECT_AGENT_WORK_MODE,
  type ProjectAgentApprovalPolicy,
  type ProjectAgentWorkMode,
} from '../../electron/shared/projectAgentContracts'
import { createEditingPanelLayoutSlice, type EditingPanelLayoutSlice } from './preview/editingPanelLayoutSlice'
import { createTimelineClipWritesSlice, type TimelineClipWritesSlice } from './timeline/timelineClipWritesSlice'
import type { ExportQuality } from './export/exportTypes'

/** 拖动中临时吸附辅助线（非持久化）。 */
export type TimelineSnapGuide = { frame: number; label: string }

/** Shared timeline layout bounds; this is UI state, not timeline data. */
export const TIMELINE_PANEL_MIN = 140
export const TIMELINE_PANEL_MAX = 300
// 188 = origin/main 的固定 --workbench-timeline-height。cutover 把时间轴改成可拖拽面板
// （timelinePanelHeight），展开态默认高度对齐 main 的 188（比 cutover 原来的 206 少 18px、多还画布
// stage 18px；可拖拽特性不变，用户仍可拉高/降低）。默认折叠态（timelinePanelCollapsed=true）下
// gridTemplateRows 走 0px、stage 拿满高，本值不参与；只有加片段展开时间轴后此值决定 stage 底边。
export const TIMELINE_PANEL_DEFAULT = 188

export function clampTimelinePanelHeight(value: number): number {
  if (!Number.isFinite(value)) return TIMELINE_PANEL_DEFAULT
  return Math.max(TIMELINE_PANEL_MIN, Math.min(TIMELINE_PANEL_MAX, Math.round(value)))
}

// 时间轴撤销栈封顶（防无限增长）。
const TIMELINE_UNDO_LIMIT = 30
// 离散编辑生效时把旧 timeline 压栈：仅当真的变了。供 set 内联调用。
function pushTimelineUndo(stack: TimelineUndoEntry[], previous: TimelineState): TimelineUndoEntry[] {
  const next = [...stack, previous]
  if (next.length > TIMELINE_UNDO_LIMIT) next.shift()
  return next
}

export const WORKSPACE_MODES = ['creation', 'storyboard', 'generation', 'preview'] as const

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number]

type GraphViewport = { zoom: number; offset: { x: number; y: number } }

export type ProjectAgentReference = Readonly<{
  id: string
  label: string
  kind: 'document' | 'canvas' | 'preview' | 'timeline' | 'browser' | 'asset'
  /** Stable domain identity captured at send time (never a UI-only label). */
  value?: string
  /** Immutable selection handle captured when the user added this reference. */
  contextHandle?: AgentContextHandle
}>

/** Renderer alias; the canonical work-mode vocabulary lives in shared contracts. */
export type ProjectAgentRunMode = ProjectAgentWorkMode

type WorkbenchState = WorkbenchDocumentSlice & EditingPanelLayoutSlice & TimelineClipWritesSlice & {
  persistRevision: number
  workspaceMode: WorkspaceMode
  /** 生成/预览区右侧助手侧栏宽度（px，可拖宽）。 */
  assistantWidth: number
  /** 左侧项目/素材侧栏展开态宽度覆盖值（px，可拖宽；null = 跟随 tab 默认：库 500 / 分组 300）。
      2026-08-08 飞书反馈「素材库宽度锁死不能拖拽」。 */
  projectSidebarWidth: number | null
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
  creationDocumentTools: CreationDocumentTools | null
  creationSelectionText: string; storyboardPlannerLauncher: ((displayPrompt?: string) => void) | null
  creationAiModeId: string
  /** 手动锁定的 active skill（覆盖 mode 推导的 skillKey）。null = 自动（用创作模式默认）。 */
  creationActiveSkill: { key: string; name: string } | null
  /**
   * 「请画布适应视图」一次性信号（nonce，仿 createCategoryNonce）。bump 一次 = 请生成画布
   * 平滑 fit 到全部节点一次。用于落画布等「批量加节点到已加载画布」的场景——useAutoFitOnLoad
   * 只在首次加载/切分类触发，加新节点不重跑，新节点会落在视口外（用户以为「没反应」）。
   * 非持久化、非用户动作残留：只在显式动作时 bump。
   */
  canvasFitNonce: number
  canvasFitCategoryId: string | null
  timeline: TimelineState
  timelinePlaying: boolean
  previewAspectRatio: PreviewAspectRatio
  /** 多选：选中 clip id 集合（单一真相源）。单片工具取末位为 primary。 */
  selectedTimelineClipIds: string[]
  /** 选中的文字（字幕/标题卡）clip id。与媒体 clip 选择互斥，避免 Delete 歧义。 */
  selectedTextClipId: string
  /** 拖动中临时吸附辅助线（非持久化，停手即清） */
  timelineSnapGuide: TimelineSnapGuide | null
  /** 剪刀模式：进入后悬停片段出切点线、点击在光标处分割；平时点片段是选中。 */
  timelineSplitMode: boolean
  /** 生成页底部时间轴收起/展开（会话级 UI 态；节点「加入时间轴」成功后会展开它）。 */
  timelinePanelCollapsed: boolean
  setTimelinePanelCollapsed: (collapsed: boolean) => void
  /** 跨生成/预览共享的时间轴高度（会话级 UI 态，不写入项目）。 */
  timelinePanelHeight: number
  setTimelinePanelHeight: (height: number) => void
  exportResolution: '720p' | '1080p'
  exportQuality: ExportQuality
  setExportResolution: (resolution: '720p' | '1080p') => void
  setExportQuality: (quality: ExportQuality) => void
  /** 时间轴撤销栈（仅时间轴编辑，非持久化）。封顶后丢最旧。 */
  timelineUndoStack: TimelineUndoEntry[]
  /** 时间轴重做栈。撤销时压入；任一新编辑清空（新编辑使 redo 失效，标准语义）。 */
  timelineRedoStack: TimelineState[]
  setTimelineSplitMode: (on: boolean) => void
  /** 把当前 timeline 压入撤销栈（变更生效前 / 拖拽手势首次移动时调）。 */
  captureTimelineUndo: () => void
  /** 弹出上一个 timeline 快照恢复（⌘Z）。 */
  undoTimeline: () => void
  /** 重做（⇧⌘Z）：把撤销掉的编辑再放回。 */
  redoTimeline: () => void
  setWorkspaceMode: (mode: unknown) => void
  setAssistantWidth: (width: number) => void
  setProjectSidebarWidth: (width: number) => void
  setCreationDocumentTools: (tools: CreationDocumentTools | null) => void
  setCreationSelectionText: (text: string) => void; setStoryboardPlannerLauncher: (launcher: ((displayPrompt?: string) => void) | null) => void
  setCreationAiModeId: (modeId: string) => void
  setCreationActiveSkill: (skill: { key: string; name: string } | null) => void
  /** 请生成画布平滑 fit 一次；可显式切到并绑定目标分类。 */
  requestCanvasFit: (categoryId?: string) => void
  /** Resident ProjectAgent composer state. Draft/attachments are ephemeral UI state, not Host history. */
  projectAgentDraft: string
  projectAgentAttachments: ComposerAttachment[]
  /** Composer-only references. Host remains the sole owner of durable context/history. */
  projectAgentReferences: ProjectAgentReference[]
  projectAgentRunMode: ProjectAgentRunMode
  /** Approval and spend are a separate axis from work mode; this snapshot is copied into each Host turn. */
  projectAgentApprovalPolicy: ProjectAgentApprovalPolicy
  projectAgentDockCollapsed: boolean
  setProjectAgentDraft: (draft: string) => void
  setProjectAgentAttachments: (attachments: ComposerAttachment[] | ((attachments: ComposerAttachment[]) => ComposerAttachment[])) => void
  setProjectAgentReferences: (references: ProjectAgentReference[] | ((references: ProjectAgentReference[]) => ProjectAgentReference[])) => void
  setProjectAgentRunMode: (mode: ProjectAgentRunMode) => void
  setProjectAgentApprovalPolicy: (policy: ProjectAgentApprovalPolicy) => void
  setProjectAgentDockCollapsed: (collapsed: boolean) => void
  setTimeline: (timeline: TimelineState) => void
  restoreProjectWorkbenchState: (payload: { workbenchDocument: WorkbenchDocument; timeline: TimelineState }) => void
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
  removeTimelineClips: (clipIds: string[], ripple?: boolean) => void
  // 一条或一批转场。整批走同一次 set，一次 ⌘Z 全撤（「套用到所有接缝」靠这条）。
  setTimelineTransition: (transition: TimelineTransition | readonly TimelineTransition[]) => void
  removeTimelineTransition: (fromClipId: string, toClipId: string) => void
  setTimelineTrackMuted: (trackId: string, muted: boolean) => void
  /**
   * 删画布节点后的时间轴对账：移除所有引用这些 sourceNodeId 的 clip。
   * 由 canvasNodeActions 的 deleteNode/deleteSelectedNodes 删完节点后调用（跨 store 最小耦合）。
   */
  reconcileTimelineForDeletedNodes: (nodeIds: readonly string[]) => void
  /**
   * 节点产物更新后的时间轴回填闸（C0，与删除对账对称）：把引用该 nodeId 的所有 clip
   * 换成新产物——位置不变（startFrame 不动）、URL 走 providerUrl 优先、trim 越界夹取。
   * 由 in-place 重生成完成后调用（见 generationRunController）。
   */
  reconcileTimelineForUpdatedNodes: (nodeId: string, result: GenerationNodeResult | null) => void
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
  /** 画面内自由拖动/缩放：position(归一化中心)/scale。拖动中 commit:false 不落盘，松手 commit:true。 */
  updateTimelineTextClipTransform: (id: string, patch: { position?: Vec2; scale?: number }, options?: { commit?: boolean }) => void
  /** 文字 clip 换字体（id，见 textFonts.ts）。 */
  updateTimelineTextClipFont: (id: string, fontId: string) => void
}
export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return typeof value === 'string' && WORKSPACE_MODES.includes(value as WorkspaceMode)
}

export const useWorkbenchStore = create<WorkbenchState>()(subscribeWithSelector((set, get, store) => ({
  ...createWorkbenchDocumentSlice(set, get, store),
  persistRevision: 0,
  workspaceMode: 'generation',
  assistantWidth: 340,
  projectSidebarWidth: null,
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
    const category = createCustomCategory({ id, name: (name || '').trim() || '新分组', order })
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
  creationDocumentTools: null,
  creationSelectionText: '', storyboardPlannerLauncher: null,
  creationAiModeId: 'general',
  creationActiveSkill: null,
  canvasFitNonce: 0,
  canvasFitCategoryId: null,
  projectAgentDraft: '',
  projectAgentAttachments: [],
  projectAgentReferences: [],
  projectAgentRunMode: DEFAULT_PROJECT_AGENT_WORK_MODE,
  projectAgentApprovalPolicy: DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
  projectAgentDockCollapsed: false,
  setProjectAgentDraft: (projectAgentDraft) => set({ projectAgentDraft }),
  setProjectAgentAttachments: (attachments) => set((state) => ({
    projectAgentAttachments: typeof attachments === 'function' ? attachments(state.projectAgentAttachments) : attachments,
  })),
  setProjectAgentReferences: (references) => set((state) => ({
    projectAgentReferences: typeof references === 'function' ? references(state.projectAgentReferences) : references,
  })),
  setProjectAgentRunMode: (projectAgentRunMode) => set({ projectAgentRunMode }),
  setProjectAgentApprovalPolicy: (projectAgentApprovalPolicy) => set({ projectAgentApprovalPolicy: Object.freeze({ mode: projectAgentApprovalPolicy.mode, spend: projectAgentApprovalPolicy.spend }) }),
  setProjectAgentDockCollapsed: (collapsed) => set((state) => ({
    projectAgentDockCollapsed: Boolean(collapsed),
    // 见 toggleEditingPanel：Nomi 栏只有一个开关，布局里的 visibility.assistant 是它的投影。
    editingPanelLayout: state.editingPanelLayout.visibility.assistant === !collapsed
      ? state.editingPanelLayout
      : { ...state.editingPanelLayout, visibility: { ...state.editingPanelLayout.visibility, assistant: !collapsed } },
  })),
  timeline: createDefaultTimeline(),
  timelinePlaying: false,
  previewAspectRatio: '16:9',
  selectedTimelineClipIds: [],
  selectedTextClipId: '',
  timelineSnapGuide: null,
  timelineSplitMode: false,
  // 默认折叠以保持最小窗口的 composer 可用空间；用户仍可拖拽展开。
  timelinePanelCollapsed: true,
  setTimelinePanelCollapsed: (collapsed) => set({ timelinePanelCollapsed: Boolean(collapsed) }),
  timelinePanelHeight: TIMELINE_PANEL_DEFAULT,
  setTimelinePanelHeight: (height) => set({ timelinePanelHeight: clampTimelinePanelHeight(height) }),
  ...createEditingPanelLayoutSlice(set, get, store),
  exportResolution: '1080p',
  exportQuality: 'standard',
  setExportResolution: (exportResolution) => set({ exportResolution }),
  setExportQuality: (exportQuality) => set({ exportQuality }),
  timelineUndoStack: [],
  timelineRedoStack: [],
  setWorkspaceMode: (mode) => {
    if (!isWorkspaceMode(mode)) return
    set({ workspaceMode: mode })
  },
  setAssistantWidth: (width) => set({ assistantWidth: Math.max(300, Math.min(600, Math.round(width))) }),
  setProjectSidebarWidth: (width) => set({ projectSidebarWidth: Math.max(240, Math.min(720, Math.round(width))) }),
  setCreationDocumentTools: (creationDocumentTools) => {
    set({ creationDocumentTools })
  },
  setCreationSelectionText: (text) => {
    set({ creationSelectionText: typeof text === 'string' ? text.trim() : '' })
  },
  setStoryboardPlannerLauncher: (storyboardPlannerLauncher) => set({ storyboardPlannerLauncher }),
  setCreationAiModeId: (creationAiModeId) => {
    set({ creationAiModeId })
  },
  setCreationActiveSkill: (creationActiveSkill) => {
    set({ creationActiveSkill })
  },
  requestCanvasFit: (categoryId) => {
    // 一次性信号：目标分类与 nonce 原子更新。显式目标立即切过去，延迟消费时若用户又手动切走则跳过。
    set((state) => {
      const target = typeof categoryId === 'string' && categoryId.trim() ? categoryId.trim() : state.activeCategoryId
      return { activeCategoryId: target, canvasFitCategoryId: target, canvasFitNonce: state.canvasFitNonce + 1 }
    })
  },
  setTimeline: (timeline) => {
    set((state) => ({
      timeline: normalizeTimeline(timeline),
      persistRevision: state.persistRevision + 1,
    }))
  },
  restoreProjectWorkbenchState: ({ workbenchDocument, timeline }) => {
    // 兼容旧调用方：单文档包装成集合。activeDocumentId 指向它。
    const doc = normalizeWorkbenchDocument(workbenchDocument)
    set({
      workbenchDocuments: [doc],
      activeDocumentId: doc.id,
      storyboardDesignsByDocumentId: {},
      activeStoryboardId: null,
      timeline: normalizeTimeline(timeline),
      timelinePlaying: false,
      selectedTimelineClipIds: [],
      timelineSnapGuide: null,
    })
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
        timelineUndoStack: inserted ? pushTimelineUndo(state.timelineUndoStack, state.timeline) : state.timelineUndoStack,
        timelineRedoStack: inserted ? [] : state.timelineRedoStack,
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
  setTimelineSplitMode: (on) => {
    set({ timelineSplitMode: Boolean(on) })
  },
  captureTimelineUndo: () => {
    set((state) => {
      const stack = state.timelineUndoStack
      if (stack.length > 0 && stack[stack.length - 1] === state.timeline) return state
      const next = [...stack, state.timeline]
      if (next.length > TIMELINE_UNDO_LIMIT) next.shift()
      return { timelineUndoStack: next, timelineRedoStack: [] }
    })
  },
  undoTimeline: () => {
    set((state) => {
      const stack = state.timelineUndoStack
      if (stack.length === 0) return state
      const previous = timelineUndoTimeline(stack[stack.length - 1])
      const liveIds = new Set(previous.tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
      return {
        timeline: previous,
        timelineUndoStack: stack.slice(0, -1),
        timelineRedoStack: [...state.timelineRedoStack, state.timeline].slice(-TIMELINE_UNDO_LIMIT),
        selectedTimelineClipIds: state.selectedTimelineClipIds.filter((id) => liveIds.has(id)),
        selectedTextClipId: previous.textClips.some((c) => c.id === state.selectedTextClipId) ? state.selectedTextClipId : '',
        timelinePlaying: false,
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  redoTimeline: () => {
    set((state) => {
      const stack = state.timelineRedoStack
      if (stack.length === 0) return state
      const restored = stack[stack.length - 1]
      const liveIds = new Set(restored.tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
      return {
        timeline: restored,
        timelineUndoStack: [...state.timelineUndoStack, state.timeline].slice(-TIMELINE_UNDO_LIMIT),
        timelineRedoStack: stack.slice(0, -1),
        selectedTimelineClipIds: state.selectedTimelineClipIds.filter((id) => liveIds.has(id)),
        selectedTextClipId: restored.textClips.some((c) => c.id === state.selectedTextClipId) ? state.selectedTextClipId : '',
        timelinePlaying: false,
        persistRevision: state.persistRevision + 1,
      }
    })
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
        timelineUndoStack: changed ? pushTimelineUndo(state.timelineUndoStack, state.timeline) : state.timelineUndoStack,
        timelineRedoStack: changed ? [] : state.timelineRedoStack,
        selectedTimelineClipIds: [],
        timelinePlaying: false,
        persistRevision: changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  removeTimelineClips: (clipIds, ripple = false) => {
    set((state) => {
      const ids = Array.from(new Set(clipIds.map((id) => String(id).trim()).filter(Boolean)))
      if (ids.length === 0) return state
      const result = applyTimelineOperation(state.timeline, { kind: 'remove', clipIds: ids, ripple })
      if (!result.ok || !result.diff.changed) return state
      return {
        timeline: result.timeline,
        timelineUndoStack: pushTimelineUndo(state.timelineUndoStack, state.timeline),
        timelineRedoStack: [],
        selectedTimelineClipIds: [],
        timelinePlaying: false,
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  setTimelineTransition: (transition) => {
    set((state) => {
      const transitions = [...(state.timeline.transitions ?? [])]
      for (const entry of Array.isArray(transition) ? transition : [transition as TimelineTransition]) {
        const index = transitions.findIndex((item) => item.fromClipId === entry.fromClipId && item.toClipId === entry.toClipId)
        if (index >= 0) transitions[index] = entry
        else transitions.push(entry)
      }
      if (JSON.stringify(transitions) === JSON.stringify(state.timeline.transitions ?? [])) return state
      return {
        timeline: { ...state.timeline, transitions },
        timelineUndoStack: pushTimelineUndo(state.timelineUndoStack, state.timeline),
        timelineRedoStack: [],
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  removeTimelineTransition: (fromClipId, toClipId) => {
    set((state) => {
      const transitions = state.timeline.transitions ?? []
      const next = transitions.filter((item) => item.fromClipId !== fromClipId || item.toClipId !== toClipId)
      if (next.length === transitions.length) return state
      return {
        timeline: { ...state.timeline, transitions: next },
        timelineUndoStack: pushTimelineUndo(state.timelineUndoStack, state.timeline),
        timelineRedoStack: [],
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  setTimelineTrackMuted: (trackId, muted) => {
    set((state) => {
      const track = state.timeline.tracks.find((item) => item.id === trackId)
      if (!track || track.type === 'image' || track.clips.length === 0) return state
      const tracks = state.timeline.tracks.map((item) => item.id === trackId
        ? { ...item, clips: item.clips.map((clip) => ({ ...clip, audio: { ...clip.audio, muted } })) }
        : item)
      return {
        timeline: { ...state.timeline, tracks },
        timelineUndoStack: pushTimelineUndo(state.timelineUndoStack, state.timeline),
        timelineRedoStack: [],
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  reconcileTimelineForDeletedNodes: (nodeIds) => {
    set((state) => {
      const nextTimeline = removeClipsBySourceNodeIds(state.timeline, nodeIds)
      if (nextTimeline === state.timeline) return state // 无悬空 clip → 不动、不触发自动保存
      // 被移除的 clip 可能正被选中/正在播 → 一并收口，避免选区指向已删 clip
      const liveClipIds = new Set(
        nextTimeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
      )
      return {
        timeline: nextTimeline,
        selectedTimelineClipIds: state.selectedTimelineClipIds.filter((id) => liveClipIds.has(id)),
        persistRevision: state.persistRevision + 1,
      }
    })
  },
  reconcileTimelineForUpdatedNodes: (nodeId, result) => {
    set((state) => {
      const id = String(nodeId || '').trim()
      if (!id) return state
      const nextTimeline = updateClipsBySourceNodeId(state.timeline, id, (clip) =>
        applyRegeneratedResultToClip(clip, result, state.timeline.fps),
      )
      if (nextTimeline === state.timeline) return state // 无引用该节点的 clip → 不动、不触发自动保存
      return {
        timeline: nextTimeline,
        persistRevision: state.persistRevision + 1,
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
      const changed = nextTimeline !== state.timeline
      return {
        timeline: nextTimeline,
        timelineUndoStack: changed ? pushTimelineUndo(state.timelineUndoStack, state.timeline) : state.timelineUndoStack,
        timelineRedoStack: changed ? [] : state.timelineRedoStack,
        selectedTimelineClipIds: [String(clipId || '').trim()].filter(Boolean),
        persistRevision: changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  duplicateTimelineClip: (clipId) => {
    set((state) => {
      const nextTimeline = duplicateClipById(state.timeline, clipId)
      const changed = nextTimeline !== state.timeline
      return {
        timeline: nextTimeline,
        timelineUndoStack: changed ? pushTimelineUndo(state.timelineUndoStack, state.timeline) : state.timelineUndoStack,
        timelineRedoStack: changed ? [] : state.timelineRedoStack,
        selectedTimelineClipIds: [String(clipId || '').trim()].filter(Boolean),
        persistRevision: changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  nudgeTimelineClip: (clipId, deltaFrame) => {
    set((state) => {
      const nextTimeline = nudgeClipById(state.timeline, clipId, deltaFrame)
      const changed = nextTimeline !== state.timeline
      return {
        timeline: nextTimeline,
        timelineUndoStack: changed ? pushTimelineUndo(state.timelineUndoStack, state.timeline) : state.timelineUndoStack,
        timelineRedoStack: changed ? [] : state.timelineRedoStack,
        selectedTimelineClipIds: [String(clipId || '').trim()].filter(Boolean),
        persistRevision: changed ? state.persistRevision + 1 : state.persistRevision,
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
    const previous = get().timeline
    const { timeline, id } = addTextClip(previous, style, startFrame)
    set((state) => ({
      timeline,
      timelineUndoStack: pushTimelineUndo(state.timelineUndoStack, previous),
      timelineRedoStack: [],
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
        : { timeline: next, timelineUndoStack: pushTimelineUndo(state.timelineUndoStack, state.timeline), timelineRedoStack: [], persistRevision: state.persistRevision + 1 }
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
        timelineUndoStack: changed ? pushTimelineUndo(state.timelineUndoStack, state.timeline) : state.timelineUndoStack,
        timelineRedoStack: changed ? [] : state.timelineRedoStack,
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
  updateTimelineTextClipTransform: (id, patch, options) => {
    const commit = options?.commit !== false
    set((state) => {
      const next = updateTextClipTransform(state.timeline, id, patch)
      const changed = next !== state.timeline
      return {
        timeline: next,
        persistRevision: commit && changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  ...createTimelineClipWritesSlice(pushTimelineUndo)(set, get, store),
  updateTimelineTextClipFont: (id, fontId) => {
    set((state) => {
      const next = updateTextClipFont(state.timeline, id, fontId)
      return next === state.timeline
        ? state
        : { timeline: next, persistRevision: state.persistRevision + 1 }
    })
  },
})))
