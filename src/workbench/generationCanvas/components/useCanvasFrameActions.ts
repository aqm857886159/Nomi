import { canvasWindowInput } from '../../shortcutSurface'
/**
 * 框的四个动作 + 那份菜单的开合：改名/说明、生成整框、整框进时间轴、折叠、解散。
 *
 * 两条不许破的纪律：
 *  · **生成整框是画布上唯一的批量生成入口**（唯一执行口在 groupGenerate：共用主人 planGenerationScope（group 意图）→
 *    confirmAndRunPlan）；每个节点用它自己已选好的模型和参数。右键菜单与组工具条共用这一份。
 *  · **解散 = ungroup，边一根都不撤**（model/groupInputLinks 的既有语义：解散的是组织方式，
 *    不是节点关系）。顺手把边也撤了，用户失去的是接线，而他以为自己只是拆了个框。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { reportCanvasFeedback } from './canvasFeedback'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { frameHasTimelineUnits, sendFrameToTimeline } from '../agent/sendFrameToTimeline'
import { groupGenerateDisabledReason, runGroupGenerate } from './groupGenerate'
import type { FrameContextMenuAction } from './FrameContextMenu'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { useFloatingOutsideDismiss } from '../../../design'

export type CanvasFrameMenuState = {
  groupId: string
  frameName: string
  stageX: number
  stageY: number
  canGenerate: boolean
  generateDisabledReason?: string
  canSendToTimeline: boolean
}

/** 右键菜单「生成整组」的可用态与原因：同一份推导（共用主人的 group 意图），和点了之后卡上的候选一致。 */
export function frameMenuGenerate(nodeIds: readonly string[]): Pick<CanvasFrameMenuState, 'canGenerate' | 'generateDisabledReason'> {
  const generateDisabledReason = groupGenerateDisabledReason(nodeIds)
  return { canGenerate: generateDisabledReason === undefined, generateDisabledReason }
}

const MENU_WIDTH = 212
const MENU_HEIGHT = 250
const MENU_EDGE_GAP = 8

export function useCanvasFrameActions({
  readOnly,
  stageRef,
}: {
  readOnly: boolean
  stageRef: React.RefObject<HTMLDivElement | null>
}): {
  frameMenu: CanvasFrameMenuState | null
  closeFrameMenu: () => void
  openFrameMenu: (groupId: string, point: { x: number; y: number }) => void
  editingFrameId: string | null
  setEditingFrameId: (groupId: string | null) => void
  handleFrameMenuAction: (action: FrameContextMenuAction) => void
  runFrameAction: (groupId: string, action: FrameContextMenuAction) => void
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
  // 只在「从没选中到选中了」那一刻收（store 订阅，不进渲染）：订成渲染里的布尔，第一次点卡就会让整个画布壳重渲。
  // 没有选中的空框时一次 setState 都不发（连「同值」也不发），第一次点卡不让壳多渲一次。
  const selectedFrameIdRef = React.useRef(selectedFrameId)
  React.useEffect(() => { selectedFrameIdRef.current = selectedFrameId }, [selectedFrameId])
  React.useEffect(() => useGenerationCanvasStore.subscribe((state, previous) => {
    if (state.selectedNodeIds.length === 0 || previous.selectedNodeIds.length > 0 || selectedFrameIdRef.current === null) return
    selectedFrameIdRef.current = null
    setSelectedFrameId(null)
  }), [])
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
      ...frameMenuGenerate(group.nodeIds),
      canSendToTimeline: frameHasTimelineUnits(groupId),
    })
  }, [readOnly, stageRef])

  const runFrameAction = React.useCallback((groupId: string, action: FrameContextMenuAction) => {
    if (readOnly) return
    const state = useGenerationCanvasStore.getState()
    const projectId = withProjectAction((project) => project.binding.projectId) ?? ''
    const report = (message: string) => reportCanvasFeedback(message, 'warning', { projectId, identity: `frame:${groupId}`, reason: action, nodeIds: state.groups.find((group) => group.id === groupId)?.nodeIds })
    if (action === 'edit') {
      setEditingFrameId(groupId)
      return
    }
    if (action === 'collapse') {
      state.setGroupCollapsed(groupId, true)
      return
    }
    if (action === 'delete') {
      // 与「选中框按 Delete」同一个结果：框和成员一起删，一个撤销点（deleteGroup 自己打快照）。
      setSelectedFrameId(null)
      state.deleteGroup(groupId, true)
      return
    }
    if (action === 'dissolve') {
      // 节点留下、边一根都不撤——这就是 ungroup 的语义，本项不额外做任何事。
      state.ungroup(groupId)
      return
    }
    if (action === 'generate') {
      // 每个节点用它自己已选好的模型和参数；唯一执行口在 groupGenerate（列表分区头共用）。
      const group = state.groups.find((candidate) => candidate.id === groupId)
      // 四扇门勾不上时都已置灰；万一状态在点下去那一刻变了，说的也是同一句原因（主人的分行），不另写。
      if (runGroupGenerate(group?.nodeIds ?? []) === 'empty') report(groupGenerateDisabledReason(group?.nodeIds ?? []) ?? t('generationCommon.canvas.group.generateEmpty'))
      return
    }
    void sendFrameToTimeline(groupId).then((result) => {
      if (!result.ok) {
        report(t('generationCommon.canvas.group.timelineEmpty'))
        return
      }
      if (result.skipped > 0) report(t('generationCommon.canvas.group.timelineDoneWithSkips', { count: result.placed, skipped: result.skipped }))
    })
  }, [readOnly, t])

  const handleFrameMenuAction = React.useCallback((action: FrameContextMenuAction) => {
    const menu = frameMenu
    setFrameMenu(null)
    if (!menu) return
    runFrameAction(menu.groupId, action)
  }, [frameMenu, runFrameAction])

  // 菜单开着时点别处 / 按 Esc 就收——与节点右键菜单同一套开合心智，不让用户学第二种。
  useFloatingOutsideDismiss({
    open: Boolean(frameMenu),
    isInside: (target) => target instanceof Element && Boolean(target.closest('[data-frame-menu="true"]')),
    onDismiss: () => setFrameMenu(null),
  })

  React.useEffect(() => {
    if (!frameMenu) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFrameMenu(null)
    }
    canvasWindowInput.addEventListener('keydown', handleKeyDown)
    return () => {
      canvasWindowInput.removeEventListener('keydown', handleKeyDown)
    }
  }, [frameMenu])

  return {
    frameMenu,
    closeFrameMenu,
    openFrameMenu,
    editingFrameId,
    setEditingFrameId,
    handleFrameMenuAction,
    runFrameAction,
    selectedFrameId,
    selectFrame: setSelectedFrameId,
    deleteSelectedFrame,
  }
}
