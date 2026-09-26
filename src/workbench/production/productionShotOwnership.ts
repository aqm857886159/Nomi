import { productionShotIdForNode, productionShotOwnsGeneration } from '../../../electron/shared/productionShotPhase'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

/**
 * 按 runId 索引的制作 Run。形状取自 owner 函数的签名：渲染层不直接引 electron/productionRun（check:boundaries
 * 的 src-no-import-electron），只依赖中立层 electron/shared。
 */
export type ProductionRunsById = Readonly<Record<string, NonNullable<Parameters<typeof productionShotOwnsGeneration>[0]>>>

/** 该节点是否属某制作 Run（meta.productionRunId）。非制作节点 → null。 */
export function productionRunIdOf(node: Pick<GenerationCanvasNode, 'meta'>): string | null {
  const meta = node.meta as Record<string, unknown> | undefined
  return typeof meta?.productionRunId === 'string' && meta.productionRunId ? meta.productionRunId : null
}

/**
 * 这个节点的镜头此刻是否归制作流程生成（报价卡等确认 / 排队 / 生成中）。判据只读 `productionShotOwnsGeneration`
 * （唯一 owner，见 docs/engineering/concept-owners.json「制作镜头的生成归属」），这里只负责从节点找到它的 Run。
 */
export function isNodeGenerationOwnedByProduction(
  node: Pick<GenerationCanvasNode, 'id' | 'meta'>,
  runs: ProductionRunsById,
): boolean {
  const runId = productionRunIdOf(node)
  const run = runId ? runs[runId] : undefined
  if (!run) return false
  return productionShotOwnsGeneration(run, productionShotIdForNode(run, node.id))
}
