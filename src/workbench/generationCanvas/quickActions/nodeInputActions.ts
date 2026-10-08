import type { AssetRef } from '../../assets/assetTypes'
import { pushUndoSnapshot } from '../events/canvasUndoJournal'
import { withCanvasGestureContext } from '../events/canvasGestureContext'
import type { GenerationCanvasEdgeMode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { resolveCanvasReferenceConnection } from '../model/canvasReferenceConnection'
import { completeNodeConnection } from '../nodes/completeNodeConnection'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { enterCanvasPickMode } from '../store/canvasPickMode'
import { addAssetLibraryNode, importLocalFilesToGenerationCanvas } from '../components/canvasStageDrop'
import { resolveRingMenuPlacement } from '../reactFlow/connectionMenuModel'

/**
 * 「给一张卡接东西」的几种动作——两侧拉环菜单、空节点「试试」、点选模式、素材选择器共用这一处，
 * 每个动作都是**一步撤销**（runAsSingleUndoStep），都只搭结构：建空节点 / 连线 / 切生成方式，不生成、不花钱。
 * 连线一律经画布 store 的 connectToNode → resolveCanvasReferenceConnection → validateReferenceEdge 这一道总闸。
 */

const store = () => useGenerationCanvasStore.getState()

/**
 * 一次用户动作 = 一个 Cmd+Z 步（建节点 + 连线 + 切生成方式这类多步动作）：动作开头打一个撤销点，
 * 动作里途经的 store action 自己的撤销点全部压住——和 agent 提议事务、结果拖出成卡（canvasResultDrag）同一个做法，
 * 只用撤销日志现成的两个出口，不改日志本身。fn 只许同步。
 */
export function runAsSingleUndoStep<T>(txnId: string, fn: () => T): T {
  pushUndoSnapshot()
  return withCanvasGestureContext({ source: 'user', txnId, suppressUndoBarriers: true }, fn)
}

let txnSeq = 0
const txn = (label: string) => `${label}-${Date.now()}-${(txnSeq += 1)}`

export type ConnectedNodeRequest = {
  /** 菜单是从哪张卡（或哪个编组）的哪一侧出的。 */
  anchorNodeId: string
  side: 'left' | 'right'
  sourceKind: 'node' | 'group'
  kind: GenerationNodeKind
  /** 新卡落点：拖线松手的那一点（exactPosition）；点「+」出的菜单没有松手点，给卡旁边的期望落点、由 addNode 避让。 */
  position: { x: number; y: number }
  exactPosition: boolean
  categoryId?: string
}

/**
 * 拉环菜单选一项：新建这一类空节点并接上——右「+」新节点在下游，左「+」新节点在上游（本卡收它当输入）。
 * 选中新节点（同「用这个节点生成」）。接不上时由 completeNodeConnection 给人话反馈。返回新节点 id。
 */
export function createConnectedNode(request: ConnectedNodeRequest): string | null {
  return runAsSingleUndoStep(txn('connected-node'), () => {
    const anchor = store().nodes.find((node) => node.id === request.anchorNodeId)
    // 点「+」出的菜单没有松手点：按选中的这一类的尺寸，落在卡那一侧旁边（避让交给 addNode）。
    const position = !request.exactPosition && anchor && request.sourceKind === 'node'
      ? resolveRingMenuPlacement(anchor, request.side, request.kind)
      : request.position
    const created = store().addNode({
      kind: request.kind,
      position,
      categoryId: request.categoryId ?? anchor?.categoryId,
      exactPosition: request.exactPosition,
      select: true,
    })
    if (request.sourceKind === 'group') store().startGroupConnection(request.anchorNodeId, request.side)
    else store().startConnection(request.anchorNodeId, request.side)
    completeNodeConnection(created.id)
    return created.id
  })
}

/**
 * 在一张卡旁边建空的上游节点、按给定边语义接进来（配方用：首帧 / 首尾帧 / 参考图）。`modes[i]` 缺省 = 按目标当前生成方式挑。
 * 不另开撤销步（调用方在自己的 runAsSingleUndoStep 里）。返回新节点 id。
 */
export function addUpstreamNodes(targetId: string, kind: GenerationNodeKind, modes: readonly (GenerationCanvasEdgeMode | undefined)[]): string[] {
  const target = store().nodes.find((node) => node.id === targetId)
  if (!target) return []
  const base = resolveRingMenuPlacement(target, 'left', kind)
  return modes.map((mode, index) => {
    const created = store().addNode({ kind, position: { x: base.x, y: base.y + index * 260 }, categoryId: target.categoryId, select: false })
    store().startConnection(targetId, 'left')
    store().connectToNode(created.id, mode ? { mode } : undefined)
    return created.id
  })
}

/** 在一张卡旁边建空的下游节点、把这张卡接进去（配方用：拿文本生图 / 生视频）。返回新节点 id。 */
export function addDownstreamNode(sourceId: string, kind: GenerationNodeKind): string | null {
  const source = store().nodes.find((node) => node.id === sourceId)
  if (!source) return null
  const created = store().addNode({ kind, position: resolveRingMenuPlacement(source, 'right', kind), categoryId: source.categoryId, select: false })
  store().startConnection(sourceId, 'right')
  store().connectToNode(created.id)
  return created.id
}

/** 已有的一张卡接进目标（点选模式点中 / 素材卡建好之后）：过同一道总闸，一步撤销。 */
export function connectExistingInput(sourceId: string, targetId: string): void {
  runAsSingleUndoStep(txn('connect-input'), () => {
    store().startConnection(targetId, 'left')
    completeNodeConnection(sourceId)
  })
}

/** 这张卡能不能作为输入接进目标：和真正连线走同一个判据（含参考槽容量）。 */
export function canConnectInput(sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) return false
  const { nodes, edges } = store()
  const source = nodes.find((node) => node.id === sourceId)
  const target = nodes.find((node) => node.id === targetId)
  if (!source || !target) return false
  if (edges.some((edge) => edge.source === sourceId && edge.target === targetId)) return false
  return resolveCanvasReferenceConnection(source, target, nodes, edges).ok
}

/** 「在画布上点选」一张卡接进这张卡（左「+」菜单、剪辑空态）。点中即连，Esc / 点空白什么都不建。 */
export function pickCanvasInputFor(targetId: string): () => void {
  return enterCanvasPickMode({
    eligible: (nodeId) => canConnectInput(nodeId, targetId),
    onPick: (nodeId) => connectExistingInput(nodeId, targetId),
  })
}

/** 「从素材库添加…」选中一项：在卡左边建一张素材卡（同素材库拖到画布那条建卡路径）并接进来，一步撤销。 */
export function addAssetInput(targetId: string, asset: AssetRef): string | null {
  return runAsSingleUndoStep(txn('asset-input'), () => {
    const target = store().nodes.find((node) => node.id === targetId)
    if (!target) return null
    const created = addAssetLibraryNode(asset, resolveRingMenuPlacement(target, 'left', 'asset'), target.categoryId)
    store().startConnection(targetId, 'left')
    completeNodeConnection(created)
    return created
  })
}

/** 素材选择器里上传：走画布现有的本地文件导入（复制进项目 + 建素材卡），导入完成后把新卡接进来。 */
export async function addUploadedInput(targetId: string, file: File): Promise<void> {
  const target = store().nodes.find((node) => node.id === targetId)
  if (!target) return
  const created = await importLocalFilesToGenerationCanvas([file], { basePosition: resolveRingMenuPlacement(target, 'left', 'asset'), categoryId: target.categoryId })
  for (const nodeId of created) connectExistingInput(nodeId, targetId)
}
