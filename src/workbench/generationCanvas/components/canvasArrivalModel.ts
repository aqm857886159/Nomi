import { unionCanvasFitBounds } from '../model/canvasFitBounds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import type { CanvasRect } from '../store/canvasVisibleArea'

/**
 * 画布边缘提示（2026-09-25 用户拍板）的纯逻辑：哪些节点是「新到的、还没被看见」、提示该指向哪边。
 *
 * 背景：程序不再主动平移 / 缩放画布。新建、导入、Agent / 付费卡落地的东西尽量落在可见区；落不下的，
 * 在画布对应的那条边上出一颗胶囊「新节点在右侧 →」，**点它**画布才移过去。
 *
 * 「新到」按 store 里多出来的节点判，不在每个建节点的入口各记一笔——入口有十几个（工具条、粘贴、复制、
 * 导入、Agent、付费卡落地、分镜表、切图……），在入口上记，漏一个就又是「找不到」。打开项目那一刻已有的
 * 节点是基线，不算新到。
 *
 * 「看见了」= 节点中心落在可见区里（在当前分类）。看见了就从待提示里删掉——用户自己拖过去、点提示过去、
 * 或者它本来就落在屏里，都一样。
 */
export type ArrivalDirection = 'left' | 'right' | 'up' | 'down'
export type ArrivalHint =
  | { kind: 'direction'; direction: ArrivalDirection; count: number; categoryId: string; nodeIds: string[] }
  | { kind: 'category'; count: number; categoryId: string; nodeIds: string[] }

const categoryOf = (node: Pick<GenerationCanvasNode, 'categoryId'>): string => node.categoryId || 'shots'

function nodeRect(node: GenerationCanvasNode): CanvasRect {
  const size = resolveNodeVisualSize(node)
  return { x: node.position.x, y: node.position.y, width: size.width, height: size.height }
}

/** 节点中心在可见区里 = 看见了。 */
export function isNodeSeen(node: GenerationCanvasNode, activeCategoryId: string, visible: CanvasRect | null): boolean {
  if (!visible || categoryOf(node) !== activeCategoryId) return false
  const rect = nodeRect(node)
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return cx >= visible.x && cx <= visible.x + visible.width && cy >= visible.y && cy <= visible.y + visible.height
}

/**
 * 待提示集合的下一步：加上这次多出来的节点、去掉已删除的、去掉已经看见的。
 * `previousIds` 为 null 表示还没有基线（项目刚打开）：这一次只登记，不算新到。
 */
export function nextUnseenArrivals(input: {
  previousIds: ReadonlySet<string> | null
  unseen: readonly string[]
  nodes: readonly GenerationCanvasNode[]
  activeCategoryId: string
  visible: CanvasRect | null
}): string[] {
  const { previousIds, unseen, nodes, activeCategoryId, visible } = input
  if (!previousIds) return []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const arrived = nodes.filter((node) => !previousIds.has(node.id)).map((node) => node.id)
  const merged = [...unseen.filter((id) => byId.has(id)), ...arrived.filter((id) => !unseen.includes(id))]
  return merged.filter((id) => !isNodeSeen(byId.get(id)!, activeCategoryId, visible))
}

/**
 * 从待提示集合算出这颗胶囊。当前分类里有没看见的 → 指方向（按它们外接盒中心偏出可见区最多的那条轴）；
 * 否则如果别的分类里有 → 指分类（最后到的那个分类）。都没有 → null。
 */
export function resolveArrivalHint(input: {
  unseen: readonly string[]
  nodes: readonly GenerationCanvasNode[]
  activeCategoryId: string
  visible: CanvasRect | null
}): ArrivalHint | null {
  const { unseen, nodes, activeCategoryId, visible } = input
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const pending = unseen.map((id) => byId.get(id)).filter((node): node is GenerationCanvasNode => Boolean(node))
  const here = pending.filter((node) => categoryOf(node) === activeCategoryId)
  const bounds = visible ? unionCanvasFitBounds(here.map(nodeRect)) : null
  if (bounds && visible) {
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    const overX = cx < visible.x ? (visible.x - cx) / visible.width : cx > visible.x + visible.width ? (cx - visible.x - visible.width) / visible.width : 0
    const overY = cy < visible.y ? (visible.y - cy) / visible.height : cy > visible.y + visible.height ? (cy - visible.y - visible.height) / visible.height : 0
    const direction: ArrivalDirection = overX >= overY
      ? (cx < visible.x ? 'left' : 'right')
      : (cy < visible.y ? 'up' : 'down')
    return { kind: 'direction', direction, count: here.length, categoryId: activeCategoryId, nodeIds: here.map((node) => node.id) }
  }
  const elsewhere = pending.filter((node) => categoryOf(node) !== activeCategoryId)
  if (!elsewhere.length) return null
  const categoryId = categoryOf(elsewhere[elsewhere.length - 1])
  const inCategory = elsewhere.filter((node) => categoryOf(node) === categoryId)
  return { kind: 'category', count: inCategory.length, categoryId, nodeIds: inCategory.map((node) => node.id) }
}

/** 点提示时要框进屏里的那块（画布坐标）。 */
export function arrivalBounds(nodeIds: readonly string[], nodes: readonly GenerationCanvasNode[]): CanvasRect | null {
  const set = new Set(nodeIds)
  return unionCanvasFitBounds(nodes.filter((node) => set.has(node.id)).map(nodeRect))
}
