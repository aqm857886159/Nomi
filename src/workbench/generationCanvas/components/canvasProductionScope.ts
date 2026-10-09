import { isNodeGenerationOwnedByProduction, type ProductionRunsById } from '../../production/productionShotOwnership'
import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'

/** 调度器默认并发。用户不再选：批量只走组的「生成整组」，并发交给调度器。 */
export const DEFAULT_CANVAS_BATCH_CONCURRENCY = 6

export type CanvasGenerationScope = {
  categoryId?: string
  nodeIds?: readonly string[]
}

let e2eConcurrency: number | null = null

/**
 * 仅供 E2E 桥（localStorage.__nomiE2E，见 ProductionCanvasLandingHost）：走查要造「排队中」的真实状态，
 * 就把整批并发压到 1。产品界面不提供这个选项，也不读任何用户偏好。
 */
export function setCanvasBatchConcurrencyForE2E(value: number | null): void {
  e2eConcurrency = value === null ? null : normalizeCanvasBatchConcurrency(value)
}

export function normalizeCanvasBatchConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return e2eConcurrency ?? DEFAULT_CANVAS_BATCH_CONCURRENCY
  return Math.max(1, Math.min(8, Math.floor(value)))
}

export function nodesInCanvasProductionScope(
  nodes: readonly GenerationCanvasNode[],
  scope: CanvasGenerationScope = {},
): GenerationCanvasNode[] {
  const scopedIds = scope.nodeIds ? new Set(scope.nodeIds) : null
  return nodes.filter((node) => {
    if (scope.categoryId && (node.categoryId || 'shots') !== scope.categoryId) return false
    if (scopedIds && !scopedIds.has(node.id)) return false
    return true
  })
}

/** 这个节点此刻在生成 / 排队，或归制作流程占着（再派一次 = 重复扣费）。逐项勾选里这类行锁住、不能勾。 */
export function isGenerationNodeBusy(node: GenerationCanvasNode | undefined, productionRuns: ProductionRunsById = {}): boolean {
  if (!node) return false
  return node.status === 'queued' || node.status === 'running' || isNodeGenerationOwnedByProduction(node, productionRuns)
}

export function eligibleGenerationNodeIds(
  nodes: readonly GenerationCanvasNode[],
  scope: CanvasGenerationScope = {},
  productionRuns: ProductionRunsById = {},
): string[] {
  return nodesInCanvasProductionScope(nodes, scope)
    .filter((node) => {
      if (!getGenerationNodeExecutionKind(node.kind)) return false
      // 归制作流程生成的镜头（报价卡等确认 / 排队 / 生成中）节点状态仍是 idle——再算进「生成整组」就是重复扣费。
      if (isNodeGenerationOwnedByProduction(node, productionRuns)) return false
      const status = node.status ?? 'idle'
      return status === 'idle' || status === 'error'
    })
    .map((node) => node.id)
}

/**
 * 「生成整组」要生成哪些节点——组工具条的可用态和点击后真正派发的集合共用这一份，不各算一遍。
 */
export function groupEligibleNodeIds(
  group: Pick<NodeGroup, 'nodeIds'> | null | undefined,
  nodes: readonly GenerationCanvasNode[],
  productionRuns: ProductionRunsById = {},
): string[] {
  if (!group?.nodeIds.length) return []
  return eligibleGenerationNodeIds(nodes, { nodeIds: group.nodeIds }, productionRuns)
}
