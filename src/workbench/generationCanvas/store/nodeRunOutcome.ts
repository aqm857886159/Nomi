// 节点「一次运行的结局」怎么落到节点上——唯一实现。
//
// 画布 store 的 addNodeResult / setNodeStatus 与「运行所属项目不在前台时按项目读写盘」的投递
// （runner/runProjectDelivery）共用这里：同一个结局，无论落进活的 store 还是关闭项目的盘上副本，
// 节点长得一样，不存在第二份合并规则。
import { textDocumentDigest } from '../runner/textGenerationDocument'
import { computeMediaMetaPatch, resolveNodeVisualSize, type MediaDimensions } from '../nodes/nodeSizing'
import type { GenerationCanvasNode, GenerationNodeResult, GenerationNodeRunRecord, GenerationNodeStatus, TiptapDocJson } from '../model/generationCanvasTypes'
import { createProgress, getResultTaskKind, mergeRunRecord, type NodeProgressInput } from './runRecordHelpers'
import { describeOpaqueFailure } from '../../observability/opaqueFailure'
import { appendNodeResultVersion } from '../model/nodeResultLifecycle'

export type NodeRunOutcome =
  | Readonly<{ kind: 'result'; result: GenerationNodeResult; mediaDimensions?: MediaDimensions }>
  | Readonly<{ kind: 'status'; status: GenerationNodeStatus; error?: string }>
  /** 一次运行开始（记录已规范化：id/startedAt/updatedAt/durationSeconds 已定）。 */
  | Readonly<{ kind: 'run-started'; run: GenerationNodeRunRecord }>
  /** 运行中的进度（含首次拿到的 taskId——找回靠它）；undefined = 清掉进度。 */
  | Readonly<{ kind: 'progress'; progress: NodeProgressInput | undefined }>
  /** 文本生成定稿后的文档（续写/重写落地）。 */
  | Readonly<{ kind: 'content'; contentJson: TiptapDocJson; runId?: string }>

type NodeRunOutcomePatch = Partial<Pick<GenerationCanvasNode, 'size' | 'meta' | 'runs' | 'result' | 'history' | 'resultVersionMax' | 'status' | 'error' | 'progress' | 'contentJson'>>

function resultPatch(node: GenerationCanvasNode, result: GenerationNodeResult, mediaDimensions?: MediaDimensions): NodeRunOutcomePatch {
  const latestRun = node.runs?.[0]
  const patch: NodeRunOutcomePatch = {}
  // Freeze the existing visual footprint before switching from placeholder to result.
  // Intrinsic media dimensions still update metadata; they cannot move the canvas on completion.
  if (latestRun && (latestRun.status === 'queued' || latestRun.status === 'running')) {
    const footprint = resolveNodeVisualSize(node)
    patch.size = footprint
    patch.meta = { ...node.meta, previewHeight: footprint.height }
  }
  const mediaMetaPatch = mediaDimensions
    ? computeMediaMetaPatch({ resultType: result.type, meta: patch.meta ?? node.meta ?? {}, ...mediaDimensions, durationSeconds: result.durationSeconds })
    : null
  if (mediaMetaPatch) patch.meta = mediaMetaPatch.meta
  const completedAt = result.createdAt || Date.now()
  patch.runs = latestRun
    ? [
        mergeRunRecord(latestRun, {
          status: 'success',
          taskId: result.taskId ?? latestRun.taskId,
          taskKind: getResultTaskKind(result) ?? latestRun.taskKind,
          assetId: result.assetId ?? latestRun.assetId,
          assetRefId: result.assetRefId ?? latestRun.assetRefId,
          resultId: result.id,
          raw: result.raw ?? latestRun.raw,
          completedAt,
          durationSeconds: result.durationSeconds ?? latestRun.durationSeconds,
          progress: undefined,
          error: undefined,
        }, completedAt),
        ...(node.runs || []).slice(1),
      ]
    : node.runs
  const landed = appendNodeResultVersion(node, result)
  patch.result = landed.result
  patch.history = landed.history
  patch.resultVersionMax = landed.resultVersionMax
  patch.status = 'success'
  patch.error = undefined
  patch.progress = undefined
  return patch
}

function statusPatch(node: GenerationCanvasNode, status: GenerationNodeStatus, error?: string): NodeRunOutcomePatch {
  const nextError = status === 'error' ? error || node.error || describeOpaqueFailure(null) : undefined
  const latestRun = node.runs?.[0]
  const runs = latestRun && latestRun.status !== 'success' && latestRun.status !== 'error' && latestRun.status !== 'cancelled'
    ? [mergeRunRecord(latestRun, { status: status === 'idle' ? 'cancelled' : status, error: nextError }), ...(node.runs || []).slice(1)]
    : node.runs
  return {
    status,
    error: nextError,
    progress: status === 'queued' || status === 'running' ? node.progress : undefined,
    runs,
  }
}

function runStartedPatch(node: GenerationCanvasNode, run: GenerationNodeRunRecord): NodeRunOutcomePatch {
  return {
    status: run.status === 'cancelled' ? 'idle' : run.status,
    error: run.status === 'error' ? run.error || node.error || describeOpaqueFailure(null) : undefined,
    progress: run.progress,
    runs: [run, ...(node.runs || []).filter((entry) => entry.id !== run.id)],
  }
}

function progressPatch(node: GenerationCanvasNode, progress: NodeProgressInput | undefined): NodeRunOutcomePatch {
  if (!progress) return { progress: undefined }
  const nextProgress = createProgress(progress, node.runs?.[0]?.id)
  const runs = node.runs?.length
    ? [
        mergeRunRecord(node.runs[0], {
          status: node.runs[0].status === 'queued' ? 'running' : node.runs[0].status,
          progress: nextProgress,
          taskId: nextProgress.taskId ?? node.runs[0].taskId,
          taskKind: nextProgress.taskKind ?? node.runs[0].taskKind,
        }, nextProgress.updatedAt),
        ...node.runs.slice(1),
      ]
    : node.runs
  return {
    status: node.status === 'queued' ? 'running' : node.status || 'running',
    error: undefined,
    progress: nextProgress,
    runs,
  }
}

/** 这个结局落到节点上要改哪些字段（store 用 Object.assign 应用到草稿；盘上副本 spread 成新节点）。 */
export function nodeRunOutcomePatch(node: GenerationCanvasNode, outcome: NodeRunOutcome): NodeRunOutcomePatch {
  switch (outcome.kind) {
    case 'result': return resultPatch(node, outcome.result, outcome.mediaDimensions)
    case 'status': return statusPatch(node, outcome.status, outcome.error)
    case 'run-started': return runStartedPatch(node, outcome.run)
    case 'progress': return progressPatch(node, outcome.progress)
    case 'content': {
      const run = node.runs?.[0]
      if (outcome.runId && run?.id !== outcome.runId) throw new Error('generation_run_changed')
      return { contentJson: outcome.contentJson,
        ...(outcome.runId && run ? { runs: [{ ...run, textDocumentDigest: textDocumentDigest(outcome.contentJson) }, ...node.runs!.slice(1)] } : {}),
      }
    }
  }
}

/**
 * 落地 = 系统事实，不是用户编辑：生成结果 / 文本定稿。整写的门（撤销 / 重做、外部写、放回节点）怎么对待它们，
 * 只由画布写边界的统一提交口决定（store/canvasDocumentCommit.ts）。
 */
export type LandedNodeOutcome =
  | Extract<NodeRunOutcome, { kind: 'result' }>
  /** 文本定稿记账不带 runId：重新叠回时不再校验「当时那次运行」。 */
  | Readonly<{ kind: 'content'; contentJson: TiptapDocJson }>

/**
 * 节点不在时到达的结局（生成中被删了——删节点不取消上游任务，钱已花）：按 nodeId 暂存在 store，
 * 任何一扇门把节点带回来时由统一提交口按顺序落上去。除了落地，运行开始 / 结束状态也要记——节点回来时它的运行态只能从这里来。
 */
export type HeldNodeOutcome =
  | LandedNodeOutcome
  | Extract<NodeRunOutcome, { kind: 'status' }>
  | Extract<NodeRunOutcome, { kind: 'run-started' }>

/** Reapply every system-owned outcome in arrival order when a node returns to the document. */
export function reapplyLandedOutcomes(
  node: GenerationCanvasNode,
  outcomes: readonly HeldNodeOutcome[],
): GenerationCanvasNode {
  return outcomes.reduce<GenerationCanvasNode>(
    (current, outcome) => ({ ...current, ...nodeRunOutcomePatch(current, outcome) }),
    node,
  )
}
