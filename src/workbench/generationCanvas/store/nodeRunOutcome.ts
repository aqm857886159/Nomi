// 节点「一次运行的结局」怎么落到节点上——唯一实现。
//
// 画布 store 的 addNodeResult / setNodeStatus 与「运行所属项目不在前台时按项目读写盘」的投递
// （runner/runProjectDelivery）共用这里：同一个结局，无论落进活的 store 还是关闭项目的盘上副本，
// 节点长得一样，不存在第二份合并规则。
//
// 归属（docs/plan/2026-11-07-shot-result-ownership.md）：运行记录是正本，每个结局按自己的运行记录号找自己那条；
// 节点显示（status / error / progress）是从记录算出来的投影。没有「只认第一条」，被拒 / 取消不回滚快照。
import { textDocumentDigest } from '../runner/textGenerationDocument'
import { computeMediaMetaPatch, resolveNodeVisualSize, type MediaDimensions } from '../nodes/nodeSizing'
import type { GenerationCanvasNode, GenerationNodeResult, GenerationNodeRunRecord, GenerationNodeStatus, TiptapDocJson } from '../model/generationCanvasTypes'
import { createProgress, getResultTaskKind, mergeRunRecord, type NodeProgressInput } from './runRecordHelpers'
import { describeOpaqueFailure } from '../../observability/opaqueFailure'
import { appendNodeResultVersion } from '../model/nodeResultLifecycle'
import { isProductionRunRecord } from '../../../../electron/shared/productionShotPhase'

export type NodeRunOutcome = (
  | Readonly<{ kind: 'result'; result: GenerationNodeResult; mediaDimensions?: MediaDimensions }>
  | Readonly<{ kind: 'status'; status: GenerationNodeStatus; error?: string }>
  /** 这次运行成立了（记录已规范化：id/startedAt/updatedAt/durationSeconds 已定）：按开始时间插进运行记录。
   *  花钱的那条路只在主进程的准入回执到了才发它；不花钱的本地 / 文本运行开始即发。 */
  | Readonly<{ kind: 'run-started'; run: GenerationNodeRunRecord }>
  /** 花钱的点击、主进程还没准入：只在节点显示上写「排队中」（进度带这次的号），不写运行记录。 */
  | Readonly<{ kind: 'attempt-started'; progress: NodeProgressInput }>
  /** 主进程拒了这一下：它从来不是一次运行。不写记录；它占着显示的话，显示按记录重算。 */
  | Readonly<{ kind: 'attempt-refused'; runId: string }>
  /** 运行中的进度（含首次拿到的 taskId——找回靠它）；undefined = 清掉进度。 */
  | Readonly<{ kind: 'progress'; progress: NodeProgressInput | undefined }>
  /** 文本生成定稿后的文档（续写/重写落地）。 */
  | Readonly<{ kind: 'content'; contentJson: TiptapDocJson; runId?: string }>

) & Readonly<{ runId?: string }>

type NodeRunOutcomePatch = Partial<Pick<GenerationCanvasNode, 'size' | 'meta' | 'runs' | 'result' | 'history' | 'resultVersionMax' | 'status' | 'error' | 'progress' | 'contentJson'>>
type NodeDisplay = Pick<GenerationCanvasNode, 'status' | 'error' | 'progress'>
type Runs = readonly GenerationNodeRunRecord[]

const isLiveRun = (run: GenerationNodeRunRecord | undefined): boolean => run?.status === 'queued' || run?.status === 'running'
const isEndedRun = (run: GenerationNodeRunRecord | undefined): boolean => run?.status === 'success' || run?.status === 'error' || run?.status === 'cancelled'

/** 运行记录新的在前，按开始时间排：晚拿到准入回执的老运行排在比它新的运行后面（同号的旧条目换掉）。 */
function insertRun(runs: Runs, run: GenerationNodeRunRecord): GenerationNodeRunRecord[] {
  const rest = runs.filter((entry) => entry.id !== run.id)
  const index = rest.findIndex((entry) => (entry.startedAt ?? 0) <= (run.startedAt ?? 0))
  return index < 0 ? [...rest, run] : [...rest.slice(0, index), run, ...rest.slice(index)]
}

function replaceRun(runs: Runs, index: number, run: GenerationNodeRunRecord): GenerationNodeRunRecord[] {
  return runs.map((entry, at) => at === index ? run : entry)
}

/** 在跑、且比它新的记录里没有成功的那条（D5）：它说了算。 */
function displayOwningRun(runs: Runs): GenerationNodeRunRecord | undefined {
  const liveIndex = runs.findIndex(isLiveRun)
  if (liveIndex < 0) return undefined
  const successIndex = runs.findIndex((run) => run.status === 'success')
  return successIndex >= 0 && successIndex < liveIndex ? undefined : runs[liveIndex]
}

/** 点下去、主进程还没准入的那一下正占着显示（进度带它的号，记录里没有它）。 */
function optimisticAttempt(node: Pick<GenerationCanvasNode, 'status' | 'progress'>, runs: Runs): string | undefined {
  const runId = node.progress?.runId
  if (!runId || (node.status !== 'queued' && node.status !== 'running')) return undefined
  return runs.some((run) => run.id === runId) ? undefined : runId
}

/** 有人在跑（在跑的记录，或乐观占着的那一下）时的显示；没有 = null。 */
function liveDisplay(node: Pick<GenerationCanvasNode, 'status' | 'error' | 'progress'>, runs: Runs): NodeDisplay | null {
  const owner = displayOwningRun(runs)
  if (owner) {
    return {
      status: owner.status === 'queued' ? 'queued' : 'running',
      error: undefined,
      progress: owner.progress ?? (node.progress?.runId === owner.id ? node.progress : undefined),
    }
  }
  if (optimisticAttempt(node, runs)) return { status: node.status, error: undefined, progress: node.progress }
  return null
}

/** 节点显示从运行记录算（D5）：在跑的说了算；没有在跑的，最新那条记录说了算。 */
export function projectNodeDisplay(node: Pick<GenerationCanvasNode, 'status' | 'error' | 'progress' | 'result'>, runs: Runs): NodeDisplay {
  const live = liveDisplay(node, runs)
  if (live) return live
  const latest = runs[0]
  if (!latest) return { status: node.result ? 'success' : 'idle', error: undefined, progress: undefined }
  if (latest.status === 'success') return { status: 'success', error: undefined, progress: undefined }
  if (latest.status === 'error') return { status: 'error', error: latest.error || describeOpaqueFailure(null), progress: undefined }
  if (latest.status === 'recoverable') return { status: 'recoverable', error: latest.error || undefined, progress: undefined }
  return { status: 'idle', error: undefined, progress: undefined }
}

/** Percent, narration and observation clocks are transient; task identity and takeover survive restart. */
export function nodeProgressChangesRecovery(node: GenerationCanvasNode, patch: NodeRunOutcomePatch): boolean {
  if (patch.status !== undefined && patch.status !== node.status) return true
  if (patch.runs && patch.runs !== node.runs) {
    const before = new Map((node.runs || []).map((run) => [run.id, run]))
    if (patch.runs.length !== before.size) return true
    const changed = patch.runs.some((run) => {
      const previous = before.get(run.id)
      return !previous || previous.status !== run.status || previous.taskId !== run.taskId || previous.taskKind !== run.taskKind
    })
    if (changed) return true
  }
  const progress = patch.progress
  if (!progress) return false
  const owner = node.runs?.find((run) => run.id === progress.runId)
  return (progress.runId !== undefined && progress.runId !== (node.progress?.runId ?? owner?.id))
    || (progress.taskId !== undefined && progress.taskId !== (node.progress?.taskId ?? owner?.taskId))
    || (progress.taskKind !== undefined && progress.taskKind !== (node.progress?.taskKind ?? owner?.taskKind))
}

/**
 * 结果永远进这一镜（钱花了，D4）：带号的结果按号结掉自己那条记录；不带号的只结掉在跑的制作记录（D6），别的记录一个字不动。
 * 比它新的运行已经成功了 → 只进版本历史，当前图不动（时间轴据此不对账）；否则成为当前图。
 */
function resultPatch(node: GenerationCanvasNode, result: GenerationNodeResult, mediaDimensions: MediaDimensions | undefined, runId: string | undefined): NodeRunOutcomePatch {
  const runs = node.runs || []
  const index = runId ? runs.findIndex((run) => run.id === runId) : runs.findIndex((run) => isLiveRun(run) && isProductionRunRecord(run))
  const target = index >= 0 ? runs[index] : undefined
  const patch: NodeRunOutcomePatch = {}
  // Freeze the existing visual footprint before switching from placeholder to result.
  // Intrinsic media dimensions still update metadata; they cannot move the canvas on completion.
  if (node.status === 'queued' || node.status === 'running' || isLiveRun(target)) {
    const footprint = resolveNodeVisualSize(node)
    patch.size = footprint
    patch.meta = { ...node.meta, previewHeight: footprint.height }
  }
  const mediaMetaPatch = mediaDimensions
    ? computeMediaMetaPatch({ resultType: result.type, meta: patch.meta ?? node.meta ?? {}, ...mediaDimensions, durationSeconds: result.durationSeconds })
    : null
  if (mediaMetaPatch) patch.meta = mediaMetaPatch.meta
  const completedAt = result.createdAt || Date.now()
  const nextRuns = target
    ? replaceRun(runs, index, mergeRunRecord(target, {
        status: 'success',
        taskId: result.taskId ?? target.taskId,
        taskKind: getResultTaskKind(result) ?? target.taskKind,
        assetId: result.assetId ?? target.assetId,
        assetRefId: result.assetRefId ?? target.assetRefId,
        resultId: result.id,
        raw: result.raw ?? target.raw,
        completedAt,
        durationSeconds: result.durationSeconds ?? target.durationSeconds,
        progress: undefined,
        error: undefined,
      }, completedAt))
    : node.runs
  if (nextRuns !== node.runs) patch.runs = nextRuns
  const landed = appendNodeResultVersion(node, result)
  patch.history = landed.history
  patch.resultVersionMax = landed.resultVersionMax
  const superseded = index > 0 && runs.slice(0, index).some((run) => run.status === 'success')
  if (superseded) return { ...patch, ...projectNodeDisplay(node, nextRuns || []) }
  patch.result = landed.result
  return { ...patch, ...(liveDisplay(node, nextRuns || []) ?? { status: 'success', error: undefined, progress: undefined }) }
}

/**
 * 结局附带的原因：失败要有原因（没给就用兜底句），**可找回也要留下传进来的那句**——那是最后一次取回
 * 失败的原话（HTTP 503 无可用渠道 / 404 / 出站被拦……），各有各的下一步。以前这里只给 error 留，
 * 可找回一律置空：面板无从显示、节点不落盘、运行记录也没有，用户截图里一点证据都没有（#1213）。
 * 可找回没给原因就是没有（纯等待超时），不编兜底句。
 */
function outcomeError(node: GenerationCanvasNode, status: GenerationNodeStatus, error?: string): string | undefined {
  if (status === 'error') return error || node.error || describeOpaqueFailure(null)
  if (status === 'recoverable') return error || undefined
  return undefined
}

/** 带号：只改这次自己那条（已结束的不改），显示按记录算。不带号：改最新那条没结束的，显示照给的（D6）。 */
function statusPatch(node: GenerationCanvasNode, status: GenerationNodeStatus, error: string | undefined, runId: string | undefined): NodeRunOutcomePatch {
  const nextError = outcomeError(node, status, error)
  const runs = node.runs || []
  const index = runId ? runs.findIndex((run) => run.id === runId) : runs.findIndex((run) => !isEndedRun(run))
  const target = index >= 0 ? runs[index] : undefined
  const nextRuns = target && !isEndedRun(target)
    ? replaceRun(runs, index, mergeRunRecord(target, { status: status === 'idle' ? 'cancelled' : status, error: nextError }))
    : node.runs
  if (!runId) return { status, error: nextError, progress: status === 'queued' || status === 'running' ? node.progress : undefined, runs: nextRuns }
  if (target) return { ...projectNodeDisplay(node, nextRuns || []), runs: nextRuns }
  // 记录里没有这个号：只有点下去还没准入、正占着显示的那一下能动显示。
  return optimisticAttempt(node, runs) === runId ? { status, error: nextError, progress: undefined } : {}
}

function runStartedPatch(node: GenerationCanvasNode, run: GenerationNodeRunRecord): NodeRunOutcomePatch {
  const runs = insertRun(node.runs || [], run)
  return { ...projectNodeDisplay(node, runs), runs }
}

function attemptStartedPatch(node: GenerationCanvasNode, progress: NodeProgressInput): NodeRunOutcomePatch {
  // 已经有一次在跑：它说了算，这一下等主进程的回话。
  if (displayOwningRun(node.runs || [])) return {}
  return { status: 'queued', error: undefined, progress: createProgress(progress) }
}

function attemptRefusedPatch(node: GenerationCanvasNode, runId: string): NodeRunOutcomePatch {
  if (node.progress?.runId !== runId) return {}
  return projectNodeDisplay({ ...node, progress: undefined }, node.runs || [])
}

/** 进度按号收账（D2）：只写在跑的那条记录；显示只在这次正占着显示时跟着动。不带号的进度（本机处理、取回）落在跑的那条。 */
function progressPatch(node: GenerationCanvasNode, progress: NodeProgressInput | undefined, outcomeRunId: string | undefined): NodeRunOutcomePatch {
  if (!progress) return { progress: undefined }
  const runs = node.runs || []
  const runId = progress.runId ?? outcomeRunId ?? runs.find(isLiveRun)?.id
  const nextProgress = createProgress(progress, runId)
  const index = runId ? runs.findIndex((run) => run.id === runId) : -1
  const target = index >= 0 ? runs[index] : undefined
  const owner = displayOwningRun(runs)
  const nextStatus = node.status === 'queued' ? 'running' : node.status || 'running'
  if (target) {
    if (!isLiveRun(target)) return {}
    const nextRuns = replaceRun(runs, index, mergeRunRecord(target, {
      status: target.status === 'queued' ? 'running' : target.status,
      progress: nextProgress,
      taskId: nextProgress.taskId ?? target.taskId,
      taskKind: nextProgress.taskKind ?? target.taskKind,
    }, nextProgress.updatedAt))
    if (owner?.id !== target.id) return { runs: nextRuns }
    return { status: 'running', error: undefined, progress: nextProgress, runs: nextRuns }
  }
  if (!runId) return { status: nextStatus, error: undefined, progress: nextProgress }
  // 记录里没有这个号：只有点下去还没准入、正占着显示的那一下能动显示。
  if (node.progress?.runId === runId && !owner) return { status: nextStatus, error: undefined, progress: nextProgress }
  return {}
}

/** 这个结局落到节点上要改哪些字段（store 用 Object.assign 应用到草稿；盘上副本 spread 成新节点）。 */
export function nodeRunOutcomePatch(node: GenerationCanvasNode, outcome: NodeRunOutcome): NodeRunOutcomePatch {
  switch (outcome.kind) {
    case 'result': return resultPatch(node, outcome.result, outcome.mediaDimensions, outcome.runId)
    case 'status': return statusPatch(node, outcome.status, outcome.error, outcome.runId)
    case 'run-started': return runStartedPatch(node, outcome.run)
    case 'attempt-started': return attemptStartedPatch(node, outcome.progress)
    case 'attempt-refused': return attemptRefusedPatch(node, outcome.runId)
    case 'progress': return progressPatch(node, outcome.progress, outcome.runId)
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
 * 任何一扇门把节点带回来时由统一提交口按顺序落上去。除了落地，运行开始 / 结束状态、被拒也要记——节点回来时它的运行态只能从这里来。
 */
export type HeldNodeOutcome =
  | LandedNodeOutcome
  | Extract<NodeRunOutcome, { kind: 'status' }>
  | Extract<NodeRunOutcome, { kind: 'run-started' }>
  | Extract<NodeRunOutcome, { kind: 'attempt-refused' }>

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
