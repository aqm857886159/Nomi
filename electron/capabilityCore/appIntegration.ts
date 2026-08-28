// 能力核 · app 集成（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S4）。
//
// 把 RPC server + token + 实例广告接到运行中的 Nomi app：启动时拉起 RPC（127.0.0.1）、ensureToken、
// 写实例广告让外部 CLI/MCP 探测得到「app 开着」；退出时清广告 + 关 server。
// 「当前项目」只投影 main-owned Surface committed identity；renderer 不再上报可执行项目标量。
//
// **库指纹 + 心跳**（2026-08-18 §P3-F）：广告写 v2——带 projectsRoot（本实例真正服务的库，取自
// getProjectLocationState，与 runtimePaths 同源，不另派生）+ heartbeatAt（每 HEARTBEAT_INTERVAL_MS 刷新的
// 心跳）+ version:2。非默认库的广告落命名空间文件（instance-<hash>.json），走查/fixture 宿主结构上抢不到生产
// advert。bare-Node launcher 据此校验归属、心跳陈旧即快速失败（见 mcpNodeLauncher）。
//
// 这里只做接线，不碰 main.ts 的其它职责（保持 main.ts 精简、单一关注点）。
import { app } from 'electron'
import crypto from 'node:crypto'
import path from 'node:path'
import { startRpcServer, type RpcServerHandle, type RpcServerOptions } from './rpcServer'
import { capabilityCoreDir, ensureCapabilitySigningKey, ensureToken } from './security'
import { clearInstanceAdvertisement, writeInstanceAdvertisement } from './lockfile'
import { HEARTBEAT_INTERVAL_MS, type InstanceAdvertisement } from './instanceAdvert'
import { getProjectLocationState, getWorkspaceRepositoryDeps } from '../runtimePaths'
import type { FetchTaskResultFn, RunTaskFn } from './core'
import { getProductionRunService } from '../productionRun/productionRunRuntime'
import { createApprovalReceiptAuthority, type ApprovalReceiptAuthority } from './approvalReceipt'
import { createProductionRunLock } from '../productionRun/productionRunLock'
import { readWorkspaceProject, resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { createRuntimeMcpGenerationPolicy, type McpGenerationPolicy } from './mcpGenerationPolicy'
import type { DispatchContext } from './dispatcher'
import { requestRenderer, rendererTargetIdentity } from './rendererBridge'
import { createGenerationPlanningHandler } from './mcpGenerationTools'
import { createProductionGenerationOperationStore } from '../productionRun/productionGenerationOperationStore'
import { createProductionGenerationSubmission } from '../productionRun/productionGenerationSubmission'
import { createMultiShotBatchScheduler, type MultiShotBatchScheduler } from '../productionRun/multiShotBatchScheduler'
import { registerBatchSchedulerKicker } from '../productionRun/batchSchedulerKick'
import type { ProductionActionResult } from '../productionRun/productionRunTypes'
import { landCanvasForRun } from '../productionRun/multiShotCanvasLanding'
import { createArtifactProjection, getArtifactPreviewSecret } from '../productionRun/artifactProjection'
import { createCatalogModelPricingResolver, createCatalogShotPriceResolver } from '../productionRun/catalogPricingResolver'
import type { ModuleRegistry } from './moduleRegistry'
import { createCatalogModuleRegistry } from './moduleCatalogBootstrap'
import { createGenerationProviderBootstrap } from './generationProviderBootstrap'
import { createGenerationOutputMaterializer } from './generationOutputMaterializer'
import { readCatalog } from '../catalog/catalogStore'
import { buildVideoModelCandidates, recommendVideoGeneration, videoArchetypeIdFromMeta } from '../shared/videoCapabilities'
import { createProductionProjectSessionRuntime } from './projectSessionRuntime'
import { canvasReadSurfaceRuntime } from './canvasReadSurfaceRuntime'
import type { CanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'

let handle: RpcServerHandle | null = null
// P4 S5：打开/切换项目时的补齐钩子（startCapabilityCore 装配后设进来）——按 run.jobs[].nodeId × artifacts
// 幂等补落缺失节点/组、回填已完成 result，并恢复未完批次调度（resumeUnfinishedRuns）。模块级 hoist 是因为
let reconcileOpenProjectHook: ((projectId: string) => void) | null = null
let unsubscribeCommittedSurface: (() => void) | null = null
// P4 S6：返工/续拍编排钩子（start 闭包装配后设进来）——住在 start 闭包里因为它们要用 scheduler builder +
// 单镜 gate 确认（confirmGenerationInNomi + 收据机构）+ 提交门面，这些都在闭包内。main.ts 的 IPC 转调这两个导出。
let reworkProductionShotHook: ((input: { projectId: string; runId: string; shotId?: string }) => Promise<ProductionActionResult>) | null = null
let resumeProductionBatchHook: ((input: { projectId: string; runId: string; reason: 'budget' | 'manual' }) => Promise<ProductionActionResult>) | null = null
// 心跳定时器 + 当前广告所在库（退出时按同一命名空间文件名清理）。
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let advertisedLibrary: { projectsRoot: string; isDefault: boolean } | null = null

function createDefaultAuthorities(generationPolicy: McpGenerationPolicy, hooks: {
  /**
   * P4 S4 试拍首镜 (§6 T3): called when a multi-shot confirmation card resolves trialFirst. Narrows the
   * plan to shot 1 and re-seals it durably, so the client's re-requested gate lists a single shot. The
   * challenge's runId is the operationId. Failures are swallowed (the client still gets trialFirst and
   * can re-request the gate; a failed narrow only means the re-gate still lists the full plan).
   */
  onTrialFirst?: (input: { projectId: string; operationId: string }) => void | Promise<void>
} = {}): Pick<
  DispatchContext,
  'approvalReceiptAuthority' | 'projectRevisionResolver' | 'confirmGenerationInNomi'
> & Pick<RpcServerOptions, 'projectSessionAuthority'> {
  const authorityDir = capabilityCoreDir()
  const sharedLock = createProductionRunLock({
    filePath: path.join(authorityDir, 'semantic-authorities.lock'),
    epochPath: path.join(authorityDir, 'semantic-authorities.epoch'),
    ownerId: `capability-core-${process.pid}`,
  })
  const projectSession = createProductionProjectSessionRuntime({
    generationPolicy,
    getOpenProjectSelection: canvasReadSurfaceRuntime.getCommittedProjectSelection,
    // Existing non-current projects are not implicitly authorized merely
    // because they exist. A future allowlist must be an explicit policy.
    isServerAllowlisted: () => false,
  })
  const receiptAuthority = createApprovalReceiptAuthority({
    filePath: path.join(authorityDir, 'approval-receipts.json'),
    macKey: ensureCapabilitySigningKey('approval-receipt'),
    storeMacKey: ensureCapabilitySigningKey('approval-receipt-store'),
    keyId: 'approval-receipt-v1',
    lock: sharedLock,
  })
  const confirmGenerationInNomi = async ({ challengeToken }: { challengeToken: string }) => {
    const challenge = receiptAuthority.verifyChallenge(challengeToken)
    const target = rendererTargetIdentity()
    if (!target || !challenge.display?.model) return { confirmed: false, challengeId: challenge.challengeId }
    const result = await requestRenderer('generation.gate.confirm', {
      challengeId: challenge.challengeId,
      projectName: challenge.display.projectName,
      shotSummary: challenge.display.shotSummary,
      model: challenge.display.model,
      referenceCount: challenge.display.referenceCount,
      maximumCost: challenge.reservationPreview.maximum,
      currency: challenge.reservationPreview.currency,
      expiresAt: challenge.expiresAt,
      // P4 S3a — forward the (MAC-signed) multi-shot projection when the challenge carries one; a
      // single-shot challenge omits it and the renderer keeps rendering today's flat card unchanged.
      ...(challenge.display.shots ? { shots: challenge.display.shots } : {}),
    }, 60_000) as { confirmed?: unknown; trialFirst?: unknown } | null
    // P4 S3a/S4 — 「先试拍第 1 镜」信号：渲染层回 { confirmed:false, trialFirst:true }。S4 在此把计划缩到
    // 首镜 + 重封存（onTrialFirst），随后客户端重发 gate → 新卡只列 1 镜；narrow 失败只降级为「重发仍列全批」。
    if (result?.confirmed !== true) {
      if (result?.trialFirst === true && hooks.onTrialFirst && challenge.runId && challenge.projectId) {
        try {
          await hooks.onTrialFirst({ projectId: challenge.projectId, operationId: challenge.runId })
        } catch (error) {
          console.error('[nomi:capability-core] trial-first narrow failed:', error instanceof Error ? error.message : String(error))
        }
      }
      return {
        confirmed: false,
        challengeId: challenge.challengeId,
        ...(result?.trialFirst === true ? { trialFirst: true } : {}),
      }
    }
    const attestation = receiptAuthority.createMainProcessGestureAttestation(challengeToken, {
      ...target,
      decision: 'accept',
    })
    const receipt = receiptAuthority.mintReceipt(challengeToken, attestation)
    return {
      confirmed: true,
      challengeId: challenge.challengeId,
      receiptId: receipt.receipt.receiptId,
      receiptToken: receipt.token,
    }
  }
  return {
    projectSessionAuthority: projectSession.authority,
    approvalReceiptAuthority: receiptAuthority,
    confirmGenerationInNomi,
    projectRevisionResolver: (projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps())?.revision,
  }
}

/** 当前进程 RPC 端口（未启动=null）。「接入助手卡」据此显示能力核就绪态。 */
export function getCapabilityPort(): number | null {
  return handle?.port ?? null
}

/**
 * P4 S6：渲染层（经 main.ts IPC）请求返工一镜 → 同 Run 新 Job + 单镜 gate 确认 + 派发。能力核未就绪 → unavailable。
 * projectId 守卫（须 = 当前打开项目）在 hook 内做。绝不在结果里带任何密钥（只回结构化 code + 可选人话 message）。
 */
export async function reworkProductionShot(input: { projectId: string; runId: string; shotId?: string }): Promise<ProductionActionResult> {
  if (!reworkProductionShotHook) return { ok: false, code: 'unavailable' }
  return reworkProductionShotHook(input)
}

/** P4 S6：渲染层请求续拍已停批次（manual=急停继续 / budget=提额续拍）。能力核未就绪 → unavailable。 */
export async function resumeProductionBatch(input: { projectId: string; runId: string; reason: 'budget' | 'manual' }): Promise<ProductionActionResult> {
  if (!resumeProductionBatchHook) return { ok: false, code: 'unavailable' }
  return resumeProductionBatchHook(input)
}

/** 组装本实例的 v2 广告：projectsRoot 取自 getProjectLocationState（与 runtimePaths 同源），心跳戳 = now。 */
function buildAdvert(port: number, token: string, projectsRoot: string): InstanceAdvertisement {
  const now = Date.now()
  return {
    version: 2,
    pid: process.pid,
    port,
    token,
    startedAt: now,
    projectsRoot,
    heartbeatAt: now,
    appVersion: typeof app.getVersion === 'function' ? app.getVersion() : '',
  }
}

/**
 * 启动能力核对外口。绝不拖垮 app 启动：任何失败只记日志、不抛（fail-open，与 applySystemProxy 同纪律）。
 */
export async function startCapabilityCore(
  runTask: RunTaskFn,
  fetchTaskResult: FetchTaskResultFn,
  authorities: {
    approvalReceiptAuthority?: ApprovalReceiptAuthority
    requestGenerationGate?: DispatchContext['requestGenerationGate']
    authorizeGeneration?: DispatchContext['authorizeGeneration']
    confirmGenerationInNomi?: import('./rpcServer').RpcServerOptions['confirmGenerationInNomi']
    generationPolicy?: McpGenerationPolicy
    generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
    generationPlanning?: DispatchContext['generationPlanning']
    generationModuleRegistry?: Pick<ModuleRegistry, 'resolve'>
    projectRevisionResolver?: (projectId: string) => number | undefined
    canvasReadExecutionRuntime?: CanvasReadExecutionRuntime
  } = {},
): Promise<void> {
  try {
    const token = ensureToken()
    const generationService = getProductionRunService()
    const operationStore = createProductionGenerationOperationStore(generationService)
    const generationPolicy = authorities.generationPolicy ?? createRuntimeMcpGenerationPolicy()
    // P4 S4: wire the trial-first narrow into the confirmation seam. When a multi-shot card resolves
    // trialFirst, narrow the durable plan to shot 1 (a fresh plan hash) so the re-requested gate lists 1
    // shot. Guarded by the same operationId the challenge carries as runId.
    const defaults = createDefaultAuthorities(generationPolicy, {
      onTrialFirst: async ({ projectId, operationId }) => {
        if (!operationStore.trialNarrow) return
        const trialPlanHash = `trial:${operationId}:${crypto.randomUUID()}`
        await operationStore.trialNarrow(projectId, operationId, trialPlanHash, new Date().toISOString())
      },
    })
    const providerBootstrap = createGenerationProviderBootstrap()
    const outputMaterializer = createGenerationOutputMaterializer()
    const generationRegistry = authorities.generationModuleRegistry ?? createCatalogModuleRegistry(undefined, { readinessByProvider: providerBootstrap.readinessByProvider })
    const videoModelCandidates = buildVideoModelCandidates(readCatalog().models
      .filter((model) => model.enabled && model.kind === 'video')
      .map((model) => ({
        provider: model.vendorKey,
        modelKey: model.modelKey,
        label: model.labelZh,
        archetypeId: videoArchetypeIdFromMeta(model.meta),
        parameterControls: model.onboarding?.fields?.map((field) => ({
          key: field.key,
          label: field.displayName,
          type: field.type,
          options: (field.options ?? []).map((option) => ({ value: option.value, label: option.label })),
          ...(field.default === undefined ? {} : { defaultValue: field.default }),
        })),
      })))
    // P4 S2: real per-shot pricing from the live catalog (resolve lazily so pricing edits apply).
    const resolveModelPricing = (providerId: string, modelId: string) => createCatalogModelPricingResolver(readCatalog().models)(providerId, modelId)
    const resolveShotPrice = (contract: Parameters<ReturnType<typeof createCatalogShotPriceResolver>>[0]) => createCatalogShotPriceResolver(readCatalog().models)(contract)
    // P4 S5：只认 main-issued Surface 的完整 committed identity；renderer scalar 不是 authority。
    const isProjectOpen = (id: string) => canvasReadSurfaceRuntime.getCommittedProjectSelection()?.projectId === id
    // P4 S5：把一个 Run 的镜尽力落成画布占位/组/回填 result，并把 shotId→nodeId 写回 Run（best-effort，永不抛）。
    // 确认即落与打开项目补齐（reconcileOpenProject）共用它——一个家（P1）。
    const landCanvasBestEffort = async (projectId: string, runId: string): Promise<boolean> => {
      let run
      try {
        run = generationService.repository.read(projectId, runId)
      } catch {
        return false
      }
      if (!run) return false
      const projectRoot = resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
      return landCanvasForRun(run, {
        requestRenderer,
        projectRoot,
        previewSecret: getArtifactPreviewSecret(),
        planName: run.brief?.goal,
        bindShotNodes: async (boundProjectId, boundRunId, expectedRevision, bindings) => {
          await generationService.command(boundProjectId, boundRunId, {
            commandId: `canvas-landing:${boundRunId}:bind:${bindings.map((binding) => `${binding.shotId}=${binding.nodeId}`).join(',')}`.slice(0, 200),
            expectedRevision,
            type: 'plan.bind-shot-nodes',
            payload: { bindings },
            issuedAt: new Date().toISOString(),
          })
        },
      })
    }
    // P4 S5：一镜落地 → 把它的 result 推给渲染层回填占位节点（逐个冒）。best-effort：项目没开/渲染层不可用/
    // 该镜没绑 nodeId → 静默跳过。渲染层 attach 会断言 result.url 为 nomi-local://（我们这里就用 preview.nomiUrl）。
    const pushShotResultToRenderer = async (projectId: string, runId: string, shotId: string): Promise<void> => {
      if (!isProjectOpen(projectId)) return
      let run
      try {
        run = generationService.repository.read(projectId, runId)
      } catch {
        return
      }
      if (!run) return
      const shot = (run.generationPlan?.shots ?? []).find((candidate) => candidate.shotId === shotId)
      const nodeId = shot?.nodeId
      if (!nodeId) return // 该镜没绑画布节点（确认时项目没开等）→ 打开项目时由 materialize-shots 一并回填
      const job = run.jobs.find((candidate) => typeof candidate.metadata?.shotId === 'string' && candidate.metadata.shotId === shotId && (candidate.status === 'ready' || candidate.status === 'adopted'))
      if (!job) return
      const artifact = run.artifacts.find((candidate) => candidate.jobId === job.jobId && (candidate.kind === 'image' || candidate.kind === 'video') && (candidate.status === 'ready' || candidate.status === 'adopted'))
      if (!artifact || !(artifact.projectRelativePath || artifact.thumbnailRelativePath)) return
      const projectRoot = resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())
      if (!projectRoot) return
      try {
        const projected = createArtifactProjection({ projectRoot, run, artifact, secret: getArtifactPreviewSecret() })
        const url = projected.preview?.nomiUrl
        if (!url) return
        await requestRenderer('production.attach-shot-result', {
          projectId,
          runId,
          nodeId,
          shotId,
          result: { id: `production-${job.jobId}`, type: artifact.kind === 'image' ? 'image' : 'video', url, createdAt: Date.now() },
        }, 15_000)
      } catch (error) {
        console.warn('[nomi:production] push shot result failed:', error instanceof Error ? error.message : String(error))
      }
    }
    // P4 S4/S5：构造一个 Run 的提交门面（submission）。lease 身份（immutableProjectUuid/projectGeneration）
    // 从工作区记录读——**耐久 binding 已冻住这些值**，恢复时无需新 lease。provider 按 run 的合同 provider 解析。
    // 返回 null = provider 未配置 / 工程根不可达（调用方跳过，不驱动）。start 与 reconcile 共用它（P1）。
    const buildSubmissionForRun = (run: { projectId: string; generationPlan?: { candidate: { providerId: string } }; jobs: Array<{ provider: string }> }) => {
      const providerId = run.generationPlan?.candidate.providerId ?? run.jobs[0]?.provider
      const provider = providerId ? providerBootstrap.providers.find((candidate) => candidate.providerId === providerId) : undefined
      const projectRoot = resolveWorkspaceProjectDir(run.projectId, getWorkspaceRepositoryDeps())
      const record = readWorkspaceProject(run.projectId, getWorkspaceRepositoryDeps())
      if (!provider || !projectRoot || !record?.immutableProjectUuid || !record.projectGeneration) return null
      return createProductionGenerationSubmission({
        repository: generationService.repository,
        projectRoot,
        immutableProjectUuid: record.immutableProjectUuid,
        projectGeneration: record.projectGeneration,
        intentMacKey: ensureCapabilitySigningKey('generation-intent'),
        provider,
        resolveShotPrice,
        materializeOutput: ({ projectId, providerTaskId, output }) => outputMaterializer.materialize({ projectId, providerTaskId, output }),
      })
    }
    // P4 S5：re-kick 一个未完多镜批次的调度器（打开项目恢复用）。best-effort、不阻塞、异常只记 warn。
    // scheduler 无自有状态：从 jobs[]+ledger 纯派生「下一批」，已提交不重提、已完成不重扣（batchScheduleDerivation）。
    // P4 S6：构造一个 Run 的批次调度器（返工/续拍/恢复共用同一 builder，P1 一个家）。options 透传给 scheduler
    // （提额续拍传 raisePlanAuthorizationTo）。返回 null = provider 未配置 / 工程根不可达（调用方跳过）。
    const buildSchedulerForRun = (
      projectId: string,
      runId: string,
      run: { projectId: string; generationPlan?: { candidate: { providerId: string } }; jobs: Array<{ provider: string }> },
      options?: { raisePlanAuthorizationTo?: number },
    ) => {
      const submission = buildSubmissionForRun(run)
      if (!submission) return null
      return createMultiShotBatchScheduler({
        repository: generationService.repository,
        submission,
        projectId,
        runId,
        perShotPrice: (shot) => (shot.contract ? resolveShotPrice(shot.contract) : { known: false }),
        onShotMaterialized: (shotId) => pushShotResultToRenderer(projectId, runId, shotId),
        ...(options ? { options } : {}),
      })
    }
    // 慢供应商续力（2026-08-25，S6.5 APIMart 真付费验收抓到的死锁）：一次 drive 只等到 pollHorizon；
    // 没到静止点（quiescent:false = 还有可轮询的在飞 job / bounded-out）就定时再踢，直到批次真正落定。
    // 重启安全：定时器丢了没关系，开项目 reconcile 的 kick 经派生 observe 一样推进在飞 job。每 run 至多
    // 一个待踢定时器；kick 路径带在飞 dedupe（长跑 drive 存续期间 reconcile/timer 不叠踢——dedupe 只是
    // 省资源，正确性本就由 Run lock + intent log + commandId 幂等保住，漏网的并发 drive 也无害）。
    // rework/resume 语义路径不 dedupe：提额要立即落 ledger。
    const REKICK_DELAY_MS = 15_000
    const activeBatchDrives = new Set<string>()
    const batchRekickTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const scheduleBatchRekick = (projectId: string, runId: string): void => {
      const key = `${projectId}:${runId}`
      if (batchRekickTimers.has(key)) return
      const timer = setTimeout(() => {
        batchRekickTimers.delete(key)
        kickSchedulerForRun(projectId, runId)
      }, REKICK_DELAY_MS)
      timer.unref?.()
      batchRekickTimers.set(key, timer)
    }
    const driveScheduler = (projectId: string, runId: string, scheduler: MultiShotBatchScheduler, label: string): void => {
      const key = `${projectId}:${runId}`
      activeBatchDrives.add(key)
      void scheduler.runToQuiescence()
        .then((outcome) => {
          if (!outcome.quiescent) scheduleBatchRekick(projectId, runId)
        })
        .catch((error) => {
          console.warn(`[nomi:production] ${label} failed:`, error instanceof Error ? error.message : String(error))
        })
        .finally(() => activeBatchDrives.delete(key))
    }
    const kickSchedulerForRun = (projectId: string, runId: string): void => {
      if (activeBatchDrives.has(`${projectId}:${runId}`)) return // 已有长跑 drive；它的下一轮派生会接住新状态
      let run
      try {
        run = generationService.repository.read(projectId, runId)
      } catch {
        return
      }
      if (!run || !run.generationPlan?.shots || run.generationPlan.shots.length === 0) return
      if (run.generationPlan.state !== 'submitted') return // 还没确认过的草稿不驱动
      if (['completed', 'cancelled', 'paused', 'pausing'].includes(run.status)) return // 已停/急停不自动续
      const scheduler = buildSchedulerForRun(projectId, runId, run)
      if (!scheduler) return
      driveScheduler(projectId, runId, scheduler, 'batch resume tick')
    }
    // P4 §3.2：注册进 service 的 post-decide 重踢插槽——任何入口（MCP dispatcher / 渲染层 IPC / 未来的
    // 检查点卡）批完锚定妆照检查点，批次自动续跑，入口自己不用记得踢（batchSchedulerKick.ts 有为什么）。
    registerBatchSchedulerKicker(kickSchedulerForRun)
    const generationPlanning = authorities.generationPlanning
      ?? createGenerationPlanningHandler({
        registry: generationRegistry,
        operations: operationStore,
        videoModelCandidates,
        recommendVideoGeneration,
        resolveModelPricing,
        providerReadiness: ({ providerId }) => providerBootstrap.readinessByProvider[providerId] ?? { providerReady: false, missingForSubmit: ['configured_provider'] },
        start: async (operation, lease) => {
          const provider = providerBootstrap.providers.find((candidate) => candidate.providerId === operation.contract?.providerId)
          const projectRoot = resolveWorkspaceProjectDir(lease.projectId, getWorkspaceRepositoryDeps())
          if (!provider || !projectRoot || !operation.contract) return { operationId: operation.operationId, state: operation.state, nextAction: 'provider_not_configured' }
          const submission = createProductionGenerationSubmission({
            repository: generationService.repository,
            projectRoot,
            immutableProjectUuid: lease.immutableProjectUuid,
            projectGeneration: lease.projectGeneration,
            intentMacKey: ensureCapabilitySigningKey('generation-intent'),
            provider,
            resolveShotPrice,
            materializeOutput: ({ projectId, providerTaskId, output }) => outputMaterializer.materialize({ projectId, providerTaskId, output }),
          })
          // P4 S4: a multi-shot operation is driven by the durable batch scheduler (anchor → checkpoint →
          // shot batch, with budget halt + stop). A single-shot operation keeps the flat one-call start.
          if (operation.shots && operation.shots.length > 0) {
            // P4 S5 确认即落（§3.4 / T2）：项目正开 → 尽力先把「锚 + 勾选镜」落成占位节点 + 组，并把
            // shotId→nodeId 写回 Run（scheduler 随后建的 job 从 shot 继承 nodeId，供 reconcile/回填）。
            // best-effort：项目没开 / 渲染层不可用 / 落地失败都只记 warn，**绝不阻断生成**（Job 从合同派生，§1）。
            // 必须在 kick scheduler **之前**——否则 job 先建、shot 还没 nodeId，job 就不带 nodeId 了。
            if (isProjectOpen(lease.projectId)) {
              await landCanvasBestEffort(lease.projectId, operation.operationId)
            }
            // P4 S6.5 生产入口修根因：调度器只驱动 state==='submitted' 的多镜计划（multiShotBatchScheduler
            // batchActive 判据）。单镜走 submission.start 内部会转 submitted；多镜这条分支此前**从不转
            // submitted**，sealed+approved 的计划停在 sealed → batchActive 恒 false → 调度器空转（S4/S5
            // e2e 用 setup 直发 generation.submit 绕过 appIntegration 才没暴露，正是「没有生产入口」的直接
            // 后果）。故 kick 前先经 durable 命令转 submitted（幂等：已 submitted 直接跳过）。
            const beforeKick = generationService.repository.read(lease.projectId, operation.operationId)
            if (beforeKick?.generationPlan?.state === 'sealed') {
              await generationService.command(lease.projectId, operation.operationId, {
                commandId: `generation.submit:${operation.operationId}:${beforeKick.generationPlan.planHash ?? beforeKick.generationPlan.contract?.contractHash ?? 'plan'}`,
                expectedRevision: beforeKick.revision,
                type: 'generation.submit',
                payload: {},
                issuedAt: new Date().toISOString(),
              })
            }
            const scheduler = createMultiShotBatchScheduler({
              repository: generationService.repository,
              submission,
              projectId: lease.projectId,
              runId: operation.operationId,
              perShotPrice: (shot) => (shot.contract ? resolveShotPrice(shot.contract) : { known: false }),
              onShotMaterialized: (shotId) => pushShotResultToRenderer(lease.projectId, operation.operationId, shotId),
            })
            // Kick the batch off the request path (durable + restart-safe): the scheduler runs to its next
            // resting point (anchors done + checkpoint waiting, or halt, or completion) without blocking.
            // 慢供应商没到静止点 → driveScheduler 定时再踢直到批次落定。
            driveScheduler(lease.projectId, operation.operationId, scheduler, 'batch scheduler tick')
            return { operationId: operation.operationId, state: operation.state, nextAction: 'observe' }
          }
          return submission.start({ projectId: lease.projectId, operationId: operation.operationId })
        },
        reconcile: async (operation, outcome, lease) => {
          if (outcome === 'not_found') return { operationId: operation.operationId, outcome, nextAction: 'manual_review' }
          const provider = providerBootstrap.providers.find((candidate) => candidate.providerId === operation.contract?.providerId)
          const projectRoot = resolveWorkspaceProjectDir(lease.projectId, getWorkspaceRepositoryDeps())
          if (!provider || !projectRoot || !operation.contract) return { operationId: operation.operationId, outcome, nextAction: 'manual_review' }
          if (!provider.query || !provider.capabilities.query) return { operationId: operation.operationId, outcome, nextAction: 'manual_review', recoveryNotice: '该供应商没有可用的任务查询；请到供应商核对。' }
          const submission = createProductionGenerationSubmission({
            repository: generationService.repository,
            projectRoot,
            immutableProjectUuid: lease.immutableProjectUuid,
            projectGeneration: lease.projectGeneration,
            intentMacKey: ensureCapabilitySigningKey('generation-intent'),
            provider,
            resolveShotPrice,
            materializeOutput: ({ projectId, providerTaskId, output }) => outputMaterializer.materialize({ projectId, providerTaskId, output }),
          })
          try {
            const polled = await submission.poll({ projectId: lease.projectId, operationId: operation.operationId })
            return polled.nextAction === 'materialize'
              ? await submission.materialize({ projectId: lease.projectId, operationId: operation.operationId })
              : polled
          } catch (error) {
            const code = (error as { code?: unknown })?.code
            if (code === 'provider_materialization_unsupported' || code === 'materialization_failed') return { operationId: operation.operationId, outcome, nextAction: 'manual_review', recoveryNotice: '供应商任务已完成，但结果还没有安全落到 Nomi 项目；请到供应商核对或稍后重试。' }
            throw error
          }
        },
      })
    // P4 S5：打开/切换项目时的补齐钩子（§3.4）。对该项目所有活跃 run：① landCanvasBestEffort 幂等补落缺失
    // 节点/组 + 回填已完成 result（materializationOperationId + 组章去重，跑两次不重复）；② resumeUnfinishedRuns
    // 恢复未完批次调度（S4 遗留的接上启动触发）。best-effort：异步、逐 run try/catch，不阻塞项目打开。
    reconcileOpenProjectHook = (projectId: string) => {
      void (async () => {
        try {
          const summaries = typeof generationService.repository.list === 'function' ? generationService.repository.list(projectId) : []
          for (const summary of summaries) {
            let run
            try {
              run = generationService.repository.read(projectId, summary.runId)
            } catch {
              continue
            }
            // 只补语义多镜 run（有 generationPlan.shots）且未终结的；单镜/legacy 不在此列。
            if (!run || ['completed', 'cancelled'].includes(run.status)) continue
            if (!run.generationPlan?.shots || run.generationPlan.shots.length === 0) continue
            // ① 幂等补落节点/组 + 回填已完成 result（materializationOperationId + 组章去重）。
            await landCanvasBestEffort(projectId, run.runId)
            // ② 恢复未完批次调度（从 jobs[]+ledger 纯派生「下一批」，已提交不重提、已完成不重扣）。
            kickSchedulerForRun(projectId, run.runId)
          }
        } catch (error) {
          console.warn('[nomi:production] open-project canvas reconcile failed:', error instanceof Error ? error.message : String(error))
        }
        // 顺带把 S4 遗留的 resumeUnfinishedRuns 接上启动触发（legacy driver / 单镜链的崩溃恢复；语义多镜批次
        // 由上面 kickSchedulerForRun 驱动，resumeUnfinishedRuns 内部会跳过 semantic-single-shot 不重复动它们）。
        try {
          await generationService.resumeUnfinishedRuns(projectId)
        } catch (error) {
          console.warn('[nomi:production] resume unfinished runs failed:', error instanceof Error ? error.message : String(error))
        }
      })()
    }
    // Late core startup must replay a Surface committed before the RPC server
    // was enabled, then follow subsequent suspend/commit/release projections.
    unsubscribeCommittedSurface?.()
    unsubscribeCommittedSurface = canvasReadSurfaceRuntime.subscribeCommittedProject((selection) => {
      if (selection && reconcileOpenProjectHook) reconcileOpenProjectHook(selection.projectId)
    })
    // P4 S6 返工编排（§3.5 / §3.B）：对一镜发起「同 Run 新 Job」→ 起**单镜 gate**（该镜子合同单价，复用唯一
    // spendConfirm 漏斗的扁平单镜卡 = 无 shots 键）→ 铸 receipt → durable `generation.approve` 带新 attempt（只批该
    // 镜，不动兄弟镜的批准）→ kick scheduler 派发这个 authorized 新 Job。锚 character_ref/DNA 提示词天然继承（新 Job
    // 复用该镜现有子合同）。用户取消/超时 → 新 Job 留 authorized 不扣费。**授权面只认 Nomi 自有确认（防注入）**。
    const reworkProductionShot = async (input: { projectId: string; runId: string; shotId?: string }): Promise<ProductionActionResult> => {
      const { projectId, runId, shotId } = input
      // 守卫：返工只对当前打开的项目（用户在本机对本项目操作，§3.C）。
      if (!isProjectOpen(projectId)) return { ok: false, code: 'run_not_open' }
      let run
      try {
        run = generationService.repository.read(projectId, runId)
      } catch {
        return { ok: false, code: 'failed', message: 'run read failed' }
      }
      if (!run || !run.generationPlan?.shots || run.generationPlan.shots.length === 0) return { ok: false, code: 'not_multishot' }
      const submission = buildSubmissionForRun(run)
      if (!submission) return { ok: false, code: 'unavailable' }
      const receiptAuthority = defaults.approvalReceiptAuthority
      const confirm = defaults.confirmGenerationInNomi
      const record = readWorkspaceProject(projectId, getWorkspaceRepositoryDeps())
      const projectRevision = record?.revision
      if (!receiptAuthority || !confirm || !record?.immutableProjectUuid || !record.projectGeneration || !Number.isInteger(projectRevision)) {
        return { ok: false, code: 'unavailable' }
      }
      // 1. 造新 attempt Job（authorized、parentJobId 谱系、继承子合同=锚继承）。无可返工的上一 job → no_prior_attempt。
      let rework
      try {
        rework = await submission.reworkShot({ projectId, operationId: runId, ...(shotId ? { shotId } : {}) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/No prior submission to rework/.test(message)) return { ok: false, code: 'no_prior_attempt' }
        return { ok: false, code: 'failed', message }
      }
      // 2. 起单镜 gate：用该镜子合同单价作 receipt 上界，display 用单镜形态（无 shots → 渲染层走扁平单镜卡）。
      const fresh = generationService.repository.read(projectId, runId)
      const shot = shotId ? (fresh?.generationPlan?.shots ?? []).find((candidate) => candidate.shotId === shotId) : undefined
      const shotContract = shot?.contract ?? fresh?.generationPlan?.contract
      const price = shotContract ? resolveShotPrice(shotContract) : { known: false as const }
      const maximumCost = price.known ? price.amount : 0
      const modelLabel = shotContract?.modelId ?? run.generationPlan.candidate.modelId ?? ''
      const shotSummary = typeof shot?.candidate.prompt === 'string' && shot.candidate.prompt.trim()
        ? shot.candidate.prompt.trim().slice(0, 80)
        : undefined
      const challenge = receiptAuthority.requestChallenge({
        challengeKey: `production.rework:${projectId}:${runId}:${shotId ?? 'default'}:${rework.attempt}`,
        immutableProjectUuid: record.immutableProjectUuid,
        projectGeneration: record.projectGeneration,
        projectId,
        runId,
        gateId: `generation-rework:${runId}:${shotId ?? 'default'}:${rework.attempt}`,
        contractHash: rework.contractHash,
        targetHash: rework.contractHash,
        projectRevision: projectRevision as number,
        costScope: 'production.rework',
        pricingSnapshotHash: rework.contractHash,
        reservationPreview: { currency: run.budget.currency, maximum: maximumCost },
        display: { model: modelLabel, ...(shotSummary ? { shotSummary } : {}), ...(shotContract?.references?.length ? { referenceCount: shotContract.references.length } : {}) },
      })
      // 3. 弹卡确认（Nomi 自有表面点头才算，防 prompt injection）。取消/超时 → 新 Job 留 authorized 不派发不扣费。
      // confirmGenerationInNomi 声明返回 unknown（DispatchContext 契约）；这里塑形到它的真实成功/取消形状。
      let confirmation: { confirmed?: unknown; receiptId?: unknown } | null
      try {
        confirmation = (await confirm({ challengeToken: challenge.token })) as { confirmed?: unknown; receiptId?: unknown } | null
      } catch (error) {
        return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
      const receiptId = confirmation?.confirmed === true && typeof confirmation.receiptId === 'string' ? confirmation.receiptId : ''
      if (!receiptId) {
        return { ok: false, code: 'rework_declined' }
      }
      // 4. durable approve（带新 attempt = 只批该镜的这次尝试；reducer 保留计划级 receipt、只重置该镜 approval）。
      try {
        const approving = generationService.repository.read(projectId, runId)
        if (!approving?.generationPlan) return { ok: false, code: 'failed', message: 'plan gone before approve' }
        const approvalHash = approving.generationPlan.shots ? approving.generationPlan.planHash : approving.generationPlan.contract?.contractHash
        await generationService.command(projectId, runId, {
          commandId: `production-rework-approve:${runId}:${shotId ?? 'default'}:${rework.attempt}`,
          expectedRevision: approving.revision,
          type: 'generation.approve',
          payload: { receiptId, contractHash: approvalHash, attempt: rework.attempt },
          issuedAt: new Date().toISOString(),
        })
        // reworkShot 把 plan 退回 sealed（reducer new_attempt）→ 重新标 submitted，scheduler 才驱动。
        const submitting = generationService.repository.read(projectId, runId)
        if (submitting?.generationPlan?.state !== 'submitted') {
          await generationService.command(projectId, runId, {
            commandId: `production-rework-submit:${runId}:${shotId ?? 'default'}:${rework.attempt}`,
            expectedRevision: submitting!.revision,
            type: 'generation.submit',
            payload: {},
            issuedAt: new Date().toISOString(),
          })
        }
      } catch (error) {
        return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
      // 5. kick scheduler：派发这个 authorized 新 Job（已完成兄弟镜不重扣）；提额上界给该镜单价（累计已授权则不降）。
      const kicking = generationService.repository.read(projectId, runId)
      if (kicking) {
        const scheduler = buildSchedulerForRun(projectId, runId, kicking, maximumCost > 0 ? { raisePlanAuthorizationTo: kicking.budget.authorized + maximumCost } : undefined)
        if (scheduler) {
          driveScheduler(projectId, runId, scheduler, 'rework dispatch tick')
        }
      }
      return { ok: true, code: 'reworked' }
    }
    // P4 S6 续拍编排（§3.3 / §3.B）：把已停批次（急停 paused / 预算 halt needs_attention）转回 running 后重踢
    // scheduler。manual（急停继续）= 转 running + kick；budget（提额续拍）= 转 running + kick 带 raisePlanAuthorizationTo
    // （抬到「已授权 + 剩余勾选镜预估上界」）。scheduler 无自有状态：已提交不重提、已完成不重扣（batchScheduleDerivation）。
    const resumeProductionBatch = async (input: { projectId: string; runId: string; reason: 'budget' | 'manual' }): Promise<ProductionActionResult> => {
      const { projectId, runId, reason } = input
      if (!isProjectOpen(projectId)) return { ok: false, code: 'run_not_open' }
      let run
      try {
        run = generationService.repository.read(projectId, runId)
      } catch {
        return { ok: false, code: 'failed', message: 'run read failed' }
      }
      if (!run || !run.generationPlan?.shots || run.generationPlan.shots.length === 0) return { ok: false, code: 'not_multishot' }
      if (run.generationPlan.state !== 'submitted') return { ok: false, code: 'failed', message: 'plan not submitted' }
      // 只从「可续拍的停态」转回 running（paused=急停、needs_attention=预算 halt）。其它态（running/completed/cancelled）
      // 不是待续拍——running 已在跑、completed/cancelled 是终态。pausing 是瞬态（等它落到 paused 再续）。
      if (run.status === 'paused' || run.status === 'needs_attention') {
        try {
          await generationService.command(projectId, runId, {
            commandId: `production-resume:${runId}:${run.revision}`,
            expectedRevision: run.revision,
            type: 'run.status',
            payload: { status: 'running' },
            issuedAt: new Date().toISOString(),
          })
        } catch (error) {
          return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
        }
      } else if (run.status !== 'running') {
        return { ok: false, code: 'failed', message: `run status ${run.status} is not resumable` }
      }
      const running = generationService.repository.read(projectId, runId)
      if (!running) return { ok: false, code: 'failed', message: 'run gone after resume' }
      // 提额续拍：抬到「已授权 + 剩余勾选镜预估上界」（scheduler 的 ledger 只接受 authorize ≥ 当前 liability，不降额）。
      let raiseTo: number | undefined
      if (reason === 'budget') {
        let remaining = 0
        for (const shot of running.generationPlan?.shots ?? []) {
          if (shot.role === 'anchor' || shot.included === false || !shot.contract) continue
          const price = resolveShotPrice(shot.contract)
          if (price.known) remaining += price.amount
        }
        raiseTo = running.budget.authorized + remaining
      }
      const scheduler = buildSchedulerForRun(projectId, runId, running, raiseTo !== undefined ? { raisePlanAuthorizationTo: raiseTo } : undefined)
      if (!scheduler) return { ok: false, code: 'unavailable' }
      driveScheduler(projectId, runId, scheduler, 'batch resume tick')
      return { ok: true, code: 'resumed' }
    }
    reworkProductionShotHook = reworkProductionShot
    resumeProductionBatchHook = resumeProductionBatch
    handle = await startRpcServer({
      runTask,
      fetchTaskResult,
      isProjectOpen,
      productionRuns: getProductionRunService(),
      ...defaults,
      ...authorities,
      generationPolicy,
      generationPlanning,
    })
    const location = getProjectLocationState()
    advertisedLibrary = { projectsRoot: location.path, isDefault: location.source === 'default' }
    writeInstanceAdvertisement(buildAdvert(handle.port, token, location.path), advertisedLibrary.isDefault)
    // 心跳：周期重写广告（刷新 heartbeatAt），让 launcher 能把「活着但卡死/挂起」的 wedged 实例与健康实例分开，
    // 从而快速失败而非盲等 60s。unref 让它不拖住进程退出。
    heartbeatTimer = setInterval(() => {
      try {
        if (!handle) return
        writeInstanceAdvertisement(buildAdvert(handle.port, token, location.path), advertisedLibrary!.isDefault)
      } catch {
        /* 心跳写失败不致命：读者的 pid 存活校验兜底 */
      }
    }, HEARTBEAT_INTERVAL_MS)
    heartbeatTimer.unref?.()
    console.log(`[nomi:capability-core] RPC 监听 127.0.0.1:${handle.port}（库 ${location.path}）`)
  } catch (error) {
    console.error('[nomi:capability-core] 启动失败（不影响 app）:', error)
  }
}

/** 退出清理：停心跳 + 清广告（按本实例的命名空间文件名）+ 关 server。同步触发、不抛，绝不卡退出。 */
export function stopCapabilityCore(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (advertisedLibrary) {
    clearInstanceAdvertisement(advertisedLibrary.projectsRoot, advertisedLibrary.isDefault)
    advertisedLibrary = null
  }
  if (handle) {
    void handle.close()
    handle = null
  }
  reconcileOpenProjectHook = null
  unsubscribeCommittedSurface?.()
  unsubscribeCommittedSurface = null
  reworkProductionShotHook = null
  resumeProductionBatchHook = null
}
