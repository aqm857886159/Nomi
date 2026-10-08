import crypto from 'node:crypto'
import { tagNomiError } from '../shared/nomiErrorCodes'
import fs from 'node:fs'
import path from 'node:path'

import { createProductionRunRepository, type ProductionRunRepository } from './productionRunRepository'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import {
  getArtifactPreviewSecret,
  resolveOwnedArtifactFile,
  verifyArtifactPreviewHandle,
} from './artifactProjection'
import { buildProductionDeepLink } from './productionDeepLink'
import { applyRunControl } from './productionRunControl'
import { isStillAtProvider, runWantsDriver, settleRunLifecycle } from './productionRunLifecycle'
import { createDriverOps, isSemanticMultiShotRun } from './productionRunDriverOps'
import { isShotGate, isSpendGate } from './productionRunGateIdentity'
import { withEventTap } from './productionRunEventTap'
import { assertStoryboardSourceFresh, createArtifactOperations } from './productionRunArtifactOperations'
import { assertStoryboardSourceApproved } from './productionRunReducer'
import { MEANINGFUL_EVENT_TYPES } from './productionRunMeaningfulEvents'
import { readAutomationPolicySettings } from '../settings/automationPolicySettings'
import { readAgentApprovalPolicy } from '../settings/agentApprovalPolicySettings'
import { readConnectedModelScope } from './connectedModelScope'
import { assertProductionPolicyReady } from './productionPolicyReadiness'
import { normalizeTrustLevel, trustLevelOf } from './productionRunTypes'
import { jobAwaitsRetrieval } from '../shared/productionShotPhase'
import { assertCallerDeclaredTrustLevel, trustLevelFromApprovalPolicy } from './productionRunTrustAuthority'
import { createGateApprovalOwner } from './productionRunApprovalReceipt'
import { isAnchorCheckpointGate } from './anchorCheckpoint'
import { kickBatchSchedulerForRun } from './batchSchedulerKick'
import { renewDispatchConsent } from './productionDispatchConsentEdits'
import { recoverStoryboardContentHashes } from './productionRunStoryboardHashRecovery'
import type { ApprovalReceiptAuthority } from '../capabilityCore/approvalReceipt'
import {
  storyboardMetadata,
} from './productionRunArtifactHelpers'
import type {
  AutomationPolicy,
  CreateProductionRunInput,
  ProductionGenerationPlan,
  ProductionGenerationShot,
  ProductionRun,
  RunEvent,
  RunCommand,
} from './productionRunTypes'
import type { ProjectAgentApprovalPolicy } from '../shared/agentCapabilities/capabilityApprovalPolicy'
import { eventProjection, runProjection } from './productionRunProjections'
import type { ProductionEventProjection, ProductionRunProjection } from './productionRunProjections'
// 投影类型的公共 API 位置不变：外部调用方仍从本模块 import。
export type {
  ProductionRunProjection,
  ProductionEventProjection,
  ProductionArtifactProjection,
  MaterializeStoryboardResult,
} from './productionRunProjections'
import { logError } from '../logging/logger'
import { ProductionRunNotFoundError } from './productionRunErrors'


type ServiceDeps = {
  repository?: ProductionRunRepository
  sleep?: (delayMs: number) => Promise<void>
  projectRootResolver?: (projectId: string) => string | null
  previewSecret?: string
  requestRenderer?: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>
  executeProductionExport?: (input: { projectId: string; runId: string; outputName: string }) => Promise<{ relativePath: string; size: number; jobId?: string }>
  policyResolver?: () => Partial<AutomationPolicy>
  reconcileProviderTask?: (job: ProductionRun['jobs'][number]) => Promise<{
    status?: string
    assets?: Array<{ type?: string; url?: string; thumbnailUrl?: string }>
    error?: string
  }>
  /** A5：每批持久化事件的旁路监听（系统通知等）。异常被吞，绝不影响制作主流程。 */
  onEvents?: (events: RunEvent[], run: ProductionRun) => void
  /**
   * 主进程收据权威。**不传不等于放行**：构造时会退成 fail-closed 的人证持有者，付费门届时只认
   * productionRunIpc 盖的真人手势章（见 createGateApprovalOwner）。生产装配必须传，装配点是
   * productionRunRuntime.getProductionRunService()。
   */
  approvalReceiptAuthority?: ApprovalReceiptAuthority
  /** Current project document revision, resolved by the project owner rather than the command body. */
  projectRevisionResolver?: (projectId: string) => number | undefined
}

function identifier(value: string, label: string): string {
  const normalized = String(value || '').trim()
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === '.' || normalized === '..') throw new Error(`Invalid ${label} id`)
  return normalized
}


export function createProductionRunService(deps: ServiceDeps = {}) {
  // A5：事件旁路装饰（通知等），见 productionRunEventTap.ts。
  const repository = withEventTap(deps.repository ?? createProductionRunRepository(), deps.onEvents)
  const sleep = deps.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
  const projectRootResolver = deps.projectRootResolver ?? ((projectId: string) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()))
  const previewSecret = deps.previewSecret ?? getArtifactPreviewSecret()
  const requestRenderer = deps.requestRenderer ?? (async (op: string, payload: unknown, timeoutMs: number) => {
    const bridge = await import('../capabilityCore/rendererBridge')
    return bridge.requestRenderer(op, payload, timeoutMs)
  })

  const executeProductionExport = deps.executeProductionExport ?? (async (input) => {
    const prepared = await requestRenderer('production.export', input, 5 * 60_000) as { manifest?: unknown }
    const exports = await import('../export/exportJobs')
    return exports.executeProductionRunExport({
      ...input,
      manifest: prepared?.manifest,
      captureWebm: async () => {
        const captured = await requestRenderer('production.capture-export', input, 30 * 60_000) as { webmBytes?: unknown }
        return captured?.webmBytes
      },
    })
  })
  const policyResolver = deps.policyResolver ?? (() => {
    const settings = readAutomationPolicySettings()
    return {
      trustedHosts: [...settings.trustedHosts],
      ...readConnectedModelScope(),
      maxAttemptsPerJob: settings.maxAttemptsPerJob,
      minimizeUploads: settings.minimizeUploads,
      // 信任档不是这一层自己的设置，而是**用户权限档的投影**（唯一那座桥）。少了这一行，
      // `normalizeTrustLevel(undefined)` 恒给 `key_confirm`：用户在 Agent 面板选了「全自动」，
      // Run 这一侧永远不知道，外部入口只能靠调用方自报——而自报那条路已经被堵死了。
      trustLevel: trustLevelFromApprovalPolicy(readAgentApprovalPolicy()),
    }
  })
  // 装配不变量：service 内部**没有**「没有人证持有者」这个状态。缺权威时持有的是 fail-closed 的那份，
  // 于是命令路径上不再有 `if (!authority)` 这种「验不了就跳过」的分支（R28：能在构造期消掉的空状态别留到运行时）。
  const gateApproval = createGateApprovalOwner(deps.approvalReceiptAuthority, deps.projectRevisionResolver)
  const inFlight = new Set<string>()
  const recoveryInFlight = new Set<string>()
  const reconciliationInFlight = new Set<string>()
  const directionsInFlight = new Set<string>()
  const reconcileProviderTask = deps.reconcileProviderTask ?? (async (job) => {
    if (!job.providerTaskId) throw new Error('供应商任务标识尚未收到，不能自动对账')
    const runtime = await import('../runtime')
    const response = await runtime.fetchTaskResult({
      taskId: job.providerTaskId,
      vendor: job.provider,
      taskKind: job.taskKind || 'text_to_video',
      prompt: '',
      modelKey: job.model,
    })
    return response.result
  })

  function requireRun(projectId: string, runId: string): ProductionRun {
    const safeProjectId = identifier(projectId, 'project')
    const safeRunId = identifier(runId, 'run')
    const run = repository.read(safeProjectId, safeRunId)
    if (!run) throw new ProductionRunNotFoundError()
    if (run.projectId !== safeProjectId) throw new Error('Production run project mismatch')
    return run
  }

  function createDraft(input: CreateProductionRunInput): ProductionRunProjection {
    const userPolicy = policyResolver()
    // 调用方自报的信任档不得自证：放松（少问）只能由用户的设置或一次真人答过的确认产生，
    // 而建 Run 这条路上连一个能问人的面都没有。收紧照收。
    assertCallerDeclaredTrustLevel(input.policy?.trustLevel, userPolicy)
    const run = repository.create({
      ...input,
      runId: input.runId ? identifier(input.runId, 'run') : undefined,
      policy: { ...userPolicy, ...(input.policy || {}) },
    })
    // create 只可能产出「等方向 + 至少一道门 + 零任务零预算」的草稿：未登记的 playbook / 缺 brief
    // 在 repository 层就抛错（productionPlaybooks.ts），draft 已不可达，这里不再给它留口子。
    if (run.status !== 'awaiting_direction' || run.gates.length === 0 || run.jobs.length > 0 || run.budget.authorized !== 0) {
      throw new Error('Production draft invariant failed')
    }
    // B3：budget_only（「别问了直接出」）→ 自动批准创意方向门（留痕），不拟候选、不打扰。
    // 其余档位 → 异步拟方向候选（GUI 有 LLM 才成；关着则保持兜底 gate）。均不阻塞返回。
    // 2026-09-21：这一行以前也认调用方在请求体里自报的档位——门在 run 创建的同一刻被批掉，
    // 没有任何人看见过它。上面的 assertCallerDeclaredTrustLevel 保证走到这里的 budget_only
    // 只可能来自用户的设置（放松档位的请求已经被拒了）。
    if (trustLevelOf(run.policy) === 'budget_only') void autoApproveGate(run.projectId, run.runId, 'gate-direction-v1')
    else void proposeDirections(run)
    return runProjection(run, projectRootResolver, previewSecret)
  }

  function createGenerationDraft(input: {
    operationId: string
    projectId: string
    origin: { host: string; actorId?: string }
    candidate: ProductionGenerationPlan['candidate']
    currency?: string
    policy?: Partial<AutomationPolicy>
    policySnapshot?: ProjectAgentApprovalPolicy
    shots?: ReadonlyArray<Pick<ProductionGenerationShot, 'shotId' | 'role' | 'included' | 'candidate'>>
    cardHidden?: boolean
  }): ProductionRun {
    // Semantic generation drafts must use the same live automation policy as
    // every other ProductionRun entry point. Previously this thin service
    // method delegated straight to the repository, whose low-level fallback
    // is intentionally conservative (¥20 / one attempt), silently discarding
    // the user's configured budget and retry ceiling. Keep caller-supplied
    // provider/model allowlists as the narrow operation override, while
    // deriving all unspecified controls from this service's policy resolver.
    return repository.createGenerationDraft({
      ...input,
      policy: { ...policyResolver(), ...(input.policy || {}) },
    })
  }

  function writeProjectJson(projectId: string, relativePath: string, value: unknown): void {
    const root = projectRootResolver(projectId)
    if (!root || relativePath.startsWith('/') || relativePath.split(/[\\/]+/).includes('..')) throw new Error('Production project artifact root unavailable')
    const target = path.resolve(root, relativePath)
    const rootWithSep = `${path.resolve(root)}${path.sep}`
    if (target !== path.resolve(root) && !target.startsWith(rootWithSep)) throw new Error('Production artifact path escapes project')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  function executeInternal(projectId: string, runId: string, current: ProductionRun, type: string, payload: Record<string, unknown>, commandId: string) {
    return repository.execute(projectId, runId, { commandId, expectedRevision: current.revision, type, payload, issuedAt: new Date().toISOString() })
  }

  function localAssetPath(projectId: string, rawUrl: unknown): string | undefined {
    if (typeof rawUrl !== 'string' || !rawUrl.startsWith('nomi-local://asset/')) return undefined
    const rest = rawUrl.slice('nomi-local://asset/'.length).split(/[?#]/, 1)[0]
    const segments = rest.split('/').filter(Boolean)
    if (segments.length < 2) return undefined
    try {
      const owner = decodeURIComponent(segments[0])
      const relativePath = segments.slice(1).map((segment) => decodeURIComponent(segment)).join('/')
      if (owner !== projectId || !relativePath || relativePath.split(/[\\/]+/).includes('..') || relativePath.startsWith('/')) return undefined
      return relativePath
    } catch {
      return undefined
    }
  }

  function projectRelativePath(projectId: string, rawPath: unknown, options: { requireFile?: boolean } = {}): string {
    const relativePath = typeof rawPath === 'string' ? rawPath.trim() : ''
    const root = projectRootResolver(projectId)
    if (!root || !relativePath || relativePath.includes('\0') || relativePath.startsWith('/') || relativePath.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(relativePath) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
      throw new Error('导出必须返回项目目录内的相对路径')
    }
    const target = path.resolve(root, relativePath)
    const rootPath = path.resolve(root)
    const rootWithSep = `${rootPath}${path.sep}`
    if (target !== rootPath && !target.startsWith(rootWithSep)) throw new Error('导出路径不能离开项目目录')
    if (options.requireFile) {
      let stat: fs.Stats
      try { stat = fs.statSync(target) } catch { throw new Error('导出文件不存在') }
      if (!stat.isFile()) throw new Error('导出结果不是文件')
    }
    return relativePath.replace(/\\/g, '/')
  }

  function stageValue(run: ProductionRun, stageId: string, patch: Record<string, unknown>): Record<string, unknown> {
    const stage = run.stages.find((candidate) => candidate.stageId === stageId)
    if (!stage) throw new Error(`Production stage not found: ${stageId}`)
    return { ...stage, ...patch, stageId }
  }

  // B0：driver 编排（拟分镜 / 生成 / 导出 / 对账）抽到 productionRunDriverOps.ts，行为零变化。
  // service 保留其依赖的路径工具 + in-flight 去重集，经参数注入，仍可单测（R9 ≤800）。
  const { proposeDirections, proposeScript, proposeStoryboard, driveGeneration, advanceSemanticProduction, driveExport, driveReconciliation } = createDriverOps({
    repository,
    sleep,
    requireRun,
    executeInternal,
    requestRenderer,
    executeProductionExport,
    writeProjectJson,
    localAssetPath,
    projectRelativePath,
    stageValue,
    reconcileProviderTask,
    inFlight,
    reconciliationInFlight,
    directionsInFlight,
  })

  /**
   * 叫醒干这个 Run 的活的那一方——「谁来驱动」只在这里判：多镜批次的派发归批次调度器（批次收齐后它自己交给
   * driveGeneration 收尾），其余归 driveGeneration。Run 从停着被放回 running（任务卡 / 画布 / MCP 的「继续」都经
   * run.control）后经这里，入口自己不用知道该踢谁；以前「继续」只踢 driveGeneration，多镜批次状态回到 running 却一镜都不派。
   */
  function wakeRunDriver(run: ProductionRun): void {
    if (isSemanticMultiShotRun(run)) kickBatchSchedulerForRun(run.projectId, run.runId)
    else void driveGeneration(run)
  }

  async function command(projectId: string, runId: string, runCommand: RunCommand) {
    const safeProjectId = identifier(projectId, 'project')
    const safeRunId = identifier(runId, 'run')
    const prior = repository.readEvents(safeProjectId, safeRunId).filter((event) => event.commandId === runCommand.commandId)
    if (prior.length > 0) return { run: requireRun(safeProjectId, safeRunId), events: prior }
    if (runCommand.type === 'policy.refresh') {
      const current = requireRun(safeProjectId, safeRunId)
      return repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'policy.set',
        payload: { policy: { ...current.policy, ...policyResolver() } },
      })
    }
    if (runCommand.type === 'job.retry_retrieval') {
      // 「已生成但取回失败」→ 重新取回（#975 A2）。只做一件事：把这一镜放回轮询，叫醒批次调度器去**查一次、取一次**。
      // 不重新提交、不预留、不扣费：轮询只用已有的供应商任务号；停着的 Run 也只观察在飞的镜，不派新的。
      const current = requireRun(safeProjectId, safeRunId)
      const jobId = typeof runCommand.payload.jobId === 'string' ? runCommand.payload.jobId.trim() : ''
      const job = current.jobs.find((candidate) => candidate.jobId === jobId)
      if (!job || !jobAwaitsRetrieval(job)) {
        throw new Error('Production job is not waiting for its result to be retrieved')
      }
      if (!isSemanticMultiShotRun(current)) throw new Error('Retrieving a result again is only available for batch shots')
      const result = repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'job.status',
        payload: { jobId, status: 'polling', patch: { errorCode: '', errorMessage: '' } },
      })
      kickBatchSchedulerForRun(safeProjectId, safeRunId)
      return result
    }
    if (runCommand.type === 'job.reconcile') {
      const current = requireRun(safeProjectId, safeRunId)
      const jobId = typeof runCommand.payload.jobId === 'string' ? runCommand.payload.jobId.trim() : ''
      const outcome = runCommand.payload.outcome
      const job = current.jobs.find((candidate) => candidate.jobId === jobId)
      if (!job || job.status !== 'submission_unknown') throw new Error('Production job is not awaiting reconciliation')
      if (outcome === 'user_checked_abandon') {
        // 「我去服务商后台核对过了，没有这一笔」：把那次结果未知的尝试记成「用户核对后放弃」，释放这一镜的占用
        // （job → needs_attention，画布重新可以生成），预留按用户核对过的事实 provider-safe 释放。
        // 只认来自 Nomi 自己窗口的真人手势（productionRunIpc 盖章）；不开拍——重新生成仍要在正常的付费确认卡上点。
        if (runCommand.humanGesture !== true) throw new Error('A user gesture is required to release an unconfirmed submission')
        const released = repository.execute(safeProjectId, safeRunId, {
          ...runCommand,
          type: 'job.status',
          payload: {
            jobId,
            status: 'needs_attention',
            patch: { errorCode: 'user_checked_abandoned', errorMessage: `User checked the provider and abandoned this unconfirmed attempt at ${runCommand.issuedAt}` },
          },
        })
        const reservationId: string = `${safeRunId}:${jobId}:${job.attempt}`
        if (repository.readBudgetLedger(safeProjectId, safeRunId).reservations[reservationId]?.status === 'unsettled') {
          return repository.execute(safeProjectId, safeRunId, {
            commandId: `${runCommand.commandId}:release`,
            expectedRevision: released.run.revision,
            type: 'budget.entry',
            payload: { entry: { billingEntryId: `${reservationId}:release-user-checked`, kind: 'release', reservationId, providerSafe: true, occurredAt: runCommand.issuedAt } },
            issuedAt: runCommand.issuedAt,
          })
        }
        return released
      }
      if (outcome === 'not_found') {
        return repository.execute(safeProjectId, safeRunId, {
          ...runCommand,
          type: 'job.status',
          payload: { jobId, status: 'needs_attention', patch: { errorCode: 'provider_task_not_found', errorMessage: '已核对供应商：没有找到原任务；Nomi 未自动重新提交' } },
        })
      }
      if (outcome !== 'found') throw new Error('Invalid production reconciliation outcome')
      if (!job.providerTaskId) throw new Error('尚未收到供应商任务标识，不能自动恢复；请保持暂停并联系供应商核对')
      const result = repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'job.status',
        payload: { jobId, status: 'reconciling' },
      })
      void driveReconciliation(safeProjectId, safeRunId, jobId)
      return result
    }
    if (runCommand.type === 'run.control' && runCommand.payload.action === 'set_trust') {
      // B3：对话改档（「别问了直接出」= 降 budget_only）。写 policy + 事件留痕（policy.set→policy.updated）。
      // 若正卡在创意/样片门等待且新档位是 budget_only → 顺手自动批准该门，让「直接出」立刻生效。
      const current = requireRun(safeProjectId, safeRunId)
      const trustLevel = normalizeTrustLevel(runCommand.payload.trustLevel)
      // 降到 budget_only = 一次付费放行（此后逐镜确认门不再生成）→ 必须有一次真人答过的确认：
      // Nomi 窗口里的手势章，或一张绑死「预算上限 + runId」的 elicitation 收据。缺两者 → 拒。
      const trustReceipt = gateApproval.verifyTrustGrant(safeProjectId, safeRunId, current, runCommand)
      const result = repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'policy.set',
        payload: { policy: { ...current.policy, trustLevel } },
      })
      // 事件先落库再消费收据：崩溃最多留下一张对着已生效档位的可重放收据，不会把档位改回去。
      gateApproval.consume(trustReceipt || undefined)
      if (trustLevel === 'budget_only') {
        // 2026-09-10 根因：这里原本也把 isShotGate(gate) 算进「顺手批掉」的范围。逐镜门是**付费门**
        // （旧剧本里批准它曾放行一次真实派发；那段派发已删，门照旧按付费门对待），而 set_trust 只能由客户端工具调用发起（渲染层 IPC
        // 把 run.control 的 payload 收窄成 pause/resume/cancel，根本递不进 trustLevel）——等于一次
        // 客户端工具调用就能替用户批掉一次真实扣费。降档只降「问得多细」，不代表替真人授权花钱。
        const waitingCreativeGate = result.run.gates.find((gate) => gate.status === 'waiting'
          && gate.scope === 'stage'
          && (gate.gateId.startsWith('gate-direction-') || gate.gateId.startsWith('gate-sample-')))
        if (waitingCreativeGate) void autoApproveGate(safeProjectId, safeRunId, waitingCreativeGate.gateId)
      }
      return result
    }
    if (runCommand.type === 'run.control') {
      // A4 run 控制：逻辑在 productionRunControl.ts（MCP 与渲染端同一收口）。
      const controlled = applyRunControl(repository, safeProjectId, safeRunId, requireRun(safeProjectId, safeRunId), runCommand)
      // 恢复必须重踢干活的那一方：只回状态不回工作 = 假 resume。
      if (runCommand.payload.action === 'resume' && controlled.run.status === 'running') wakeRunDriver(controlled.run)
      return controlled
    }
    if (runCommand.type === 'script.review' || runCommand.type === 'artifact.review') {
      const current = requireRun(safeProjectId, safeRunId)
      const artifactId = typeof runCommand.payload.artifactId === 'string' ? runCommand.payload.artifactId.trim() : ''
      const artifact = current.artifacts.find((candidate) => candidate.artifactId === artifactId)
      if (!artifact || !['script', 'storyboard'].includes(artifact.kind)) throw new Error('Production artifact is not ready to review')
      const decision = runCommand.payload.decision ?? runCommand.payload.status
      if (!['approved', 'changes_requested', 'rejected'].includes(String(decision))) throw new Error('Invalid script review decision')
      const result = repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'script.review',
        payload: { ...runCommand.payload, artifactId, decision },
      })
      if (decision === 'approved' && artifact.kind === 'script') void proposeStoryboard(result.run)
      return result
    }
    if (runCommand.type === 'plan.attach') {
      const current = requireRun(safeProjectId, safeRunId)
      const artifactId = typeof runCommand.payload.artifactId === 'string' ? runCommand.payload.artifactId : ''
      const artifact = current.artifacts.find((item) => item.artifactId === artifactId && item.kind === 'storyboard')
      if (!artifact) throw new Error('Storyboard artifact is not ready to attach')
      if (artifact.status !== 'adopted' || (artifact.reviewStatus !== undefined && artifact.reviewStatus !== 'approved')) throw new Error('Approved storyboard artifact required before attach')
      assertStoryboardSourceApproved(current, artifact.artifactId)
      const source = assertStoryboardSourceFresh(projectRootResolver, current, artifact, runCommand.payload)
      const bindings = Array.isArray(runCommand.payload.bindings) ? runCommand.payload.bindings : []
      const jobs = bindings.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid storyboard binding ${index}`)
        const binding = value as Record<string, unknown>
        const nodeId = typeof binding.nodeId === 'string' ? binding.nodeId.trim() : ''
        const provider = typeof binding.provider === 'string' ? binding.provider.trim() : ''
        const model = typeof binding.model === 'string' ? binding.model.trim() : ''
        const stageId = typeof binding.stageId === 'string' && binding.stageId.trim() ? binding.stageId.trim() : 'generate'
        if (!nodeId || !provider || !model) throw new Error('Every production shot must have a provider and model before approval')
        const metadata = storyboardMetadata(binding.metadata ?? binding)
        return {
          jobId: `job:${safeRunId}:${nodeId}`,
          stageId,
          status: 'authorization_required' as const,
          attempt: 0,
          provider,
          model,
          idempotencyKey: `production:${safeRunId}:${nodeId}`,
          nodeId,
          ...(source.artifactId ? { sourceScriptArtifactId: source.artifactId } : {}),
          ...(source.version ? { sourceScriptVersion: source.version } : {}),
          ...(source.hash ? { sourceScriptHash: source.hash } : {}),
          ...(metadata ? { metadata } : {}),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      })
      const maxSpend = current.policy.maxSpend
      const gate = {
        gateId: `gate-contract-v${current.planVersion}`,
        scope: 'budget_envelope' as const,
        status: 'waiting' as const,
        planHash: typeof runCommand.payload.planHash === 'string' ? runCommand.payload.planHash : crypto.createHash('sha256').update(JSON.stringify(runCommand.payload.bindings)).digest('hex'),
        jobIds: jobs.map((job) => job.jobId),
        title: 'Approve production contract and budget',
        summary: 'Review shots, models, and the hard spend limit before Nomi submits any paid generation.',
        artifactId,
        artifactVersion: artifact.version || 1,
        contract: {
          specs: { durationSeconds: current.brief?.durationSeconds, shotCount: jobs.length },
          claims: (current.brief?.sellingPoints || []).map((text, index) => ({ text, evidenceIds: [`brief-${index + 1}`] })),
          evidence: (current.brief?.sellingPoints || []).map((label, index) => ({ evidenceId: `brief-${index + 1}`, label })),
          // 取**本 run 的** playbook 名（W4：此前硬编码 'brand.promo'——换任何 playbook 都会在合同里谎报技能名）。
          skills: [{ name: current.playbook.name, version: current.playbook.version }],
          ...(maxSpend !== null ? { estimatedCost: { currency: current.budget.currency, minimum: 0, maximum: maxSpend } } : {}),
        },
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }
      const result = repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'plan.attach',
        payload: { artifactId, jobs, gate },
      })
      return result
    }
    const gateDecisionRun = runCommand.type === 'gate.decide' ? requireRun(safeProjectId, safeRunId) : undefined
    const duplicateGateDecision = gateDecisionRun
      ? gateApproval.duplicateGateDecisionFor(safeProjectId, safeRunId, gateDecisionRun, runCommand)
      : undefined
    const gateReceipt = duplicateGateDecision
      ? duplicateGateDecision.gateReceipt
      : gateDecisionRun && gateApproval.verifyGateDecision(safeProjectId, safeRunId, gateDecisionRun, runCommand)
    if (duplicateGateDecision) return { run: duplicateGateDecision.current, events: [] }
    if (runCommand.type === 'gate.decide' && runCommand.payload.status === 'approved') {
      const current = requireRun(safeProjectId, safeRunId)
      const gateId = typeof runCommand.payload.gateId === 'string' ? runCommand.payload.gateId.trim() : ''
      const gate = current.gates.find((item) => item.gateId === gateId)
      if (gate?.scope === 'export' && current.status !== 'awaiting_export') {
        throw new Error('请先完成粗剪审看，再单独批准导出')
      }
      if (gate?.scope === 'budget_envelope' && gate.jobIds.length > 0) {
        const jobs = gate.jobIds
          .map((jobId) => current.jobs.find((job) => job.jobId === jobId))
          .filter((job): job is ProductionRun['jobs'][number] => Boolean(job))
        assertProductionPolicyReady(current.policy, jobs)
      }
    }
    const result = repository.execute(safeProjectId, safeRunId, runCommand)
    // The Run event is durable before receipt consumption. A crash can only leave
    // a replayable receipt against an already-decided gate; it cannot reopen it.
    gateApproval.consume(gateReceipt || undefined)
    if (runCommand.type === 'gate.decide' && runCommand.payload.status === 'approved' && runCommand.payload.gateId === 'gate-direction-v1') {
      void proposeScript(result.run)
    }
    if (runCommand.type === 'gate.decide' && runCommand.payload.status === 'approved' && runCommand.payload.gateId === `gate-contract-v${result.run.planVersion}`) {
      void driveGeneration(result.run)
    }
    // W2 冻结门：批准（真人视觉确认了角色/场景卡）→ 续跑 driver（此时 hasApprovedFreezeGate 为真 → 不再拦，进
    // 首镜提交）；否决 → 暂停 run，让用户回去改/冻结卡后再继续（与样片门否决同形，不作废任何已生成物）。
    if (runCommand.type === 'gate.decide' && runCommand.payload.gateId === `gate-freeze-v${result.run.planVersion}`) {
      if (runCommand.payload.status === 'approved') {
        void driveGeneration(result.run)
      } else if (runCommand.payload.status === 'rejected' && result.run.status === 'running') {
        try {
          applyRunControl(repository, safeProjectId, safeRunId, result.run, {
            commandId: `${runCommand.commandId}:freeze-reject-pause`,
            expectedRevision: result.run.revision,
            type: 'run.control',
            payload: { action: 'pause' },
            issuedAt: new Date().toISOString(),
          })
        } catch (error) {
          logError('production-run', 'freeze-gate-reject-pause-failed', error)
        }
      }
    }
    // B2 样片门：批准 → 续跑剩余镜头（重踢 driver）；否决 → 暂停 run，让用户改提示词后再继续（不作废已生成的样片）。
    if (runCommand.type === 'gate.decide' && runCommand.payload.gateId === `gate-sample-v${result.run.planVersion}`) {
      if (runCommand.payload.status === 'approved') {
        void driveGeneration(result.run)
      } else if (runCommand.payload.status === 'rejected' && result.run.status === 'running') {
        try {
          applyRunControl(repository, safeProjectId, safeRunId, result.run, {
            commandId: `${runCommand.commandId}:sample-reject-pause`,
            expectedRevision: result.run.revision,
            type: 'run.control',
            payload: { action: 'pause' },
            issuedAt: new Date().toISOString(),
          })
        } catch (error) {
          // 暂停失败不掩盖否决本身（门已落 rejected）；run 状态仍可查、可手动暂停。
          logError('production-run', 'sample-gate-reject-pause-failed', error)
        }
      }
    }
    const decidedGate = runCommand.type === 'gate.decide'
      ? result.run.gates.find((gate) => gate.gateId === runCommand.payload.gateId)
      : undefined
    if (runCommand.type === 'gate.decide' && decidedGate && isShotGate(decidedGate)) {
      if (runCommand.payload.status === 'approved') {
        void driveGeneration(result.run)
      } else if (runCommand.payload.status === 'rejected' && result.run.status === 'running') {
        try {
          applyRunControl(repository, safeProjectId, safeRunId, result.run, {
            commandId: `${runCommand.commandId}:shot-reject-pause`,
            expectedRevision: result.run.revision,
            type: 'run.control',
            payload: { action: 'pause' },
            issuedAt: new Date().toISOString(),
          })
        } catch (error) {
          logError('production-run', 'shot-gate-reject-pause-failed', error)
        }
      }
    }
    if (runCommand.type === 'gate.decide' && runCommand.payload.status === 'approved' && runCommand.payload.gateId === `gate-export-v${result.run.planVersion}`) {
      void driveExport(result.run)
    }
    // P4 §3.2 锚定妆照检查点：决议落库 → 重踢多镜批 scheduler（与上面 freeze/sample/shot 门的 driveGeneration
    // 重踢同一个家——任何入口的 gate.decide 都经这里，入口自己不用记得踢）。approved = 放行镜头批；rejected =
    // 免费空 tick（derivation 对 rejected 只在有新 attempt 时才重派锚，见 batchScheduleDerivation）。scheduler
    // 构造依赖 appIntegration 接线，故经晚绑定插槽（batchSchedulerKick.ts 有为什么）。
    if (runCommand.type === 'gate.decide' && decidedGate && isAnchorCheckpointGate(decidedGate)) {
      // 付费卡① 第 13 条：用户在 Nomi 窗口里放行形象 = 他对等着这一下才开拍的那几镜点了头，续上它们的同意。
      // MCP / Agent 的决议没有真人手势章，不续——派到时同意过了窗口就如实停下，等他自己点。
      const renewed = runCommand.payload.status === 'approved' && runCommand.humanGesture === true
        ? renewDispatchConsent(repository, safeProjectId, safeRunId, result.run, 'anchor_release', runCommand.issuedAt)
        : undefined
      kickBatchSchedulerForRun(safeProjectId, safeRunId)
      if (renewed) return { run: renewed.run, events: [...result.events, ...renewed.events] }
    }
    return result
  }

  /**
   * B3：按信任档位自动批准一道创意门（budget_only 用）。走同一条 command 路径（driver 钩子照常触发），
   * commandId 自证「按档位自动批准」= 留痕（事件流透出 commandId）。门已不在 waiting（并发/重放）→ 静默跳过。
   */
  async function autoApproveGate(projectId: string, runId: string, gateId: string): Promise<void> {
    try {
      const current = requireRun(projectId, runId)
      const gate = current.gates.find((item) => item.gateId === gateId)
      if (!gate || gate.status !== 'waiting') return
      // 付费门永远不自动批：自动批准没有人证，而付费门的不变量就是「必须有真人授权」。防线放在这个
      // 共享出口，任何未来的自动批准调用者都被同一条规则拦住（不靠每个调用点自己记得筛）。
      if (isSpendGate(gate)) throw new Error(`Spend gate cannot be auto-approved by trust level: ${gate.gateId}`)
      await command(projectId, runId, {
        commandId: `auto-trust-budget-only:${gateId}:${current.revision}`,
        expectedRevision: current.revision,
        type: 'gate.decide',
        payload: { gateId, status: 'approved' },
        issuedAt: new Date().toISOString(),
      })
    } catch (error) {
      // 自动批准失败不掩盖 run：门仍 waiting、可手动批。
      logError('production-run', 'auto-approve-gate-failed', error)
    }
  }

  async function resumeUnfinishedRuns(projectId: string): Promise<void> {
    const safeProjectId = identifier(projectId, 'project')
    if (recoveryInFlight.has(safeProjectId)) return
    recoveryInFlight.add(safeProjectId)
    try {
      const summaries = typeof repository.list === 'function' ? repository.list(safeProjectId) : []
      for (const summary of summaries) {
        let current = repository.read(safeProjectId, summary.runId)
        // 要不要处理只问生命周期 owner：停稳了而手上没有交给供应商的活就跳过。以前这里自己按状态挑、已取消一律跳过——
        // 取消后关掉 Nomi，那一镜停在「提交中」永远没人标成结果待核对（2026-10-07 独立验收 V-1078 抓到的第四扇门）。
        if (!current || !runWantsDriver(current)) continue
        // 老数据：上一版把多镜批次急停后留在 pausing、手上其实已经没有在跑的活——之后再没有命令经过写入口，
        // 它就永远「暂停中」。欠不欠这一步只由生命周期 owner 判，这里只负责在重开项目时让它经过一次写入口。
        if (settleRunLifecycle(current, new Date().toISOString())) {
          try {
            current = executeInternal(safeProjectId, current.runId, current, 'run.lifecycle.settle', {}, `recovery-${current.runId}-lifecycle-${current.revision}`).run
          } catch (error) {
            logError('production-run', 'recovery-lifecycle-settle-failed', error)
          }
        }
        // Semantic single-shot runs own recovery through ProductionGenerationSubmission
        // (resume/poll/reconcile). The legacy playbook driver must not rewrite their
        // durable provider state to submission_unknown or kick a second submit.
        const isSemanticSingleShot = current.playbook.name === 'generation.single-shot'
          && current.generationPlan?.operationId === current.runId
        let changedUnknown = false
        for (const job of current.jobs) {
          if (!isStillAtProvider(job)) continue
          if (isSemanticSingleShot) {
            // 提交在路上时进程没了（硬杀 / 断电）：请求发没发出去、供应商收没收下，Nomi 都不知道——结果未知，
            // 和连接被重置是同一档。此前这里直接跳过，job 永远停在 submitting、画布一直写「生成中」。
            // 已经拿到任务号的（polling 等）仍由 ProductionGenerationSubmission 的恢复路径接手。
            if (job.status === 'submitting' && !job.providerTaskId) {
              try {
                current = executeInternal(safeProjectId, current.runId, current, 'job.status', {
                  jobId: job.jobId,
                  status: 'submission_unknown',
                  patch: { errorCode: 'submission_unknown_restart', errorMessage: tagNomiError('submission-unknown', 'Nomi was closed while the request was being sent') },
                }, `recovery-${current.runId}-${job.jobId}-submit-unknown`).run
                const reservationId: string = `${current.runId}:${job.jobId}:${job.attempt}`
                if (repository.readBudgetLedger(safeProjectId, current.runId).reservations[reservationId]?.status === 'reserved') {
                  current = executeInternal(safeProjectId, current.runId, current, 'budget.entry', {
                    entry: { billingEntryId: `${reservationId}:mark-unsettled`, kind: 'mark_unsettled', reservationId, occurredAt: new Date().toISOString() },
                  }, `recovery-${current.runId}-${job.jobId}-unsettled`).run
                }
                changedUnknown = true
              } catch {
                // A concurrent command may have already settled this job.
              }
            }
            continue
          }
          try {
            current = executeInternal(safeProjectId, current.runId, current, 'job.status', {
              jobId: job.jobId,
              status: 'submission_unknown',
              patch: { errorCode: 'restart_recovery_required', errorMessage: 'Nomi 重启后无法确认供应商状态，请先对账' },
            }, `recovery-${current.runId}-${job.jobId}-${current.revision}`).run
            changedUnknown = true
          } catch {
            // A concurrent command may have already reconciled this job.
          }
        }
        current = requireRun(safeProjectId, current.runId)
        if (changedUnknown && current.status !== 'needs_attention') {
          try { current = executeInternal(safeProjectId, current.runId, current, 'run.status', { status: 'needs_attention', reason: 'restart_recovery' }, `recovery-${current.runId}-attention-${current.revision}`).run } catch { /* preserve the durable job state */ }
        }
        if (current.status === 'exporting') {
          try { current = executeInternal(safeProjectId, current.runId, current, 'run.status', { status: 'needs_attention', reason: 'restart_recovery' }, `recovery-${current.runId}-export-attention-${current.revision}`).run } catch { /* preserve exporting state for inspection */ }
        }
        // B1/B3：草稿建好时 GUI 关着 → 重开时补动作。budget_only 自动批准方向门，其余补拟候选（gate 还 waiting 且无候选才跑）。
        if (current.status === 'awaiting_direction') {
          if (trustLevelOf(current.policy) === 'budget_only') void autoApproveGate(current.projectId, current.runId, 'gate-direction-v1')
          else void proposeDirections(current)
        }
        if (current.status === 'running' && current.stageId === 'direction') void proposeScript(current)
        const qaStage = current.stages.find((stage) => stage.stageId === 'qa')
        const resumableProductionStage = current.status === 'running'
          && (current.stageId === 'qa' || current.stageId === 'assemble' || current.stageId === 'generate' && qaStage?.status !== 'completed')
        if (current.status === 'ready'
          || current.status === 'running' && current.jobs.some((job) => ['authorized', 'submit_intent_persisted'].includes(job.status))
          || resumableProductionStage) {
          void driveGeneration(current)
        }
      }
    } catch (error) {
      logError('production-run', 'recovery-scan-failed', error)
    } finally {
      recoveryInFlight.delete(safeProjectId)
    }
  }

  function readProjection(projectId: string, runId: string): ProductionRunProjection {
    return runProjection(requireRun(projectId, runId), projectRootResolver, previewSecret)
  }

  function readFull(projectId: string, runId: string): ProductionRun {
    const run = requireRun(projectId, runId)
    return recoverStoryboardContentHashes(run, projectRootResolver(run.projectId))
  }

  const artifactOperations = createArtifactOperations({
    repository,
    projectRootResolver,
    previewSecret,
    requestRenderer,
    requireRun,
    command,
    writeProjectJson,
    runProjection: (run) => runProjection(run, projectRootResolver, previewSecret),
    identifier,
    buildDeepLink: buildProductionDeepLink,
  })
  const {
    readArtifactProjection,
    readArtifactContent,
    readScriptDraft,
    requestArtifactRevision,
    reviewArtifact,
    materializeStoryboard,
  } = artifactOperations

  async function readEvents(projectId: string, runId: string, afterCursor = 0, waitMs = 0): Promise<{
    events: ProductionEventProjection[]
    nextCursor: number
  }> {
    const run = requireRun(projectId, runId)
    const cursor = Number.isInteger(afterCursor) && afterCursor >= 0 ? afterCursor : 0
    const boundedWaitMs = Math.min(25_000, Math.max(0, Math.floor(waitMs)))
    const deadline = Date.now() + boundedWaitMs
    let durableEvents = repository.readEvents(run.projectId, run.runId, cursor)
    while (durableEvents.length === 0 && Date.now() < deadline) {
      await sleep(Math.min(250, Math.max(1, deadline - Date.now())))
      durableEvents = repository.readEvents(run.projectId, run.runId, cursor)
    }
    const nextCursor = durableEvents.reduce((latest, event) => Math.max(latest, event.cursor), cursor)
    return { events: durableEvents.filter((event) => MEANINGFUL_EVENT_TYPES.has(event.type)).map(eventProjection), nextCursor }
  }

  function resolveArtifactPreview(token: string): { filePath: string; expiresAt: string } {
    const claims = verifyArtifactPreviewHandle({ token, secret: previewSecret })
    const run = requireRun(claims.projectId, claims.runId)
    const artifact = run.artifacts.find((candidate) => candidate.artifactId === claims.artifactId)
    if (!artifact) throw new Error('Production artifact preview scope mismatch')
    const relativePath = artifact.thumbnailRelativePath || artifact.projectRelativePath
    if (!relativePath || relativePath.replace(/\\/g, '/') !== claims.relativePath) {
      throw new Error('Production artifact preview path mismatch')
    }
    const root = projectRootResolver(run.projectId)
    if (!root) throw new Error('Production artifact preview root unavailable')
    return { filePath: resolveOwnedArtifactFile(root, claims.relativePath), expiresAt: claims.expiresAt }
  }


  return {
    // Semantic generation is a thin orchestration layer; ProductionRun remains the only durable owner.
    repository,
    createDraft, createGenerationDraft, readProjection, readFull, readEvents, readArtifactProjection, readArtifactContent, readScriptDraft,
    requestArtifactRevision, reviewArtifact, materializeStoryboard, resolveArtifactPreview, command, proposeScript, proposeStoryboard,
    advanceSemanticProduction, resumeUnfinishedRuns,
  }
}
export type ProductionRunService = ReturnType<typeof createProductionRunService>
