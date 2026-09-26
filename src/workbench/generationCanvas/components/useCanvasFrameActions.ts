/**
 * 框的四个动作 + 那份菜单的开合：改名/说明、生成整框、整框进时间轴、折叠、解散。
 *
 * 两条不许破的纪律：
 *  · **生成整框走的就是浮条那一条批量生产路径**（resolveCanvasGenerationScope →
 *    eligibleGenerationNodeIds → buildDependencyWaves → confirmAndRunPlan），只是把 scope
 *    从「选中集」换成「框内成员」。一份实现两个入口，不是第二套生成（P1）。
 *  · **解散 = ungroup，边一根都不撤**（model/groupInputLinks 的既有语义：解散的是组织方式，
 *    不是节点关系）。顺手把边也撤了，用户失去的是接线，而他以为自己只是拆了个框。
 */
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { reportCanvasFeedback } from './canvasFeedback'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { frameHasTimelineUnits, sendFrameToTimeline } from '../agent/sendFrameToTimeline'
import { confirmAndRunPlan } from './batchPlanPreview'
import { eligibleGenerationNodeIds, readCanvasBatchConcurrency, resolveCanvasGenerationScope } from './canvasProductionScope'
import type { FrameContextMenuAction } from './FrameContextMenu'
import { withProjectAction } from '../../project/projectCanvasReadSurface'

export type CanvasFrameMenuState = {
  groupId: string
  frameName: string
  stageX: number
  stageY: number
  canGenerate: boolean
  canSendToTimeline: boolean
}

const MENU_WIDTH = 212
const MENU_HEIGHT = 250
const MENU_EDGE_GAP = 8

function frameEligibleIds(groupId: string): string[] {
  const state = useGenerationCanvasStore.getState()
  const group = state.groups.find((candidate) => candidate.id === groupId)
  if (!group?.nodeIds.length) return []
  return eligibleGenerationNodeIds(
    state.nodes,
    resolveCanvasGenerationScope(group.categoryId, group.nodeIds),
    useProductionCanvasLandingStore.getState().runs,
  )
}

export function useCanvasFrameActions({
  readOnly,
  stageRef,
}: {
  readOnly: boolean
  stageRef: React.RefObject<HTMLDivElement>
}): {
  frameMenu: CanvasFrameMenuState | null
  closeFrameMenu: () => void
  openFrameMenu: (groupId: string, point: { x: number; y: number }) => void
  editingFrameId: string | null
  setEditingFrameId: (groupId: string | null) => void
  handleFrameMenuAction: (action: FrameContextMenuAction) => void
  /** 单独选中的**空框**（没有成员可选，框本身就是选区）；有成员的框的选区就是它的成员。 */
  selectedFrameId: string | null
  selectFrame: (groupId: string | null) => void
  /** Delete / Backspace：选中的空框被删掉返回 true，没有就返回 false 让键盘继续往下判。 */
  deleteSelectedFrame: () => boolean
} {
  const { t } = useTranslation()
  const [frameMenu, setFrameMenu] = React.useState<CanvasFrameMenuState | null>(null)
  const [editingFrameId, setEditingFrameId] = React.useState<string | null>(null)
  const [selectedFrameId, setSelectedFrameId] = React.useState<string | null>(null)
  // 框选区与节点选区互斥：一旦又选中了节点（点卡、框选、Agent 选中……），空框的选中态就退场。
  const hasNodeSelection = useGenerationCanvasStore((state) => state.selectedNodeIds.length > 0)
  React.useEffect(() => { if (hasNodeSelection) setSelectedFrameId(null) }, [hasNodeSelection])
  const deleteSelectedFrame = React.useCallback(() => {
    if (!selectedFrameId) return false
    setSelectedFrameId(null)
    if (!useGenerationCanvasStore.getState().groups.some((group) => group.id === selectedFrameId)) return false
    useGenerationCanvasStore.getState().deleteGroup(selectedFrameId, true)
    return true
  }, [selectedFrameId])

  const closeFrameMenu = React.useCallback(() => setFrameMenu(null), [])

  const openFrameMenu = React.useCallback((groupId: string, point: { x: number; y: number }) => {
    if (readOnly) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const state = useGenerationCanvasStore.getState()
    const group = state.groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    setFrameMenu({
      groupId,
      frameName: group.name,
      // 贴边时夹回视口内：框可能画在画布最右下角，菜单原样弹出会被切掉一半。
      stageX: Math.max(MENU_EDGE_GAP, Math.min(point.x - rect.left, rect.width - MENU_WIDTH - MENU_EDGE_GAP)),
      stageY: Math.max(MENU_EDGE_GAP, Math.min(point.y - rect.top, rect.height - MENU_HEIGHT - MENU_EDGE_GAP)),
      canGenerate: frameEligibleIds(groupId).length > 0,
      canSendToTimeline: frameHasTimelineUnits(groupId),
    })
  }, [readOnly, stageRef])

  const handleFrameMenuAction = React.useCallback((action: FrameContextMenuAction) => {
    const menu = frameMenu
    setFrameMenu(null)
    if (!menu || readOnly) return
    const state = useGenerationCanvasStore.getState()
    const projectId = withProjectAction((project) => project.binding.projectId) ?? ''
    const report = (message: string) => reportCanvasFeedback(message, 'warning', { projectId, identity: `frame:${menu.groupId}`, reason: action, nodeIds: state.groups.find((group) => group.id === menu.groupId)?.nodeIds })
    if (action === 'edit') {
      setEditingFrameId(menu.groupId)
      return
    }
    if (action === 'collapse') {
      state.setGroupCollapsed(menu.groupId, true)
      return
    }
    if (action === 'delete') {
      // 与「选中框按 Delete」同一个结果：框和成员一起删，一个撤销点（deleteGroup 自己打快照）。
      setSelectedFrameId(null)
      state.deleteGroup(menu.groupId, true)
      return
    }
    if (action === 'dissolve') {
      // 节点留下、边一根不撤——这就是 ungroup 的语义，本项不额外做任何事。
      state.ungroup(menu.groupId)
      return
    }
    if (action === 'generate') {
      const eligibleIds = frameEligibleIds(menu.groupId)
      if (!eligibleIds.length) {
        report(t('generationCommon.canvas.group.generateEmpty'))
        return
      }
      const live = useGenerationCanvasStore.getState()
      // 并发读的是浮条写进去的**同一份**（canvasProductionScope 的 localStorage 口径）。
      // 在这里另存一份的后果是：用户在浮条上改了并发，从框菜单发起时却没生效。
      void confirmAndRunPlan(buildDependencyWaves(eligibleIds, { nodes: live.nodes, edges: live.edges }), {
        concurrency: readCanvasBatchConcurrency(),
        initiator: 'user',
      })
      return
    }
    void sendFrameToTimeline(menu.groupId).then((result) => {
      if (!result.ok) {
        report(t('generationCommon.canvas.group.timelineEmpty'))
        return
      }
      if (result.skipped > 0) report(t('generationCommon.canvas.group.timelineDoneWithSkips', { count: result.placed, skipped: result.skipped }))
    })
  }, [frameMenu, readOnly, t])

  // 菜单开着时点别处 / 按 Esc 就收——与节点右键菜单同一套开合心智，不让用户学第二种。
  React.useEffect(() => {
    if (!frameMenu) return undefined
    const close = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-frame-menu="true"]')) return
      setFrameMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFrameMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [frameMenu])

  return {
    frameMenu,
    closeFrameMenu,
    openFrameMenu,
    editingFrameId,
    setEditingFrameId,
    handleFrameMenuAction,
    selectedFrameId,
    selectFrame: setSelectedFrameId,
    deleteSelectedFrame,
  }
}
