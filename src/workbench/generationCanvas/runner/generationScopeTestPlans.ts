// 测试用：要一份「指定波次」的执行计划时，也只能经共用主人规划出来（执行计划带品牌，手拼字面量过不了类型）。
// 做法：在给的图上补几根依赖边让波次成形，再按组生成意图问主人；问出来的波次和想要的不一样就当场报错——
// 说明这份测试的节点状态本来就进不了批量（生成中 / 可找回 / 不能生成），该改的是测试的前提，不是绕过主人。
import { narrowGenerationScope, type GenerationScopePlan } from '../../../../electron/shared/agentCapabilities/generationShotScope'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { planCanvasGenerationScope, scopeFactsOf, type ScopeGraph } from './generationScopeFacts'

const dependsOn = (source: string, target: string): GenerationCanvasEdge =>
  ({ id: `test-wave:${source}->${target}`, source, target, mode: 'first_frame' }) as unknown as GenerationCanvasEdge

/**
 * 后一波的每个节点依赖前一波的第一个节点；默认读画布 store。
 * 等于「组生成的卡上把这几个全勾上」：先按组意图规划，再按勾上的这几个缩一次（已出图的默认不勾，人勾上就进）。
 */
export function planOfWaves(waves: readonly (readonly string[])[], graph: ScopeGraph = useGenerationCanvasStore.getState()): GenerationScopePlan {
  const edges = [...graph.edges, ...waves.slice(1).flatMap((wave, index) => wave.map((target) => dependsOn(waves[index][0], target)))]
  const shaped = { nodes: graph.nodes, edges }
  const plan = narrowGenerationScope(planCanvasGenerationScope('group', waves.flat(), shaped), waves.flat(), scopeFactsOf(shaped))
  if (JSON.stringify(plan.waves) !== JSON.stringify(waves)) {
    throw new Error(`planOfWaves: 主人规划出的波次 ${JSON.stringify(plan.waves)} ≠ 想要的 ${JSON.stringify(waves)}（blocked ${JSON.stringify(plan.blocked)}）`)
  }
  return plan
}

/** 只有被拦下的节点：`missing-upstream` 接一个没结果的图外上游，`cycle` 接一根自环。 */
export function planOfBlocked(nodeId: string, reason: 'missing-upstream' | 'cycle', graph: ScopeGraph = useGenerationCanvasStore.getState()): GenerationScopePlan {
  const upstream = { id: `test-upstream:${nodeId}`, kind: 'image', title: 'upstream', position: { x: 0, y: 0 } } as unknown as GenerationCanvasNode
  const plan = reason === 'cycle'
    ? planCanvasGenerationScope('group', [nodeId], { nodes: graph.nodes, edges: [...graph.edges, dependsOn(nodeId, nodeId)] })
    : planCanvasGenerationScope('group', [nodeId], { nodes: [...graph.nodes, upstream], edges: [...graph.edges, dependsOn(upstream.id, nodeId)] })
  if (plan.waves.length || plan.blocked.length !== 1 || plan.blocked[0].reason !== reason) {
    throw new Error(`planOfBlocked: 想要 ${nodeId} 因 ${reason} 被拦，主人给的波次 ${JSON.stringify(plan.waves)}、拦下 ${JSON.stringify(plan.blocked)}`)
  }
  return plan
}
