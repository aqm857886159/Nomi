import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../workbenchStore'
import { createEditingPanelLayoutSlice } from './editingPanelLayoutSlice'
import { cloneEditingPanelLayout, EDITING_PANEL_DEFAULTS, resolveEditingStageFrame, type EditingSidePanel } from './panelLayout'

/**
 * 两侧栏放不下时留哪边（editingPanelKeep，2026-11-04 用户拍板「先收属性」）。
 * 只由显式动作改：点收起条 / 布局菜单 / Agent 打开某一栏 / 切左栏 tab；换项目、切预设回到默认左栏。
 * 点收起条时它的开合意图往往**已经是开着**（只是放不下被让成了条）——这一下必须照样让它成为留下的那栏，
 * 否则 1280 宽开着 Nomi 时点属性收起条什么都不会发生。
 */
describe('editingPanelKeep — 放不下时留下用户刚点开的那栏', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
      editingPanelUndoStack: [],
      editingPanelKeep: 'source',
      previewSourceTab: 'shots',
    })
  })

  it('默认留左栏「镜头 / 素材」', () => {
    expect(useWorkbenchStore.getState().editingPanelKeep).toBe('source')
  })

  it('点被让成收起条的属性栏：开合意图本来就开着，只换留哪边，不压撤销栈、不触发存盘', () => {
    const before = useWorkbenchStore.getState()
    before.showEditingPanel('inspector', true)
    const after = useWorkbenchStore.getState()
    expect(after.editingPanelKeep).toBe('inspector')
    expect(after.editingPanelLayout).toBe(before.editingPanelLayout)
    expect(after.editingPanelUndoStack).toHaveLength(0)
    expect(after.persistRevision).toBe(before.persistRevision)
  })

  it('点真正关着的栏：打开它（进撤销栈、存盘），并留它', () => {
    useWorkbenchStore.getState().showEditingPanel('source', false)
    const rev = useWorkbenchStore.getState().persistRevision
    useWorkbenchStore.getState().showEditingPanel('source', true)
    const state = useWorkbenchStore.getState()
    expect(state.editingPanelLayout.visibility.source).toBe(true)
    expect(state.editingPanelKeep).toBe('source')
    expect(state.editingPanelUndoStack).toHaveLength(2)
    expect(state.persistRevision).toBe(rev + 1)
  })

  it('「收起」只关这一栏，不改留哪边', () => {
    useWorkbenchStore.getState().showEditingPanel('inspector', true)
    useWorkbenchStore.getState().showEditingPanel('inspector', false)
    const state = useWorkbenchStore.getState()
    expect(state.editingPanelLayout.visibility.inspector).toBe(false)
    expect(state.editingPanelKeep).toBe('inspector')
  })

  it('布局菜单的开关走同一个口', () => {
    useWorkbenchStore.getState().showEditingPanel('inspector', false)
    useWorkbenchStore.getState().toggleEditingPanel('inspector')
    expect(useWorkbenchStore.getState().editingPanelKeep).toBe('inspector')
  })

  it('Agent layout.write 只打开一栏 → 留它；同时开两栏 → 不改', () => {
    useWorkbenchStore.getState().setEditingPanelLayout({ visibility: { inspector: true } })
    expect(useWorkbenchStore.getState().editingPanelKeep).toBe('inspector')
    useWorkbenchStore.getState().setEditingPanelLayout({ visibility: { source: true, inspector: true } })
    expect(useWorkbenchStore.getState().editingPanelKeep).toBe('inspector')
  })

  it('切左栏 tab（含时间轴右键「从素材库添加…」）→ 留左栏，才真的看得到那个 tab', () => {
    useWorkbenchStore.getState().keepEditingPanel('inspector')
    useWorkbenchStore.getState().openPreviewSourceTab('assets')
    const state = useWorkbenchStore.getState()
    expect(state.previewSourceTab).toBe('assets')
    expect(state.editingPanelKeep).toBe('source')
  })

  it('打开项目还原落盘布局 / 切预设 / 重置 → 回到默认左栏', () => {
    const store = useWorkbenchStore.getState()
    store.keepEditingPanel('inspector')
    store.setEditingPanelLayout(cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS), false)
    expect(useWorkbenchStore.getState().editingPanelKeep).toBe('source')
    store.keepEditingPanel('inspector')
    store.setEditingPanelPreset('focus')
    expect(useWorkbenchStore.getState().editingPanelKeep).toBe('source')
    store.keepEditingPanel('inspector')
    store.resetEditingPanelLayout()
    expect(useWorkbenchStore.getState().editingPanelKeep).toBe('source')
  })
})

/**
 * 入口一类（★9 第 9 项「布局菜单 / 预设 / ⌘Z / Agent layout.write 打开一栏：该栏展开，另一栏按需让成收起条」）。
 * 2026-11-05 独立验收：⌘Z 撤回一次收起，属性的开合回到开，留哪边却没跟着改，1280 宽开 Nomi 时属性仍是收起条。
 * 根因是「留哪边」由每个入口各记一遍；现在所有改开合的入口都经 keepAfterLayoutChange。这里守两件事：
 *  ①slice 里每个动作都必须在 ENTRIES 里登记它会不会打开侧栏——以后新加的入口不登记就红，没法悄悄漏掉这一步；
 *  ②每个会打开侧栏的入口，在拍板的三个窄宽度下都让打开的那栏展开、另一栏让成条；再随机串起来跑一遍。
 * 没有「重做」：布局只有撤销栈（⌘Z），重做不存在，不登记。
 */
const SIDES: EditingSidePanel[] = ['source', 'inspector']
const other = (side: EditingSidePanel): EditingSidePanel => (side === 'source' ? 'inspector' : 'source')
/** 舞台行宽：1100 / 1280 / 1440 开着 Nomi（390 → 外壳在 1100 钳到 340）。 */
const NARROW_STAGES = [682, 812, 972]

type Store = ReturnType<typeof useWorkbenchStore.getState>
/** 把 target 打开的一种做法；每个入口的真实调用者写在注释里。 */
type Opener = { name: string; sides: EditingSidePanel[]; open: (store: () => Store, target: EditingSidePanel) => void }
const OPENERS: Opener[] = [
  // 点收起条 / 栏头「收起」（PreviewWorkspace → PreviewSourcePanel / PreviewInspector）
  { name: 'showEditingPanel', sides: SIDES, open: (store, target) => store().showEditingPanel(target, true) },
  // 顶栏「布局」菜单的勾选（EditingLayoutMenu）
  { name: 'toggleEditingPanel', sides: SIDES, open: (store, target) => store().toggleEditingPanel(target) },
  // ⌘Z（PreviewWorkspace keydown）：撤回刚才那次收起
  { name: 'undoEditingPanelLayout', sides: SIDES, open: (store, target) => { store().showEditingPanel(target, false); store().undoEditingPanelLayout() } },
  // Agent layout.write（capabilityApplyHandler）与拖开收起条（PreviewWorkspace 的 editingPanelDragIntent）：只写这一栏
  { name: 'setEditingPanelLayout', sides: SIDES, open: (store, target) => store().setEditingPanelLayout({ visibility: { [target]: true } }) },
  // Agent layout.write 整份写入：两栏都写 true，真正从关变开的只有 target
  { name: 'setEditingPanelLayout（整份）', sides: SIDES, open: (store) => store().setEditingPanelLayout({ ...store().editingPanelLayout, visibility: { source: true, inspector: true, assistant: true } }) },
  // 左栏切 tab、时间轴右键「从素材库添加…」（PreviewSourcePanel / TimelineContextMenu）
  { name: 'openPreviewSourceTab', sides: ['source'], open: (store) => store().openPreviewSourceTab('assets') },
]
/** 整份换回默认的入口：两栏一起打开，按拍板「先收属性」留左栏。 */
const RESETS: Array<{ name: string; run: (store: Store) => void }> = [
  { name: 'setEditingPanelPreset', run: (store) => store.setEditingPanelPreset('default') },
  { name: 'resetEditingPanelLayout', run: (store) => store.resetEditingPanelLayout() },
]
/** 不会把侧栏从关变开的动作，各写一句为什么。 */
const NEVER_OPENS_SIDE: Record<string, string> = {
  setProjectAgentDockCollapsed: '只开关 Nomi 栏',
  keepEditingPanel: '只在拖宽某一栏时改留哪边，不改开合',
  setTimelineSnapEnabled: '时间轴吸附开关',
  syncEditingPanelSize: '只记拖出来的宽高',
  markEditingPanelLayoutCustom: '只把预设名改成 custom',
}

const frameOf = (state: Store, panelsWidth: number) => resolveEditingStageFrame({ panelsWidth, layout: state.editingPanelLayout, keep: state.editingPanelKeep })

describe('打开侧栏的每个入口：打开的那栏一定看得到', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
      editingPanelUndoStack: [],
      editingPanelKeep: 'source',
      previewSourceTab: 'shots',
    })
  })

  it('slice 的每个动作都登记了它会不会打开侧栏（新入口不登记就红）', () => {
    const noop = () => undefined
    const slice = createEditingPanelLayoutSlice(noop as never, noop as never, {} as never)
    const actions = Object.entries(slice).filter(([, value]) => typeof value === 'function').map(([key]) => key).sort()
    const registered = new Set([...OPENERS.map((opener) => opener.name.replace(/（.*$/, '')), ...RESETS.map((reset) => reset.name), ...Object.keys(NEVER_OPENS_SIDE)])
    expect(actions.filter((action) => !registered.has(action))).toEqual([])
    expect([...registered].filter((action) => !actions.includes(action))).toEqual([])
  })

  for (const opener of OPENERS) {
    for (const target of opener.sides) {
      it(`${opener.name} 打开 ${target}：拍板的窄宽度下它展开、另一栏让成条`, () => {
        const store = () => useWorkbenchStore.getState()
        // 起点：另一栏是留下的那栏；target 若不是被这个入口自己关掉，就先关上。
        store().keepEditingPanel(other(target))
        if (opener.name !== 'undoEditingPanelLayout') store().showEditingPanel(target, false)
        opener.open(store, target)
        const state = store()
        expect(state.editingPanelLayout.visibility[target]).toBe(true)
        expect(state.editingPanelKeep).toBe(target)
        for (const width of NARROW_STAGES) {
          const frame = frameOf(state, width)
          expect({ width, open: frame[target].open }).toEqual({ width, open: true })
          // 1440 开 Nomi（972）两栏都放得下（292 / 480 / 200）；更窄时另一栏让成收起条。
          if (state.editingPanelLayout.visibility[other(target)]) expect({ width, other: frame[other(target)].open }).toEqual({ width, other: width === 972 })
        }
      })
    }
  }

  for (const reset of RESETS) {
    it(`${reset.name}：两栏一起打开，留左栏（先收属性）`, () => {
      const store = useWorkbenchStore.getState()
      store.setEditingPanelPreset('result')
      store.keepEditingPanel('inspector')
      reset.run(useWorkbenchStore.getState())
      const state = useWorkbenchStore.getState()
      expect(state.editingPanelKeep).toBe('source')
      expect(frameOf(state, 812).source.open).toBe(true)
    })
  }

  it('随机串起来：任何一步只要把某一栏打开（点名或从关变开），三个窄宽度下它都看得到', () => {
    let seed = 20261105
    // 线性同余的低位周期很短（mod 4 只有 4 步一循环），取高位才抽得到「收起 → 撤销」这类相邻组合。
    const random = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n }
    const store = () => useWorkbenchStore.getState()
    const steps: Array<{ label: string; run: () => EditingSidePanel | null }> = [
      ...SIDES.flatMap((side) => [
        { label: `show ${side}`, run: () => { store().showEditingPanel(side, true); return side } },
        { label: `hide ${side}`, run: () => { store().showEditingPanel(side, false); return null } },
        { label: `toggle ${side}`, run: () => { const wasOpen = store().editingPanelLayout.visibility[side]; store().toggleEditingPanel(side); return wasOpen ? null : side } },
        { label: `agent ${side}`, run: () => { store().setEditingPanelLayout({ visibility: { [side]: true } }); return side } },
      ]),
      { label: 'tab', run: () => { store().openPreviewSourceTab('assets'); return 'source' } },
      { label: 'undo', run: () => {
        const before = store().editingPanelLayout.visibility
        store().undoEditingPanelLayout()
        const after = store().editingPanelLayout.visibility
        const opened = SIDES.filter((side) => !before[side] && after[side])
        return opened.length === 1 ? opened[0] : null
      } },
      { label: 'preset focus', run: () => { store().setEditingPanelPreset('focus'); return null } },
      { label: 'nomi', run: () => { store().setProjectAgentDockCollapsed(!store().projectAgentDockCollapsed); return null } },
    ]
    for (let sequence = 0; sequence < 400; sequence += 1) {
      useWorkbenchStore.setState({ editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS), editingPanelUndoStack: [], editingPanelKeep: 'source' })
      const trail: string[] = []
      for (let index = 0; index < 12; index += 1) {
        const step = steps[random(steps.length)]
        trail.push(step.label)
        const opened = step.run()
        if (!opened) continue
        for (const width of NARROW_STAGES) {
          expect({ trail: trail.join(' → '), width, open: frameOf(store(), width)[opened].open }).toEqual({ trail: trail.join(' → '), width, open: true })
        }
      }
    }
  })
})
