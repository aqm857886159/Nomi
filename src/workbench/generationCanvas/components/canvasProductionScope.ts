import { selectIsNodeQueued, useGenerationQueueStore } from '../runner/generationQueueStore'
import { isNodeGenerationOwnedByProduction, type ProductionRunsById } from '../../production/productionShotOwnership'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/** 调度器默认并发。用户不再选：批量只走组的「生成整组」，并发交给调度器。 */
export const DEFAULT_CANVAS_BATCH_CONCURRENCY = 6

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

/** 这个节点此刻在生成 / 排队，或归制作流程占着（再派一次 = 重复扣费）。逐项勾选里这类行锁住、不能勾。 */
export function isGenerationNodeBusy(node: GenerationCanvasNode | undefined, productionRuns: ProductionRunsById = {}): boolean {
  if (!node) return false
  return selectIsNodeQueued(useGenerationQueueStore.getState(), node.id) || node.status === 'queued' || node.status === 'running' || isNodeGenerationOwnedByProduction(node, productionRuns)
}
