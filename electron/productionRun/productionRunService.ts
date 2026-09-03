import crypto from 'node:crypto'
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
import { createDriverOps } from './productionRunDriverOps'
import { isShotGate } from './productionRunGateIdentity'
import { withEventTap } from './productionRunEventTap'
import { assertStoryboardSourceFresh, createArtifactOperations } from './productionRunArtifactOperations'
import { assertStoryboardSourceApproved } from './productionRunReducer'
import { MEANINGFUL_EVENT_TYPES } from './productionRunMeaningfulEvents'
import { readAutomationPolicySettings } from '../settings/automationPolicySettings'
import { assertProductionPolicyReady } from './productionPolicyReadiness'
import { normalizeTrustLevel, trustLevelOf } from './productionRunTypes'
import { approvalReceiptForGate } from './productionRunApprovalReceipt'
import { isAnchorCheckpointGate } from './anchorCheckpoint'
import { kickBatchSchedulerForRun } from './batchSchedulerKick'
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
import { eventProjection, runProjection } from './productionRunProjections'
import type { ProductionEventProjection, ProductionRunProjection } from './productionRunProjections'
// 投影类型的公共 API 位置不变：外部调用方仍从本模块 import。
export type {
  ProductionRunProjection,
  ProductionEventProjection,
  ProductionArtifactProjection,
  MaterializeStoryboardResult,
} from './productionRunProjections'


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
  /** Optional main-process receipt owner. When supplied, gate.decide must verify and consume a receipt. */
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
      mode: settings.mode,
      trustedHosts: [...settings.trustedHosts],
      allowedProviders: [...settings.allowedProviders],
      allowedModels: [...settings.allowedModels],
      maxSpend: settings.maxSpend,
      maxAttemptsPerJob: settings.maxAttemptsPerJob,
      minimizeUploads: settings.minimizeUploads,
    }
  })
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
    if (!run) throw new Error(`Production run not found: ${safeRunId}`)
    if (run.projectId !== safeProjectId) throw new Error('Production run project mismatch')
    return run
  }

  function createDraft(input: CreateProductionRunInput): ProductionRunProjection {
    const run = repository.create({
      ...input,
      runId: input.runId ? identifier(input.runId, 'run') : undefined,
      policy: { ...policyResolver(), ...(input.policy || {}) },
    })
    // create 只可能产出「等方向 + 至少一道门 + 零任务零预算」的草稿：未登记的 playbook / 缺 brief
    // 在 repository 层就抛错（productionPlaybooks.ts），draft 已不可达，这里不再给它留口子。
    if (run.status !== 'awaiting_direction' || run.gates.length === 0 || run.jobs.length > 0 || run.budget.authorized !== 0) {
      throw new Error('Production draft invariant failed')
    }
    // B3：budget_only（「别问了直接出」）→ 自动批准创意方向门（留痕），不拟候选、不打扰。
    // 其余档位 → 异步拟方向候选（GUI 有 LLM 才成；关着则保持兜底 gate）。均不阻塞返回。
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
    shots?: ReadonlyArray<Pick<ProductionGenerationShot, 'shotId' | 'role' | 'included' | 'candidate'>>
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
    if (runCommand.type === 'job.reconcile') {
      const current = requireRun(safeProjectId, safeRunId)
      const jobId = typeof runCommand.payload.jobId === 'string' ? runCommand.payload.jobId.trim() : ''
      const outcome = runCommand.payload.outcome
      const job = current.jobs.find((candidate) => candidate.jobId === jobId)
      if (!job || job.status !== 'submission_unknown') throw new Error('Production job is not awaiting reconciliation')
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
      const result = repository.execute(safeProjectId, safeRunId, {
        ...runCommand,
        type: 'policy.set',
        payload: { policy: { ...current.policy, trustLevel } },
      })
      if (trustLevel === 'budget_only') {
        const waitingCreativeGate = result.run.gates.find((gate) => gate.status === 'waiting' && (
          gate.scope === 'stage' && (gate.gateId.startsWith('gate-direction-') || gate.gateId.startsWith('gate-sample-'))
          || isShotGate(gate)
        ))
        if (waitingCreativeGate) void autoApproveGate(safeProjectId, safeRunId, waitingCreativeGate.gateId)
      }
      return result
    }
    if (runCommand.type === 'run.control') {
      // A4 run 控制：逻辑在 productionRunControl.ts（MCP 与渲染端同一收口）。
      const controlled = applyRunControl(repository, safeProjectId, safeRunId, requireRun(safeProjectId, safeRunId), runCommand)
      if (runCommand.payload.action === 'resume' && controlled.run.status === 'running') void driveGeneration(controlled.run) // 恢复必须重踢 driver：只回状态不回工作=假 resume
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
    if (runCommand.type === 'gate.decide') {
      // B4 幂等：两个审批同时来（异 commandId、同决议）——门已按同方向决过 → 幂等 no-op，
      // 返回当前态、不再执行（不重复授权预算 / 不重踢 driver / 不炸「already decided」）。
      // 翻决议（approved↔rejected）不在此放行 → 落到 reducer 拒改写。竞态的输家由此静默收敛。
      const current = requireRun(safeProjectId, safeRunId)
      const gateId = typeof runCommand.payload.gateId === 'string' ? runCommand.payload.gateId.trim() : ''
      const decidedGate = current.gates.find((item) => item.gateId === gateId)
      if (decidedGate && decidedGate.status !== 'waiting' && decidedGate.status === runCommand.payload.status) {
        return { run: current, events: [] }
      }
    }
    const gateReceipt = approvalReceiptForGate(
      deps.approvalReceiptAuthority,
      safeProjectId,
      safeRunId,
      runCommand,
      deps.projectRevisionResolver,
    )
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
    if (gateReceipt && deps.approvalReceiptAuthority) {
      // The Run event is durable before receipt consumption. A crash can only leave
      // a replayable receipt against an already-decided gate; it cannot reopen it.
      deps.approvalReceiptAuthority.consumeReceipt(gateReceipt.token)
    }
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
          console.error('[nomi:production] freeze gate reject pause failed:', error instanceof Error ? error.message : String(error))
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
          console.error('[nomi:production] sample gate reject pause failed:', error instanceof Error ? error.message : String(error))
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
          console.error('[nomi:production] shot gate reject pause failed:', error instanceof Error ? error.message : String(error))
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
      kickBatchSchedulerForRun(safeProjectId, safeRunId)
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
      await command(projectId, runId, {
        commandId: `auto-trust-budget-only:${gateId}:${current.revision}`,
        expectedRevision: current.revision,
        type: 'gate.decide',
        payload: { gateId, status: 'approved' },
        issuedAt: new Date().toISOString(),
      })
    } catch (error) {
      // 自动批准失败不掩盖 run：门仍 waiting、可手动批。
      console.error('[nomi:production] auto-approve gate failed:', error instanceof Error ? error.message : String(error))
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
        if (!current || ['completed', 'cancelled'].includes(current.status)) continue
        // Semantic single-shot runs own recovery through ProductionGenerationSubmission
        // (resume/poll/reconcile). The legacy playbook driver must not rewrite their
        // durable provider state to submission_unknown or kick a second submit.
        const isSemanticSingleShot = current.playbook.name === 'generation.single-shot'
          && current.generationPlan?.operationId === current.runId
        let changedUnknown = false
        for (const job of current.jobs) {
          if (!['submitting', 'provider_accepted', 'polling', 'retry_wait', 'downloading', 'validating_technical', 'validating_content'].includes(job.status)) continue
          if (isSemanticSingleShot) continue
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
          try { current = executeInternal(safeProjectId, current.runId, current, 'run.status', { status: 'needs_attention' }, `recovery-${current.runId}-attention-${current.revision}`).run } catch { /* preserve the durable job state */ }
        }
        if (current.status === 'exporting') {
          try { current = executeInternal(safeProjectId, current.runId, current, 'run.status', { status: 'needs_attention' }, `recovery-${current.runId}-export-attention-${current.revision}`).run } catch { /* preserve exporting state for inspection */ }
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
      console.error('[nomi:production] recovery scan failed:', error instanceof Error ? error.message : String(error))
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

  function listProjections(projectId: string): ProductionRunProjection[] {
    return repository.list(identifier(projectId, 'project')).map((summary) => runProjection(requireRun(projectId, summary.runId), projectRootResolver, previewSecret))
  }

  function listFull(projectId: string): ProductionRun[] {
    return repository.list(identifier(projectId, 'project')).map((summary) => requireRun(projectId, summary.runId))
  }
  return {
    // Semantic generation is a thin orchestration layer; ProductionRun remains the only durable owner.
    repository,
    createDraft, createGenerationDraft, readProjection, readFull, readEvents, readArtifactProjection, readArtifactContent, readScriptDraft,
    requestArtifactRevision, reviewArtifact, materializeStoryboard, resolveArtifactPreview, command, proposeScript, proposeStoryboard,
    advanceSemanticProduction, resumeUnfinishedRuns, listProjections, listFull,
  }
}
export type ProductionRunService = ReturnType<typeof createProductionRunService>
