import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../ui/toast'
import { frameHasTimelineUnits } from '../agent/sendFrameToTimeline'
import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import type { GroupArrangeMode } from '../model/groupArrange'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { groupEligibleNodeIds } from './canvasProductionScope'
import { downloadGroupResults, groupDownloadTargets } from './groupDownload'
import type { CanvasGroupToolbarModel } from './CanvasGroupToolbar'
import type { FrameContextMenuAction } from './FrameContextMenu'
import { FRAME_MENU_TOOLBAR_DUPLICATES } from './frameMenuExclusions'

export function useCanvasGroupToolbar({
  selectedGroup,
  allNodes,
  visibleNodeIds,
  canvasZoom,
  canvasOffsetX,
  canvasOffsetY,
  stageWidth,
  stageHeight,
  readOnly,
  runFrameAction,
  openFrameMenu,
}: {
  selectedGroup: NodeGroup | null
  allNodes: readonly GenerationCanvasNode[]
  visibleNodeIds: ReadonlySet<string>
  canvasZoom: number
  canvasOffsetX: number
  canvasOffsetY: number
  stageWidth: number
  stageHeight: number
  readOnly: boolean
  runFrameAction: (groupId: string, action: FrameContextMenuAction) => void
  openFrameMenu: (groupId: string, point: { x: number; y: number }, exclude?: readonly FrameContextMenuAction[]) => void
}): CanvasGroupToolbarModel | undefined {
  const { t } = useTranslation()
  const arrangeGroup = useGenerationCanvasStore((state) => state.arrangeGroup)
  const setGroupColor = useGenerationCanvasStore((state) => state.setGroupColor)
  const productionRuns = useProductionCanvasLandingStore((store) => store.runs)
  const base = React.useMemo((): Omit<CanvasGroupToolbarModel, 'canvasOffsetX' | 'canvasOffsetY' | 'stageWidth' | 'stageHeight'> | undefined => {
    if (!selectedGroup || selectedGroup.collapsed || !selectedGroup.nodeIds.length || readOnly) return undefined
    const targets = groupDownloadTargets(allNodes, selectedGroup.nodeIds)
    return {
      group: selectedGroup,
      canvasZoom,
      memberCount: selectedGroup.nodeIds.filter((nodeId) => visibleNodeIds.has(nodeId)).length,
      // 与点击后真正派发的集合同一份推导（useCanvasFrameActions 的 generate）。
      canGenerate: groupEligibleNodeIds(selectedGroup, allNodes, productionRuns).length > 0,
      canSendToTimeline: frameHasTimelineUnits(selectedGroup.id),
      canDownload: targets.length > 0,
      onGenerate: () => runFrameAction(selectedGroup.id, 'generate'),
      onSendToTimeline: () => runFrameAction(selectedGroup.id, 'timeline'),
      onDissolve: () => runFrameAction(selectedGroup.id, 'dissolve'),
      onArrange: (mode: GroupArrangeMode) => arrangeGroup(selectedGroup.id, mode),
      onColor: (color: string) => setGroupColor(selectedGroup.id, color),
      // 工具条「⋯」只留 改名 / 说明、折叠成卡、删除：生成整组、进时间轴、解组在工具条上已有，不重复（10-10 拍板）。
      onOpenMenu: (point: { x: number; y: number }) => openFrameMenu(selectedGroup.id, point, FRAME_MENU_TOOLBAR_DUPLICATES),
      onDownload: () => {
        void downloadGroupResults(targets, selectedGroup.name || 'group', (count) => toast(t('generationCommon.canvas.group.toolbarDownloadSaved', { count }), 'success'))
      },
    }
  }, [allNodes, arrangeGroup, canvasZoom, openFrameMenu, productionRuns, readOnly, runFrameAction, selectedGroup, setGroupColor, t, visibleNodeIds])
  // 平移时 offsetY 每帧都在变：只在这一层把它拼进去，上面那份（含下载目标的遍历）不跟着重算。
  return React.useMemo(() => (base ? { ...base, canvasOffsetX, canvasOffsetY, stageWidth, stageHeight } : undefined), [base, canvasOffsetX, canvasOffsetY, stageWidth, stageHeight])
}
