// W1.5 · production run 路径②的 qa 阶段审片判决（纯逻辑，DI 可裸测）。
// 方案：docs/plan/2026-08-19-w1-shot-verify-wiring.md §3「production run 路径②的对称落点」+ T10。
//
// driver 的 qa stage 把「本次已 adopted 的生成镜头」交给渲染层现成审片（verifyShotsAndReport，
// 复用同一纯核判分，不造第二份），拿回 per-shot 判决后：本模块把判决**塑形成 run 事件 message + 阶段摘要**
// （参照既有 artifact/gate 事件写法，不发明新形态体系）。qa 是「生成后判分呈现」，**不是新门**：
// 不弹确认、不改状态机；判分失败/渲染层不可达 → 诚实降级为「审片跳过」一条事件，绝不阻断 run。
//
// 纯净：零 electron/IPC 依赖（副作用点——发 IPC、写事件——留在 driver ops 里），本文件只做数据塑形。

import type { ProductionRun } from './productionRunTypes'
import { isAssessedShotReview, unreviewedShot, type ShotReviewAssessment } from '../shared/shotReviewEvidence'

/** A retry is deliberately one durable job per failing shot, never a batch replay. */
export type QaRetryPlan = {
  shotNodeId: string
  parentJobId: string
  retryCount: number
  retryReason: string
  retryDirective: string
  nextAttempt: number
  eligible: boolean
  blockedReason?: 'attempt_limit' | 'budget_exhausted'
}

/** 渲染层 production.verify-shots 回传的单镜判决（由 capabilityApplyHandler 从 shotVerify store 映射）。 */
export type QaShotVerdict = {
  shotNodeId: string
  /** Legacy responses without assessment remain unreviewed. */
  assessment?: ShotReviewAssessment
  /** 该镜是否通过（无低于阈值的维度）。 */
  passed: boolean
  /** 人话镜头标题（转述/事件显示用；缺省回落 shotNodeId）。 */
  shotTitle?: string
  /** 红标维度（仅 passed=false 时非空）。 */
  flagged?: Array<{ dimension?: string; dimensionName?: string; score?: number; reason?: string }>
}

/** 渲染层 production.verify-shots 的整体回传形状。 */
export type QaVerifyResponse = {
  requestedShotIds?: string[]
  /** 渲染层实际有画布节点、纳入审片的镜头 id（用于区分「审过 0 镜」= 跳过）。 */
  reviewedShotIds?: string[]
  /** per-shot 判决。 */
  verdicts?: QaShotVerdict[]
  /** 渲染层主动跳过（verify 关闭 / 无当前项目 / 无可审镜头）→ true。 */
  skipped?: boolean
  /** 跳过原因（人话，可空）。 */
  skipReason?: string
}

/** 一条要写进 run 的 qa 事件（driver 据此发 executeInternal('qa.verdict', {summary})）。 */
export type QaVerdictEvent = { summary: string }

/** qa 阶段塑形结果：per-shot 事件序列 + 一句话阶段摘要（盖到 qa stage.qaSummary 供投影读）。 */
export type QaStageOutcome = {
  events: QaVerdictEvent[]
  stageSummary: string
}

/** 本次 run 里「已 adopted 的生成镜头节点 id」（qa 审这些）。去重、保序、丢空 nodeId。 */
export function adoptedGenerationShotNodeIds(run: ProductionRun): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const job of run.jobs) {
    if (job.stageId !== 'generate' || job.status !== 'adopted') continue
    const nodeId = typeof job.nodeId === 'string' ? job.nodeId.trim() : ''
    if (!nodeId || seen.has(nodeId)) continue
    seen.add(nodeId)
    out.push(nodeId)
  }
  return out
}

function latestJobForShot(run: ProductionRun, shotNodeId: string): ProductionRun['jobs'][number] | undefined {
  return run.jobs
    .filter((job) => job.stageId === 'generate' && job.nodeId === shotNodeId)
    .sort((left, right) => (right.attempt - left.attempt) || right.updatedAt.localeCompare(left.updatedAt))[0]
}

function retryDirective(flags: NonNullable<QaShotVerdict['flagged']>): string {
  const dimensions = new Set(flags.map((flag) => (flag.dimensionName || flag.dimension || '').trim()).filter(Boolean))
  const fixes = Array.from(dimensions)
  const fixText = fixes.length ? fixes.join('、') : '审片标红的维度'
  return `【定向重滚】保持背景、光线与未标红的构图尽量不变，只修正：${fixText}。不要引入新人物或新场景。`
}

/**
 * Build a bounded retry plan from QA results. This is pure so the driver can persist the
 * decision before any provider call. `maxAttemptsPerJob` is the hard attempt ceiling; the
 * run-level ledger must also have one authorized unit left for each retry.
 */
export function buildQaRetryPlans(run: ProductionRun, verdicts: readonly QaShotVerdict[]): QaRetryPlan[] {
  const authorizedRemaining = run.budget.authorized - run.budget.reserved - run.budget.actual - run.budget.unsettled
  const maxAttempts = Math.max(0, Math.floor(Number(run.policy.maxAttemptsPerJob) || 0))
  const plans: QaRetryPlan[] = []
  for (const verdict of verdicts) {
    if (!isAssessedShotReview(verdict.assessment) || verdict.assessment?.shotNodeId !== verdict.shotNodeId) continue
    if (verdict.passed || !Array.isArray(verdict.flagged) || verdict.flagged.length === 0) continue
    const shotNodeId = typeof verdict.shotNodeId === 'string' ? verdict.shotNodeId.trim() : ''
    if (!shotNodeId) continue
    // Verifiers should return one verdict per shot. Treat duplicate rows as one retry
    // decision so a malformed response cannot reserve two budget units for one shot.
    if (plans.some((plan) => plan.shotNodeId === shotNodeId)) continue
    // A score of 0 means “not assessable”, not a low score; do not burn a retry on it.
    const lowFlags = verdict.flagged.filter((flag) => typeof flag.dimension === 'string' && verdict.assessment!.dimensions.includes(flag.dimension) && typeof flag.score === 'number' && Number.isFinite(flag.score) && flag.score > 0 && flag.score < 3)
    if (lowFlags.length === 0) continue
    const parent = latestJobForShot(run, shotNodeId)
    if (!parent) continue
    const previousRetryCount = Math.max(0, Math.floor(Number(parent.retryCount ?? parent.metadata?.retryCount) || 0))
    const retryCount = previousRetryCount + 1
    const retryReason = lowFlags
      .map((flag) => {
        const dimension = (flag.dimensionName || flag.dimension || '画面').trim()
        const score = typeof flag.score === 'number' && Number.isFinite(flag.score) ? `第 ${flag.score} 档` : '偏差'
        return `${dimension} ${score}${flag.reason?.trim() ? `：${flag.reason.trim()}` : ''}`
      })
      .join('；')
    const base = {
      shotNodeId,
      parentJobId: parent.jobId,
      retryCount,
      retryReason,
      retryDirective: retryDirective(lowFlags),
      nextAttempt: parent.attempt + 1,
    }
    if (retryCount > maxAttempts || base.nextAttempt > maxAttempts) {
      plans.push({ ...base, eligible: false, blockedReason: 'attempt_limit' })
      continue
    }
    if (authorizedRemaining < plans.filter((plan) => plan.eligible).length + 1) {
      plans.push({ ...base, eligible: false, blockedReason: 'budget_exhausted' })
      continue
    }
    plans.push({ ...base, eligible: true })
  }
  return plans
}

function verdictLine(verdict: QaShotVerdict): string {
  const label = (verdict.shotTitle && verdict.shotTitle.trim()) || verdict.shotNodeId
  if (!isAssessedShotReview(verdict.assessment)) return `${label}：未审片（${verdict.assessment?.reason || '缺少实际评估证据'}）`
  if (verdict.passed) return `${label}：审片通过`
  const flags = Array.isArray(verdict.flagged) ? verdict.flagged : []
  if (flags.length === 0) return `${label}：审片红标`
  const parts = flags.map((flag) => {
    const dim = (flag.dimensionName && flag.dimensionName.trim()) || (flag.dimension && flag.dimension.trim()) || '画面'
    const score = typeof flag.score === 'number' && Number.isFinite(flag.score) ? `第 ${flag.score} 档` : '偏差'
    const reason = flag.reason && flag.reason.trim() ? ` — ${flag.reason.trim()}` : ''
    return `${dim} ${score}${reason}`
  })
  return `${label}：审片红标（${parts.join('；')}）`
}

/**
 * 把渲染层审片回传塑形成 qa 阶段结果：
 * - 主动跳过 / 审过 0 镜 → 单条「审片跳过」事件 + 摘要（诚实降级，不误报为「全过」）。
 * - 有判决 → 每镜一条事件（过检 / 红标带维度理由）+ 「N 镜过检 · M 面红标」总览摘要。
 */
/** The Run supplies requested IDs; renderer omissions/duplicates cannot become implicit passes. */
export function qaVerdictsForRequestedShots(response: QaVerifyResponse | null | undefined, requested: readonly string[]): QaShotVerdict[] {
  return [...new Set(requested)].map(shotNodeId => {
    const matches = (Array.isArray(response?.verdicts) ? response.verdicts : []).filter(item => item.shotNodeId === shotNodeId)
    const verdict = matches.length === 1 ? matches[0] : undefined
    if (response?.skipped || !verdict || !isAssessedShotReview(verdict.assessment) || verdict.assessment?.shotNodeId !== shotNodeId) {
      return { shotNodeId, passed: false, assessment: unreviewedShot(shotNodeId, response?.skipReason || 'missing-or-invalid-assessment') }
    }
    return verdict
  })
}

export function buildQaStageOutcome(response: QaVerifyResponse | null | undefined): QaStageOutcome {
  const requested = response?.requestedShotIds ?? [...new Set([
    ...(Array.isArray(response?.reviewedShotIds) ? response.reviewedShotIds : []),
    ...(Array.isArray(response?.verdicts) ? response.verdicts.map(item => item.shotNodeId) : []),
  ])]
  if (!response || response.skipped || requested.length === 0) {
    const reason = response?.skipReason?.trim() || '本次未进行画面审片'
    return { events: [{ summary: '审片跳过：' + reason }], stageSummary: '审片跳过：' + reason }
  }
  const verdicts = qaVerdictsForRequestedShots(response, requested)
  const assessed = verdicts.filter(item => isAssessedShotReview(item.assessment))
  const unreviewed = verdicts.length - assessed.length
  const passedCount = assessed.filter(item => item.passed).length
  const flaggedVerdicts = assessed.filter(item => !item.passed)
  const events = verdicts.map(item => ({ summary: verdictLine(item) }))
  const flaggedDims = new Set(flaggedVerdicts.flatMap(item => (item.flagged ?? []).map(flag => flag.dimensionName?.trim() || flag.dimension?.trim()).filter(Boolean)))
  const scope = '（仅首帧与文字上下文）'
  const stageSummary = unreviewed === 0 && flaggedVerdicts.length === 0
    ? '审片完成：' + passedCount + ' 镜全部过检' + scope
    : '审片结果：' + passedCount + '/' + verdicts.length + ' 镜过检，' + flaggedVerdicts.length + ' 镜红标（' + (Array.from(flaggedDims).join('、') || '画面偏差') + '），' + unreviewed + ' 镜未审' + scope
  return { events, stageSummary }
}
