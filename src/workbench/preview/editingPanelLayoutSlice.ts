import type { StateCreator } from 'zustand'
import {
  clampEditingPanelLayout,
  cloneEditingPanelLayout,
  EDITING_PANEL_DEFAULTS,
  EDITING_PANEL_PRESETS,
  type EditingPanelLayout,
  type EditingPanelPreset,
  type EditingPanelSizeKey,
  type EditingSidePanel,
} from './panelLayout'

/**
 * 剪辑面五块面板的布局状态（合同 §2.1）。从 workbenchStore 拆出来守 R9/R12 巨壳门。
 *
 * 这一份就是布局的**唯一真相**：界面按它渲染、Agent 的 `layout.read/write` 读写它、
 * 它随项目落盘（projectRecordSchema.editingPanelLayout）。
 *
 * 一条必须一起维护的不变式：Nomi 栏在全站共用 `projectAgentDockCollapsed`（创作/分镜/生成
 * 三页也读它），所以 `visibility.assistant` 不是第二个开关，而是它的投影——凡是动到
 * assistant 可见性的 action，都在**同一次 set** 里把两边一起写，别让它们各自漂。
 * 正因为这条不变式，开关本身（状态 + setter）就住在这个 slice 里，不在 workbenchStore 的外壳上。
 */
/** 左栏两个 tab。住在 store 而不是 PreviewSourcePanel 的局部 state：时间轴空轨右键的
 *  「从素材库添加…」要能把它切过去，两处够不着彼此就只能各留一份真相。不落盘。 */
export type PreviewSourceTab = 'shots' | 'assets'

export type EditingPanelLayoutSlice = {
  editingPanelLayout: EditingPanelLayout
  /**
   * 常驻 Nomi 栏收起没有。2026-09-06 用户拍板：**默认展开**，并**记住用户上次的开合**——
   * 后者不新造存储，就是 `editingPanelLayout.visibility.assistant` 随项目落盘的那一份，本字段是它的投影。
   */
  projectAgentDockCollapsed: boolean
  setProjectAgentDockCollapsed: (collapsed: boolean) => void
  /**
   * 「有人要把 Nomi 叫回来」的计数：收起 → 展开的**用户 / Agent 动作**（setProjectAgentDockCollapsed、切预设、翻可见性、撤销、
   * layout.write）各 +1；**打开项目时的还原（setEditingPanelLayout(…, false)）和关项目时的整体重置不算**。
   * 外壳的 Agent 小球靠它决定要不要自己展开——不能靠 `projectAgentDockCollapsed` 的翻转去猜，
   * 因为重开项目时这个投影会被还原 / 重置翻一下，小球就会在用户什么也没点时自己弹成浮窗（评测 j5 重开项目后浮窗盖住生成钮）。
   */
  agentRecallNonce: number
  previewSourceTab: PreviewSourceTab
  /** 切 tab；顺带保证左栏是展开的——收起状态下切 tab 等于什么都没发生。 */
  openPreviewSourceTab: (tab: PreviewSourceTab) => void
  /**
   * 两侧栏放不下时留哪一栏（resolveEditingStageFrame 的 keep）。默认左栏：2026-11-04 用户拍板「先收属性」——
   * 剪辑页的主活是把镜头拖进成片，属性要选中片段才有内容。会话态、不落盘：它只记「用户刚点开的是哪边」，
   * 只由显式动作改（点收起条 / 布局菜单打开 / Agent 打开 / 拖开或拖宽那一栏），不从状态变化里猜。
   */
  editingPanelKeep: EditingSidePanel
  /** 放不下时留这一栏（拖宽某一栏时用；开合不变）。 */
  keepEditingPanel: (panel: EditingSidePanel) => void
  /** 打开 / 关掉一块面板。打开侧栏 = 它成为放不下时留下的那一栏（点收起条一定看得到它展开，C1）。 */
  showEditingPanel: (panel: keyof EditingPanelLayout['visibility'], visible: boolean) => void
  /**
   * 时间轴吸附开关。必须住在 store：预览面（full）与生成画布（compact）两个 TimelinePanel
   * 因 keep-alive **同时挂载**，各注册一个 window keydown。放在组件局部 state 时，按 N 只翻了
   * 「先注册的那个」——很可能是屏幕上看不见的那一个，用户看到的工具条纹丝不动，而拖动时的
   * 吸附行为却偷偷变了。一个开关必须只有一份真相。
   */
  timelineSnapEnabled: boolean
  setTimelineSnapEnabled: (next: boolean | ((previous: boolean) => boolean)) => void
  editingPanelUndoStack: EditingPanelLayout[]
  setEditingPanelLayout: (
    patch: Partial<Omit<EditingPanelLayout, 'visibility'>> & { visibility?: Partial<EditingPanelLayout['visibility']> },
    recordUndo?: boolean,
  ) => void
  setEditingPanelPreset: (preset: EditingPanelPreset) => void
  resetEditingPanelLayout: () => void
  toggleEditingPanel: (panel: keyof EditingPanelLayout['visibility']) => void
  undoEditingPanelLayout: () => boolean
  /**
   * 用户**亲手拖完**分隔条后记下的宽 / 高（PreviewWorkspace 只在 onLayoutChanged.isUserInteraction 时调，
   * 规则见 panelLayout 的 editingPanelDragIntent）。不动 preset、不压撤销栈：⌘Z 先撤布局、再撤时间轴，
   * 拖一下宽度不该占掉一次 ⌘Z；preset → 'custom' 由 markEditingPanelLayoutCustom 走同一个用户动作口。
   * 窗口变窄、开关 Nomi、约束重算都不走这里——它们改的是这一刻的实际布局，不是用户的选择。
   */
  syncEditingPanelSize: (patch: Partial<Record<EditingPanelSizeKey, number>>) => void
  markEditingPanelLayoutCustom: () => void
}

type LayoutHostState = { persistRevision: number } & EditingPanelLayoutSlice

const UNDO_LIMIT = 20

const pushUndo = (stack: EditingPanelLayout[], entry: EditingPanelLayout): EditingPanelLayout[] =>
  [...stack, entry].slice(-UNDO_LIMIT)

const DEFAULT_KEEP: EditingSidePanel = 'source'
const isSidePanel = (panel: keyof EditingPanelLayout['visibility']): panel is EditingSidePanel => panel === 'source' || panel === 'inspector'

/** 一次补丁里只打开了一块侧栏，它就是用户这一下要看的那栏；两块都开或都没开就不改留哪边。 */
function keepFromOpened(patch: Partial<EditingPanelLayout['visibility']> | undefined): { editingPanelKeep: EditingSidePanel } | Record<string, never> {
  const opened = (['source', 'inspector'] as const).filter((panel) => patch?.[panel] === true)
  return opened.length === 1 ? { editingPanelKeep: opened[0] } : {}
}

/**
 * 布局是 per-project 落盘物（`readCurrentWorkbenchProjectPayload` 把它写进 projectRecord），
 * 但落盘只由 `persistRevision` 变化触发。改了布局却不 bump = 用户收起的 Nomi 栏、拖出来的
 * 栏宽下次开项目全丢——除非碰巧有别的改动顺手把它捎带存了。所以**凡是真改到这份布局的
 * action，都在同一次 set 里 bump**，别再让「记住上次状态」依赖别处的副作用。
 */
const bumpPersist = (state: LayoutHostState) => ({ persistRevision: state.persistRevision + 1 })

/** 这一下把 Nomi 栏从收起翻成展开：计一次「叫回」（见 agentRecallNonce）。 */
const recallIfReopened = (state: LayoutHostState, nowVisible: boolean) =>
  (state.projectAgentDockCollapsed && nowVisible ? { agentRecallNonce: state.agentRecallNonce + 1 } : {})

/** 换上一整份布局：撤销栈、Nomi 栏开关、落盘游标一起对齐，避免几个 action 各写一遍写漏。 */
const replaceLayout = (state: LayoutHostState, next: EditingPanelLayout) => ({
  editingPanelUndoStack: pushUndo(state.editingPanelUndoStack, state.editingPanelLayout),
  editingPanelLayout: next,
  projectAgentDockCollapsed: !next.visibility.assistant,
  ...recallIfReopened(state, next.visibility.assistant),
  ...bumpPersist(state),
})

export const createEditingPanelLayoutSlice: StateCreator<
  LayoutHostState,
  [['zustand/subscribeWithSelector', never]],
  [],
  EditingPanelLayoutSlice
> = (set, get) => ({
  editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
  // 默认展开，因为 EDITING_PANEL_DEFAULTS.visibility.assistant 是 true——两处不许各写一个默认。
  projectAgentDockCollapsed: !EDITING_PANEL_DEFAULTS.visibility.assistant,
  agentRecallNonce: 0,
  setProjectAgentDockCollapsed: (collapsed) => set((state) => {
    const changed = state.editingPanelLayout.visibility.assistant === Boolean(collapsed)
    if (!changed) return { projectAgentDockCollapsed: Boolean(collapsed), ...recallIfReopened(state, !collapsed) }
    const visibility = { ...state.editingPanelLayout.visibility, assistant: !collapsed }
    return {
      projectAgentDockCollapsed: Boolean(collapsed),
      ...recallIfReopened(state, !collapsed),
      editingPanelLayout: { ...state.editingPanelLayout, visibility },
      ...bumpPersist(state),
    }
  }),
  editingPanelUndoStack: [],
  previewSourceTab: 'shots',
  editingPanelKeep: DEFAULT_KEEP,

  keepEditingPanel: (panel) => set((state) => (state.editingPanelKeep === panel ? state : { editingPanelKeep: panel })),

  showEditingPanel: (panel, visible) => set((state) => {
    const keep = visible && isSidePanel(panel) ? { editingPanelKeep: panel } : {}
    if (state.editingPanelLayout.visibility[panel] === visible) return keep
    const visibility = { ...state.editingPanelLayout.visibility, [panel]: visible }
    return { ...replaceLayout(state, { ...state.editingPanelLayout, preset: 'custom', visibility }), ...keep }
  }),
  timelineSnapEnabled: true,

  setTimelineSnapEnabled: (next) => set((state) => ({
    timelineSnapEnabled: typeof next === 'function' ? next(state.timelineSnapEnabled) : next,
  })),

  // 左栏可能是因为放不下被让成了收起条（意图仍是开着）：切 tab 同时让它成为留下的那栏，才真的看得到。
  openPreviewSourceTab: (tab) => set((state) => (
    state.previewSourceTab === tab && state.editingPanelLayout.visibility.source && state.editingPanelKeep === 'source'
      ? state
      : {
        previewSourceTab: tab,
        editingPanelKeep: 'source' as const,
        ...(state.editingPanelLayout.visibility.source ? {} : replaceLayout(state, {
          ...state.editingPanelLayout,
          preset: 'custom' as const,
          visibility: { ...state.editingPanelLayout.visibility, source: true },
        })),
      }
  )),

  setEditingPanelLayout: (patch, recordUndo = true) => set((state) => {
    const next = clampEditingPanelLayout({
      ...state.editingPanelLayout,
      ...patch,
      visibility: { ...state.editingPanelLayout.visibility, ...(patch.visibility ?? {}) },
      preset: patch.preset ?? 'custom',
    })
    const changed = JSON.stringify(next) !== JSON.stringify(state.editingPanelLayout)
    return {
      editingPanelLayout: next,
      editingPanelUndoStack: recordUndo && changed ? pushUndo(state.editingPanelUndoStack, state.editingPanelLayout) : state.editingPanelUndoStack,
      projectAgentDockCollapsed: !next.visibility.assistant,
      // recordUndo === false 是「打开项目时还原落盘布局」的口（workbenchProjectSession），不是有人叫回 Nomi；
      // 换了项目，「刚点开的是哪边」也回到默认。
      ...(recordUndo ? recallIfReopened(state, next.visibility.assistant) : {}),
      ...(recordUndo ? keepFromOpened(patch.visibility) : { editingPanelKeep: DEFAULT_KEEP }),
      persistRevision: changed ? state.persistRevision + 1 : state.persistRevision,
    }
  }),

  setEditingPanelPreset: (preset) => set((state) => ({
    ...replaceLayout(state, cloneEditingPanelLayout(EDITING_PANEL_PRESETS[preset === 'custom' ? 'default' : preset])),
    editingPanelKeep: DEFAULT_KEEP,
  })),

  resetEditingPanelLayout: () => set((state) => ({ ...replaceLayout(state, cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS)), editingPanelKeep: DEFAULT_KEEP })),

  toggleEditingPanel: (panel) => get().showEditingPanel(panel, !get().editingPanelLayout.visibility[panel]),

  undoEditingPanelLayout: () => {
    const stack = get().editingPanelUndoStack
    if (stack.length === 0) return false
    const next = cloneEditingPanelLayout(stack[stack.length - 1])
    set((state) => ({
      editingPanelLayout: next,
      editingPanelUndoStack: stack.slice(0, -1),
      projectAgentDockCollapsed: !next.visibility.assistant,
      ...recallIfReopened(state, next.visibility.assistant),
      ...bumpPersist(state),
    }))
    return true
  },

  syncEditingPanelSize: (patch) => set((state) => {
    const next = clampEditingPanelLayout({ ...state.editingPanelLayout, ...patch })
    const same = next.sourceWidth === state.editingPanelLayout.sourceWidth
      && next.inspectorWidth === state.editingPanelLayout.inspectorWidth
      && next.assistantWidth === state.editingPanelLayout.assistantWidth
      && next.timelineHeight === state.editingPanelLayout.timelineHeight
    return same ? state : { editingPanelLayout: next, ...bumpPersist(state) }
  }),

  markEditingPanelLayoutCustom: () => set((state) => (
    state.editingPanelLayout.preset === 'custom'
      ? state
      : { editingPanelLayout: { ...state.editingPanelLayout, preset: 'custom' }, ...bumpPersist(state) }
  )),
})
