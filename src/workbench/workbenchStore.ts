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
  setClipFraming,
  setTimelinePlayheadFrame,
  setTimelineScale,
  splitClipAtFrame,
  updateClipsBySourceNodeId,
} from './timeline/timelineEdit'
import { applyRegeneratedResultToClip } from './generationCanvas/model/buildClipFromGenerationNode'
import type { GenerationNodeResult } from './generationCanvas/model/generationCanvasTypes'
import type { ClipFraming } from './timeline/clipFraming'
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
import { createDefaultWorkbenchDocument, normalizeWorkbenchDocument, type CreationDocumentTools, type PreviewAspectRatio, type WorkbenchDocument } from './workbenchTypes'
import type { WorkbenchAiMessage } from './ai/workbenchAiTypes'
import type { StoryboardPlan } from './generationCanvas/agent/storyboardPlan'
import type { ComposerAttachment } from './ai/composer/composerAttachmentTypes'
import { createConversationBuckets } from './aiConversationBuckets'
import { abandonCreationTurn } from './creation/creationTurnController'

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

// 时间轴撤销栈封顶（防无限增长）。
const TIMELINE_UNDO_LIMIT = 30
// 离散编辑生效时把旧 timeline 压栈：仅当真的变了。供 set 内联调用。
function pushTimelineUndo(stack: TimelineState[], previous: TimelineState): TimelineState[] {
  const next = [...stack, previous]
  if (next.length > TIMELINE_UNDO_LIMIT) next.shift()
  return next
}

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
  /** 手动锁定的 active skill（覆盖 mode 推导的 skillKey）。null = 自动（用创作模式默认）。 */
  creationActiveSkill: { key: string; name: string } | null
  creationAiDraft: string
  creationAiMessages: WorkbenchAiMessage[]
  creationAiAttachments: ComposerAttachment[]
  creationAiError: string
  /** 分镜方案对象（planner 产出，创作区审/改后确认落画布）。null=本项目暂无方案。随项目持久化。 */
  storyboardPlan: StoryboardPlan | null
  /** 方案是否已落画布：false=草稿，true=已落画布（落后卡片留痕，不再即焚）。随项目持久化。 */
  storyboardPlanCommitted: boolean
  /** 主列是否展开全宽编辑器（UI 瞬态，不持久化；重开项目默认收起成卡片）。 */
  storyboardEditorOpen: boolean
  /**
   * 「请画布适应视图」一次性信号（nonce，仿 createCategoryNonce）。bump 一次 = 请生成画布
   * 平滑 fit 到全部节点一次。用于落画布等「批量加节点到已加载画布」的场景——useAutoFitOnLoad
   * 只在首次加载/切分类触发，加新节点不重跑，新节点会落在视口外（用户以为「没反应」）。
   * 非持久化、非用户动作残留：只在显式动作时 bump。
   */
  canvasFitNonce: number
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
  /** 时间轴撤销栈（仅时间轴编辑，非持久化）。封顶后丢最旧。 */
  timelineUndoStack: TimelineState[]
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
  setWorkbenchDocument: (document: WorkbenchDocument) => void
  setCreationDocumentTools: (tools: CreationDocumentTools | null) => void
  setCreationSelectionText: (text: string) => void
  setCreationAiModeId: (modeId: string) => void
  setCreationActiveSkill: (skill: { key: string; name: string } | null) => void
  setCreationAiDraft: (draft: string) => void
  setCreationAiMessages: (messages: WorkbenchAiMessage[] | ((messages: WorkbenchAiMessage[]) => WorkbenchAiMessage[])) => void
  setCreationAiAttachments: (attachments: ComposerAttachment[] | ((attachments: ComposerAttachment[]) => ComposerAttachment[])) => void
  setCreationAiError: (error: string) => void
  /** 写入/改写分镜方案对象（planner 落库、编辑器逐字段编辑）：置草稿态；editorOpen 由调用方管。 */
  setStoryboardPlan: (plan: StoryboardPlan | null) => void
  /** 卡片「打开编辑」/「收起」：仅切主列编辑器显隐，不动方案。 */
  setStoryboardEditorOpen: (open: boolean) => void
  /** 确认落画布后：方案保留、转「已落画布」、收起编辑器（卡片留痕）。 */
  commitStoryboardPlan: () => void
  /** 请生成画布平滑 fit 一次（落画布后揭示新镜头）。bump canvasFitNonce。 */
  requestCanvasFit: () => void
  /** 丢弃方案：清空 plan + 收起编辑器（卡片随之消失）。 */
  discardStoryboardPlan: () => void
  /** 项目载入专用：恢复 plan + committed，编辑器收起、不标脏（区别于用户动作 setStoryboardPlan）。 */
  hydrateStoryboardPlan: (plan: StoryboardPlan | null, committed: boolean) => void
  /** 切项目时交换对话桶(S1 治串台):存旧项目的对话,载入新项目的(没有则空)。 */
  swapCreationAiProject: (prevId: string | null, nextId: string | null) => void
  /** 一次性信号：打开示例/新项目时请求创作助手默认展开（让「拆镜头」CTA 一眼可见），消费后清掉。 */
  creationAssistantAutoOpen: boolean
  setCreationAssistantAutoOpen: (open: boolean) => void
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
  /** 设置 clip 取景（适应/填充 + 缩放 + 平移）。拖动/连续缩放传 commit:false，落定 commit:true 落盘一次。 */
  setTimelineClipFraming: (clipId: string, patch: Partial<ClipFraming>, options?: { commit?: boolean }) => void
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
  creationActiveSkill: null,
  creationAiDraft: '',
  creationAiMessages: [],
  creationAiAttachments: [],
  creationAiError: '',
  storyboardPlan: null,
  storyboardPlanCommitted: false,
  storyboardEditorOpen: false,
  canvasFitNonce: 0,
  creationAssistantAutoOpen: false,
  timeline: createDefaultTimeline(),
  timelinePlaying: false,
  previewAspectRatio: '16:9',
  selectedTimelineClipIds: [],
  selectedTextClipId: '',
  timelineSnapGuide: null,
  timelineSplitMode: false,
  timelineUndoStack: [],
  timelineRedoStack: [],
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
  setCreationActiveSkill: (creationActiveSkill) => {
    set({ creationActiveSkill })
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
    // P0-6:方案是 per-project 持久化产物 → bump persistRevision 触发防抖落盘(否则用户手改的方案不保存)。
    // 写/改方案一律置草稿态(被编辑即与画布上旧节点不一致)。editorOpen 不在此强制开 —— 它既被
    // planner 产出后显式打开、也被编辑器内逐字段编辑频繁调用,强制开会打架;由调用方管。置 null 时顺手收起。
    set((state) => ({
      storyboardPlan,
      storyboardPlanCommitted: false,
      ...(storyboardPlan === null ? { storyboardEditorOpen: false } : {}),
      persistRevision: state.persistRevision + 1,
    }))
  },
  setStoryboardEditorOpen: (storyboardEditorOpen) => {
    set({ storyboardEditorOpen })
  },
  commitStoryboardPlan: () => {
    // 确认落画布:方案保留(卡片留痕)、转已落画布、收起编辑器。bump 落盘 committed 状态。
    set((state) => ({
      storyboardPlanCommitted: true,
      storyboardEditorOpen: false,
      persistRevision: state.persistRevision + 1,
    }))
  },
  discardStoryboardPlan: () => {
    set((state) => ({
      storyboardPlan: null,
      storyboardPlanCommitted: false,
      storyboardEditorOpen: false,
      persistRevision: state.persistRevision + 1,
    }))
  },
  requestCanvasFit: () => {
    // 一次性信号：bump nonce，生成画布消费后平滑 fit。不 bump persistRevision（视口意图非持久化产物）。
    set((state) => ({ canvasFitNonce: state.canvasFitNonce + 1 }))
  },
  hydrateStoryboardPlan: (storyboardPlan, storyboardPlanCommitted) => {
    // 载入态:一次性设三字段、编辑器收起、不 bump persistRevision(restore 非用户编辑,别标脏触发回存)。
    set({ storyboardPlan, storyboardPlanCommitted: storyboardPlan ? storyboardPlanCommitted : false, storyboardEditorOpen: false })
  },
  setCreationAssistantAutoOpen: (creationAssistantAutoOpen) => {
    set({ creationAssistantAutoOpen })
  },
  swapCreationAiProject: (prevId, nextId) => {
    // 结构性保证:任何「创作区切项目」都先中止在途流式轮次(中止流 + 作废 token +
    // 拒绝清空待批写卡),否则旧轮回调会把内容写进新项目、写卡弹到新项目面板。
    abandonCreationTurn()
    const state = get()
    set({
      ...creationAiBuckets.swap(prevId, nextId, {
        creationAiDraft: state.creationAiDraft,
        creationAiAttachments: state.creationAiAttachments,
        creationAiError: state.creationAiError,
      }),
      // messages 由 conversationThreads 模型按项目持有;切项目先清空,载入由 loadProjectConversations 投影回。
      creationAiMessages: [],
      // 编辑器展开态(UI 瞬态,不持久化)切项目复位为收起:重开项目以「卡片·收起」休息态出现。
      storyboardEditorOpen: false,
      // 方案(storyboardPlan)与 committed 不在此清:随项目持久化(P0-6),hydrate restore 先于本 swap 跑、
      // 已按新项目 payload 载入(无则 null/false)。此处再清会清掉刚 restore 的 → 切项目即丢。防串台职责移交 restore。
    })
  },
  setTimeline: (timeline) => {
    set((state) => ({
      timeline: normalizeTimeline(timeline),
      persistRevision: state.persistRevision + 1,
    }))
  },
  restoreProjectWorkbenchState: ({ workbenchDocument, timeline }) => {
    set({
      workbenchDocument: normalizeWorkbenchDocument(workbenchDocument),
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
      // 去重：手势重复 capture 同一状态不重复入栈。
      if (stack.length > 0 && stack[stack.length - 1] === state.timeline) return state
      const next = [...stack, state.timeline]
      if (next.length > TIMELINE_UNDO_LIMIT) next.shift()
      // capture 发生在一次新编辑（多为拖拽手势）首次改动前 → 清空 redo（新编辑使 redo 失效）。
      return { timelineUndoStack: next, timelineRedoStack: [] }
    })
  },
  undoTimeline: () => {
    set((state) => {
      const stack = state.timelineUndoStack
      if (stack.length === 0) return state
      const previous = stack[stack.length - 1]
      const liveIds = new Set(previous.tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
      return {
        timeline: previous,
        timelineUndoStack: stack.slice(0, -1),
        // 撤销 = 把当前态推入 redo 栈（供 ⇧⌘Z 放回）。
        timelineRedoStack: [...state.timelineRedoStack, state.timeline].slice(-TIMELINE_UNDO_LIMIT),
        // 撤销后清掉指向已不存在 clip 的选择，避免 Delete/工具作用于幽灵选区
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
        // 重做 = 把当前态推回撤销栈、从 redo 弹出（不清 redo——这不是新编辑）。
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
  setTimelineClipFraming: (clipId, patch, options) => {
    const commit = options?.commit !== false
    set((state) => {
      const next = setClipFraming(state.timeline, clipId, patch)
      const changed = next !== state.timeline
      return {
        timeline: next,
        persistRevision: commit && changed ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  updateTimelineTextClipFont: (id, fontId) => {
    set((state) => {
      const next = updateTextClipFont(state.timeline, id, fontId)
      return next === state.timeline
        ? state
        : { timeline: next, persistRevision: state.persistRevision + 1 }
    })
  },
})))
