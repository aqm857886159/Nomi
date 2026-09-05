import type { TranslationKey } from '../../i18n/translationKey'
import type {
  ProductionArtifact,
  ProductionJob,
  ProductionRun,
} from '../../../electron/productionRun/productionRunTypes'

export type ProductionRunTone = 'working' | 'attention' | 'danger' | 'success' | 'neutral'
/** 门类：决定文案与「在哪决定」。方向/样片/形象检查点不花钱，预算/导出才是钱与不可逆。 */
export type ProductionGateKind = 'direction' | 'sample' | 'shot' | 'checkpoint' | 'contract' | 'export' | 'stage'
/** 决定的家：origin=发起端（CLI）主决策、Nomi 只指路兜底；nomi=用户自主发起，门在 Nomi 是主路径。 */
export type ProductionDecisionHome = 'origin' | 'nomi'

/** gateId/scope → 门类（gateId 前缀是 driver 侧的既有约定，scope 兜底）。 */
export function gateKindOf(gate: { gateId: string; scope: string }): ProductionGateKind {
  if (gate.gateId.startsWith('gate-direction-')) return 'direction'
  if (gate.gateId.startsWith('gate-sample-')) return 'sample'
  if (gate.scope === 'job_set' && gate.gateId.startsWith('gate-shot-')) return 'shot'
  // P4 §3.2 锚定妆照检查点（免费质量门）：形象确认卡在 Nomi 弹（decisionHome 归 nomi），不上内部词。
  if (gate.scope === 'anchor_checkpoint') return 'checkpoint'
  if (gate.scope === 'budget_envelope') return 'contract'
  if (gate.scope === 'export') return 'export'
  return 'stage'
}
export type ProductionRunPrimaryAction = 'open-stage' | 'open-gate' | 'review-script' | 'review-storyboard' | 'reconcile' | 'review-rough-cut' | 'open-export' | 'resume-run' | null
/** A4 情境控制（§1.5 L2：进行中才出现，不占常驻预算）。 */
export type ProductionRunControl = 'pause' | 'cancel'

export type ProductionRunView = {
  tone: ProductionRunTone
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  percent?: number
  primaryAction: ProductionRunPrimaryAction
  /** 面板情境控制行：running → 暂停+取消；paused/pausing → 取消（继续走 primaryAction）。 */
  controls: ProductionRunControl[]
  /** 有门在等时的门类（决定文案 + 指路措辞）；无门为 undefined。 */
  gateKind?: ProductionGateKind
  /** Exact provider submission covered by a confirm_all shot gate. */
  gateJob?: { index: number; nodeId: string; provider: string; model: string }
  /** 门该在哪决定：外部驱动 → 指路回 CLI（Nomi 只兜底）；nomi 自主发起 → 门在 Nomi 是主路径。 */
  decisionHome: ProductionDecisionHome
  targetId?: string
  originHost: string
  preview?: {
    artifactId: string
    kind: ProductionArtifact['kind']
    thumbnailRelativePath?: string
    projectRelativePath?: string
  }
  details: {
    completedStages: number
    totalStages: number
    budget: ProductionRun['budget']
    updatedAt: string
    stages: Array<Pick<ProductionRun['stages'][number], 'stageId' | 'title' | 'status'>>
    skills: Array<{ name: string; version: string }>
  }
}

function safeRelativePath(value: string | undefined): value is string {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false
  return !value.split(/[\\/]+/).includes('..')
}

function latestSafePreview(artifacts: ProductionArtifact[]): ProductionRunView['preview'] {
  const latest = [...artifacts]
    .filter((artifact) => artifact.status !== 'rejected'
      && ['image', 'video', 'export'].includes(artifact.kind)
      && (safeRelativePath(artifact.thumbnailRelativePath) || safeRelativePath(artifact.projectRelativePath)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!latest) return undefined
  return {
    artifactId: latest.artifactId,
    kind: latest.kind,
    ...(safeRelativePath(latest.thumbnailRelativePath) ? { thumbnailRelativePath: latest.thumbnailRelativePath } : {}),
    ...(safeRelativePath(latest.projectRelativePath) ? { projectRelativePath: latest.projectRelativePath } : {}),
  }
}

function latestJob(run: ProductionRun): ProductionJob | undefined {
  return [...run.jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

function validPercent(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined
}

export function buildProductionRunView(
  run: ProductionRun,
  now = Date.now(),
  options: { staleAfterMs?: number } = {},
): ProductionRunView {
  const staleAfterMs = options.staleAfterMs ?? 2 * 60_000
  const job = latestJob(run)
  const unknown = run.jobs.find((value) => value.status === 'submission_unknown')
  const waitingGate = run.gates.find((value) => value.status === 'waiting')
  const skills = [...new Map(
    run.gates.flatMap((gate) => gate.contract?.skills ?? [])
      .map((skill) => [`${skill.name}\u0000${skill.version}`, skill]),
  ).values()]
  const originHost = ['nomi', 'claude', 'codex', 'cursor'].includes(run.origin.host)
    ? run.origin.host
    : (['claude', 'codex', 'cursor'].includes(run.origin.actorId || '') ? run.origin.actorId! : 'external')
  // Older durable Runs could reach the terminal status before direction/build stage bookkeeping
  // was completed. The terminal Run status is authoritative for presentation; new Runs also write
  // every stage transition in the reducer.
  const presentedStages = [...run.stages]
    .sort((left, right) => left.order - right.order)
    .map(({ stageId, title, status }) => ({
      stageId,
      title,
      status: run.status === 'completed' ? 'completed' as const : status,
    }))
  const base = {
    controls: [] as ProductionRunControl[],
    // 谁发起的谁决定：nomi 自主发起时没有 CLI 可用，门在 Nomi 是主路径。
    decisionHome: (originHost === 'nomi' ? 'nomi' : 'origin') as ProductionDecisionHome,
    originHost,
    preview: latestSafePreview(run.artifacts),
    details: {
      completedStages: presentedStages.filter((stage) => stage.status === 'completed').length,
      totalStages: run.stages.length,
      budget: run.budget,
      updatedAt: run.updatedAt,
      stages: presentedStages,
      skills,
    },
  }

  if (unknown) {
    return {
      ...base,
      tone: 'danger',
      titleKey: 'generationCommon.production.status.submissionUnknown',
      descriptionKey: 'generationCommon.production.description.submissionUnknown',
      primaryAction: 'reconcile',
      targetId: unknown.jobId,
    }
  }
  // 历史遗留坏 Run：draft 且一个阶段一道门都没有——起草时的 playbook 没实现，流水线没建起来
  // （2026-08-18 已在 repository 层堵死，见 electron/productionRun/productionPlaybooks.ts；盘上
  // 已有的仍读得到）。它不会自己往前走，所以给诚实终态 + 唯一出口：别再挂「查看当前阶段」——
  // 那个按钮点了只会切到一张空画布，比没有按钮更误导。
  if (run.status === 'draft' && run.stages.length === 0 && run.gates.length === 0) {
    return {
      ...base,
      tone: 'danger',
      titleKey: 'generationCommon.production.status.stalledDraft',
      descriptionKey: 'generationCommon.production.description.stalledDraft',
      primaryAction: null,
      controls: ['cancel'],
    }
  }
  if (run.status === 'completed') {
    return {
      ...base,
      tone: 'success',
      titleKey: 'generationCommon.production.status.completed',
      descriptionKey: 'generationCommon.production.description.completed',
      primaryAction: null,
    }
  }
  if (run.status === 'awaiting_script_review') {
    const script = [...run.artifacts]
      .reverse()
      .find((artifact) => artifact.kind === 'script' && artifact.status === 'candidate')
    return {
      ...base,
      tone: 'attention',
      titleKey: 'generationCommon.production.status.scriptReady',
      descriptionKey: 'generationCommon.production.description.scriptReady',
      primaryAction: 'review-script',
      ...(script ? { targetId: script.artifactId } : {}),
    }
  }
  if (run.status === 'awaiting_storyboard_review') {
    return {
      ...base,
      tone: 'attention',
      titleKey: 'generationCommon.production.status.storyboardReady',
      descriptionKey: 'generationCommon.production.description.storyboardReady',
      primaryAction: 'review-storyboard',
      targetId: run.stageId,
    }
  }
  if (run.status === 'awaiting_rough_cut_review') {
    return {
      ...base,
      tone: 'attention',
      titleKey: 'generationCommon.production.status.roughCutReady',
      descriptionKey: 'generationCommon.production.description.roughCutReady',
      primaryAction: 'review-rough-cut',
    }
  }
  if (run.status === 'awaiting_export') {
    return {
      ...base,
      decisionHome: 'nomi',
      tone: 'attention',
      titleKey: 'generationCommon.production.status.exportReady',
      descriptionKey: 'generationCommon.production.description.exportReady',
      primaryAction: waitingGate ? 'open-gate' : 'open-export',
      ...(waitingGate ? { targetId: waitingGate.gateId } : {}),
    }
  }
  const rejectedContract = run.status === 'awaiting_contract'
    ? [...run.gates].reverse().find((value) => value.scope === 'budget_envelope' && value.status === 'rejected')
    : undefined
  if (rejectedContract) {
    return {
      ...base,
      tone: 'neutral',
      titleKey: 'generationCommon.production.status.contractDeclined',
      descriptionKey: 'generationCommon.production.description.contractDeclined',
      primaryAction: null,
      targetId: rejectedContract.gateId,
    }
  }
  if (waitingGate) {
    // N3：四类门不再共用一套「核对支出边界」文案——方向/样片门根本不花钱，说付费是误导。
    const gateKind = gateKindOf(waitingGate)
    const copyKey = gateKind === 'direction'
      ? 'directionGate'
      : gateKind === 'sample'
        ? 'sampleGate'
        : gateKind === 'shot'
          ? 'shotGate'
        : gateKind === 'checkpoint'
          ? 'checkpointGate'
        : gateKind === 'export'
          ? 'exportGate'
          : 'approvalRequired'
    const gateJob = gateKind === 'shot'
      ? run.jobs.find((candidate) => candidate.jobId === waitingGate.jobIds[0])
      : undefined
    const gateJobIndex = gateJob ? run.jobs.findIndex((candidate) => candidate.jobId === gateJob.jobId) + 1 : 0
    return {
      ...base,
      decisionHome: gateKind === 'direction' || gateKind === 'sample' ? base.decisionHome : 'nomi',
      tone: 'attention',
      titleKey: `generationCommon.production.status.${copyKey}`,
      descriptionKey: `generationCommon.production.description.${copyKey}`,
      primaryAction: 'open-gate',
      gateKind,
      ...(gateJob ? {
        gateJob: {
          index: gateJobIndex,
          nodeId: gateJob.nodeId || gateJob.jobId,
          provider: gateJob.provider,
          model: gateJob.model,
        },
      } : {}),
      targetId: waitingGate.gateId,
    }
  }
  if (run.status === 'needs_attention' || job?.status === 'needs_attention') {
    return {
      ...base,
      tone: 'danger',
      titleKey: 'generationCommon.production.status.needsAttention',
      descriptionKey: 'generationCommon.production.description.needsAttention',
      primaryAction: 'open-stage',
      targetId: job?.jobId ?? run.stageId,
    }
  }
  if (run.status === 'paused' || run.status === 'pausing') {
    return {
      ...base,
      tone: 'attention',
      titleKey: run.status === 'paused' ? 'generationCommon.production.status.paused' : 'generationCommon.production.status.pausing',
      descriptionKey: run.status === 'paused' ? 'generationCommon.production.description.paused' : 'generationCommon.production.description.pausing',
      primaryAction: run.status === 'paused' ? 'resume-run' : null,
      controls: ['cancel'],
      targetId: job?.jobId ?? run.stageId,
    }
  }
  const vendorStateAt = job?.lastVendorStateChangeAt ? Date.parse(job.lastVendorStateChangeAt) : Number.NaN
  const vendorIsStale = job && ['provider_accepted', 'polling', 'retry_wait'].includes(job.status)
    && Number.isFinite(vendorStateAt) && now - vendorStateAt >= staleAfterMs
  if (vendorIsStale) {
    return {
      ...base,
      tone: 'attention',
      titleKey: 'generationCommon.production.status.providerStale',
      descriptionKey: 'generationCommon.production.description.providerStale',
      primaryAction: 'open-stage',
      targetId: job.jobId,
    }
  }
  const percent = validPercent(job?.progressPercent)
  return {
    ...base,
    tone: run.status === 'draft' ? 'neutral' : 'working',
    titleKey: run.status === 'draft' ? 'generationCommon.production.status.draft' : 'generationCommon.production.status.running',
    descriptionKey: run.status === 'draft' ? 'generationCommon.production.description.draft' : 'generationCommon.production.description.running',
    ...(percent === undefined ? {} : { percent }),
    primaryAction: 'open-stage',
    controls: run.status === 'running' ? ['pause', 'cancel'] : [],
    targetId: job?.jobId ?? run.stageId,
  }
}
