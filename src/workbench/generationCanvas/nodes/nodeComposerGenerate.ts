// 生成框「↑」按下去之后做的事——画布节点那张生成框与列表大详情（样张 design/shell-space）共用这一个口，
// 不各写一份（check:generation-entrances 守的就是「生成入口只有一处」）。逻辑原样搬自 NodeGenerationComposer。
import { canRunGenerationNode, confirmAndRunNode, regenerateNodeInPlace } from '../runner/generationRunController'
import { collectUngeneratedReferenceAncestors } from '../runner/referenceAncestors'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export async function runComposerGenerate(nodeId: string): Promise<void> {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  // 自动备齐参考：本节点有「连了线但还没出图」的上游 → 不裸跑，排依赖波次（参考先、本镜后）
  // 走批量确认条（确认前零调用零扣费；用户一眼看到先生成谁、再生成谁）。根治单节点生成绕过
  // 依赖、参考没回灌进镜头的整类问题（对话 2026-06-14）。
  const pendingRefs = collectUngeneratedReferenceAncestors(node.id, { nodes: state.nodes, edges: state.edges })
  if (pendingRefs.length > 0) {
    const plan = buildDependencyWaves([...pendingRefs, node.id], { nodes: state.nodes, edges: state.edges })
    useBatchPlanPreviewStore.getState().open(plan)
    return
  }
  if (!canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges })) return
  // 每按一次 ↑ 只出一版；要几版就按几次，版本卡片把它们铺开（用户 2026-10-06 拍板删掉「每次生成几个」）。
  // 已有结果的「重新生成」原地回填：新图进当前节点堆叠并设为主图，不再复制新节点。
  if (node.result?.url) await regenerateNodeInPlace(node.id, { initiator: 'user' })
  else await confirmAndRunNode(node.id, { initiator: 'user' })
}
