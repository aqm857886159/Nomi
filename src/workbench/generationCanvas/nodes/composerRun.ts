import { canRunGenerationNode, confirmAndRunNode, regenerateNodeInPlace } from '../runner/generationRunController'
import { collectUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

/**
 * 生成浮框里「↑」按下去之后的唯一一条路（画布浮框与文本节点加工框共用）。
 *
 * 自动备齐参考（对话 2026-06-14）：本节点有「连了线但还没出图」的上游 → 不裸跑，排依赖波次（参考先、本镜后）
 * 走批量确认条（确认前零调用零扣费；用户一眼看到先生成谁、再生成谁）。根治单节点生成绕过依赖、参考没回灌进镜头的整类问题。
 * 每按一次 ↑ 只出一版；已有结果的「重新生成」原地回填：新图进当前节点堆叠并设为主图，不再复制新节点。
 */
export async function startGenerationFromComposer(node: GenerationCanvasNode, hasResult: boolean): Promise<void> {
  const state = useGenerationCanvasStore.getState()
  const pendingRefs = collectUngeneratedReferenceAncestors(node.id, { nodes: state.nodes, edges: state.edges })
  if (pendingRefs.length > 0) {
    const plan = buildDependencyWaves([...pendingRefs, node.id], { nodes: state.nodes, edges: state.edges })
    useBatchPlanPreviewStore.getState().open(plan)
    return
  }
  if (!canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges })) return
  if (hasResult) await regenerateNodeInPlace(node.id, { initiator: 'user' })
  else await confirmAndRunNode(node.id, { initiator: 'user' })
}
