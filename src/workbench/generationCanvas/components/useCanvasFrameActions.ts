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
import React from 'react'
import { useTranslation } from 'react-i18next'
import { showInfoToast } from '../../../utils/showInfoToast'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { frameHasTimelineUnits, sendFrameToTimeline } from '../agent/sendFrameToTimeline'
import { confirmAndRunPlan } from './batchPlanPreview'
import { eligibleGenerationNodeIds, readCanvasBatchConcurrency, resolveCanvasGenerationScope } from './canvasProductionScope'
import type { FrameContextMenuAction } from './FrameContextMenu'

export type CanvasFrameMenuState = {
  groupId: string
  frameName: string
  stageX: number
  stageY: number
  canGenerate: boolean
  canSendToTimeline: boolean
}

const MENU_WIDTH = 212
const MENU_HEIGHT = 200
const MENU_EDGE_GAP = 8

function frameEligibleIds(groupId: string): string[] {
  const state = useGenerationCanvasStore.getState()
  const group = state.groups.find((candidate) => candidate.id === groupId)
  if (!group?.nodeIds.length) return []
  return eligibleGenerationNodeIds(state.nodes, resolveCanvasGenerationScope(group.categoryId, group.nodeIds))
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
} {
  const { t } = useTranslation()
  const [frameMenu, setFrameMenu] = React.useState<CanvasFrameMenuState | null>(null)
  const [editingFrameId, setEditingFrameId] = React.useState<string | null>(null)

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
    if (action === 'edit') {
      setEditingFrameId(menu.groupId)
      return
    }
    if (action === 'collapse') {
      state.setGroupCollapsed(menu.groupId, true)
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
        showInfoToast(t('generationCommon.canvas.group.generateEmpty'))
        return
      }
      const live = useGenerationCanvasStore.getState()
      // 并发读的是浮条写进去的**同一份**（canvasProductionScope 的 localStorage 口径）。
      // 在这里另存一份的后果是：用户在浮条上改了并发，从框菜单发起时却没生效。
      void confirmAndRunPlan(buildDependencyWaves(eligibleIds, { nodes: live.nodes, edges: live.edges }), {
        concurrency: readCanvasBatchConcurrency(),
      })
      return
    }
    void sendFrameToTimeline(menu.groupId).then((result) => {
      if (!result.ok) {
        showInfoToast(t('generationCommon.canvas.group.timelineEmpty'))
        return
      }
      showInfoToast(
        result.skipped > 0
          ? t('generationCommon.canvas.group.timelineDoneWithSkips', { count: result.placed, skipped: result.skipped })
          : t('generationCommon.canvas.group.timelineDone', { count: result.placed }),
      )
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
  }
}
