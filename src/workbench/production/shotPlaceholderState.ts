// P4 S5 — 多镜节点的执行态派生（纯函数，可单测）。真相源 = Run 的 jobs[] + 计划（无第二真相）。
//
// 两条纪律：
// · **禁「永远等待生成」假进度**：状态只由 job 与「用户点过头没有」决定，不由「有没有 job」猜。
// · **还没点头 = 什么都不是**（2026-09-24 用户拍板）：草稿、报价卡还在等人、job 还停在人工门前、
//   这镜没被勾进这一批——节点就是一个还没生成的普通节点，不挂任何状态。以前这里把「没有 job」一律
//   说成「排队中」，Agent 按「先别生成」建的草稿因此显示「排队中 · 第 1/1」，读起来像已经在排队花钱。
//   「派出去了没有」的判据只有一份：`electron/shared/contracts/productionDispatch.ts`。
//
// 画法不在这里：生成中 / 排队中 / 失败 走普通节点那一套（`projectShotExecution` → 共享的等待面、状态行、
// 错误卡）；只有 Agent 批次独有的「已停」由 ProductionShotPlaceholder 画。
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { ProductionRun, ProductionJob, ProductionJobStatus, ProductionRunStatus } from '../../../electron/productionRun/productionRunTypes'
import { isNodeInDispatchedScope, jobAwaitsHuman } from '../../../electron/shared/contracts/productionDispatch'

export type ShotPlaceholderPhase = 'queued' | 'generating' | 'stopped' | 'failed' | 'done'

export type ShotPlaceholderState = {
  phase: ShotPlaceholderPhase
  /** stopped 的原因：预算触顶(halt) 还是用户急停(stop)。文案据此选（提额续拍 / 继续剩余）。 */
  stoppedReason?: 'budget' | 'stopped'
  /** failed 的人话原因（交给普通节点的错误卡去分类）。 */
  failureMessage?: string
}

// job.status → 执行态（与 batchScheduleDerivation 的 TERMINAL_DONE / in-flight 判据同一组状态）。
// 「排队中」不单列 set：过了人工门、又不在 generating/done/failed 里的（authorized / submit_intent_persisted …）落到排队。
const GENERATING_STATUSES = new Set<ProductionJobStatus>(['submitting', 'provider_accepted', 'polling', 'retry_wait', 'downloading', 'validating_technical', 'validating_content'])
const DONE_STATUSES = new Set<ProductionJobStatus>(['ready', 'adopted'])
const FAILED_STATUSES = new Set<ProductionJobStatus>(['needs_attention', 'cancelled_remote', 'too_late'])
// 「已停」而非「失败」的 job 错因：预算触顶 / 急停到达这镜（可续拍，warning 非 danger）。provider 拒 = 真失败。
const HALT_ERROR_CODES = new Set(['budget_exhausted', 'budget_halt', 'batch_stopped', 'restart_recovery_required'])

/** run 整体处于「停」的态：急停(pausing/paused/cancelled) 或预算 halt(needs_attention)。 */
function runIsStopped(status: ProductionRunStatus): boolean {
  return status === 'pausing' || status === 'paused' || status === 'cancelled' || status === 'needs_attention'
}

function jobForNode(run: ProductionRun, nodeId: string): ProductionJob | undefined {
  // 取该节点最新一 job（同 shotId 多 attempt 时按 createdAt 取新）。job.nodeId 是绑定单一真相。
  const jobs = run.jobs.filter((job) => job.nodeId === nodeId)
  if (jobs.length === 0) return undefined
  return jobs.reduce((latest, job) => (Date.parse(job.createdAt) >= Date.parse(latest.createdAt) ? job : latest))
}

/** P4 S6：占位/失败镜的返工要拿到该节点对应的 shotId（shots[].nodeId 是「shot ↔ 画布节点」单一真相）。 */
export function shotIdForNode(run: ProductionRun, nodeId: string): string | undefined {
  const shot = (run.generationPlan?.shots ?? []).find((candidate) => candidate.nodeId === nodeId)
  return shot?.shotId
}

/**
 * 派生一个节点（by nodeId）当前的执行态。`null` = 这个节点此刻没有任何执行态可说：
 * 用户还没点头（草稿 / 报价卡在等 / job 停在人工门前），或这镜不在已派出的这一批里。
 */
export function deriveShotPlaceholderState(run: ProductionRun | null, nodeId: string): ShotPlaceholderState | null {
  if (!run || !nodeId) return null
  const job = jobForNode(run, nodeId)

  if (job && jobAwaitsHuman(job.status)) return null
  if (job && DONE_STATUSES.has(job.status)) return { phase: 'done' }
  if (job && FAILED_STATUSES.has(job.status)) {
    // 区分「已停」vs「失败」：预算/急停错因（HALT_ERROR_CODES）或批被停/取消到达这镜 = 已停（可续拍，warning）；
    // provider 拒（有真错因）= 失败（danger）。run 整体已停 + 无真错因也算已停。
    const haltedByCode = job.errorCode !== undefined && HALT_ERROR_CODES.has(job.errorCode)
    const batchStopped = job.status === 'cancelled_remote' || job.status === 'too_late'
    if (haltedByCode || batchStopped || (job.status === 'needs_attention' && !job.errorCode && runIsStopped(run.status))) {
      return { phase: 'stopped', stoppedReason: haltedByCode && job.errorCode !== 'batch_stopped' ? 'budget' : run.status === 'needs_attention' ? 'budget' : 'stopped' }
    }
    return { phase: 'failed', ...(job.errorMessage ? { failureMessage: job.errorMessage } : {}) }
  }
  if (job && GENERATING_STATUSES.has(job.status)) return { phase: 'generating' }
  // 过了人工门、还没提交：真的在排队。
  if (job) return runIsStopped(run.status) ? { phase: 'stopped', stoppedReason: run.status === 'needs_attention' ? 'budget' : 'stopped' } : { phase: 'queued' }

  // 没有 job：只有在已经交给执行的范围里，才谈得上「排队」或「已停」。
  if (!isNodeInDispatchedScope(run, nodeId)) return null
  if (runIsStopped(run.status)) {
    return { phase: 'stopped', stoppedReason: run.status === 'needs_attention' ? 'budget' : 'stopped' }
  }
  return { phase: 'queued' }
}

/**
 * 把一个 Agent 批次镜的执行态**投影到节点上**，让普通节点那一套（等待面 / 状态行 / 错误卡）画它。
 *
 * 为什么是投影而不是写回 `node.status`：节点状态归画布的本地执行器管，写回去就是第二个写口
 * （任务中心会把它和 Run 行各算一遍、本地「停止」会去停一个它不拥有的任务）。这里只在**读**的那一刻换一副面孔。
 *
 * 本地执行器正在跑这个节点（用户在节点上自己点了生成）时，本地说了算；节点已经有结果时，结果说了算。
 */
export function projectShotExecution<T extends GenerationCanvasNode>(node: T, state: ShotPlaceholderState | null, failureFallback: string): T {
  if (!state || node.result?.url || node.status === 'running' || node.status === 'queued') return node
  if (state.phase === 'generating') return { ...node, status: 'running' }
  if (state.phase === 'queued') return { ...node, status: 'queued' }
  if (state.phase === 'failed') return { ...node, status: 'error', error: state.failureMessage || failureFallback }
  return node
}
