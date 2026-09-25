// P4 S6 — 多镜物化节点（meta.productionRunId）失败重试的 onRetry 收口（把决策从 BaseGenerationNode 壳里抽出来，
// 守 800 行门岗 R9）。返回：多镜节点 + 项目已开 → 走返工链（同 Run 新 Job + 锚继承 + 单镜确认，§3.E）；否则 null
// （由调用方退回本地重跑/素材重导入，单镜与普通节点行为不变 = 回归门）。
//
// 2026-09-25：失败态搬进节点自己的运行记录之后，失败卡就是普通生成那张 NodeErrorReport，它的「重试」走这里。
// 返工链只认多镜计划（主进程对单镜回 not_multishot），所以单镜制作节点返回 null——它的重试就是在节点上
// 正常再生成一次（普通生成那扇付费门），而不是点了只弹一句「暂时用不了」。
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { reworkProductionShot } from '../../production/productionShotActions'

/** 多镜物化节点走返工链的 onRetry；非多镜/项目没开 → null（调用方兜底本地重跑）。 */
export function useProductionNodeRetry(node: GenerationCanvasNode, reportFeedback: (message: string) => void): (() => void) | null {
  const meta = node.meta as Record<string, unknown> | undefined
  const runId = typeof meta?.productionRunId === 'string' && meta.productionRunId ? meta.productionRunId : ''
  const shotId = typeof meta?.productionShotId === 'string' && meta.productionShotId ? meta.productionShotId : undefined
  const projectId = useProductionCanvasLandingStore((store) => store.projectId)
  const multiShot = useProductionCanvasLandingStore((store) => (store.runs[runId]?.generationPlan?.shots?.length ?? 0) > 0)
  if (!runId || !projectId || !multiShot) return null
  return () => { void reworkProductionShot(projectId, runId, shotId, reportFeedback) }
}
