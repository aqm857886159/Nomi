// 依赖波次的执行层：把 `DependencyWavePlan` 按波次交给既有的 `runGenerationNodesBatch`，
// 上游失败就显式挡住下游（不裸跑、不死等）。
//
// 为什么单独一个文件：`generationRunController.ts` 是「一个节点怎么跑完」的 owner，
// 这里是「一批节点按什么顺序跑」的 owner —— 两件事，分开之后控制器回到 800 行门岗之内
// （R9）。**没有在旧文件留 re-export**：留了就是 P1 说的逃生口，两个入口迟早各长一份。
import { withdrawCanvasShots } from '../../api/taskApi'
import { deliverRunOutcome, readRunGraph } from './runProjectDelivery'
import { describeOpaqueFailure } from '../../observability/opaqueFailure'
import { useGenerationQueueStore } from './generationQueueStore'
import type { DependencyWavePlan } from './dependencyWaves'
import {
  runGenerationNodesBatch,
  type RunGenerationNodesBatchOptions,
  type RunGenerationNodesBatchResult,
} from './generationRunController'

/** Execute dependency waves through the original batch runner; failed upstreams block downstreams.
 * @legacy-batch-frozen (P4 S7): fixes only; new batch capabilities belong to the semantic scheduler. */
export async function runGenerationNodesByPlan(
  plan: DependencyWavePlan,
  options: RunGenerationNodesBatchOptions,
): Promise<RunGenerationNodesBatchResult> {
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
  // Register all waves and blocked nodes together so queued work remains visible in the task center.
  const batchId = useGenerationQueueStore
    .getState()
    .enqueueBatch([...plan.waves, plan.blocked.map((blocked) => blocked.nodeId)], options.target.projectId)
  if (options.canvasRunRecordIds?.size) useGenerationQueueStore.getState().attachCanvasConsent(batchId, options.canvasRunRecordIds)
  const runOptions: RunGenerationNodesBatchOptions = { ...options, batchId }
  try {
    const failNode = async (nodeId: string, message: string) => {
      const error = new Error(message)
      await deliverRunOutcome(options.target, nodeId, { kind: 'status', status: 'error', error: message })
      // 「上游缺果/成环」与「上游本批失败的连带」都不是模型挂了 → 不进刹车计数，否则一个上游失败
      // 会把下游连锁标失败、瞬间凑满 3 个，误停整条队列。
      useGenerationQueueStore.getState().markSettled(batchId, nodeId, 'error', { error: message, countsTowardBrake: false })
      failures.push({ nodeId, error })
      options.onNodeResult?.({ ok: false, nodeId, error })
    }
    // Missing prerequisites keep nodes idle and settle the unsubmitted queue entry as cancelled;
    // they neither count toward the failure brake nor enter paid retry. The existing notice explains why.
    const waitNode = async (nodeId: string) => {
      await deliverRunOutcome(options.target, nodeId, { kind: 'status', status: 'idle' })
      useGenerationQueueStore.getState().markSettled(batchId, nodeId, 'cancelled', { countsTowardBrake: false })
    }
    const isWaitingReason = (reason: DependencyWavePlan['blocked'][number]['reason']): boolean =>
      reason === 'unfrozen-anchor' || reason === 'missing-upstream'
    for (const blocked of plan.blocked) {
      if (isWaitingReason(blocked.reason)) await waitNode(blocked.nodeId)
      else await failNode(blocked.nodeId, blocked.detail) // cycle 等结构错误 = 真失败桶（红），可单独处理
    }

    const plannedIds = new Set(plan.waves.flat())
    const internalDeps = new Map<string, string[]>()
    for (const edge of plan.edgesUsed) {
      if (!plannedIds.has(edge.source) || !plannedIds.has(edge.target)) continue
      internalDeps.set(edge.target, [...(internalDeps.get(edge.target) ?? []), edge.source])
    }

    const failedIds = new Set(plan.blocked.map((blocked) => blocked.nodeId))
    for (const wave of plan.waves) {
      // 上游本批失败 → 下游显式失败(不裸跑、不死等),其余照常并行。
      const runnable: string[] = []
      for (const nodeId of wave) {
        const failedDep = (internalDeps.get(nodeId) ?? []).find((dep) => failedIds.has(dep))
        if (failedDep) {
          failedIds.add(nodeId)
          const depTitle =
            (await readRunGraph(options.target))?.nodes.find((node) => node.id === failedDep)?.title || failedDep
          await failNode(nodeId, `上游「${depTitle}」本批生成失败,本节点未执行`)
        } else {
          runnable.push(nodeId)
        }
      }
      if (runnable.length === 0) continue
      const result = await runGenerationNodesBatch(runnable, runOptions)
      successes.push(...result.successes)
      for (const failure of result.failures) {
        failedIds.add(failure.nodeId)
        failures.push(failure)
      }
    }
    return { totalCount: plan.waves.flat().length + plan.blocked.length, successes, failures }
  } catch (error) {
    for (const entry of useGenerationQueueStore.getState().entries.filter(item => item.batchId === batchId && item.state === 'queued')) {
      useGenerationQueueStore.getState().markSettled(batchId, entry.nodeId, 'error', {
        error: describeOpaqueFailure(error), countsTowardBrake: false,
      })
    }
    throw error
  } finally {
    // 卡上点过确认、这一批跑完都没轮到的（上游失败、缺料、刹车后取消）：收回出价。已经交了的主进程不动它。
    if (options.canvasRunRecordIds?.size) {
      withdrawCanvasShots({ projectId: options.target.projectId, runRecordIds: [...options.canvasRunRecordIds.values()], by: 'stopped' })
    }
    useGenerationQueueStore.getState().finishBatch(batchId)
  }
}