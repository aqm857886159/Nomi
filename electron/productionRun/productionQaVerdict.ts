// W1.5 · production run 路径②的 qa 阶段审片判决（纯逻辑，DI 可裸测）。
// 方案：docs/plan/2026-08-19-w1-shot-verify-wiring.md §3「production run 路径②的对称落点」+ T10 + 三态诚实审片升级。
//
// driver 的 qa stage 把「本次已 adopted 的生成镜头」交给渲染层现成审片（verifyShotsAndReport，
// 复用同一纯核判分，不造第二份），拿回 per-shot 三态判决（passed | flagged | unverified）后：
// 本模块把判决塑形成 run 事件 message + 阶段摘要（qaSummary + 结构化 qaReport）。
// qa 是「生成后判分呈现」，不是新门：不弹确认、不改状态机；
// 视觉不可用 / 抽帧失败 / 判分异常一律照实回报 unverified，绝不冒充「全部过检」，也不触发花钱重滚。
//
// 纯净：零 electron/IPC 依赖（副作用点——发 IPC、写事件——留在 driver ops 里），本文件只做数据塑形。

import type {
  ProductionRun,
  QaShotUnverifiedReason,
  QaShotVerdictStatus,
  QaStageReport,
} from './productionRunTypes'
import { latestJobForShot } from '../shared/productionShotJobs'

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

/** 渲染层 production.verify-shots 回传的单镜判决（三态：passed / flagged / unverified）。 */
export type QaShotVerdict = {
  shotNodeId: string
  /** 显式三态；老记录无此字段时按 passed 布尔兼容回落（passed=true→passed，false→flagged）。 */
  status?: QaShotVerdictStatus
  /** 兼容布尔：仅当真实审过且无偏离（passed）时为 true；flagged 与 unverified 均为 false。 */
  passed: boolean
  /** 人话镜头标题（转述/事件显示用；缺省回落 shotNodeId）。 */
  shotTitle?: string
  /** 红标维度（仅 status='flagged' 时非空）。 */
  flagged?: Array<{ dimension?: string; dimensionName?: string; score?: number; reason?: string }>
  /** 未校验原因（仅 status='unverified' 时填写）。 */
  unverifiedReason?: QaShotUnverifiedReason
}

/** 渲染层 production.verify-shots 的整体回传形状。 */
export type QaVerifyResponse = {
  /** 渲染层实际有画布节点、纳入审片的镜头 id（用于区分「审过 0 镜」= 跳过）。 */
  reviewedShotIds?: string[]
  /** per-shot 三态判决。 */
  verdicts?: QaShotVerdict[]
  /** 渲染层主动跳过（verify 关闭 / 无当前项目 / 无可审镜头）→ true。 */
  skipped?: boolean
  /** 跳过原因（人话，可空）。 */
  skipReason?: string
}

/** 一条要写进 run 的 qa 事件（driver 据此发 executeInternal('qa.verdict', {summary})）。 */
export type QaVerdictEvent = { summary: string }

/** qa 阶段塑形结果：per-shot 事件序列 + 一句话阶段摘要 + 结构化三态报告（供 UI 国际化展示）。 */
export type QaStageOutcome = {
  events: QaVerdictEvent[]
  stageSummary: string
  qaReport: QaStageReport
}

const UNVERIFIED_REASON_ZH: Readonly<Record<QaShotUnverifiedReason, string>> = {
  vision_unavailable: '当前模型不支持看图',
  missing_frame_source: '缺少可校验画面',
  frame_extract_failed: '视频抽帧失败',
  judge_failed: '审片请求失败',
  invalid_verdict_json: '审片结果无法解析',
}

/** 唯一三态解析器：显式 status 优先；兼容老盘上仅带 passed 布尔的历史记录。 */
export function resolveQaVerdictStatus(verdict: QaShotVerdict): QaShotVerdictStatus {
  if (verdict.status === 'passed' || verdict.status === 'flagged' || verdict.status === 'unverified') {
    return verdict.status
  }
  return verdict.passed ? 'passed' : 'flagged'
}

function unverifiedReasonLabel(reason: QaShotUnverifiedReason | undefined): string {
  return (reason && UNVERIFIED_REASON_ZH[reason]) || '未能完成画面校验'
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
 * Only genuinely `flagged` shots are eligible; `passed` and `unverified` shots never burn retry budget.
 */
export function buildQaRetryPlans(run: ProductionRun, verdicts: readonly QaShotVerdict[]): QaRetryPlan[] {
  const authorizedRemaining = run.budget.authorized - run.budget.reserved - run.budget.actual - run.budget.unsettled
  const maxAttempts = Math.max(0, Math.floor(Number(run.policy.maxAttemptsPerJob) || 0))
  const plans: QaRetryPlan[] = []
  for (const verdict of verdicts) {
    if (resolveQaVerdictStatus(verdict) !== 'flagged' || !Array.isArray(verdict.flagged) || verdict.flagged.length === 0) continue
    const shotNodeId = typeof verdict.shotNodeId === 'string' ? verdict.shotNodeId.trim() : ''
    if (!shotNodeId) continue
    // Verifiers should return one verdict per shot. Treat duplicate rows as one retry
    // decision so a malformed response cannot reserve two budget units for one shot.
    if (plans.some((plan) => plan.shotNodeId === shotNodeId)) continue
    // A score of 0 means “not assessable”, not a low score; do not burn a retry on it.
    const lowFlags = verdict.flagged.filter((flag) => typeof flag.score !== 'number' || (flag.score > 0 && flag.score < 3))
    if (lowFlags.length === 0) continue
    const parent = latestJobForShot(run, { nodeId: shotNodeId })
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
  const status = resolveQaVerdictStatus(verdict)
  if (status === 'passed') return `${label}：审片通过`
  if (status === 'unverified') return `${label}：未校验（${unverifiedReasonLabel(verdict.unverifiedReason)}）`
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
 * 把渲染层审片回传塑形成 qa 阶段结果（严格三态）：
 * - 主动跳过 / 审过 0 镜 → 单条「审片跳过」事件 + 摘要；
 * - 全部真审过且无偏离（passed === total）→ 「审片完成：N 镜全部过检」；
 * - 全部未校验（unverified === total）→ 「审片未完成：N 镜未校验（原因）」，绝不冒充过检；
 * - 部分过检 / 红标 / 未校验混合 → 照实列出过检数、红标维度与未校验数及原因。
 */
export function buildQaStageOutcome(response: QaVerifyResponse | null | undefined): QaStageOutcome {
  const reviewed = Array.isArray(response?.reviewedShotIds) ? response!.reviewedShotIds! : []
  const verdicts = Array.isArray(response?.verdicts) ? response!.verdicts! : []

  if (!response || response.skipped || (reviewed.length === 0 && verdicts.length === 0)) {
    const reason = (response?.skipReason && response.skipReason.trim()) || '本次未进行画面审片'
    return {
      events: [{ summary: `审片跳过：${reason}` }],
      stageSummary: `审片跳过：${reason}`,
      qaReport: {
        total: 0,
        passedCount: 0,
        flaggedCount: 0,
        unverifiedCount: 0,
        skipped: true,
        skipReason: reason,
      },
    }
  }

  const passedVerdicts = verdicts.filter((v) => resolveQaVerdictStatus(v) === 'passed')
  const flaggedVerdicts = verdicts.filter((v) => resolveQaVerdictStatus(v) === 'flagged')
  const unverifiedVerdicts = verdicts.filter((v) => resolveQaVerdictStatus(v) === 'unverified')
  const passedCount = passedVerdicts.length
  const flaggedCount = flaggedVerdicts.length
  const unverifiedCount = unverifiedVerdicts.length
  const total = verdicts.length

  const events = verdicts.map((v) => ({ summary: verdictLine(v) }))
  const flaggedDims = new Set<string>()
  for (const v of flaggedVerdicts) {
    for (const flag of v.flagged ?? []) {
      const dim = (flag.dimensionName && flag.dimensionName.trim()) || (flag.dimension && flag.dimension.trim())
      if (dim) flaggedDims.add(dim)
    }
  }
  const unverifiedReasons = new Set<QaShotUnverifiedReason>()
  for (const v of unverifiedVerdicts) {
    if (v.unverifiedReason) unverifiedReasons.add(v.unverifiedReason)
  }
  const flaggedDimList = Array.from(flaggedDims)
  const unverifiedReasonList = Array.from(unverifiedReasons)
  const dimText = flaggedDimList.join('、') || '画面偏差'
  const reasonText = unverifiedReasonList.length > 0
    ? unverifiedReasonList.map((r) => UNVERIFIED_REASON_ZH[r]).join('、')
    : '未能完成画面校验'

  let stageSummary: string
  if (flaggedCount === 0 && unverifiedCount === 0) {
    stageSummary = `审片完成：${total} 镜全部过检`
  } else if (unverifiedCount === total) {
    stageSummary = `审片未完成：${total} 镜未校验（${reasonText}）`
  } else if (flaggedCount === 0) {
    stageSummary = `审片部分完成：${passedCount}/${total} 镜过检，${unverifiedCount} 镜未校验（${reasonText}）`
  } else if (unverifiedCount === 0) {
    stageSummary = `审片完成：${passedCount}/${total} 镜过检，${flaggedCount} 镜红标（${dimText}）`
  } else {
    stageSummary = `审片完成：${passedCount}/${total} 镜过检，${flaggedCount} 镜红标（${dimText}），${unverifiedCount} 镜未校验（${reasonText}）`
  }

  return {
    events,
    stageSummary,
    qaReport: {
      total,
      passedCount,
      flaggedCount,
      unverifiedCount,
      ...(flaggedDimList.length ? { flaggedDimensions: flaggedDimList } : {}),
      ...(unverifiedReasonList.length ? { unverifiedReasons: unverifiedReasonList } : {}),
    },
  }
}
