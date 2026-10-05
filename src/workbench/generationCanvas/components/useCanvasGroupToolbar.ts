import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../ui/toast'
import { frameHasTimelineUnits } from '../agent/sendFrameToTimeline'
import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import type { GroupArrangeMode } from '../model/groupArrange'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { downloadGroupResults, groupDownloadTargets } from './groupDownload'
import type { CanvasGroupToolbarProps } from './CanvasGroupToolbar'
import type { FrameContextMenuAction } from './FrameContextMenu'

export function useCanvasGroupToolbar({
  selectedGroup,
  allNodes,
  visibleNodeIds,
  readOnly,
  eligibleCount,
  runFrameAction,
}: {
  selectedGroup: NodeGroup | null
  allNodes: readonly GenerationCanvasNode[]
  visibleNodeIds: ReadonlySet<string>
  readOnly: boolean
  eligibleCount: number
  runFrameAction: (groupId: string, action: FrameContextMenuAction) => void
}): CanvasGroupToolbarProps | undefined {
  const { t } = useTranslation()
  const arrangeGroup = useGenerationCanvasStore((state) => state.arrangeGroup)
  const setGroupColor = useGenerationCanvasStore((state) => state.setGroupColor)
  const clearSelection = useGenerationCanvasStore((state) => state.clearSelection)
  return React.useMemo(() => {
    if (!selectedGroup || selectedGroup.collapsed || !selectedGroup.nodeIds.length || readOnly) return undefined
    const targets = groupDownloadTargets(allNodes, selectedGroup.nodeIds)
    return {
      group: selectedGroup,
      memberCount: selectedGroup.nodeIds.filter((nodeId) => visibleNodeIds.has(nodeId)).length,
      canGenerate: eligibleCount > 0,
      canSendToTimeline: frameHasTimelineUnits(selectedGroup.id),
      canDownload: targets.length > 0,
      onGenerate: () => runFrameAction(selectedGroup.id, 'generate'),
      onSendToTimeline: () => runFrameAction(selectedGroup.id, 'timeline'),
      onDissolve: () => runFrameAction(selectedGroup.id, 'dissolve'),
      onArrange: (mode: GroupArrangeMode) => arrangeGroup(selectedGroup.id, mode),
      onColor: (color: string) => setGroupColor(selectedGroup.id, color),
      onDownload: () => {
        void downloadGroupResults(targets, selectedGroup.name || 'group', (count) => toast(t('generationCommon.canvas.group.toolbarDownloadSaved', { count }), 'success'))
      },
      onClearSelection: clearSelection,
    }
  }, [allNodes, arrangeGroup, clearSelection, eligibleCount, readOnly, runFrameAction, selectedGroup, setGroupColor, t, visibleNodeIds])
}
