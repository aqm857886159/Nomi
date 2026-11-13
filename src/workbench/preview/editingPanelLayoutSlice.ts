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
 * 两样东西，别混：
 *  - `editingPanelLayout`：**随项目落盘**的那一份（projectRecordSchema.editingPanelLayout，整份写进项目文件）。
 *  - Nomi 栏此刻开没开：**显示态** `projectAgentDockCollapsed`。它由这台机器每页的形态偏好（agentFormStore.bySurface）
 *    驱动，谁都能读，但永远不让项目落盘（用户 2026-11-13 拍板「跟机器走」）。
 *
 * 所以 `editingPanelLayout.visibility.assistant` 是**项目里原来那个值**：只在打开项目还原时赋值，
 * 其余任何动作都改不到它（commitLayout 一处钉住）——老版本照读这个字段，格式不变。
 * 界面和 Agent 要的「此刻的整份布局」用 `displayEditingPanelLayout(state)` 拼出来。
 * 复盘：docs/engineering/direction-checks/2026-11-13-open-writes-project.md。
 */
/** 左栏两个 tab。住在 store 而不是 PreviewSourcePanel 的局部 state：时间轴空轨右键的
 *  「从素材库添加…」要能把它切过去，两处够不着彼此就只能各留一份真相。不落盘。 */
export type PreviewSourceTab = 'shots' | 'assets'

export type EditingPanelLayoutPatch = Partial<Omit<EditingPanelLayout, 'visibility'>> & { visibility?: Partial<EditingPanelLayout['visibility']> }

export type EditingPanelLayoutSlice = {
  editingPanelLayout: EditingPanelLayout
  /**
   * 常驻 Nomi 栏此刻收起没有（显示态）。2026-09-06 用户拍板：**默认展开**，并**记住用户上次的开合**；
   * 2026-11-13 拍板「跟机器走」：记住的是这台机器每页的形态（agentFormStore.bySurface，外壳单向同步到这里），
   * 不再写进项目文件。改它不让项目落盘。
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
   * 剪辑页的主活是把镜头拖进成片，属性要选中片段才有内容。会话态、不落盘：它只记「用户刚打开的是哪边」。
   * 改侧栏开合的入口一律经 keepAfterLayoutChange 定它（规则见那里）；另外只有拖宽某一栏（keepEditingPanel）
   * 和整份换回默认（预设 / 恢复默认 / 打开项目）会改它。
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
  /** 用户在剪辑面改布局；`recordUndo === false` 是打开项目时还原落盘布局的口（不算编辑、不落盘）。 */
  setEditingPanelLayout: (patch: EditingPanelLayoutPatch, recordUndo?: boolean) => void
  /** Agent 的 `layout.write`：和用户改布局同一套规则，登记成 Agent 动作。 */
  writeEditingPanelLayoutFromAgent: (patch: EditingPanelLayoutPatch) => void
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

type PanelVisibility = EditingPanelLayout['visibility']
const SIDE_PANELS = ['source', 'inspector'] as const

/**
 * 放不下时留哪一栏——**凡是改侧栏开合的入口都经这一条**（点收起条、布局菜单、⌘Z、Agent layout.write、拖开、切左栏 tab），
 * 不让每个入口各记一遍：2026-11-05 ⌘Z 自己还原开合、漏了这一步，撤销重开的属性栏在 1280 宽仍被让成收起条。
 *  ①这一下点名要开的侧栏只有一块（asked）→ 留它，哪怕它的开合本来就是开着（只是放不下被让成了条）；
 *  ②否则看开合前后：从关变开的只有一块 → 留它；两块一起变开 → 回到默认（先收属性）；
 *  ③都没有 → 不变（关栏、只改 Nomi、只改宽度都不改留哪边）。
 */
export function keepAfterLayoutChange(
  previous: PanelVisibility,
  next: PanelVisibility,
  keep: EditingSidePanel,
  asked?: Partial<PanelVisibility>,
): EditingSidePanel {
  const askedOpen = SIDE_PANELS.filter((panel) => asked?.[panel] === true && next[panel])
  if (askedOpen.length === 1) return askedOpen[0]
  const opened = SIDE_PANELS.filter((panel) => !previous[panel] && next[panel])
  if (opened.length === 1) return opened[0]
  return opened.length === 2 ? DEFAULT_KEEP : keep
}

type LayoutActionName = {
  [K in keyof EditingPanelLayoutSlice]: EditingPanelLayoutSlice[K] extends (...args: never[]) => unknown ? K : never
}[keyof EditingPanelLayoutSlice]

/**
 * 布局这一片每个动作让不让项目落盘——必须声明，不声明编译不过（表 `satisfies Record<LayoutActionName, …>`，
 * 同画布 CANVAS_ACTION_LAYERS 的做法）。
 * - `user`：用户在剪辑面亲手改布局（菜单、收起条、拖分隔条、⌘Z、预设）；
 * - `agent`：Agent 的 `layout.write`；
 * - `fact`：事实回写（这一片目前没有）；
 * - `display`：只改此刻怎么显示（Nomi 栏开合、放不下时留哪边、吸附开关）——**不落盘**。
 * 打开项目时的还原（setEditingPanelLayout(…, false)）、外壳挂载时按本机形态同步 Nomi 栏，都不是编辑，没资格落盘。
 * 落盘只有 commitLayout 一个口，它只收非 display 层的动作名；新动作不归类、或拿 display 动作去落盘，都编译不过。
 */
export type LayoutActionLayer = 'user' | 'agent' | 'fact' | 'display'

export const LAYOUT_ACTION_LAYERS = {
  setProjectAgentDockCollapsed: 'display',
  keepEditingPanel: 'display',
  setTimelineSnapEnabled: 'display',
  openPreviewSourceTab: 'user',
  showEditingPanel: 'user',
  toggleEditingPanel: 'user',
  setEditingPanelLayout: 'user',
  writeEditingPanelLayoutFromAgent: 'agent',
  setEditingPanelPreset: 'user',
  resetEditingPanelLayout: 'user',
  undoEditingPanelLayout: 'user',
  syncEditingPanelSize: 'user',
  markEditingPanelLayoutCustom: 'user',
} as const satisfies Record<LayoutActionName, LayoutActionLayer>

type PersistingLayoutAction = {
  [K in LayoutActionName]: (typeof LAYOUT_ACTION_LAYERS)[K] extends 'display' ? never : K
}[LayoutActionName]

/**
 * 此刻的整份布局（界面和 Agent `layout.read` 读这个）：落盘那份 + 显示态的 Nomi 栏开合。
 * 没差别时原样返回同一个引用（选择器里用不会每次换对象）。
 */
export function displayEditingPanelLayout(state: Pick<EditingPanelLayoutSlice, 'editingPanelLayout' | 'projectAgentDockCollapsed'>): EditingPanelLayout {
  const assistant = !state.projectAgentDockCollapsed
  const layout = state.editingPanelLayout
  return layout.visibility.assistant === assistant ? layout : { ...layout, visibility: { ...layout.visibility, assistant } }
}

const sameLayout = (a: EditingPanelLayout, b: EditingPanelLayout) => JSON.stringify(a) === JSON.stringify(b)

/** 这一下把 Nomi 栏从收起翻成展开：计一次「叫回」（见 agentRecallNonce）。 */
const recallIfReopened = (state: LayoutHostState, nowVisible: boolean) =>
  (state.projectAgentDockCollapsed && nowVisible ? { agentRecallNonce: state.agentRecallNonce + 1 } : {})

/**
 * 布局这一片**唯一**的落盘口。`next` 是此刻的整份布局（含显示态的 Nomi 开合）：
 * 开合进显示态（+ 叫回计数），其余进落盘那份，落盘那份的 `visibility.assistant` 钉成原值——
 * 所以任何动作都写不动项目里的 Nomi 栏开合；只有落盘那份真变了才 bump `persistRevision`。
 */
function commitLayout(state: LayoutHostState, _action: PersistingLayoutAction, next: EditingPanelLayout) {
  const pinned = state.editingPanelLayout.visibility.assistant
  const persisted: EditingPanelLayout = { ...next, visibility: { ...next.visibility, assistant: pinned } }
  const changed = !sameLayout(persisted, state.editingPanelLayout)
  return {
    editingPanelLayout: changed ? persisted : state.editingPanelLayout,
    projectAgentDockCollapsed: !next.visibility.assistant,
    ...recallIfReopened(state, next.visibility.assistant),
    ...(changed ? { persistRevision: state.persistRevision + 1 } : {}),
  }
}

/** 换上一整份布局：撤销栈（存的是此刻的整份布局，会话态）、留哪边、落盘一起对齐。 */
const replaceLayout = (state: LayoutHostState, action: PersistingLayoutAction, next: EditingPanelLayout, asked?: Partial<PanelVisibility>) => {
  const current = displayEditingPanelLayout(state)
  return {
    editingPanelUndoStack: pushUndo(state.editingPanelUndoStack, current),
    editingPanelKeep: keepAfterLayoutChange(current.visibility, next.visibility, state.editingPanelKeep, asked),
    ...commitLayout(state, action, next),
  }
}

/** 用户 / Agent 按补丁改布局：同一套规则，层不同。 */
const patchLayout = (state: LayoutHostState, action: PersistingLayoutAction, patch: EditingPanelLayoutPatch) => {
  const current = displayEditingPanelLayout(state)
  const next = clampEditingPanelLayout({
    ...current,
    ...patch,
    visibility: { ...current.visibility, ...(patch.visibility ?? {}) },
    preset: patch.preset ?? 'custom',
  })
  return {
    editingPanelUndoStack: sameLayout(next, current) ? state.editingPanelUndoStack : pushUndo(state.editingPanelUndoStack, current),
    editingPanelKeep: keepAfterLayoutChange(current.visibility, next.visibility, state.editingPanelKeep, patch.visibility),
    ...commitLayout(state, action, next),
  }
}

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
  // 显示态：外壳按本机形态同步、任务中心 / 分镜「交给 Agent」叫回都走这里；不碰落盘那份。
  setProjectAgentDockCollapsed: (collapsed) => set((state) => (
    state.projectAgentDockCollapsed === Boolean(collapsed)
      ? state
      : { projectAgentDockCollapsed: Boolean(collapsed), ...recallIfReopened(state, !collapsed) }
  )),
  editingPanelUndoStack: [],
  previewSourceTab: 'shots',
  editingPanelKeep: DEFAULT_KEEP,

  keepEditingPanel: (panel) => set((state) => (state.editingPanelKeep === panel ? state : { editingPanelKeep: panel })),

  showEditingPanel: (panel, visible) => set((state) => {
    const asked = { [panel]: visible }
    const current = displayEditingPanelLayout(state)
    if (current.visibility[panel] === visible) {
      // 开合没变（多半是点被让成收起条的那栏）：只可能换留哪边，不进撤销栈、不存盘。
      const editingPanelKeep = keepAfterLayoutChange(current.visibility, current.visibility, state.editingPanelKeep, asked)
      return editingPanelKeep === state.editingPanelKeep ? state : { editingPanelKeep }
    }
    const visibility = { ...current.visibility, [panel]: visible }
    return replaceLayout(state, 'showEditingPanel', { ...current, preset: 'custom', visibility }, asked)
  }),
  timelineSnapEnabled: true,

  setTimelineSnapEnabled: (next) => set((state) => ({
    timelineSnapEnabled: typeof next === 'function' ? next(state.timelineSnapEnabled) : next,
  })),

  // 左栏可能是因为放不下被让成了收起条（意图仍是开着）：切 tab 同时让它成为留下的那栏，才真的看得到。
  openPreviewSourceTab: (tab) => set((state) => {
    const asked = { source: true }
    const current = displayEditingPanelLayout(state)
    if (!current.visibility.source) {
      return {
        previewSourceTab: tab,
        ...replaceLayout(state, 'openPreviewSourceTab', { ...current, preset: 'custom', visibility: { ...current.visibility, source: true } }, asked),
      }
    }
    const editingPanelKeep = keepAfterLayoutChange(current.visibility, current.visibility, state.editingPanelKeep, asked)
    return state.previewSourceTab === tab && editingPanelKeep === state.editingPanelKeep ? state : { previewSourceTab: tab, editingPanelKeep }
  }),

  setEditingPanelLayout: (patch, recordUndo = true) => set((state) => {
    if (recordUndo) return patchLayout(state, 'setEditingPanelLayout', patch)
    // 打开项目时还原落盘布局（workbenchProjectSession）：这是读，不是编辑——不进撤销栈、不叫回、不落盘；
    // 换了项目，「刚点开的是哪边」也回到默认。项目里的 Nomi 栏开合就在这里成为落盘那份的原值，
    // 显示态先跟它对齐，外壳挂上后再按本机形态改显示态（不回写）。
    const next = clampEditingPanelLayout({
      ...state.editingPanelLayout,
      ...patch,
      visibility: { ...state.editingPanelLayout.visibility, ...(patch.visibility ?? {}) },
      preset: patch.preset ?? 'custom',
    })
    return { editingPanelLayout: next, projectAgentDockCollapsed: !next.visibility.assistant, editingPanelKeep: DEFAULT_KEEP }
  }),

  writeEditingPanelLayoutFromAgent: (patch) => set((state) => patchLayout(state, 'writeEditingPanelLayoutFromAgent', patch)),

  setEditingPanelPreset: (preset) => set((state) => ({
    ...replaceLayout(state, 'setEditingPanelPreset', cloneEditingPanelLayout(EDITING_PANEL_PRESETS[preset === 'custom' ? 'default' : preset])),
    editingPanelKeep: DEFAULT_KEEP,
  })),

  resetEditingPanelLayout: () => set((state) => ({ ...replaceLayout(state, 'resetEditingPanelLayout', cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS)), editingPanelKeep: DEFAULT_KEEP })),

  toggleEditingPanel: (panel) => get().showEditingPanel(panel, !displayEditingPanelLayout(get()).visibility[panel]),

  undoEditingPanelLayout: () => {
    const stack = get().editingPanelUndoStack
    if (stack.length === 0) return false
    const next = cloneEditingPanelLayout(stack[stack.length - 1])
    set((state) => ({
      editingPanelUndoStack: stack.slice(0, -1),
      // 撤回一次「收起」就是把那栏打开：照同一条规则让它成为留下的那栏，不然 1280 宽开着 Nomi 时撤销了也还是收起条。
      editingPanelKeep: keepAfterLayoutChange(displayEditingPanelLayout(state).visibility, next.visibility, state.editingPanelKeep),
      ...commitLayout(state, 'undoEditingPanelLayout', next),
    }))
    return true
  },

  syncEditingPanelSize: (patch) => set((state) => {
    const current = displayEditingPanelLayout(state)
    const next = clampEditingPanelLayout({ ...current, ...patch })
    const same = next.sourceWidth === current.sourceWidth
      && next.inspectorWidth === current.inspectorWidth
      && next.assistantWidth === current.assistantWidth
      && next.timelineHeight === current.timelineHeight
    return same ? state : commitLayout(state, 'syncEditingPanelSize', next)
  }),

  markEditingPanelLayoutCustom: () => set((state) => {
    const current = displayEditingPanelLayout(state)
    return current.preset === 'custom' ? state : commitLayout(state, 'markEditingPanelLayoutCustom', { ...current, preset: 'custom' })
  }),
})
