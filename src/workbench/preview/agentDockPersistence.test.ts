import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkbenchStore } from '../workbenchStore'
import { readCurrentWorkbenchProjectPayload } from '../project/workbenchProjectSession'
import { cloneEditingPanelLayout, EDITING_PANEL_DEFAULTS } from './panelLayout'

/**
 * 常驻 Nomi 栏的开合是**项目级 UI 偏好**（2026-09-06 用户拍板：默认展开 + 记住上次状态）。
 *
 * 它没有自己的存储：真相住在随项目落盘的 `editingPanelLayout.visibility.assistant`，
 * `projectAgentDockCollapsed` 是它的投影。而落盘只由 `persistRevision` 变化触发——
 * 改布局却不 bump，用户收起的栏下次开项目就复原，看起来像「设置没保存」。
 * 这几条锁的就是这条链：默认值 → 切换写进落盘物 → 落盘物 bump → 回读还原。
 */
describe('常驻 Nomi 栏的开合偏好', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
      editingPanelUndoStack: [],
      projectAgentDockCollapsed: false,
    })
  })

  it('默认展开（没有存过偏好时）', () => {
    expect(useWorkbenchStore.getState().projectAgentDockCollapsed).toBe(false)
    expect(EDITING_PANEL_DEFAULTS.visibility.assistant).toBe(true)
  })

  it('收起会写进随项目落盘的布局，并 bump persistRevision 触发存盘', () => {
    const rev = useWorkbenchStore.getState().persistRevision
    useWorkbenchStore.getState().setProjectAgentDockCollapsed(true)
    const state = useWorkbenchStore.getState()
    expect(state.projectAgentDockCollapsed).toBe(true)
    expect(state.editingPanelLayout.visibility.assistant).toBe(false)
    expect(state.persistRevision).toBe(rev + 1)
    expect(readCurrentWorkbenchProjectPayload().editingPanelLayout?.visibility.assistant).toBe(false)
  })

  it('重复设成同一个值不 bump（别让无改动的 set 反复触发回存）', () => {
    useWorkbenchStore.getState().setProjectAgentDockCollapsed(true)
    const rev = useWorkbenchStore.getState().persistRevision
    useWorkbenchStore.getState().setProjectAgentDockCollapsed(true)
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev)
  })

  it('回读上次存下的布局：收起状态被记住，投影同步', () => {
    useWorkbenchStore.getState().setProjectAgentDockCollapsed(true)
    const saved = readCurrentWorkbenchProjectPayload().editingPanelLayout!
    // 模拟重开项目：先回到默认，再按存下的布局恢复（restoreWorkbenchProjectPayload 走的同一条口）。
    useWorkbenchStore.setState({
      editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
      projectAgentDockCollapsed: false,
    })
    useWorkbenchStore.getState().setEditingPanelLayout(saved, false)
    expect(useWorkbenchStore.getState().projectAgentDockCollapsed).toBe(true)
  })

  it('从别处翻可见性（toggleEditingPanel / 预设）同样 bump，两个开关不漂', () => {
    const rev = useWorkbenchStore.getState().persistRevision
    useWorkbenchStore.getState().toggleEditingPanel('assistant')
    expect(useWorkbenchStore.getState().projectAgentDockCollapsed).toBe(true)
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev + 1)
  })

  it('拖出来的栏宽也 bump（同一份落盘物，无改动时不 bump）', () => {
    const rev = useWorkbenchStore.getState().persistRevision
    const width = useWorkbenchStore.getState().editingPanelLayout.assistantWidth
    useWorkbenchStore.getState().syncEditingPanelSize({ assistantWidth: width + 20 })
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev + 1)
    useWorkbenchStore.getState().syncEditingPanelSize({ assistantWidth: width + 20 })
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev + 1)
  })
})
