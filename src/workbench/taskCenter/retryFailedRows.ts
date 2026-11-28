// 任务中心「全部重试」：失败行按自己的种类走（D-1126-sd-hd-retry-route）。
// 普通失败 → 照节点设置重新生成（失败范围计划，走原来那张批量卡）；出高清失败 → 只带样片号再出高清，
// 和这一行自己的「重试」同一条路，不会顺手按节点设置再出一条样片。
import i18n from '../../i18n'
import { confirmAndRunPlan } from '../generationCanvas/components/batchPlanPreview'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { sampleByTaskId, sampleFinalExecutionNode, type SampleFinalRequest } from '../generationCanvas/model/sampleFacts'
import { confirmAndRunNode } from '../generationCanvas/runner/generationRunController'
import { planCanvasGenerationScope } from '../generationCanvas/runner/generationScopeFacts'
import { confirmGenerationSpend, describeGenerationCost, generationCostContextForNodes, spendCostKind, withGenerationEtaStats } from '../generationCanvas/spend/spendConfirm'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { isProjectExecutionContextCurrent, withProjectAction } from '../project/projectCanvasReadSurface'
import type { TaskCenterProjection } from './taskCenterProjection'

export type FailedRetries = {
  /** 照节点设置重新生成的节点。 */
  regenerate: string[]
  /** 再出高清的节点（只带样片号和清晰度）。 */
  sampleFinals: Array<{ nodeId: string; sampleFinal: SampleFinalRequest }>
}

/**
 * 「全部重试」要发哪些：每个节点只重试一次（同一节点两次同时发会被主进程拒），按它最新那条失败行（行是新的在前）的种类走。
 * 行上没有重试动作的（样片不在了 / 过期了的出高清行、不能重试的失败）不进。
 */
export function splitFailedRetries(rows: readonly TaskCenterProjection[]): FailedRetries {
  const seen = new Set<string>()
  const out: FailedRetries = { regenerate: [], sampleFinals: [] }
  for (const row of rows) {
    if (row.kind !== 'generation' || seen.has(row.nodeId)) continue
    const action = row.action
    if (action?.kind === 'retry_generation') out.regenerate.push(row.nodeId)
    else if (action?.kind === 'retry_sample_final') out.sampleFinals.push({ nodeId: row.nodeId, sampleFinal: action.sampleFinal })
    else continue
    seen.add(row.nodeId)
  }
  return out
}

/** 「全部重试」里没发出去的那几镜（交回面板，挂到各自那一行上说一句）。 */
export type RetryFailure = { nodeId: string; error: unknown }

/**
 * 发出去。只有普通失败时一字不改走原来那条（失败范围计划 + 批量卡）。混着出高清时：这一下点击要花几笔就问一次（≥2 笔才问，
 * 判据仍归 confirmGenerationSpend），问过之后普通那几镜照原计划跑（不再弹第二张卡），出高清那几镜各走自己那一行的重试。
 * 出高清的身份照样片那一行（不看节点现在选着谁），卡上的花不花钱、名词也按它算。
 */
export async function retryFailedGenerationRows(rows: readonly TaskCenterProjection[]): Promise<RetryFailure[]> {
  // 项目身份在点击这一刻签发（函数第一行，签发前没有任何 await）；卡开着时换了项目 = 出高清那几镜什么都不发。
  // 只有普通失败时用不到它：原来那条批量卡自己签发。
  const project = withProjectAction((issued) => issued)
  const { regenerate, sampleFinals } = splitFailedRetries(rows)
  const graph = useGenerationCanvasStore.getState()
  const plan = planCanvasGenerationScope('retry-failed', regenerate, graph)
  if (sampleFinals.length === 0) {
    await confirmAndRunPlan(plan, { initiator: 'user' })
    return []
  }
  if (!project) return []
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const finalNodes = sampleFinals.flatMap(({ nodeId, sampleFinal }): GenerationCanvasNode[] => {
    const node = nodesById.get(nodeId)
    const sample = node ? sampleByTaskId(node, sampleFinal.draftTaskId) : null
    return node && sample ? [sampleFinalExecutionNode(node, sample, sampleFinal)] : []
  })
  const spendNodes = [...plan.waves.flat().map((id) => nodesById.get(id)), ...finalNodes]
  const kinds = new Set(spendNodes.flatMap((node) => (node ? [spendCostKind(node.kind)] : [])))
  const ok = await confirmGenerationSpend(spendNodes, {
    initiator: 'user',
    title: i18n.t('generationCommon.batchPlan.startTitle'),
    message: describeGenerationCost(spendNodes.length, kinds.size === 1 ? [...kinds][0] : 'mixed', await withGenerationEtaStats(generationCostContextForNodes(spendNodes, project.binding.projectId))),
    confirmLabel: i18n.t('generationCommon.batchPlan.confirmGenerate'),
  })
  if (!ok || !isProjectExecutionContextCurrent(project)) return []
  const sends = [
    ...(regenerate.length ? [{ nodeIds: regenerate, send: confirmAndRunPlan(plan, { initiator: 'user', skipSpendConfirmation: true }) }] : []),
    ...sampleFinals.map(({ nodeId, sampleFinal }) => ({ nodeIds: [nodeId], send: confirmAndRunNode(nodeId, { initiator: 'user', sampleFinal }) })),
  ]
  const settled = await Promise.allSettled(sends.map(({ send }) => send))
  return settled.flatMap((result, index) => (result.status === 'rejected' ? sends[index].nodeIds.map((nodeId) => ({ nodeId, error: result.reason })) : []))
}
