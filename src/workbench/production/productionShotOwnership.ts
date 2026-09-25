import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'
import { deriveProductionShotState, productionShotIdForNode, productionShotOwnsGeneration } from '../../../electron/shared/productionShotPhase'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

/** 该节点是否属某制作 Run（meta.productionRunId）。非制作节点 → null。 */
export function productionRunIdOf(node: Pick<GenerationCanvasNode, 'meta'>): string | null {
  const meta = node.meta as Record<string, unknown> | undefined
  return typeof meta?.productionRunId === 'string' && meta.productionRunId ? meta.productionRunId : null
}

/**
 * 这个节点的镜头此刻是否由制作流程在生成（排队 / 生成中）。判据只读 `deriveProductionShotState`
 * （唯一 owner，见 docs/engineering/concept-owners.json「制作镜头在画布上的运行状态」），这里只负责从节点找到它的 Run。
 */
export function isNodeProductionShotInFlight(
  node: Pick<GenerationCanvasNode, 'id' | 'meta'>,
  runs: Readonly<Record<string, ProductionRun>>,
): boolean {
  const runId = productionRunIdOf(node)
  const run = runId ? runs[runId] : undefined
  if (!run) return false
  return productionShotOwnsGeneration(deriveProductionShotState(run, productionShotIdForNode(run, node.id)))
}
