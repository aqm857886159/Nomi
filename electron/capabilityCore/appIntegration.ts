import { readAgentApprovalPolicy } from '../settings/agentApprovalPolicySettings'
import { parseDirectorPreviewBlockReply } from "../shared/director/directorPreviewStatus";
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
import { mainWindowPhase, revealMainWindow } from '../mainWindowPresence'
import { startRpcServer, type RpcServerHandle } from './rpcServer'
import { ensureToken } from './security'
import { clearInstanceAdvertisement, writeInstanceAdvertisement } from './lockfile'
import { HEARTBEAT_INTERVAL_MS, type InstanceAdvertisement } from './instanceAdvert'
import { getProjectLocationState, getWorkspaceRepositoryDeps } from '../runtimePaths'
import type { FetchTaskResultFn, RunTaskFn } from './core'
import { getProductionRunService, subscribeProductionRunChanges } from '../productionRun/productionRunRuntime'
import type { ApprovalReceiptAuthority } from './approvalReceipt'
import { readWorkspaceProject, resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import type { DispatchContext } from './dispatcher'
import { requestRenderer, requestRendererDecision } from './rendererBridge'
import { resolveIndexedReferencePreview } from './pendingSpendReferences'
import { installGuiResolveNarrowIpc } from './generationResolveIpc'
import { withdrawStalePresentations } from '../productionRun/stalePresentationSweep'
import {
} from '../productionRun/prepareProductionGenerationAuthorization'
import { createMultiShotBatchScheduler } from '../productionRun/multiShotBatchScheduler'
import { registerBatchSchedulerKicker } from '../productionRun/batchSchedulerKick'
import type { ProductionRun, ProductionShotActionResult } from '../productionRun/productionRunTypes'
import { createCanvasLandingHost } from '../productionRun/canvasLandingHost'
import { createGuiLandingProjectAccess, landBatchBeforeKick } from './appIntegrationLandFirst'
import { createRunObservationDrivers } from './appIntegrationRunObservation'
import { hasWorkToWatch, runWantsDriver } from '../productionRun/productionRunLifecycle'
import { readCatalog } from '../catalog/catalogStore'
import { installCatalogRowLookup } from './modelSpecRead'
import { canvasReadSurfaceRuntime } from './canvasReadSurfaceRuntime'
import type { CanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import {
  createRunOwnedGenerationGateAuthority,
} from './runOwnedGenerationGateAuthority'
import { installResidentGenerationAdapter } from './residentGenerationAdapterFactory'
import {
  hasGenerationOperationProviderReadiness,
  type GenerationOperationProviderShape,
} from './generationOperationProviderReadiness'
import { type LiveGenerationCallCatalog } from './liveGenerationRuntime'
import { createGenerationDomain } from './generationDomain'
import { createDefaultAuthorities } from './appIntegrationAuthorities'
import { createProductionActionHooks } from './appIntegrationProductionActions'
import { installPendingSpendActions, pendingSpendDependencies, readInstalledPendingSpend } from './appIntegrationSpendConfirm'
import { createCanvasShotRuns, followCanvasShotChange, installCanvasShotRuns, withdrawQueuedHandOvers } from './appIntegrationCanvasShot'
import { CANVAS_SHOT_SETTLED_OP } from '../shared/canvas/canvasShotSettled'
import { createCanvasHandOver } from './canvasHandOver'
import { canvasTransportProviders, lazyCanvasTransport } from './canvasTransportProvider'
import { quoteSpendLine } from '../spendQuote'
export { canvasOpenRuns, decideCanvasResend, consentCanvasShots, submitCanvasShot, pollCanvasShot, releaseCanvasShot, withdrawCanvasShots, releaseCanvasShotSender } from './appIntegrationCanvasShot'
// 付费卡的四个动作住在它自己的模块里（这里只装配）。main.ts 的 IPC 经能力核门面转调，所以门面要露出这四个名字。
export { handOverPendingSpendShots, discardPendingSpendConfirmation, removePendingSpendShot, restorePendingSpendShot } from './appIntegrationSpendConfirm'
import { repairStaleMcpConfigs } from './mcpConfig'
import { logDevDetail, logError, logInfo, logWarn } from '../logging/logger'
import { markResidentSurfaceInstallFailed, markResidentSurfaceReady, markResidentSurfaceStarting, markResidentSurfaceStopped, readResidentSurfaceLifecycle } from './residentSurfaceLifecycle'

let handle: RpcServerHandle | null = null
// P4 S5：打开/切换项目时的补齐钩子（startCapabilityCore 装配后设进来）——按 run.jobs[].nodeId × artifacts
// 幂等补落缺失节点/组、回填已完成 result，并恢复未完批次调度（resumeUnfinishedRuns）。模块级 hoist 是因为
let reconcileOpenProjectHook: ((projectId: string) => void) | null = null
let unsubscribeCommittedSurface: (() => void) | null = null
let unsubscribeRunChanges: (() => void) | null = null
// P4 S6：返工/续拍编排钩子（start 闭包装配后设进来）——住在 start 闭包里因为它们要用 scheduler builder +
// 单镜 gate 确认（confirmGenerationInNomi + 收据机构）+ 提交门面，这些都在闭包内。main.ts 的 IPC 转调这两个导出。
let reworkProductionShotHook: ((input: { projectId: string; runId: string; shotId?: string }) => Promise<ProductionShotActionResult>) | null = null
let resumeProductionBatchHook: ((input: { projectId: string; runId: string }) => Promise<ProductionShotActionResult>) | null = null
let disposeResidentGenerationAdapter: (() => void) | null = null
let disposeSingleShotObservationLifecycle: (() => void) | null = null
// 心跳定时器 + 当前广告所在库（退出时按同一命名空间文件名清理）。
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let advertisedLibrary: { projectsRoot: string; isDefault: boolean } | null = null

/** 当前进程 RPC 端口（未启动=null）。「接入助手卡」据此显示能力核就绪态。 */
// 档案解析要目录行里的 meta（fal/* 这类带斜杠的键靠 meta.archetypeId 钉档案）。装配期接一次。
installCatalogRowLookup()

export function getCapabilityPort(): number | null {
  return handle?.port ?? null
}

/**
 * P4 S6：渲染层（经 main.ts IPC）请求返工一镜 → 同 Run 新 Job + 单镜 gate 确认 + 派发。能力核还没起来 → core_starting。
 * projectId 守卫（须 = 当前打开项目）在 hook 内做。绝不在结果里带任何密钥（只回结构化码）。
 */
export async function reworkProductionShot(input: { projectId: string; runId: string; shotId?: string }): Promise<ProductionShotActionResult> {
  if (!reworkProductionShotHook) return { ok: false, code: 'failed', failure: 'core_starting' }
  return reworkProductionShotHook(input)
}

/**
 * P4 S6：渲染层请求续拍已停批次。续额度还是直接接着拍，由 Run 停下那一刻记下的原因决定（不是渲染层传进来的）。
 * 能力核还没起来 → core_starting。
 */
export async function resumeProductionBatch(input: { projectId: string; runId: string }): Promise<ProductionShotActionResult> {
  if (!resumeProductionBatchHook) return { ok: false, code: 'failed', failure: 'core_starting' }
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
    generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
    projectRevisionResolver?: (projectId: string) => number | undefined
    proposalReceiptFor?: import('./rpcServer').RpcServerOptions['proposalReceiptFor']
    openCredentialsInNomi?: import('./rpcServer').RpcServerOptions['openCredentialsInNomi']
    canvasReadExecutionRuntime?: CanvasReadExecutionRuntime
    onRpcActivity?: () => void
  } = {},
): Promise<void> {
  // 常驻生成面的相从这里起算：重启能力核时先回到 starting，上一轮的 install-failed 不许残留。
  markResidentSurfaceStarting();
  try {
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
    // 已接入的编程助手若还指着 Nomi 旧入口，宿主侧只显示一句 CONNECTION_CLOSED——里面一个字都没提 Nomi，
    // 用户没有理由想到「去开 Nomi 的模型接入面板」。这个修复原本只作为渲染那块面板的副作用发生，等于没有。
    // 能力核起来 = 这些配置指向的服务端就绪，正是把它们修回来的时刻（只动 Nomi 自己写过的条目，见 mcpConfig）。
    try {
      repairStaleMcpConfigs()
    } catch { /* 宿主配置不可读不是 Nomi 的故障，不能反向拖垮能力核 */ }
    const token = ensureToken()
    const generationService = getProductionRunService()
    // 生成这一套的接线只有一处（generationDomain）。这里只交这个宿主真不一样的地方：有窗口、有画布、有回合外的观察者。
    // 落画布、调度驱动、单镜观察在下面才装配得起来（它们反过来要工厂给的提交门面），所以先留槽：
    // 装配完成前没有调用会走到它们；草稿投影在那之前是 no-op（能力核还没就绪时本来也没有渲染层可落）。
    let landingHost: ReturnType<typeof createCanvasLandingHost> | null = null
    let observation: ReturnType<typeof createRunObservationDrivers> | null = null
    const wired = <T,>(value: T | null, what: string): T => {
      if (!value) throw new Error(`generation host port used before it was wired: ${what}`)
      return value
    }
    const generation = createGenerationDomain({
      runs: generationService,
      renderer: { request: requestRenderer, requestDecision: requestRendererDecision },
      landShots: (projectId, runId) => wired(landingHost, 'canvas landing').landBeforeDispatch(projectId, runId),
      onPlanChanged: (projectId, operationId) => landingHost?.landDraftOnCanvas(projectId, operationId),
      // 封信封前先等 Nomi 自己在飞的画布落地落完（草稿投影是 fire-and-forget，它会让 project.revision 前进）。
      // 不等的话信封盖的是旧 revision，用户点确认时收据已被自家的写作废，报「此确认已失效」——
      // 付费闸对**用户**改项目才该 fail-closed，对我们自己的投影不该。
      settleBeforeAuthorization: (projectId) => wired(landingHost, 'canvas landing').settleCanvasLanding(projectId),
      kickMultiShotBatch: async ({ operation, lease, readRun, submitPlan, createScheduler }) => {
        const beforeKick = readRun(lease.projectId, operation.operationId)
        if (beforeKick?.generationPlan?.state === 'sealed') await submitPlan(beforeKick)
        // Durable, restart-safe kick; slow providers are re-kicked until quiescent.
        wired(observation, 'run observation').driveScheduler(lease.projectId, operation.operationId, createScheduler(), 'batch scheduler tick')
        return { operationId: operation.operationId, state: operation.state, nextAction: 'observe' }
      },
      observeSingleShot: (submission, projectId, runId) => wired(observation, 'run observation').observeSingleShotRun(submission, projectId, runId),
      // 应用内今天不在核对这里给单镜 Run 收尾（是不是漏接没有查清，原样保留）。
      onReconciled: () => undefined,
    })
    const operationStore = generation.operations
    // P4 S4: trialFirst narrows the durable plan to shot 1 and re-seals it.
    const defaults = createDefaultAuthorities({
      onTrialFirst: async ({ projectId, operationId }) => {
        if (!operationStore.trialNarrow) return
        await operationStore.trialNarrow(projectId, operationId, new Date().toISOString())
      },
    })
    const projectRevisionResolver = authorities.projectRevisionResolver ?? defaults.projectRevisionResolver!
    const liveGenerationRuntime = generation.catalog
    // 调用之外（后台活、调用结束之后才问的地方）读现在的目录；调用之内用入口收到的那一版。
    const readProviderBootstrap = () => liveGenerationRuntime.current().bootstrap
    // 提交出口认得的执行器：目录执行器 + 画布那台的传输（按家各一个 `canvas:<key>`，发动机收敛第一刀）。
    const canvasTransport = lazyCanvasTransport()
    const submissionProviders = () => [...readProviderBootstrap().providers, ...canvasTransportProviders(readCatalog().vendors.map((vendor) => vendor.key), canvasTransport)]
    // P4 S2: real per-shot pricing from the live catalog (resolve lazily so pricing edits apply).
    // 调用之外按现在的目录算价（返工 / 续拍从这里走）；规划调用里用入口那一版的 `catalog.resolveShotPrice`。
    const resolveShotPrice: LiveGenerationCallCatalog['resolveShotPrice'] = (contract) => liveGenerationRuntime.current().resolveShotPrice(contract)
    // P4 S5：只认 main-issued Surface 的完整 committed identity；renderer scalar 不是 authority。
    const isProjectOpen = (id: string) => canvasReadSurfaceRuntime.getCommittedProjectSelection()?.projectId === id
    // P4 S5 / 架构③：建/改草稿即投影 · 派发前落地（不再 best-effort，准入点判能不能派）· 打开项目补齐 共用一条链。
    // 实现住 productionRun/canvasLandingHost.ts（本文件守 800 行门岗 · R9），这里只做接线。
    const canvasLanding = createCanvasLandingHost({
      readRun: (projectId, runId) => generationService.repository.read(projectId, runId),
      command: (projectId, runId, command) => generationService.command(projectId, runId, command as never),
      requestRenderer,
      resolveProjectRoot: (projectId) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()),
      isProjectOpen,
      openProjectForLanding: createGuiLandingProjectAccess(() => canvasReadSurfaceRuntime.getCommittedProjectSelection()?.projectId ?? null),
      // 参考落到节点上（D2 第③步）：与卡预览同一个解析口，钉住的版本对不上就不过线（节点上没有的不会发出去）。
      resolveReferenceUrl: (projectId, reference) => resolveIndexedReferencePreview(projectId, reference),
    })
    landingHost = canvasLanding
    // 画布节点跟着 Run 走：每一次耐久变化（派发 / 受理 / 出片落盘 / 失败 / 停）都经过仓库 execute 的事件旁路，
    // 跟随者据此把「生成中 / 结果 / 失败」写进节点自己的运行记录——与普通生成同一份状态、同一套画法。
    // 它取代了以前只在「出片」那一下投递结果的专用通道（一件事一个 owner：Run → 画布只有落地这一条路）。
    // 同一个订阅里收排队的交接：Agent 那一次出价从哪条路关的（取消 / 停 / 打字 / 重启清扫 / 被顶掉），交给画布、还没轮到的那几镜都当场收回同意；
    // 画布单镜交给观察者的那一笔收尾了，也在这里摇渲染层按号去收（画布单镜 Run 不走上面的落地）。
    unsubscribeRunChanges?.()
    unsubscribeRunChanges = subscribeProductionRunChanges((run) => { canvasLanding.followRunChange(run); withdrawQueuedHandOvers(run); followCanvasShotChange(run) })
    // P4 S4/S5：构造一个 Run 的提交门面（submission）。lease 身份（immutableProjectUuid/projectGeneration）
    // 从工作区记录读——**耐久 binding 已冻住这些值**，恢复时无需新 lease。provider 集合按所有镜头合同和已有 job 推导。
    // 返回 null = provider 未配置 / 工程根不可达（调用方跳过，不驱动）。start 与恢复调度共用同一门槛（P1）。
    const buildSubmission = generation.buildSubmission
    type SubmittableRun = {
      projectId: string
      generationPlan?: GenerationOperationProviderShape & { candidate?: { providerId?: unknown } }
      jobs: Array<{ provider: string }>
    }
    // 这个 Run 现在驱动得起来吗、起不来缺什么——调度器构造与返工 / 续拍的「如实说」读同一份判断。
    const submissionReadinessForRun = (run: SubmittableRun) => {
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
      const providers = submissionProviders()
      if (!hasGenerationOperationProviderReadiness(operationShape, providers, jobProviderIds)) return { ready: false as const, missing: 'provider_missing' as const }
      const projectRoot = resolveWorkspaceProjectDir(run.projectId, getWorkspaceRepositoryDeps())
      const record = readWorkspaceProject(run.projectId, getWorkspaceRepositoryDeps())
      if (!projectRoot || !record?.immutableProjectUuid || !record.projectGeneration) return { ready: false as const, missing: 'project_missing' as const }
      return { ready: true as const, input: { projectRoot, immutableProjectUuid: record.immutableProjectUuid, projectGeneration: record.projectGeneration, providers } }
    }
    const buildSubmissionForRun = (run: SubmittableRun) => {
      const readiness = submissionReadinessForRun(run)
      return readiness.ready ? buildSubmission(readiness.input) : null
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
        landShots: canvasLanding.landBeforeDispatch,
        onBatchComplete: () => generationService.advanceSemanticProduction(projectId, runId),
      })
    }
    // 观察与调度驱动（多镜推到静止点 + 单镜回合外轮询）整块住在 appIntegrationRunObservation：
    // 它们共享同一批 per-instance 状态（在飞的 drive / 重踢定时器 / 单镜 epoch），核重启时一起作废。
    const runObservation = createRunObservationDrivers({
      repository: generationService.repository,
      buildSchedulerForRun,
      buildSubmissionForRun,
    })
    observation = runObservation
    disposeSingleShotObservationLifecycle = runObservation.stop
    const { settleSingleShotCompleted, settleSingleShotAttention, kickSchedulerForRun, observeSingleShotRun } = runObservation
    // 画布单节点 ↑ 的唯一付费口（实现住 appIntegrationCanvasShot，这里只接线）。
    const canvasShots = createCanvasShotRuns({
      service: generationService,
      readProject: (projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps()),
      resolveProjectRoot: (projectId) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()),
      receipts: defaults.approvalReceiptAuthority!,
      providers: submissionProviders,
      buildSubmission,
      // 回包只经唯一解析认：认不得的挡住原因按挡处理（fail-closed），不再白名单过滤成「放行」
      previewBlock: async (projectId, nodeId) => parseDirectorPreviewBlockReply(await requestRenderer('director.preview-blocks', { projectId, nodeIds: [nodeId] }, 10_000)),
      quote: (input) => { const amount = quoteSpendLine(input).amount; return amount === null ? { known: false } : { known: true, amount } },
      observe: observeSingleShotRun,
      notifySettled: (notice) => requestRenderer(CANVAS_SHOT_SETTLED_OP, notice, 60_000),
    })
    installCanvasShotRuns(canvasShots)
    // 付费卡上点「生成」与「直接生成」档的策略共用这一台：把 Agent 那一次出价里的几镜交给画布（逐镜走上面那条画布单节点提交）。
    const canvasHandOver = createCanvasHandOver({
      runs: generationService.repository,
      landShots: canvasLanding.landBeforeDispatch,
      requestRenderer,
      subscribe: subscribeProductionRunChanges,
    })
    // P4 §3.2：所有 gate 入口共用 post-decide 重踢。
    registerBatchSchedulerKicker(kickSchedulerForRun)
    const generationPlanning = generation.planning
    // Generation strategy resolver GUI 窄 IPC：seam 一就绪就装配注册（幂等，重启重注册）。装配点住
    // generationResolveIpc 模块（避免 main.ts 巨壳增长 / 本文件破 800 上限）；候选集与 agent/MCP 同源。
    installGuiResolveNarrowIpc(generationPlanning, () => canvasReadSurfaceRuntime.getCommittedProjectSelection()?.projectId ?? null)
    const runOwnedGenerationAuthority = createRunOwnedGenerationGateAuthority({
      owner: generationService,
      operations: operationStore,
      planning: generationPlanning,
      receipts: defaults.approvalReceiptAuthority!,
    })
    try {
      const requestGenerationGate = authorities.requestGenerationGate ?? runOwnedGenerationAuthority.requestGenerationGate
      const authorizeGeneration = authorities.authorizeGeneration ?? runOwnedGenerationAuthority.authorizeGeneration
      // P1 单轨化（2026-09-11）：这条 lane 不再注入 `confirmGenerationInNomi`（居中弹窗的入口），
      // 于是「agent 代发的付费确认弹居中卡」结构上不可能；真被走到会 fail-closed。面板那条走 appIntegrationSpendConfirm。
      const residentGeneration = installResidentGenerationAdapter({ planning: generationPlanning, requestGenerationGate, authorizeGeneration, approvalReceiptAuthority: defaults.approvalReceiptAuthority!, projectSessionAuthority: defaults.projectSessionAuthority, owner: generationService, draftLanding: canvasLanding.draftLandingOutcome, handOverToCanvas: canvasHandOver })
      disposeResidentGenerationAdapter = residentGeneration.dispose
      // 付费卡的编排：卡上的四个动作都是 Run 账本里的一条命令，「生成」交给上面那一台画布交接。
      installPendingSpendActions(pendingSpendDependencies({
        isProjectOpen, repository: generationService.repository, operations: operationStore, handOver: canvasHandOver.handOver,
      }))
      // 两条面（lane 的生成适配器、面板的付费卡）装齐了才算 ready：它们由同一份相回答。
      markResidentSurfaceReady(residentGeneration.factory, readInstalledPendingSpend)
    } catch (error) {
      logError('capability', 'resident-generation-adapter-install-failed', error)
      // 装配失败**不许只留一行日志**（2026-09-12）。这一段一旦抛，付费确认卡在整个会话里
      // 都不会再出现，而模型还在一句句告诉用户「请在确认卡上点头」——那正是「声称有卡、
      // 却什么都没渲染」这一族的会话级版本。把原因记进 owner，读通道据此抛得明明白白，
      // 用户那头看到一张会说话的卡，CI 里那条 console error 让门岗当场红。
      installPendingSpendActions(null)
      markResidentSurfaceInstallFailed(error)
    }
    // P4 S5：打开/切换项目时的补齐钩子（§3.4）。对该项目所有未取消的 run：① reconcileExistingCanvas 只让已有节点
    // 对上 Run（补结果、纠正记录，绝不新建节点）；② single-shot 只 poll→materialize
    // 恢复，不重新 start；③ resumeUnfinishedRuns 恢复 legacy/多镜调度。
    // best-effort：异步、逐 run try/catch，不阻塞项目打开。
    reconcileOpenProjectHook = (projectId: string) => {
      void (async () => {
        // 裁决 C：上一个进程摆出去、还没人答的那几次出价先撤回（回 draft / 未 present，计划留着）。
        // 排在补落画布之前：占位节点照旧补，但那张「没人在等」的卡不该再闪出来一次。
        // 画布单镜 Run 不在 list 里（一次 ↑ 一个），只看还没收尾的那几个：没人在等的交给观察者。
        canvasShots.recoverOrphans(projectId)
        // 列一次、读一次：下面两段共用这一份（以前 list 两遍、再各读一遍，每个 Run 读四次）。
        let runs: ProductionRun[] = []
        let withdrawnIds = new Set<string>()
        try {
          runs = generationService.repository.listRuns(projectId)
          const withdrawn = await withdrawStalePresentations({
            listRuns: () => runs,
            // 关的原因要一路带到账上（「被停」），回执据此说「没决定是因为上一次被停了」——少传一个参数就会变成「用户关了卡」。
            withdraw: (owner, operationId, now, reason) => operationStore.withdraw(owner, operationId, now, reason),
            onError: (operationId, error) => logWarn('production-run', 'withdraw-stale-presentation-failed', { operationId }, error),
          }, projectId)
          withdrawnIds = new Set(withdrawn)
          if (withdrawn.length > 0) logInfo('production-run', 'withdrew-stale-presentations', { projectId, operationIds: withdrawn.join(',') })
        } catch (error) {
          logWarn('production-run', 'stale-presentation-sweep-failed', undefined, error)
        }
        try {
          for (const listed of runs) {
            let run: ProductionRun | null = listed
            // 上一段撤回过出价的那几个才重读一次，其余用同一份。
            try {
              if (withdrawnIds.has(listed.runId)) run = generationService.repository.read(projectId, listed.runId)
            } catch {
              continue
            }
            // 已取消的 Run 只在手上还有交给供应商的活时往下走（钱已花出：盯到收尾、产物落进节点）；其余照旧跳过。
            if (!run || (run.status === 'cancelled' && !runWantsDriver(run))) continue
            // 打开项目的画布对账**绝不新建节点**：只让已经在、认得出是同一镜的节点对上 Run（补结果、纠正 detached 记录），
            // 认不出来的什么都不做（落地宿主记日志）。建节点只归确认即落 / 草稿投影。
            // CI 抓到（#966 canvas-shortcuts C19）：这里以前是整份落地，带老 Run 的项目一打开就凭空多出一份节点。
            await canvasLanding.reconcileExistingCanvas(projectId, run.runId)
            // 结束的 Run 不再调度。
            if (run.status === 'completed') continue
            const isSemanticSingleShot = run.playbook.name === 'generation.single-shot'
              && run.generationPlan?.operationId === run.runId
              && !run.generationPlan.shots?.length
            if (isSemanticSingleShot) {
              // The canvas side was reconciled above (existing nodes only). If a
              // provider task is still in flight, resume by query only: this
              // path must never call start or create a second paid job.
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
              // 与观察者「歇一歇再问」用同一个判据（生命周期 owner 的 hasWorkToWatch），重开项目与观察窗到期不会各判各的。
              const observable = hasWorkToWatch(refreshed)
              if (observable) {
                const submission = buildSubmissionForRun(refreshed)
                if (submission) observeSingleShotRun(submission, projectId, run.runId)
              }
              continue
            }
            // 只补语义多镜 run（有 generationPlan.shots）且未终结的；legacy 不在此列。
            if (!run.generationPlan?.shots || run.generationPlan.shots.length === 0) continue
            // ② 恢复未完批次调度（从 jobs[]+ledger 纯派生「下一批」，已提交不重提、已完成不重扣）。
            kickSchedulerForRun(projectId, run.runId)
          }
        } catch (error) {
          logWarn('production-run', 'open-project-canvas-reconcile-failed', undefined, error)
        }
        // 顺带把 S4 遗留的 resumeUnfinishedRuns 接上启动触发（legacy driver / 多镜批次的崩溃恢复；
        // semantic single-shot 已在上面走只读 observer，service 内部仍跳过它们，避免任何隐式 start）。
        try {
          await generationService.resumeUnfinishedRuns(projectId)
        } catch (error) {
          logWarn('production-run', 'resume-unfinished-runs-failed', undefined, error)
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
      driverReadiness: (run) => {
        const readiness = submissionReadinessForRun(run)
        return readiness.ready ? 'ready' : readiness.missing
      },
      kickScheduler: kickSchedulerForRun,
      landBeforeResume: (projectId, runId) => landBatchBeforeKick({ repository: generationService.repository, landShots: canvasLanding.landBeforeDispatch, projectId, runId }),
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
      projectRevisionResolver,
      // 同 mcpStdioServer：档位来自设置里持久化的那一份，宿主只负责递，不自己编。
      approvalPolicy: readAgentApprovalPolicy,
      proposalReceiptFor: authorities.proposalReceiptFor,
      openCredentialsInNomi: authorities.openCredentialsInNomi ?? (async ({ sessionId }: { sessionId: string; vendorName: string }) => {
        if (mainWindowPhase() !== 'open') throw new Error('Nomi window unavailable')
        // 叫回只发意图：主窗主人在 macOS 上另做 app.focus({steal:true})——只 focus 窗口不会把 Nomi 变成最前面的应用。
        // 2026-09-06 实测这条路径能把窗口叫到前台（tests/ux/mcp-key-window.walk.mjs）；
        // 那条走查在锁屏/无前台登录会话时会用阳性对照判出「窗口服务器不给任何 App 焦点」并明说没跑成，
        // 不会把环境没功率报成 Nomi 的 bug。
        revealMainWindow('mcp-credentials')
        await requestRenderer('integration.open-credentials', { sessionId }, 30_000)
        return { opened: true }
      }),
      generationPlanning,
      onRpcActivity: authorities.onRpcActivity,
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
    logInfo('capability', 'rpc-listening', { port: handle.port })
    // 库路径是本机路径，只在开发终端里给人看，不落盘。
    logDevDetail('capability', `RPC 监听 127.0.0.1:${handle.port}（库 ${location.path}）`)
  } catch (error) {
    logError('capability', 'rpc-start-failed', error)
    // 没走到常驻面装配就抛了（比如 token / 供应商引导抛）：相不许停在 starting 装睡。
    if (readResidentSurfaceLifecycle().phase === 'starting') markResidentSurfaceInstallFailed(error)
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
  unsubscribeRunChanges?.()
  unsubscribeRunChanges = null
  reworkProductionShotHook = null
  resumeProductionBatchHook = null
  disposeSingleShotObservationLifecycle?.(); disposeSingleShotObservationLifecycle = null; installCanvasShotRuns(null)
  disposeResidentGenerationAdapter?.(); disposeResidentGenerationAdapter = null; installPendingSpendActions(null); markResidentSurfaceStopped()
  installGuiResolveNarrowIpc(null)
}
