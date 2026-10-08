import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { CENTER_PLACEMENT_ANCHOR, type CanvasPlacementAnchor } from '../model/canvasPlacement'
import { importLocalFilesToGenerationCanvas } from './canvasStageDrop'
import { createConnectedNode } from '../quickActions/nodeInputActions'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import type { CanvasContextNodeMenu } from './useCanvasContextNodeMenu'
import type { NodeContextMenuAction } from './NodeContextMenu'

/**
 * 画布三个菜单的动作落点（R9：从 GenerationCanvas 抽出，那边已到 800 行门岗）。
 *
 * 这里只做「把菜单里的一次点击翻译成一次 store 动作」，不含任何 React 状态与渲染——
 * 三个菜单共用同一套落点语义：**动作发生在右键/起线的那一点**，不是画布中心，也不是鼠标当前位置。
 */
type CanvasMenuActionsInput = {
  activeCategoryId: string
  contextNodeMenu: CanvasContextNodeMenu | null
  setContextNodeMenu: (menu: CanvasContextNodeMenu | null) => void
  connectionCreateMenu: {
    sourceNodeId: string
    sourceSide: ConnectionAnchorSide
    canvasX: number
    canvasY: number
    /** true = 拖线松手的那一点（卡落在那儿）；false = 点「+」出的菜单，(canvasX, canvasY) 只是卡旁边的期望落点、由 addNode 避让。 */
    exactPosition: boolean
    /** 线从卡起还是从编组的「+」起；编组起的线新建节点后，组内每个成员各连一条（store.connectToGroup）。 */
    sourceKind: 'node' | 'group'
  } | null
  setConnectionCreateMenu: (menu: null) => void
  addNode: (input: {
    kind: GenerationNodeKind
    position: { x: number; y: number }
    categoryId: string
    exactPosition?: boolean
    select?: boolean
  }) => { id: string }
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: (position: { x: number; y: number }, anchor?: CanvasPlacementAnchor) => void
  groupSelectedNodes: () => void
  deleteSelectedNodes: () => void
}

export function buildCanvasMenuActions(input: CanvasMenuActionsInput): {
  handleAddContextNode: (kind: GenerationNodeKind) => void
  handleImportContextFiles: (files: File[]) => void
  handleNodeContextAction: (action: NodeContextMenuAction) => void
  handleAddConnectedNode: (kind: GenerationNodeKind) => void
} {
  const handleAddContextNode = (kind: GenerationNodeKind) => {
    if (!input.contextNodeMenu) return
    input.addNode({
      kind,
      position: { x: input.contextNodeMenu.canvasX, y: input.contextNodeMenu.canvasY },
      categoryId: input.activeCategoryId,
    })
    input.setContextNodeMenu(null)
  }

  // 右键菜单「导入 · 文件…」：落点与「右键空白 → 添加节点」同一点，走的是画布本地文件导入
  // 那条现役路径（与拖文件进画布同一条），不另建 asset 节点。
  const handleImportContextFiles = (files: File[]) => {
    if (!input.contextNodeMenu) return
    const basePosition = { x: input.contextNodeMenu.canvasX, y: input.contextNodeMenu.canvasY }
    input.setContextNodeMenu(null)
    void importLocalFilesToGenerationCanvas(files, { basePosition, categoryId: input.activeCategoryId })
  }

  // 节点右键菜单的五个动作。**复用快捷键那条路的同一批 store 动作**——
  // 一个功能一份实现，菜单只是把它们变得看得见（P1 无并行版）。
  const handleNodeContextAction = (action: NodeContextMenuAction) => {
    if (!input.contextNodeMenu) return
    // 粘贴落在右键那一点，与「右键空白 → 添加节点」的落点语义一致。
    const pastePosition = { x: input.contextNodeMenu.canvasX, y: input.contextNodeMenu.canvasY }
    input.setContextNodeMenu(null)
    if (action === 'copy') input.copySelectedNodes()
    else if (action === 'cut') input.cutSelectedNodes()
    else if (action === 'paste') input.pasteNodes(pastePosition, CENTER_PLACEMENT_ANCHOR)
    else if (action === 'group') input.groupSelectedNodes()
    else if (action === 'delete') input.deleteSelectedNodes()
    else if (action === 'duplicate-variant') {
      // 浮条上「复制为变体」同一个动作（带上游连线、不带结果、一个撤销点）；菜单只是它的第二个发现入口。
      const [only, ...rest] = useGenerationCanvasStore.getState().selectedNodeIds
      if (only && rest.length === 0) useGenerationCanvasStore.getState().duplicateNodeForRegeneration(only)
    }
  }

  // 拉环菜单选一项：建节点 + 连线（左「+」新节点在上游、右「+」在下游）是一步撤销（quickActions/nodeInputActions）。
  const handleAddConnectedNode = (kind: GenerationNodeKind) => {
    if (!input.connectionCreateMenu) return
    const { sourceNodeId, sourceSide, sourceKind, canvasX, canvasY, exactPosition } = input.connectionCreateMenu
    createConnectedNode({
      anchorNodeId: sourceNodeId,
      side: sourceSide,
      sourceKind,
      kind,
      position: { x: canvasX, y: canvasY },
      exactPosition,
      categoryId: input.activeCategoryId,
    })
    input.setConnectionCreateMenu(null)
  }

  return { handleAddContextNode, handleImportContextFiles, handleNodeContextAction, handleAddConnectedNode }
}
