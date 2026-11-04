import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../workbenchStore'
import { cloneEditingPanelLayout, EDITING_PANEL_DEFAULTS } from './panelLayout'

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
