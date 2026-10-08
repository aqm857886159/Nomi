// 开关引导模块必须是第一个导入：它在本进程装好共享层的开关视图，之后导入的工具注册表才按同一个值装配。
import { director3dBoxProof } from '../shared/featureFlags/director3dbox'
import { resolveIndexedReferencePreview } from './pendingSpendReferences'
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";

const DIRECTOR_3DBOX_BOOTSTRAP_PROOF = director3dBoxProof()
// 能力核 · MCP stdio server（app 自身二进制以 NOMI_MCP_STDIO 模式跑；见 docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。
//
// Claude Code / Codex / Cursor 用 `<Nomi 二进制> + env NOMI_MCP_STDIO=1` 把 Nomi 拉起当 MCP server。
// 本模块把纯协议层 mcpProtocol.ts 接到 stdin/stdout（newline JSON-RPC），并提供「进程内 invoke」：
//   · Nomi GUI 开着（readLiveInstance 活）→ 转发给它的 RPC（127.0.0.1:port + 广告 token）：
//     写经 GUI 网关（不撞正在编辑的工程，所见即所得）、付费生成弹应用内实时确认卡。
//   · 没开 → 进程内 dispatch（磁盘网关，本进程是唯一写者，安全）。付费经 elicitation 真人确认后铸令牌放行。
// 取代旧 scripts/nomi-mcp.mjs + scripts/lib/nomiClient.mjs 的 MCP 路径：无 node 依赖、入口在包内永远存在（P1）。
import { app, safeStorage, session } from 'electron'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { createNomiMcpServer, MCP_REQUEST_SIGNAL, type McpInvokeOptions } from './mcpProtocol'
import { MCP_CANCELLED_IN_FLIGHT_EVENT, MCP_TRANSPORT_ERROR_EVENT } from './mcpStdioDiagnostics'
import { getDesktopLocale, setDesktopLocale } from '../i18n'
import { createDiskGateway } from './gateway'
import { readLiveInstance, type InstanceAdvertisement } from './lockfile'
import { runTask, fetchTaskResult } from '../runtime'
import { applySystemProxy } from '../systemProxy'
import { appFetch } from '../appFetch'
import { readProxyPrefs } from '../proxySettings'
import { getProductionRunService } from '../productionRun/productionRunRuntime'
import { startArtifactPreviewHttpServer, withAssetPreview } from '../productionRun/artifactPreviewHttpServer'
import { resolveProjectAssetReferenceIdentity } from '../assets/projectAssetStore'
import { startCredentialElicitationServer } from '../integrationCertification/credentialElicitationServer'
import { installIntegrationSessionRuntime } from '../integrationCertification/integrationSessionRuntimeInstall'
import { readWorkspaceProject, resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { ensureWorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import { getProjectLocationState, getWorkspaceRepositoryDeps } from '../runtimePaths'
import { dispatchAndEnrich } from './mcpResultEnrichLive'
import {
  MCP_CLIENT_PROOF_ENV,
  ensureCapabilitySigningKey,
} from './security'
import type { ApprovalReceiptAuthority } from './approvalReceipt'
import type { DispatchContext } from './dispatcher'
import { createGenerationPlanningHandler } from './mcpGenerationTools'
import { planStoryboardFromScript } from './mcpStoryboardPlanner'
import { createProductionGenerationOperationStore } from '../productionRun/productionGenerationOperationStore'
import { createProductionGenerationSubmission } from '../productionRun/productionGenerationSubmission'
import { createProductionShotDispatchGuard } from '../productionRun/productionShotDispatchGuard'
import { createMultiShotBatchScheduler } from '../productionRun/multiShotBatchScheduler'
import { prepareProductionGenerationAuthorizationWithReferences } from '../productionRun/prepareProductionGenerationAuthorization'
import { createCatalogModelPricingResolver, createCatalogShotPriceResolver } from '../productionRun/catalogPricingResolver'
import type { ModuleRegistry } from './moduleRegistry'
import { createLiveGenerationRuntime } from './liveGenerationRuntime'
import { createGenerationProviderBootstrap } from './generationProviderBootstrap'
import { productionFixtureBaseOriginFromEnv } from '../shared/productionRunE2eFixtureGate'
import { markSingleShotAttention, markSingleShotCompleted } from '../productionRun/singleShotRunLifecycle'
import { createGenerationOutputMaterializer } from './generationOutputMaterializer'
import { readAgentApprovalPolicy } from '../settings/agentApprovalPolicySettings'
import { readCatalog } from '../catalog/catalogStore'
import { recommendVideoGeneration } from '../shared/videoCapabilities'
import { deriveUsableVideoModelCandidates } from './usableVideoModelCandidates'
import { installCatalogRowLookup } from './modelSpecRead'
import type { McpConnectionContext } from './mcpConnectionContext'
import { createMcpStdioProjectSessionRouter } from './mcpStdioProjectSessionRouter'
import { createProductionMcpStdioProjectSessionBinding } from './mcpStdioProjectSessionBinding'
import { callMcpLoopbackRpc, createLoopbackGenerationConfirmation } from './mcpLoopbackRpcCall'
import { createHeadlessCanvasReadExecutionRuntime, type CanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import { createMcpCanvasReadTransportAdapter } from './canvasReadTransportAdapters'
import type { VerifiedProjectSessionBinding } from './projectSessionRuntime'
import { createRunOwnedGenerationGateAuthority } from './runOwnedGenerationGateAuthority'
import { readGenerationDefaultModelResolver } from './generationDefaultModelResolver'
import { startSemanticMultiShotBatch } from './mcpSemanticBatchStart'
import { hasGenerationOperationProviderReadiness } from './generationOperationProviderReadiness'
import { recordDetectedMcpClient } from './mcpDetectedClients'
import { createDefaultAuthorities } from './appIntegrationAuthorities'
import { createProjectAgentProposalReceiptService } from './projectAgentProposalReceiptStore'
import { executeMcpDocumentWriteWithReceipt } from './mcpDocumentWriteReceipt'
import { logWarn } from '../logging/logger'

const productionRuns = getProductionRunService()
const assertProductionShotCanDispatch = createProductionShotDispatchGuard({
  readRun: (projectId, runId) => productionRuns.repository.read(projectId, runId) ?? undefined,
})

// 档案解析要目录行里的 meta（fal/* 这类键靠 meta.archetypeId 钉档案）。装配期接一次。
installCatalogRowLookup()

export type McpStdioServerOptions = {
  approvalReceiptAuthority?: ApprovalReceiptAuthority
  requestGenerationGate?: DispatchContext['requestGenerationGate']
  authorizeGeneration?: DispatchContext['authorizeGeneration']
  generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
  generationPlanning?: DispatchContext['generationPlanning']
  generationModuleRegistry?: Pick<ModuleRegistry, 'resolve'>
  projectRevisionResolver?: (projectId: string) => number | undefined
  /** Main-owned receipt resolver for the headless stdio process. */
  proposalReceiptFor?: (projectId: string) => ReturnType<typeof createProjectAgentProposalReceiptService> | undefined | Promise<ReturnType<typeof createProjectAgentProposalReceiptService> | undefined>
}

type DefaultProposalReceiptResolverDeps = Readonly<{
  resolveProjectRoot: (projectId: string) => string | null
  ensureProjectIdentity: typeof ensureWorkspaceProjectIdentity
  createReceiptService: typeof createProjectAgentProposalReceiptService
}>

/**
 * Resolve the main-owned receipt service for a headless stdio request. The
 * project root and identity remain the trusted boundary; the caller never
 * supplies a receipt or binding directly.
 */
export function createDefaultMcpProposalReceiptResolver(
  deps: DefaultProposalReceiptResolverDeps = {
    resolveProjectRoot: (projectId) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()),
    ensureProjectIdentity: ensureWorkspaceProjectIdentity,
    createReceiptService: createProjectAgentProposalReceiptService,
  },
) {
  return async (projectId: string) => {
    const root = deps.resolveProjectRoot(projectId)
    if (!root) return undefined
    const identity = await deps.ensureProjectIdentity(root)
    return deps.createReceiptService({
      projectRoot: root,
      binding: {
        projectId: identity.projectId,
        immutableProjectUuid: identity.immutableProjectUuid,
        projectGeneration: identity.projectGeneration,
      },
    })
  }
}

/**
 * 本进程（in-Electron stdio）服务的库 → 传给 readLiveInstance 读**对应命名空间**的广告文件。与 appIntegration
 * 写者同源（getProjectLocationState），故同库的 GUI 与本 stdio 进程读写同一份广告：GUI 开着时 stdio 仍能重连到
 * 它的 RPC（实时反映 + 应用内确认卡），不因命名空间化而误退回进程内 dispatch（§P3-F 引入命名空间后的收口）。
 */
function currentLibrary(): { projectsRoot: string; isDefault: boolean } {
  const location = getProjectLocationState()
  return { projectsRoot: location.path, isDefault: location.source === 'default' }
}

async function callViaRpc(
  instance: InstanceAdvertisement,
  method: string,
  params: Record<string, unknown>,
  connection: McpConnectionContext,
  options?: McpInvokeOptions,
): Promise<unknown> {
  return callMcpLoopbackRpc({
    instance,
    fetchImpl: appFetch,
    clientProof: String(process.env[MCP_CLIENT_PROOF_ENV] || ''),
    connection,
    method,
    params,
    options,
  })
}

/**
 * Build the no-GUI direct invoker separately from the stdio bootstrap so the
 * real headless receipt boundary can be exercised without starting a second
 * stdin/stdout server in a unit test. The production default is still the
 * same dispatchAndEnrich function used by the Electron process.
 */
export function createMcpStdioDirectInvoker(
  authorities: McpStdioServerOptions,
  canvasReadExecutionRuntime: CanvasReadExecutionRuntime,
  dispatchFn: typeof dispatchAndEnrich = dispatchAndEnrich,
) {
  return async (
    routedMethod: string,
    routedParams: Record<string, unknown>,
    routedProjectSession: VerifiedProjectSessionBinding,
    routedOptions: McpInvokeOptions | undefined,
  ): Promise<unknown> => {
    const canvasRead = await createMcpCanvasReadTransportAdapter({
      projectSession: routedProjectSession,
      executor: canvasReadExecutionRuntime.executor,
    }).tryExecute(routedMethod, routedParams, { signal: routedOptions?.signal })
    if (canvasRead.handled) return canvasRead.result
    const makeGateway = createDiskGateway
    // 交付②④：GUI 没开的进程内路——本进程就是 Electron（NOMI_MCP_STDIO 模式），有 nativeImage → dispatchAndEnrich
    // 里就地富化生成结果（缩略图/签名链）。收口在包装器（0a），此路与 GUI-开着的 RPC 路一样忘不了富化。
    const dispatch = () => dispatchFn(routedMethod, routedParams, {
      runTask,
      fetchTaskResult,
      makeGateway,
      productionRuns,
      origin: { host: routedProjectSession.connection.authenticatedClient },
      ...authorities,
      projectSession: routedProjectSession,
      ...(routedOptions?.planConfirmed ? { planConfirmed: true } : {}),
    })
    if (routedMethod !== 'document.write') return dispatch()
    if (routedOptions?.documentConfirmed !== true) throw new Error('human_approval_required')
    const projectId = typeof routedParams.projectId === 'string' ? routedParams.projectId : ''
    const service = await authorities.proposalReceiptFor?.(projectId)
    if (!service) throw new Error('durable_document_receipt_unavailable')
    return executeMcpDocumentWriteWithReceipt({
      service,
      operation: typeof routedParams.operation === 'string' ? routedParams.operation : 'write',
      execute: dispatch,
    })
  }
}

/** 进程内调能力核：GUI 开着→转发 RPC（实时 + 应用内确认卡）；关着→进程内 dispatch（磁盘网关）。 */
async function invoke(
  method: string,
  params: Record<string, unknown>,
  options: McpInvokeOptions | undefined,
  authorities: McpStdioServerOptions,
  projectSession: VerifiedProjectSessionBinding,
  canvasReadExecutionRuntime: CanvasReadExecutionRuntime,
): Promise<unknown> {
  const requestSignal = (params as Record<PropertyKey, unknown>)[MCP_REQUEST_SIGNAL] as AbortSignal | undefined
  const effectiveOptions = requestSignal ? { ...options, signal: requestSignal } : options
  return createMcpStdioProjectSessionRouter<InstanceAdvertisement, McpInvokeOptions>({
    projectSession,
    readLiveInstance: () => readLiveInstance(currentLibrary()),
    // GUI 开着 → RPC 转发，rpcServer 侧已做生成结果富化（缩略图/签名链），此处不再重复富化。
    invokeViaRpc: (instance, routedMethod, routedParams, connection, routedOptions) =>
      callViaRpc(instance, routedMethod, routedParams, connection, routedOptions),
    invokeDirect: createMcpStdioDirectInvoker(authorities, canvasReadExecutionRuntime),
  })(method, params, effectiveOptions)
}

/** 启动 stdio JSON-RPC server。main.ts 在 NOMI_MCP_STDIO 模式的 app.whenReady 后调；不开窗、不抢单实例锁。 */
export async function startMcpStdioServer(authorities: McpStdioServerOptions = {}): Promise<void> {
  process.stderr.write(`[nomi:feature-flags] director3dbox=${DIRECTOR_3DBOX_BOOTSTRAP_PROOF.enabled} fingerprint=${DIRECTOR_3DBOX_BOOTSTRAP_PROOF.fingerprint}\n`)
  if (process.env.NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE === '1' && process.platform === 'linux') {
    safeStorage.setUsePlainTextEncryption(true)
  }
  const defaultAuthorities = createDefaultAuthorities()
  const projectRevisionResolver = authorities.projectRevisionResolver ?? defaultAuthorities.projectRevisionResolver!
  const approvalReceiptAuthority = authorities.approvalReceiptAuthority ?? defaultAuthorities.approvalReceiptAuthority
  let verifiedSession: VerifiedProjectSessionBinding | undefined
  const projectSession = () => verifiedSession ??= createProductionMcpStdioProjectSessionBinding()
  const proposalReceiptFor = authorities.proposalReceiptFor ?? createDefaultMcpProposalReceiptResolver()
  const canvasReadExecutionRuntime = createHeadlessCanvasReadExecutionRuntime()
  // 无窗口进程：mac 别在 dock 弹图标。
  app.dock?.hide?.()
  const previewServer = await startArtifactPreviewHttpServer(
    withAssetPreview(productionRuns, (projectId) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())),
  )
  // 接入会话服务：headless 进程也必须自己装（GUI 那条 registerIpc 根本不跑）。下面的凭据页与
  // dispatcher 的 integration.* 都取它，不装就是整条接模型链在 stdio 下不可用。
  installIntegrationSessionRuntime()
  // MCP URL 模式 elicitation 的一次性凭据页（headless 时这就是密钥的唯一入口）。自成一个严格 CSP 的
  // 回环 listener，不蹭预览服务器那套跨源放行的头（见 credentialElicitationServer.ts）。
  await startCredentialElicitationServer()
  // 关键：stdout 是 JSON-RPC 通道，任何杂质都会毁帧。我们自己的日志已经统一走 logging/logger
  //（落盘 + stderr 镜像，不碰 stdout）；这里改写 console.* 是给**第三方依赖**留的闸——
  //（Chromium 自身日志本就走 stderr），stdout 只出 JSON-RPC。
  const toErr = (...parts: unknown[]) => process.stderr.write(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ') + '\n')
  console.log = toErr
  console.info = toErr
  console.warn = toErr
  console.debug = toErr

  // 与 GUI 共用持久化偏好；失败不退出 stdio，本机 RPC 仍按明确私网规则直连。
  try {
    await applySystemProxy(session.defaultSession, readProxyPrefs())
  } catch {
    /* appFetch 会阻止未经确认的公共请求，不能把初始化失败当成允许直连。 */
  }

  // 交付5：结果/进度文案 locale 跟随系统/App 语言。stdio 进程走的是 main.ts 的 isMcpStdio 分支，**不经** GUI
  // whenReady 里那句 setDesktopLocale(app.getLocale())，故在此对齐一次——app.getLocale() 是 Electron 的 UI locale
  //（受 --lang/系统语言设定），与主 App 同一信号源。这是传输链里真实存在的语言信号，非凭空发明（transport 的
  // getLocale 由此拿到 en/zh-CN），据它把 mcpToolResults 的 L(ctx,zh,en) 转成对的语言，不再硬编码 zh-CN。
  try {
    setDesktopLocale(app.getLocale())
  } catch {
    /* 取不到系统 locale → 保持 zh-CN 缺省 */
  }

  const fixtureBaseUrlOverride = productionFixtureBaseOriginFromEnv(process.env, app.isPackaged)
  const fixtureReferenceUrl = fixtureBaseUrlOverride && process.env.NOMI_E2E_FIXTURE_REFERENCE_URL
    ? process.env.NOMI_E2E_FIXTURE_REFERENCE_URL
    : undefined
  const liveGenerationRuntime = createLiveGenerationRuntime({
    bootstrap: (state, options) => createGenerationProviderBootstrap(state, {
      ...options,
      ...(fixtureBaseUrlOverride ? { fixtureBaseUrlOverride } : {}),
    }),
  })
  const readProviderBootstrap = liveGenerationRuntime.readBootstrap
  const initialGenerationScope = liveGenerationRuntime.createDraftScope()
  const outputMaterializer = createGenerationOutputMaterializer()
  const generationRegistry = authorities.generationModuleRegistry ?? initialGenerationScope.registry
  // P4 S2: derive real per-shot prices from the live catalog pricing (readCatalog reflects user edits;
  // resolve lazily so a mid-session pricing change is picked up). Preview/gate use the model-pricing
  // resolver; the submission seam uses the contract→ShotPrice resolver for its ledger amounts.
  const resolveModelPricing = (providerId: string, modelId: string) => createCatalogModelPricingResolver(readCatalog().models)(providerId, modelId)
  const resolveShotPrice = (contract: Parameters<ReturnType<typeof createCatalogShotPriceResolver>>[0]) => createCatalogShotPriceResolver(readCatalog().models)(contract)
  const operationStore = createProductionGenerationOperationStore(productionRuns)
  const generationPlanning = authorities.generationPlanning
    ?? createGenerationPlanningHandler({
      registry: generationRegistry,
      createDraftScope: liveGenerationRuntime.createDraftScope,
      operations: operationStore,
      get videoModelCandidates() { return deriveUsableVideoModelCandidates() },
      defaultModelForTaskKind: (taskKind) => readGenerationDefaultModelResolver()(taskKind),
      // 参考素材的身份（内容哈希 + 版本）归项目素材库管，模型只给 assetId。接线前 `draft_shots`
      // 只要带一张参考图就 100% 被判 `generation_input_invalid`，而那两个字段模型根本拿不到。
      resolveAssetReferenceIdentity: (projectId, assetId) => resolveProjectAssetReferenceIdentity(projectId, assetId),
      // 今天走不到：stdio 的 origin 只有 `{ host: authenticatedClient }`，没有 `sourceDocument`，
      // 而分镜正本那两条路都以它为闸。留着是因为它是一个**参数**不是第二份实现——外部 MCP 哪天带上
      // 文稿来源，缺了它就是悄悄少一份预览 URL。核实日期 2026-09-21。
      resolveStoryboardReferenceUrl: resolveIndexedReferencePreview,
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
        const authorizationRun = productionRuns.repository.read(lease.projectId, operation.operationId)
        if (!authorizationRun) throw new Error('Generation authorization requires the current Run snapshot')
        return prepareProductionGenerationAuthorizationWithReferences({
          lease,
            assertCurrent: () => {
              const currentProject = readWorkspaceProject(lease.projectId, getWorkspaceRepositoryDeps())
              const currentRun = productionRuns.repository.read(lease.projectId, operation.operationId)
              if (!currentProject || currentProject.revision !== projectRecord.revision
                || currentProject.immutableProjectUuid !== lease.immutableProjectUuid
                || currentProject.projectGeneration !== lease.projectGeneration
                || currentRun?.revision !== authorizationRun?.revision) throw new Error('generation_reference_scope_changed')
            },
          projectRevision: projectRecord.revision,
          operation,
          contract,
          ...(multiShot ? { multiShot } : {}),
          providers: providerBootstrap.providers,
          resolveShotPrice,
            run: authorizationRun,
          now: new Date().toISOString(),
        }, fixtureReferenceUrl ? async ({ references }) => Object.fromEntries(references.map(reference => [spendReferenceKey(reference), fixtureReferenceUrl])) : undefined)
      },
      start: async (operation, lease) => {
        const providerBootstrap = readProviderBootstrap()
        const projectRoot = resolveWorkspaceProjectDir(lease.projectId, getWorkspaceRepositoryDeps())
        const projectRecord = readWorkspaceProject(lease.projectId, getWorkspaceRepositoryDeps())
        // The first shot can be an image anchor while the actual video shots
        // use a different provider.  Check the complete included plan before
        // starting the scheduler so a missing video provider is never hidden
        // by operation.contract.providerId.
        if (!hasGenerationOperationProviderReadiness(operation, providerBootstrap.providers)
          || !projectRoot || !operation.contract || !projectRecord || !Number.isInteger(projectRecord.revision)) {
          return { operationId: operation.operationId, state: operation.state, nextAction: 'provider_not_configured' }
        }
        const submission = createProductionGenerationSubmission({
          repository: productionRuns.repository,
          beforeDispatch: assertProductionShotCanDispatch,
          projectRoot,
          immutableProjectUuid: lease.immutableProjectUuid,
          projectGeneration: lease.projectGeneration,
          intentMacKey: ensureCapabilitySigningKey('generation-intent'),
          providers: providerBootstrap.providers,
          materializeOutput: ({ projectId, providerTaskId, output, job }) => outputMaterializer.materialize({ projectId, providerTaskId, output, providerId: job.provider }),
        })
        // A semantic multi-shot operation must enter the durable batch
        // scheduler. Calling submission.start() without shotId would submit
        // only the top-level contract while falsely reporting the whole plan
        // as running (the old stdio-only gap). The helper persists the
        // sealed→submitted transition before any per-shot provider call.
        if (operation.shots && operation.shots.length > 0) {
          return startSemanticMultiShotBatch(operation, {
            readRun: (projectId, runId) => productionRuns.repository.read(projectId, runId),
            submitPlan: (run) => productionRuns.command(lease.projectId, operation.operationId, {
              commandId: `generation.submit:${operation.operationId}:v${run.planVersion}`,
              expectedRevision: run.revision,
              type: 'generation.submit',
              payload: {},
              issuedAt: new Date().toISOString(),
            }),
            createScheduler: (run) => {
              void run
              return createMultiShotBatchScheduler({
                repository: productionRuns.repository,
                submission,
                projectId: lease.projectId,
                runId: operation.operationId,
                onBatchComplete: () => productionRuns.advanceSemanticProduction(lease.projectId, operation.operationId),
              })
            },
            driveScheduler: (scheduler) => {
              void scheduler.runToQuiescence().catch((error) => {
                logWarn('production-run', 'stdio-semantic-batch-scheduler-failed', undefined, error)
              })
            },
          })
        }
        // 受理那一刻单镜 Run 已经记成进行中（提交出口和「已受理」同一次落盘，GUI 与 stdio 同一处）。
        return await submission.start({ projectId: lease.projectId, operationId: operation.operationId })
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
          repository: productionRuns.repository,
          beforeDispatch: assertProductionShotCanDispatch,
          projectRoot,
          immutableProjectUuid: lease.immutableProjectUuid,
          projectGeneration: lease.projectGeneration,
          intentMacKey: ensureCapabilitySigningKey('generation-intent'),
          providers: providerBootstrap.providers,
          materializeOutput: ({ projectId, providerTaskId, output, job }) => outputMaterializer.materialize({ projectId, providerTaskId, output, providerId: job.provider }),
        })
        try {
          const polled = await submission.poll({ projectId: lease.projectId, operationId: operation.operationId })
          if (polled.nextAction === 'materialize') {
            const materialized = await submission.materialize({ projectId: lease.projectId, operationId: operation.operationId })
            markSingleShotCompleted(productionRuns.repository, lease.projectId, operation.operationId, {
              jobId: materialized.jobId,
              artifactId: materialized.artifactId,
            })
            return materialized
          }
          if (polled.nextAction === 'attention') {
            markSingleShotAttention(productionRuns.repository, lease.projectId, operation.operationId, polled.jobId)
          }
          return polled
        } catch (error) {
          const code = (error as { code?: unknown })?.code
          if (code === 'provider_materialization_unsupported' || code === 'materialization_failed') return { operationId: operation.operationId, outcome, nextAction: 'manual_review', recoveryNotice: '供应商任务已完成，但结果还没有安全落到 Nomi 项目；请到供应商核对或稍后重试。' }
          throw error
        }
      },
    })
  const runOwnedGenerationAuthority = approvalReceiptAuthority
    ? createRunOwnedGenerationGateAuthority({
        owner: productionRuns,
        operations: operationStore,
        planning: generationPlanning,
        receipts: approvalReceiptAuthority,
      })
    : undefined
  const generationAuthorities = {
    ...authorities,
    approvalReceiptAuthority,
    projectRevisionResolver,
    generationPlanning,
    // 用户此刻选的审批档位——**持久化的那一份**（设置里的单一 owner）。
    // 不递下去的后果不是崩溃，是「全自动」在这个宿主上完全不存在：接入试跑与付费门
    // 读到 undefined，一律把用户叫回 Nomi 窗口点一次——而他刚刚才授权过「不用再问」。
    approvalPolicy: readAgentApprovalPolicy,
    proposalReceiptFor,
    ...(authorities.requestGenerationGate ?? runOwnedGenerationAuthority?.requestGenerationGate
      ? { requestGenerationGate: authorities.requestGenerationGate ?? runOwnedGenerationAuthority!.requestGenerationGate }
      : {}),
    ...(authorities.authorizeGeneration ?? runOwnedGenerationAuthority?.authorizeGeneration
      ? { authorizeGeneration: authorities.authorizeGeneration ?? runOwnedGenerationAuthority!.authorizeGeneration }
      : {}),
  }
  const invokeRequest = (method: string, params: Record<string, unknown>, options?: McpInvokeOptions) => invoke(
    method,
    params,
    options,
    generationAuthorities,
    projectSession(),
    canvasReadExecutionRuntime,
  )
  const generationConfirmation = createLoopbackGenerationConfirmation({
    rpcIfOpen: (method, params) => {
      const instance = readLiveInstance(currentLibrary())
      return instance ? callViaRpc(instance, method, params, projectSession().connection) : undefined
    },
    authenticatedClient: () => projectSession().connection.authenticatedClient,
  })
  const mcp = createNomiMcpServer({
    invoke: invokeRequest,
    // This protocol instance is itself a live Nomi host. Its direct route does
    // not cold-start another desktop process, so discovery may use it.
    invokeIfOpen: invokeRequest,
    isAppOpen: () => Boolean(readLiveInstance(currentLibrary())),
    getAuthenticatedClient: () => projectSession().connection.authenticatedClient,
    onClientDetected: (name) => { recordDetectedMcpClient(name) },
    // 两条付费确认经回环 RPC 交给 GUI 主进程（弹兜底卡 / 验证客户端同意并铸收据）；实现三个装配点共用一份。
    confirmGenerationInNomi: generationConfirmation.confirmGenerationInNomi,
    verifyClientGenerationConfirmation: generationConfirmation.verifyClientGenerationConfirmation,
    getLocale: () => getDesktopLocale(),
  })

  // stdin/stdout 分帧、读缓冲上限、stdin 关闭即断连都归 SDK 的 StdioServerTransport。
  // 断连时 SDK 中止全部在途请求的信号：已经发出去的付费生成不会在后台跑到底（真金风险，审计 2026-08-25）；
  // 已提交给供应商的任务走既有 reconcile 语义收敛，这里不新增重试、也不重复提交。
  mcp.server.onerror = (error) => logWarn('mcp', MCP_TRANSPORT_ERROR_EVENT, { message: error.message })
  mcp.onClose((inFlightAtClose) => {
    if (inFlightAtClose > 0) logWarn('mcp', MCP_CANCELLED_IN_FLIGHT_EVENT, { count: inFlightAtClose })
    void previewServer.close().finally(() => app.exit(0))
  })
  await mcp.connect(new StdioServerTransport())
}
