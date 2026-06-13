import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

/**
 * 单节点生成的「自动备齐参考」根治（对话 2026-06-14）：用户连了 角色→镜头，但镜头先生成时
 * 参考还没出图、又没东西把后生成的角色回灌进镜头。根因=单节点「生成」不走依赖逻辑（只有批量
 * 「生成选中」走 buildDependencyWaves）。本函数收集一个节点**经参考边、尚未出图**的全部上游
 * （传递闭包），供单节点生成时把它们和自己一起排进依赖波次（参考先生成、镜头后生成）。
 *
 * 已出图的上游视为「已满足」——不纳入选择集（buildDependencyWaves 会把它当外部满足上游），
 * 故不会被重复生成、不会重复扣费。
 */
function hasUsableResult(node: GenerationCanvasNode | undefined): boolean {
  const url = node?.result?.url || node?.result?.thumbnailUrl
  return typeof url === 'string' && url.length > 0
}

export function collectUngeneratedReferenceAncestors(
  nodeId: string,
  context: { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] },
): string[] {
  const byId = new Map(context.nodes.map((node) => [node.id, node]))
  const collected = new Set<string>()
  const stack = [nodeId]
  const guard = context.edges.length + context.nodes.length + 1
  let steps = 0
  while (stack.length > 0 && steps < guard) {
    steps += 1
    const current = stack.pop() as string
    for (const edge of context.edges) {
      if (edge.target !== current) continue
      const source = edge.source
      if (collected.has(source)) continue
      if (hasUsableResult(byId.get(source))) continue // 已出图 = 已满足，不纳入（不重复生成）
      collected.add(source)
      stack.push(source) // 该上游也没图 → 它自己的参考也要先备齐（传递闭包）
    }
  }
  collected.delete(nodeId)
  return [...collected]
}
