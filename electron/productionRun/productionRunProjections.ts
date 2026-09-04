/**
 * ProductionRun 对外投影层。从 productionRunService.ts 抽出（R9 巨壳拆分）。
 *
 * 这里只做「把内部 Run/事件/产物折算成可安全外发的形状」：剥掉 planHash、contract 等
 * 内部字段，套上 sanitizer，补上深链。服务编排与命令处理仍住 productionRunService.ts。
 * 投影类型是公共 API（productionRunArtifactOperations.ts 与 src/desktop/productionRunBridgeTypes.ts
 * 都依赖它），因此仍从 productionRunService.ts 再导出，调用方 import 路径不变。
 */
import { buildProductionDeepLink } from './productionDeepLink'
import { safeExternalText, safeProductionContract, safeShotId } from './productionRunProjectionSanitizer'
import { trustLevelOf } from './productionRunTypes'
import { createArtifactProjection, type ArtifactProjection } from './artifactProjection'
import { metadataProjection } from './productionRunArtifactHelpers'
import type { ProductionRun, RunEvent } from './productionRunTypes'

type SafeProductionGate = Omit<ProductionRun['gates'][number], 'planHash' | 'contract'> & {
  contract?: ReturnType<typeof safeProductionContract>
}
type SafeProductionJob = Pick<ProductionRun['jobs'][number], 'jobId' | 'stageId' | 'status' | 'attempt' | 'provider' | 'model' | 'nodeId' | 'parentJobId' | 'retryCount' | 'retryReason' | 'progressPercent' | 'lastPollAt' | 'lastVendorStateChangeAt' | 'createdAt' | 'updatedAt' | 'errorCode'>
  // metadata 只投影 shotId 这一格，故显式写死形状——不 Pick 整个 metadata：那是 Record<string, unknown> 袋子
  // （还装着 ffDesc/dialogue/retryDirective 等未脱敏长文本），类型上承诺全量、实际只发一格 = 类型说谎。
  & { metadata?: { shotId: string } }
export type ProductionRunProjection = {
  schemaVersion: number
  runId: string
  projectId: string
  revision: number
  status: ProductionRun['status']
  stageId: string
  playbook: ProductionRun['playbook']
  origin: ProductionRun['origin']
  budget: ProductionRun['budget']
  planVersion: number
  snapshotCursor: number
  stages: ProductionRun['stages']
  gates: SafeProductionGate[]
  jobs: SafeProductionJob[]
  artifacts: Array<Omit<ArtifactProjection, 'projectId' | 'runId' | 'openInNomi'>>
  /** B3：信任档位（run 级）。老 run 无字段 → 默认 key_confirm。用于合同/状态转述。 */
  trustLevel: import('./productionRunTypes').TrustLevel
  createdAt: string
  updatedAt: string
  openInNomi: string
}

export type ProductionEventProjection = Pick<RunEvent, 'schemaVersion' | 'eventId' | 'cursor' | 'runId' | 'runRevision' | 'commandId' | 'type' | 'message' | 'emittedAt' | 'stageId' | 'jobId' | 'artifactId' | 'causationId' | 'correlationId' | 'attemptId' | 'providerOccurredAt'>

export type ProductionArtifactProjection = ArtifactProjection

/**
 * Renderer result for the external-agent storyboard materialization seam.
 * The renderer owns the actual Zustand canvas mutation; the service only accepts
 * the small, validated binding receipt needed to attach the production contract.
 */
export type MaterializeStoryboardResult = ProductionRunProjection & {
  materialized: true
  artifactId: string
  artifactVersion: number
  createdNodeIds: string[]
  connectedCount?: number
  /** Stable canvas node bindings copied into production jobs. */
  bindings: Array<{
    nodeId: string
    provider: string
    model: string
    stageId: string
    metadata?: Record<string, unknown>
  }>
}
export function safeRunProjection(run: ProductionRun): Omit<ProductionRunProjection, 'artifacts' | 'openInNomi'> {
  return {
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    projectId: run.projectId,
    revision: run.revision,
    status: run.status,
    stageId: run.stageId,
    playbook: { name: run.playbook.name, version: run.playbook.version },
    origin: { host: run.origin.host, ...(run.origin.actorId ? { actorId: run.origin.actorId } : {}) },
    budget: { ...run.budget },
    planVersion: run.planVersion,
    snapshotCursor: run.snapshotCursor,
    // B3：run 级信任档位（老 run 无字段 → 默认 key_confirm）。合同/状态转述据此显示打扰程度。
    trustLevel: trustLevelOf(run.policy),
    stages: run.stages.map((stage) => ({
      stageId: stage.stageId, title: safeExternalText(stage.title), status: stage.status, order: stage.order,
      ...(stage.startedAt ? { startedAt: stage.startedAt } : {}),
      ...(stage.completedAt ? { completedAt: stage.completedAt } : {}),
      // W1.5：审片摘要透出（仅 qa 阶段有，文本经 sanitizer）。
      ...(stage.qaSummary ? { qaSummary: safeExternalText(stage.qaSummary) } : {}),
    })),
    gates: run.gates.map((gate) => ({
      gateId: gate.gateId, scope: gate.scope, status: gate.status, title: safeExternalText(gate.title), summary: safeExternalText(gate.summary),
      jobIds: [...gate.jobIds],
      createdAt: gate.createdAt, expiresAt: gate.expiresAt, ...(gate.decidedAt ? { decidedAt: gate.decidedAt } : {}),
      ...(gate.contract ? { contract: safeProductionContract(gate.contract) } : {}),
      // B1：方向候选透出（文本经 sanitizer）；决议后回填的 choiceKey 供转述/审计。
      ...(gate.directionCandidates ? { directionCandidates: gate.directionCandidates.map((candidate) => ({ key: candidate.key, title: safeExternalText(candidate.title), oneLiner: safeExternalText(candidate.oneLiner) })) } : {}),
      ...(gate.decidedChoiceKey ? { decidedChoiceKey: gate.decidedChoiceKey } : {}),
    })),
    jobs: run.jobs.map((job) => {
      // 多镜批次里 job↔镜头的对应关系（agent 建批时自己传的 shotId）。没有它，读回来的 jobs 只能按 status
      // 计数、认不出哪个 job 是哪一镜——返工/对账全瞎。老 run / 单镜链无此字段 → 不发（等价「默认镜」）。
      const shotId = safeShotId(job.metadata?.shotId)
      return {
        jobId: job.jobId, stageId: job.stageId, status: job.status, attempt: job.attempt,
        provider: job.provider, model: job.model, ...(job.nodeId ? { nodeId: job.nodeId } : {}),
        ...(shotId ? { metadata: { shotId } } : {}),
        ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
        ...(job.retryCount !== undefined ? { retryCount: job.retryCount } : {}),
        ...(job.retryReason ? { retryReason: safeExternalText(job.retryReason) } : {}),
        ...(job.progressPercent !== undefined ? { progressPercent: job.progressPercent } : {}),
        ...(job.providerStatus ? { providerStatus: safeExternalText(job.providerStatus) } : {}),
        ...(job.lastPollAt ? { lastPollAt: job.lastPollAt } : {}),
        ...(job.lastVendorStateChangeAt ? { lastVendorStateChangeAt: job.lastVendorStateChangeAt } : {}),
        ...(job.errorCode ? { errorCode: job.errorCode } : {}),
        createdAt: job.createdAt, updatedAt: job.updatedAt,
      }
    }),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

export function runProjection(
  run: ProductionRun,
  projectRootResolver: (projectId: string) => string | null,
  previewSecret: string,
): ProductionRunProjection {
  const { artifacts } = run
  const safeRun = safeRunProjection(run)
  return {
    ...safeRun,
    artifacts: artifacts.map((artifact) => {
      const root = projectRootResolver(run.projectId)
      if (root && (artifact.projectRelativePath || artifact.thumbnailRelativePath)) {
        try {
          const projected = createArtifactProjection({ projectRoot: root, run, artifact, secret: previewSecret })
          const { runId: _runId, projectId: _projectId, openInNomi: _openInNomi, ...safeArtifact } = projected
          return safeArtifact
        } catch {
          // Missing or changed files must not hide the Run itself; expose metadata without a preview.
        }
      }
      const { runId: _runId, projectId: _projectId, openInNomi: _openInNomi, ...safeArtifact } = metadataProjection(run, artifact)
      return safeArtifact
    }),
    openInNomi: buildProductionDeepLink(run.projectId, run.runId),
  }
}

export function eventProjection(event: RunEvent): ProductionEventProjection {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    cursor: event.cursor,
    runId: event.runId,
    runRevision: event.runRevision,
    commandId: event.commandId,
    type: event.type,
    message: safeExternalText(event.message),
    emittedAt: event.emittedAt,
    ...(event.stageId ? { stageId: event.stageId } : {}),
    ...(event.jobId ? { jobId: event.jobId } : {}),
    ...(event.artifactId ? { artifactId: event.artifactId } : {}),
    ...(event.causationId ? { causationId: event.causationId } : {}),
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    ...(event.attemptId ? { attemptId: event.attemptId } : {}),
    ...(event.providerOccurredAt ? { providerOccurredAt: event.providerOccurredAt } : {}),
  }
}
