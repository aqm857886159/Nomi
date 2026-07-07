// 拓扑波次规划(harness S2b,源自 ViMax 论文 §2.3.1 依赖图调度,消融:去掉它一致性 -8.7%)。
// 把"谁参考谁"的边变成执行波次:无依赖并行(第 1 波),有依赖等前置完成(后续波)。
// 纯函数:同一份计划既给确认 UI 画,也给调度器跑——显示的 ≡ 执行的(可断言)。
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isTextPromptEdge } from '../agent/referenceEdgeCapability'

export type DependencyWavePlan = {
  /** 执行波次:waves[0] 全部并行,waves[n] 等 waves[n-1] 完成。 */
  waves: string[][]
  /** 不进本批的节点及原因。 */
  blocked: { nodeId: string; reason: 'cycle' | 'missing-upstream'; detail: string }[]
  /** 本次计划用到的依赖边(target 在选择集内、source 是它的生成输入)。 */
  edgesUsed: GenerationCanvasEdge[]
}

function hasUsableResult(node: GenerationCanvasNode | undefined): boolean {
  if (!node) return false
  const url = node.result?.url || node.result?.thumbnailUrl
  return typeof url === 'string' && url.length > 0
}

/**
 * 对选中的节点按依赖边分波。
 * 规则:
 * - 只考虑指向选中节点的边(edge.target ∈ selection);
 * - source 也在选中集内 → 形成波次先后(它先跑);
 * - source 在选中集外:已有可用结果 → 满足,不在图里;无结果 → target 标 blocked
 *   (missing-upstream:上游参考没生成又不在本批,跑了必裸跑——宁可拦下,杜绝静默);
 * - 环 → 环上节点全部 blocked(cycle)。
 */
export function buildDependencyWaves(
  selectedIds: readonly string[],
  context: { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] },
): DependencyWavePlan {
  const selection = new Set(selectedIds)
  const nodesById = new Map(context.nodes.map((node) => [node.id, node]))
  const blocked: DependencyWavePlan['blocked'] = []
  const blockedIds = new Set<string>()
  const edgesUsed: GenerationCanvasEdge[] = []

  // 选中集内的依赖邻接:target ← sources(只算 selection 内部的 source)
  const internalDeps = new Map<string, Set<string>>()
  for (const id of selection) internalDeps.set(id, new Set())
  for (const edge of context.edges) {
    if (!selection.has(edge.target)) continue
    const sourceNode = nodesById.get(edge.source)
    const targetNode = nodesById.get(edge.target)
    if (sourceNode && targetNode && isTextPromptEdge(sourceNode, targetNode)) continue
    if (selection.has(edge.source)) {
      internalDeps.get(edge.target)?.add(edge.source)
      edgesUsed.push(edge)
      continue
    }
    // 选择集外的上游:有结果=满足;无结果=拦下(这就是修"静默丢参考裸跑"的地方)
    if (!hasUsableResult(sourceNode)) {
      if (!blockedIds.has(edge.target)) {
        blockedIds.add(edge.target)
        const sourceTitle = sourceNode?.title || edge.source
        blocked.push({ nodeId: edge.target, reason: 'missing-upstream', detail: `上游「${sourceTitle}」还没有生成结果` })
      }
    } else {
      edgesUsed.push(edge)
    }
  }

  // Kahn 分层(排除已 blocked 的;依赖 blocked 节点的也传染 blocked)
  const waves: string[][] = []
  const placed = new Set<string>(blockedIds)
  let frontier: string[] = []
  let remaining = [...selection].filter((id) => !blockedIds.has(id))
  let guard = remaining.length + 1
  while (remaining.length > 0 && guard > 0) {
    guard -= 1
    frontier = remaining.filter((id) => {
      const deps = internalDeps.get(id) ?? new Set()
      for (const dep of deps) {
        if (blockedIds.has(dep)) return false // 依赖被拦 → 自己也跑不了(下面传染处理)
        if (!placed.has(dep)) return false
      }
      return true
    })
    // 传染:依赖了 blocked 节点的,标 blocked 而不是死等
    const infected = remaining.filter((id) => [...(internalDeps.get(id) ?? [])].some((dep) => blockedIds.has(dep)))
    for (const id of infected) {
      if (!blockedIds.has(id)) {
        blockedIds.add(id)
        placed.add(id)
        blocked.push({ nodeId: id, reason: 'missing-upstream', detail: '依赖的节点本批被拦下' })
      }
    }
    const wave = frontier.filter((id) => !blockedIds.has(id))
    if (wave.length === 0) {
      // 剩下的互相依赖 = 环
      for (const id of remaining.filter((candidate) => !blockedIds.has(candidate))) {
        blockedIds.add(id)
        blocked.push({ nodeId: id, reason: 'cycle', detail: '与其他节点构成循环引用' })
      }
      break
    }
    waves.push(wave)
    for (const id of wave) placed.add(id)
    remaining = remaining.filter((id) => !placed.has(id))
  }

  return { waves, blocked, edgesUsed }
}

/** 节点 → 波次序号(1 起);blocked/不在计划内 → undefined。给确认 UI 画徽标用。 */
export function waveIndexByNode(plan: DependencyWavePlan): Map<string, number> {
  const map = new Map<string, number>()
  plan.waves.forEach((wave, index) => {
    for (const id of wave) map.set(id, index + 1)
  })
  return map
}
