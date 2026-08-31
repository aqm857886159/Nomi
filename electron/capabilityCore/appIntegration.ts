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
import { startRpcServer, type RpcServerHandle } from './rpcServer'
import { ensureCapabilitySigningKey, ensureToken } from './security'
import { clearInstanceAdvertisement, writeInstanceAdvertisement } from './lockfile'
import { HEARTBEAT_INTERVAL_MS, type InstanceAdvertisement } from './instanceAdvert'
import { getProjectLocationState, getWorkspaceRepositoryDeps } from '../runtimePaths'
import type { FetchTaskResultFn, RunTaskFn } from './core'
import { getProductionRunService } from '../productionRun/productionRunRuntime'
import type { ApprovalReceiptAuthority } from './approvalReceipt'
import { readWorkspaceProject, resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { createRuntimeMcpGenerationPolicy, type McpGenerationPolicy } from './mcpGenerationPolicy'
import type { DispatchContext } from './dispatcher'
import { requestRenderer } from './rendererBridge'
import { createGenerationPlanningHandler } from './mcpGenerationTools'
import { planStoryboardFromScript } from './mcpStoryboardPlanner'
import { createProductionGenerationOperationStore } from '../productionRun/productionGenerationOperationStore'
import { createProductionGenerationSubmission } from '../productionRun/productionGenerationSubmission'
import {
  prepareProductionGenerationAuthorization,
} from '../productionRun/prepareProductionGenerationAuthorization'
import { createMultiShotBatchScheduler, type MultiShotBatchScheduler } from '../productionRun/multiShotBatchScheduler'
import { registerBatchSchedulerKicker } from '../productionRun/batchSchedulerKick'
import type { ProductionActionResult } from '../productionRun/productionRunTypes'
import { landCanvasForRun } from '../productionRun/multiShotCanvasLanding'
import { createArtifactProjection, getArtifactPreviewSecret } from '../productionRun/artifactProjection'
import { createCatalogModelPricingResolver, createCatalogShotPriceResolver } from '../productionRun/catalogPricingResolver'
import type { ModuleRegistry } from './moduleRegistry'
import { createGenerationOutputMaterializer } from './generationOutputMaterializer'
import { observeSingleShotGeneration } from '../productionRun/singleShotGenerationObserver'
import { createSingleShotObservationLifecycle } from '../productionRun/singleShotObservationLifecycle'
import {
  markSingleShotAttention,
  markSingleShotCompleted,
  markSingleShotRunning,
} from '../productionRun/singleShotRunLifecycle'
import { readGenerationDefaultModelResolver } from './generationDefaultModelResolver'
import { readCatalog } from '../catalog/catalogStore'
import { buildVideoModelCandidates, recommendVideoGeneration, videoArchetypeIdFromMeta } from '../shared/videoCapabilities'
import { canvasReadSurfaceRuntime } from './canvasReadSurfaceRuntime'
import type { CanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import {
  createRunOwnedGenerationGateAuthority,
} from './runOwnedGenerationGateAuthority'
import { installResidentGenerationAdapter, type ResidentGenerationAdapterFactory } from './residentGenerationAdapterFactory'
import {
  hasGenerationOperationProviderReadiness,
  type GenerationOperationProviderShape,
} from './generationOperationProviderReadiness'
import { createLiveGenerationRuntime } from './liveGenerationRuntime'
import { createGenerationProviderBootstrap } from './generationProviderBootstrap'
import { createDefaultAuthorities } from './appIntegrationAuthorities'
import { createProductionActionHooks } from './appIntegrationProductionActions'

let handle: RpcServerHandle | null = null
// P4 S5：打开/切换项目时的补齐钩子（startCapabilityCore 装配后设进来）——按 run.jobs[].nodeId × artifacts
// 幂等补落缺失节点/组、回填已完成 result，并恢复未完批次调度（resumeUnfinishedRuns）。模块级 hoist 是因为
let reconcileOpenProjectHook: ((projectId: string) => void) | null = null
let unsubscribeCommittedSurface: (() => void) | null = null
// P4 S6：返工/续拍编排钩子（start 闭包装配后设进来）——住在 start 闭包里因为它们要用 scheduler builder +
// 单镜 gate 确认（confirmGenerationInNomi + 收据机构）+ 提交门面，这些都在闭包内。main.ts 的 IPC 转调这两个导出。
let reworkProductionShotHook: ((input: { projectId: string; runId: string; shotId?: string }) => Promise<ProductionActionResult>) | null = null
let resumeProductionBatchHook: ((input: { projectId: string; runId: string; reason: 'budget' | 'manual' }) => Promise<ProductionActionResult>) | null = null
let disposeResidentGenerationAdapter: (() => void) | null = null
let disposeSingleShotObservationLifecycle: (() => void) | null = null
// 心跳定时器 + 当前广告所在库（退出时按同一命名空间文件名清理）。
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let advertisedLibrary: { projectsRoot: string; isDefault: boolean } | null = null

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
    onGenerationReady?: (factory: ResidentGenerationAdapterFactory['factory']) => void
  } = {},
): Promise<void> {
  // A second core start must invalidate observers owned by the previous
  // instance before any new provider/runtime wiring can begin. Otherwise a
  // setup failure could leave the old poll loop alive against a replaced
  // renderer.
  disposeSingleShotObservationLifecycle?.();
  disposeSingleShotObservationLifecycle = null;
  // A resident adapter owns listeners/IPC bindings. Dispose the previous
  // instance before reinstalling it on a capability-core restart so no stale
  // adapter can keep writing into the new runtime.
  disposeResidentGenerationAdapter?.();
  disposeResidentGenerationAdapter = null;
  try {
    const token = ensureToken()
    const generationService = getProductionRunService()
    const operationStore = createProductionGenerationOperationStore(generationService)
    const generationPolicy = authorities.generationPolicy ?? createRuntimeMcpGenerationPolicy()
    // P4 S4: trialFirst narrows the durable plan to shot 1 and re-seals it.
    const defaults = createDefaultAuthorities(generationPolicy, {
      onTrialFirst: async ({ projectId, operationId }) => {
        if (!operationStore.trialNarrow) return
        await operationStore.trialNarrow(projectId, operationId, new Date().toISOString())
      },
    })
    const fixtureBaseUrlOverride = process.env.NOMI_E2E_PRODUCTION_FIXTURE === '1'
      ? process.env.NOMI_E2E_APIMART_BASE_URL
      : undefined
    const liveGenerationRuntime = createLiveGenerationRuntime({
      bootstrap: (state, options) => createGenerationProviderBootstrap(state, {
        ...options,
        ...(fixtureBaseUrlOverride ? { fixtureBaseUrlOverride } : {}),
      }),
    })
    const readProviderBootstrap = liveGenerationRuntime.readBootstrap
    const outputMaterializer = createGenerationOutputMaterializer()
    const generationRegistry = authorities.generationModuleRegistry ?? liveGenerationRuntime.registry
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
    const landCanvasBestEffort = async (projectId: string, runId: string, isCurrent?: () => boolean): Promise<boolean> => {
      if (isCurrent && !isCurrent()) return false
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
        ...(isCurrent ? { isCurrent } : {}),
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
    // 从工作区记录读——**耐久 binding 已冻住这些值**，恢复时无需新 lease。provider 集合按所有镜头合同和已有 job 推导。
    // 返回 null = provider 未配置 / 工程根不可达（调用方跳过，不驱动）。start 与恢复调度共用同一门槛（P1）。
    const buildSubmissionForRun = (run: {
      projectId: string
      generationPlan?: GenerationOperationProviderShape & { candidate?: { providerId?: unknown } }
      jobs: Array<{ provider: string }>
    }) => {
      // Recovery uses the same provider set as a live multi-shot start.  A
      // durable job can outlive the provider that happened to be first in the
      // top-level candidate, so include every shot contract and every already
      // materialized job provider before deciding whether to resume.
      const plan = run.generationPlan
      const operationShape: GenerationOperationProviderShape = {
        contract: plan?.contract ?? (plan?.candidate ? { providerId: plan.candidate.providerId } : undefined),
        shots: plan?.shots,
      }
      const jobProviderIds = run.jobs.map((job) => job.provider)
      const projectRoot = resolveWorkspaceProjectDir(run.projectId, getWorkspaceRepositoryDeps())
      const record = readWorkspaceProject(run.projectId, getWorkspaceRepositoryDeps())
      const providerBootstrap = readProviderBootstrap()
      if (!hasGenerationOperationProviderReadiness(operationShape, providerBootstrap.providers, jobProviderIds)
        || !projectRoot || !record?.immutableProjectUuid || !record.projectGeneration || !Number.isInteger(record.revision)) return null
      return createProductionGenerationSubmission({
        repository: generationService.repository,
        projectRoot,
        immutableProjectUuid: record.immutableProjectUuid,
        projectGeneration: record.projectGeneration,
        projectRevision: record.revision,
        intentMacKey: ensureCapabilitySigningKey('generation-intent'),
        providers: providerBootstrap.providers,
        materializeOutput: ({ projectId, providerTaskId, output }) => outputMaterializer.materialize({ projectId, providerTaskId, output }),
      })
    }
    // P4 S5：re-kick 一个未完多镜批次的调度器（打开项目恢复用）。best-effort、不阻塞、异常只记 warn。
    // scheduler 无自有状态：从 jobs[]+ledger 纯派生「下一批」，已提交不重提、已完成不重扣（batchScheduleDerivation）。
    // P4 S6：构造一个 Run 的批次调度器（返工/续拍/恢复共用同一 builder，P1 一个家）。
    // Scheduler 只消费 gate 已授权的 jobs/ledger，绝不创建或提高付费授权。
    const buildSchedulerForRun = (
      projectId: string,
      runId: string,
      run: { projectId: string; generationPlan?: GenerationOperationProviderShape & { candidate?: { providerId?: unknown } }; jobs: Array<{ provider: string }> },
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
        onBatchComplete: () => generationService.advanceSemanticProduction(projectId, runId),
      })
    }
    // 慢供应商未到静止点时定时重踢；Run lock、intent log 与 commandId 保证重启/并发幂等。
    const REKICK_DELAY_MS = 15_000
    const activeBatchDrives = new Set<string>()
    const batchRekickTimers = new Map<string, ReturnType<typeof setTimeout>>()
    // Single-shot submissions intentionally return the durable provider receipt
    // immediately. Keep observation outside the MCP turn, but dedupe it by Run
    // so a replay/reconnect can never start two poll/materialize loops. The
    // lifecycle advances an epoch on core shutdown/restart and aborts stale
    // provider waits before they can materialize or touch the renderer.
    const singleShotObservationLifecycle = createSingleShotObservationLifecycle()
    disposeSingleShotObservationLifecycle = singleShotObservationLifecycle.stop
    // Single-shot lifecycle status is owned by the same durable ProductionRun
    // repository as the provider submission.  Keep these callbacks local to
    // the capability-core instance so a stopped/replaced instance cannot write
    // a stale status after its epoch is invalidated.
    const settleSingleShotRunning = (projectId: string, runId: string): void => {
      try {
        markSingleShotRunning(generationService.repository, projectId, runId)
      } catch (error) {
        console.warn('[nomi:production] single-shot running status failed:', error instanceof Error ? error.name : 'unknown')
      }
    }
    const settleSingleShotCompleted = (projectId: string, runId: string, options: { jobId?: string; artifactId?: string } = {}): void => {
      try {
        markSingleShotCompleted(generationService.repository, projectId, runId, options)
      } catch (error) {
        console.warn('[nomi:production] single-shot completion status failed:', error instanceof Error ? error.name : 'unknown')
      }
    }
    const settleSingleShotAttention = (projectId: string, runId: string, jobId?: string): void => {
      try {
        markSingleShotAttention(generationService.repository, projectId, runId, jobId)
      } catch (error) {
        console.warn('[nomi:production] single-shot attention status failed:', error instanceof Error ? error.name : 'unknown')
      }
    }
    const activeSingleShotJobId = (projectId: string, runId: string): string | undefined => {
      try {
        const run = generationService.repository.read(projectId, runId)
        return run?.jobs.find((job) => Boolean(job.providerTaskId) && !['adopted', 'cancelled_remote', 'detached', 'too_late'].includes(job.status))?.jobId
      } catch {
        return undefined
      }
    }
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
    const driveScheduler = (
      projectId: string,
      runId: string,
      scheduler: Pick<MultiShotBatchScheduler, 'runToQuiescence'>,
      label: string,
    ): void => {
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
    const observeSingleShotRun = (
      submission: ReturnType<typeof createProductionGenerationSubmission>,
      projectId: string,
      runId: string,
    ): void => {
      const key = `${projectId}:${runId}`
      void singleShotObservationLifecycle.run(key, async ({ signal, isCurrent }) => {
        try {
          const result = await observeSingleShotGeneration({
            submission,
            input: { projectId, operationId: runId },
            signal,
            isCurrent,
            // The Run/artifact store remains the only result owner. Reusing the
            // existing landing operation makes single-shot completion idempotent
            // and lets the renderer attach the local artifact to its placeholder.
            onMaterialized: async () => {
              if (!isCurrent()) return
              await landCanvasBestEffort(projectId, runId, isCurrent)
            },
          })
          // An owner stop is expected lifecycle control, not a provider failure;
          // leave the durable Run untouched for the next restart/open recovery.
          if (result.aborted) return
          if (result.nextAction === 'completed') {
            settleSingleShotCompleted(projectId, runId, {
              ...(result.materialized?.jobId ? { jobId: result.materialized.jobId } : {}),
              ...(result.materialized?.artifactId ? { artifactId: result.materialized.artifactId } : {}),
            })
          } else if (result.nextAction === 'attention') {
            settleSingleShotAttention(projectId, runId, result.lastPoll?.jobId ?? activeSingleShotJobId(projectId, runId))
          }
        } catch (error) {
          // Poll/materialization failures are durable attention, not a silent
          // promise rejection that causes the same provider task to be retried
          // forever on the next project reopen. Never submit from this path.
          if (isCurrent()) settleSingleShotAttention(projectId, runId, activeSingleShotJobId(projectId, runId))
          console.warn('[nomi:production] single-shot observation failed:', error instanceof Error ? error.name : 'unknown')
        }
      }).catch((error) => {
        // The inner try/catch handles provider/materialization errors. A final
        // lifecycle rejection (for example, a duplicate observer) must not
        // write attention: by this point the worker may belong to an older
        // capability-core epoch and the current Run could be unrelated.
        console.warn('[nomi:production] single-shot observation failed:', error instanceof Error ? error.name : 'unknown')
      })
    }
    // P4 §3.2：所有 gate 入口共用 post-decide 重踢。
    registerBatchSchedulerKicker(kickSchedulerForRun)
    const generationPlanning = authorities.generationPlanning
      ?? createGenerationPlanningHandler({
        registry: generationRegistry,
        operations: operationStore,
        videoModelCandidates,
        // ScriptText uses the Workbench defaults lazily (single preference source).
        defaultModelForTaskKind: (taskKind) => readGenerationDefaultModelResolver()(taskKind),
        planStoryboard: planStoryboardFromScript,
        recommendVideoGeneration,
        resolveModelPricing,
        providerReadiness: ({ providerId }) => {
          const providerBootstrap = readProviderBootstrap()
          return providerBootstrap.readinessByProvider[providerId] ?? { providerReady: false, missingForSubmit: ['configured_provider'] }
        },
        prepareAuthorization: ({ lease, operation, contract, multiShot }) => {
          const providerBootstrap = readProviderBootstrap()
          const projectRecord = readWorkspaceProject(lease.projectId, getWorkspaceRepositoryDeps())
          if (!projectRecord || !Number.isInteger(projectRecord.revision)) throw new Error('Generation authorization requires the current project revision')
          const authorizationRun = generationService.repository.read(lease.projectId, operation.operationId)
          return prepareProductionGenerationAuthorization({
            lease,
            projectRevision: projectRecord.revision,
            operation,
            contract,
            ...(multiShot ? { multiShot } : {}),
            providers: providerBootstrap.providers,
            resolveShotPrice,
            maximumSpend: authorizationRun?.policy.maxSpend,
            now: new Date().toISOString(),
          })
        },
        start: async (operation, lease) => {
          // Settings can save APIMart while this process is already running.
          // Read the executable provider set at this operation boundary rather
          // than using the startup snapshot.
          const providerBootstrap = readProviderBootstrap()
          const projectRoot = resolveWorkspaceProjectDir(lease.projectId, getWorkspaceRepositoryDeps())
          const projectRecord = readWorkspaceProject(lease.projectId, getWorkspaceRepositoryDeps())
          // A multi-shot plan may put an image anchor in the top-level
          // contract while its video shots use another provider.  Readiness
          // must be derived from every included shot (the scheduler's real
          // submission set), not just operation.contract.providerId.
          if (!hasGenerationOperationProviderReadiness(operation, providerBootstrap.providers)
            || !projectRoot || !operation.contract || !projectRecord || !Number.isInteger(projectRecord.revision)) {
            return { operationId: operation.operationId, state: operation.state, nextAction: 'provider_not_configured' }
          }
          const submission = createProductionGenerationSubmission({
            repository: generationService.repository,
            projectRoot,
            immutableProjectUuid: lease.immutableProjectUuid,
            projectGeneration: lease.projectGeneration,
            projectRevision: projectRecord.revision,
            intentMacKey: ensureCapabilitySigningKey('generation-intent'),
            providers: providerBootstrap.providers,
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
              onBatchComplete: () => generationService.advanceSemanticProduction(lease.projectId, operation.operationId),
            })
            // Durable, restart-safe kick; slow providers are re-kicked until quiescent.
            driveScheduler(lease.projectId, operation.operationId, scheduler, 'batch scheduler tick')
            return { operationId: operation.operationId, state: operation.state, nextAction: 'observe' }
          }
          const started = await submission.start({ projectId: lease.projectId, operationId: operation.operationId })
          settleSingleShotRunning(lease.projectId, operation.operationId)
          // Single-shot semantic plans keep their candidate at the plan root,
          // but they still belong to the same canvas materialization owner as
          // multi-shot runs. Land the real placeholder after the durable
          // provider acceptance so the node carries the run/job provenance.
          // The semantic operation was initiated by the active resident
          // surface; requestRenderer itself enforces the committed target
          // identity. Do not gate this call on a transient surface snapshot
          // (surface switches can lag the main-process selection by a tick).
          await landCanvasBestEffort(lease.projectId, operation.operationId)
          if (started.nextAction === 'observe') observeSingleShotRun(submission, lease.projectId, operation.operationId)
          return started
        },
        reconcile: async (operation, outcome, lease) => {
          const providerBootstrap = readProviderBootstrap()
          if (outcome === 'not_found') return { operationId: operation.operationId, outcome, nextAction: 'manual_review' }
          const provider = providerBootstrap.providers.find((candidate) => candidate.providerId === operation.contract?.providerId)
          const projectRoot = resolveWorkspaceProjectDir(lease.projectId, getWorkspaceRepositoryDeps())
          const projectRecord = readWorkspaceProject(lease.projectId, getWorkspaceRepositoryDeps())
          if (!provider || !projectRoot || !operation.contract || !projectRecord || !Number.isInteger(projectRecord.revision)) return { operationId: operation.operationId, outcome, nextAction: 'manual_review' }
          if (!provider.query || !provider.capabilities.query) return { operationId: operation.operationId, outcome, nextAction: 'manual_review', recoveryNotice: '该供应商没有可用的任务查询；请到供应商核对。' }
          const submission = createProductionGenerationSubmission({
            repository: generationService.repository,
            projectRoot,
            immutableProjectUuid: lease.immutableProjectUuid,
            projectGeneration: lease.projectGeneration,
            projectRevision: projectRecord.revision,
            intentMacKey: ensureCapabilitySigningKey('generation-intent'),
            providers: providerBootstrap.providers,
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
    const runOwnedGenerationAuthority = createRunOwnedGenerationGateAuthority({
      owner: generationService,
      operations: operationStore,
      planning: generationPlanning,
      receipts: defaults.approvalReceiptAuthority!,
    })
    try {
      const requestGenerationGate = authorities.requestGenerationGate ?? runOwnedGenerationAuthority.requestGenerationGate
      const authorizeGeneration = authorities.authorizeGeneration ?? runOwnedGenerationAuthority.authorizeGeneration
      const confirmGenerationInNomi = authorities.confirmGenerationInNomi ?? defaults.confirmGenerationInNomi
      disposeResidentGenerationAdapter = installResidentGenerationAdapter({ planning: generationPlanning, requestGenerationGate, authorizeGeneration, confirmGenerationInNomi, approvalReceiptAuthority: defaults.approvalReceiptAuthority!, projectSessionAuthority: defaults.projectSessionAuthority, owner: generationService }, authorities.onGenerationReady)
    } catch (error) {
      console.error('[nomi:capability-core] resident generation adapter install failed:', error instanceof Error ? error.message : String(error))
    }
    // P4 S5：打开/切换项目时的补齐钩子（§3.4）。对该项目所有活跃 run：① landCanvasBestEffort 幂等补落缺失
    // 节点/组 + 回填已完成 result（materializationOperationId + 组章去重，跑两次不重复）；② single-shot 只 poll→materialize
    // 恢复，不重新 start；③ resumeUnfinishedRuns 恢复 legacy/多镜调度。best-effort：异步、逐 run try/catch，不阻塞项目打开。
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
            if (!run || ['completed', 'cancelled'].includes(run.status)) continue
            const isSemanticSingleShot = run.playbook.name === 'generation.single-shot'
              && run.generationPlan?.operationId === run.runId
              && !run.generationPlan.shots?.length
            if (isSemanticSingleShot) {
              // A single-shot may have been accepted while no project surface
              // was committed (or while the app was restarting). Re-land its
              // durable placeholder/result now that the project is open. If a
              // provider task is still in flight, resume by query only: this
              // path must never call start or create a second paid job.
              await landCanvasBestEffort(projectId, run.runId)
              const refreshed = generationService.repository.read(projectId, run.runId) ?? run
              const readyJob = refreshed.jobs.find((job) => ['ready', 'adopted'].includes(job.status))
              const readyArtifact = readyJob
                ? refreshed.artifacts.find((artifact) => artifact.jobId === readyJob.jobId
                  && ['ready', 'adopted'].includes(artifact.status)
                  && Boolean(artifact.contentHash)
                  && Boolean(artifact.projectRelativePath || artifact.thumbnailRelativePath))
                : undefined
              if (readyJob && readyArtifact) {
                settleSingleShotCompleted(projectId, run.runId, { jobId: readyJob.jobId, artifactId: readyArtifact.artifactId })
                continue
              }
              const attentionJob = refreshed.jobs.find((job) => job.status === 'needs_attention')
              if (attentionJob || refreshed.status === 'needs_attention') {
                settleSingleShotAttention(projectId, run.runId, attentionJob?.jobId)
                continue
              }
              const observable = refreshed.jobs.some((job) =>
                ['provider_accepted', 'polling'].includes(job.status) && Boolean(job.providerTaskId),
              )
              if (observable) {
                const submission = buildSubmissionForRun(refreshed)
                if (submission) observeSingleShotRun(submission, projectId, run.runId)
              }
              continue
            }
            // 只补语义多镜 run（有 generationPlan.shots）且未终结的；legacy 不在此列。
            if (!run.generationPlan?.shots || run.generationPlan.shots.length === 0) continue
            // ① 幂等补落节点/组 + 回填已完成 result（materializationOperationId + 组章去重）。
            await landCanvasBestEffort(projectId, run.runId)
            // ② 恢复未完批次调度（从 jobs[]+ledger 纯派生「下一批」，已提交不重提、已完成不重扣）。
            kickSchedulerForRun(projectId, run.runId)
          }
        } catch (error) {
          console.warn('[nomi:production] open-project canvas reconcile failed:', error instanceof Error ? error.message : String(error))
        }
        // 顺带把 S4 遗留的 resumeUnfinishedRuns 接上启动触发（legacy driver / 多镜批次的崩溃恢复；
        // semantic single-shot 已在上面走只读 observer，service 内部仍跳过它们，避免任何隐式 start）。
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
    const { reworkProductionShot, resumeProductionBatch } = createProductionActionHooks({
      generationService,
      isProjectOpen,
      readProviderBootstrap,
      readProject: (projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps()),
      resolveShotPrice,
      buildSchedulerForRun,
      driveScheduler,
      receiptAuthority: defaults.approvalReceiptAuthority,
      confirmGenerationInNomi: defaults.confirmGenerationInNomi,
    })
    reworkProductionShotHook = reworkProductionShot
    resumeProductionBatchHook = resumeProductionBatch
    handle = await startRpcServer({
      runTask,
      fetchTaskResult,
      isProjectOpen,
      productionRuns: getProductionRunService(),
      ...defaults,
      requestGenerationGate: authorities.requestGenerationGate ?? runOwnedGenerationAuthority.requestGenerationGate,
      authorizeGeneration: authorities.authorizeGeneration ?? runOwnedGenerationAuthority.authorizeGeneration,
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
  disposeSingleShotObservationLifecycle?.(); disposeSingleShotObservationLifecycle = null
  disposeResidentGenerationAdapter?.(); disposeResidentGenerationAdapter = null
}
