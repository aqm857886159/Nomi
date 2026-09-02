import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

/**
 * 提交时的上游版本快照（分镜 v5「参考已变」检测的写边界，但语义通用）：本次运行经由入边
 * 消费的每个上游节点，当时用的是哪个 result 版本 → `meta.refSnapshot[sourceNodeId] = resultId`。
 * 由 runGenerationNode 在真正开跑处调用（花钱确认之后、executor 之前）——取消确认不打戳，
 * 戳=「这次跑真用了这些版本」。上游 result 后来变了（重生成），diff 快照即得「用旧图的节点」
 * → 亮标提示补跑，绝不自动跑（Toonflow 引用模式零失效传播=静默换脸的反面教材，plan §v3-3）。
 * 无入边上游有果 → 删旧戳（诚实）；戳随 meta passthrough 持久化，重启仍在。
 */
export function stampUpstreamRefSnapshot(
  nodeId: string,
  graph: { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] },
): void {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  const snapshot: Record<string, string> = {}
  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    const source = graph.nodes.find((candidate) => candidate.id === edge.source)
    const resultId = source?.result?.id
    if (typeof resultId === 'string' && resultId) snapshot[edge.source] = resultId
  }
  const meta = { ...((node.meta as Record<string, unknown> | undefined) || {}) }
  if (Object.keys(snapshot).length > 0) meta.refSnapshot = snapshot
  else if ('refSnapshot' in meta) delete meta.refSnapshot
  else return // 无上游版本也无旧戳：不写空 meta（避免无谓 store churn）
  useGenerationCanvasStore.getState().updateNode(nodeId, { meta })
}
