
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
import { startCredentialElicitationServer } from '../integrationCertification/credentialElicitationServer'
import { installIntegrationSessionRuntime } from '../integrationCertification/integrationSessionRuntimeInstall'
import { readWorkspaceProject, resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { ensureWorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import { getProjectLocationState, getWorkspaceRepositoryDeps } from '../runtimePaths'
import { dispatchAndEnrich } from './mcpResultEnrichLive'
import {
  MCP_CLIENT_PROOF_ENV,
} from './security'
import type { ApprovalReceiptAuthority } from './approvalReceipt'
import type { DispatchContext } from './dispatcher'
import { requestQuit } from '../quitTeardown'
import { createGenerationDomain } from './generationDomain'
import { markSingleShotAttention, markSingleShotCompleted } from '../productionRun/singleShotRunLifecycle'
import { readAgentApprovalPolicy } from '../settings/agentApprovalPolicySettings'
import { installCatalogRowLookup } from './modelSpecRead'
import type { McpConnectionContext } from './mcpConnectionContext'
import { createMcpStdioProjectSessionRouter } from './mcpStdioProjectSessionRouter'
import { createProductionMcpStdioProjectSessionBinding } from './mcpStdioProjectSessionBinding'
import { callMcpLoopbackRpc, createLoopbackGenerationConfirmation } from './mcpLoopbackRpcCall'
import { createHeadlessCanvasReadExecutionRuntime, type CanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import { createMcpCanvasReadTransportAdapter } from './canvasReadTransportAdapters'
import type { VerifiedProjectSessionBinding } from './projectSessionRuntime'
import { createRunOwnedGenerationGateAuthority } from './runOwnedGenerationGateAuthority'
import { startSemanticMultiShotBatch } from './mcpSemanticBatchStart'
import { refuseLandingWithoutRenderer } from '../productionRun/landingProjectAccess'
import { recordDetectedMcpClient } from './mcpDetectedClients'
import { createDefaultAuthorities } from './appIntegrationAuthorities'
import { createProjectAgentProposalReceiptService } from './projectAgentProposalReceiptStore'
import { executeMcpDocumentWriteWithReceipt } from './mcpDocumentWriteReceipt'
import { logWarn } from '../logging/logger'

const productionRuns = getProductionRunService()

// 档案解析要目录行里的 meta（fal/* 这类键靠 meta.archetypeId 钉档案）。装配期接一次。
installCatalogRowLookup()

export type McpStdioServerOptions = {
  approvalReceiptAuthority?: ApprovalReceiptAuthority
  requestGenerationGate?: DispatchContext['requestGenerationGate']
  authorizeGeneration?: DispatchContext['authorizeGeneration']
  generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
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

  // 生成这一套的接线只有一处（generationDomain）。这里只交这个宿主真不一样的地方：没有窗口、没有画布。
  const refuseProject = refuseLandingWithoutRenderer((projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps())?.name)
  const generation = createGenerationDomain({
    runs: productionRuns,
    // 这条进程内路没有渲染层：要渲染层的路在规划里如实拒。
    renderer: null,
    // 架构③ 先落节点、再发请求：这里落不了画布（10-09 拍板：拒，不派）。准入点照走——
    // Run 停在 landing_failed，回给 Agent「需要在 Nomi 里打开项目「X」后再继续」（打开后点继续 = 重落再派）。
    landShots: async (projectId) => { await refuseProject(projectId) },
    onPlanChanged: () => undefined,
    settleBeforeAuthorization: async () => undefined,
    // A semantic multi-shot operation must enter the durable batch scheduler. Calling submission.start()
    // without shotId would submit only the top-level contract while falsely reporting the whole plan as
    // running (the old stdio-only gap). The helper persists the sealed→submitted transition before any
    // per-shot provider call.
    kickMultiShotBatch: ({ operation, readRun, submitPlan, createScheduler }) => startSemanticMultiShotBatch(operation, {
      readRun,
      submitPlan,
      createScheduler: () => createScheduler(),
      driveScheduler: (scheduler) => {
        void scheduler.runToQuiescence().catch((error) => {
          logWarn('production-run', 'stdio-semantic-batch-scheduler-failed', undefined, error)
        })
      },
    }),
    // 没有回合外的观察者；这个宿主也发不出去（没有画布可落）。
    observeSingleShot: () => undefined,
    onReconciled: (event) => {
      if (event.kind === 'materialized') markSingleShotCompleted(productionRuns.repository, event.projectId, event.runId, { jobId: event.jobId, artifactId: event.artifactId })
      else markSingleShotAttention(productionRuns.repository, event.projectId, event.runId, event.jobId)
    },
  })
  const operationStore = generation.operations
  const generationPlanning = generation.planning
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
    void previewServer.close().finally(() => requestQuit())
  })
  await mcp.connect(new StdioServerTransport())
}
