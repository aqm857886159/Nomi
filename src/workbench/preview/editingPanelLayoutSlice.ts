import type { StateCreator } from 'zustand'
import {
  clampEditingPanelLayout,
  cloneEditingPanelLayout,
  EDITING_PANEL_DEFAULTS,
  EDITING_PANEL_PRESETS,
  type EditingPanelLayout,
  type EditingPanelPreset,
  type EditingPanelSizeKey,
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
 */
/** 左栏两个 tab。住在 store 而不是 PreviewSourcePanel 的局部 state：时间轴空轨右键的
 *  「从素材库添加…」要能把它切过去，两处够不着彼此就只能各留一份真相。不落盘。 */
export type PreviewSourceTab = 'shots' | 'assets'

export type EditingPanelLayoutSlice = {
  editingPanelLayout: EditingPanelLayout
  previewSourceTab: PreviewSourceTab
  /** 切 tab；顺带保证左栏是展开的——收起状态下切 tab 等于什么都没发生。 */
  openPreviewSourceTab: (tab: PreviewSourceTab) => void
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
   * 面板拖动的**唯一回写口**：只镜像 react-resizable-panels 量到的真实像素，
   * 不动 preset、不压撤销栈。用户手拖导致的 preset → 'custom' 由 Group 的
   * onLayoutChanged(isUserInteraction) 走 markEditingPanelLayoutCustom，
   * 这样「切预设 → 面板按预设 resize → onResize 回写」不会把刚选的预设洗掉。
   */
  syncEditingPanelSize: (patch: Partial<Record<EditingPanelSizeKey, number>>) => void
  markEditingPanelLayoutCustom: () => void
}

type LayoutHostState = { projectAgentDockCollapsed: boolean } & EditingPanelLayoutSlice

const UNDO_LIMIT = 20

const pushUndo = (stack: EditingPanelLayout[], entry: EditingPanelLayout): EditingPanelLayout[] =>
  [...stack, entry].slice(-UNDO_LIMIT)

/** 换上一整份布局：撤销栈、Nomi 栏开关一起对齐，避免三个 action 各写一遍写漏。 */
const replaceLayout = (state: LayoutHostState, next: EditingPanelLayout) => ({
  editingPanelUndoStack: pushUndo(state.editingPanelUndoStack, state.editingPanelLayout),
  editingPanelLayout: next,
  projectAgentDockCollapsed: !next.visibility.assistant,
})

export const createEditingPanelLayoutSlice: StateCreator<
  LayoutHostState,
  [['zustand/subscribeWithSelector', never]],
  [],
  EditingPanelLayoutSlice
> = (set, get) => ({
  editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
  editingPanelUndoStack: [],
  previewSourceTab: 'shots',
  timelineSnapEnabled: true,

  setTimelineSnapEnabled: (next) => set((state) => ({
    timelineSnapEnabled: typeof next === 'function' ? next(state.timelineSnapEnabled) : next,
  })),

  openPreviewSourceTab: (tab) => set((state) => (
    state.previewSourceTab === tab && state.editingPanelLayout.visibility.source
      ? state
      : {
        previewSourceTab: tab,
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
    }
  }),

  setEditingPanelPreset: (preset) => set((state) =>
    replaceLayout(state, cloneEditingPanelLayout(EDITING_PANEL_PRESETS[preset === 'custom' ? 'default' : preset]))),

  resetEditingPanelLayout: () => set((state) => replaceLayout(state, cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS))),

  toggleEditingPanel: (panel) => set((state) => {
    const visibility = { ...state.editingPanelLayout.visibility, [panel]: !state.editingPanelLayout.visibility[panel] }
    return replaceLayout(state, { ...state.editingPanelLayout, preset: 'custom', visibility })
  }),

  undoEditingPanelLayout: () => {
    const stack = get().editingPanelUndoStack
    if (stack.length === 0) return false
    const next = cloneEditingPanelLayout(stack[stack.length - 1])
    set({ editingPanelLayout: next, editingPanelUndoStack: stack.slice(0, -1), projectAgentDockCollapsed: !next.visibility.assistant })
    return true
  },

  syncEditingPanelSize: (patch) => set((state) => {
    const next = clampEditingPanelLayout({ ...state.editingPanelLayout, ...patch })
    const same = next.sourceWidth === state.editingPanelLayout.sourceWidth
      && next.inspectorWidth === state.editingPanelLayout.inspectorWidth
      && next.assistantWidth === state.editingPanelLayout.assistantWidth
      && next.timelineHeight === state.editingPanelLayout.timelineHeight
    return same ? state : { editingPanelLayout: next }
  }),

  markEditingPanelLayoutCustom: () => set((state) => (
    state.editingPanelLayout.preset === 'custom' ? state : { editingPanelLayout: { ...state.editingPanelLayout, preset: 'custom' } }
  )),
})
