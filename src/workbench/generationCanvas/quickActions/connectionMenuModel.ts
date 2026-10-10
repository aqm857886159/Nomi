import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeDefaultSize } from '../model/generationNodeKinds'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  connectionCreateVerdictsForSource,
  connectionCreateVerdictsForSources,
  connectionCreateVerdictsForTarget,
  type ConnectionCreateVerdict,
} from '../agent/referenceEdgeCapability'
import { NODE_DERIVE_KINDS, type NodeDeriveKind } from './nodeDeriveMenuModel'

/** 菜单是从哪儿出的：哪张卡（或哪个编组）的哪一侧。 */
export type ConnectionMenuStart = { nodeId: string; side: 'left' | 'right'; sourceKind: 'node' | 'group' }

/**
 * 拉环菜单的判据（点「+」与拖到空白处松手同一份）。**看起线的一侧**：
 * - 右「+」= 用这个节点生成：以本卡为源（connectionCreateVerdictsForSource）；
 * - 左「+」= 给它加输入：以本卡为目标（connectionCreateVerdictsForTarget）——新节点会落成本卡的上游（connectToNode 按
 *   pendingConnectionSourceSide 定方向），判据必须和结果同向（bug ②：以前左侧也按源判）。
 * 编组只有右侧能接出新节点（组内成员的并集）；左侧（接进编组）在空白处没有「新建谁喂给这一组」的定义 → 空。
 */
export function connectionMenuVerdicts(start: ConnectionMenuStart): ConnectionCreateVerdict<NodeDeriveKind>[] {
  const state = useGenerationCanvasStore.getState()
  if (start.sourceKind === 'node') {
    const node = state.nodes.find((candidate) => candidate.id === start.nodeId)
    if (!node) return []
    return start.side === 'left'
      ? connectionCreateVerdictsForTarget(node, NODE_DERIVE_KINDS)
      : connectionCreateVerdictsForSource(node, NODE_DERIVE_KINDS)
  }
  if (start.side !== 'right') return []
  const memberIds = new Set(state.groups.find((group) => group.id === start.nodeId)?.nodeIds ?? [])
  return connectionCreateVerdictsForSources(state.nodes.filter((node) => memberIds.has(node.id)), NODE_DERIVE_KINDS)
}

/** 点一下「+」出的菜单锚在圈下：左上角贴「+」圈左缘、圈底往下 6px（左右两边同一个锚法，样张 ch-03 / ch-04）。 */
export function handleMenuAnchor(ringRect: Pick<DOMRect, 'left' | 'bottom'> & Partial<DOMRect>): { x: number; y: number } {
  return { x: ringRect.left, y: ringRect.bottom + 6 }
}

const RING_MENU_GAP = 80

/**
 * 点「+」（没有松手点）新建的节点落在哪：卡的那一侧旁边、顶端对齐。只是期望落点——真实避让由 store.addNode 统一做。
 * 左侧：新卡右缘离本卡左缘一个间距；右侧：新卡左缘离本卡右缘一个间距。
 */
export function resolveRingMenuPlacement(
  card: Pick<GenerationCanvasNode, 'kind' | 'position' | 'size' | 'meta' | 'result'>,
  side: 'left' | 'right',
  kind: GenerationNodeKind,
): { x: number; y: number } {
  const cardWidth = resolveNodeVisualSize(card as GenerationCanvasNode).width
  const newWidth = getGenerationNodeDefaultSize(kind).width
  const x = side === 'left' ? card.position.x - newWidth - RING_MENU_GAP : card.position.x + cardWidth + RING_MENU_GAP
  return { x: Math.round(x), y: Math.round(card.position.y) }
}
