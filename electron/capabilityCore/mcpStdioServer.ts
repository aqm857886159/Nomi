// 能力核 · MCP stdio server（app 自身二进制以 NOMI_MCP_STDIO 模式跑；见 docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。
//
// Claude Code / Codex / Cursor 用 `<Nomi 二进制> + env NOMI_MCP_STDIO=1` 把 Nomi 拉起当 MCP server。
// 本模块把纯协议层 mcpProtocol.ts 接到 stdin/stdout（newline JSON-RPC），并提供「进程内 invoke」：
//   · Nomi GUI 开着（readLiveInstance 活）→ 转发给它的 RPC（127.0.0.1:port + 广告 token）：
//     写经 GUI 网关（不撞正在编辑的工程，所见即所得）、付费生成弹应用内实时确认卡。
//   · 没开 → 进程内 dispatch（磁盘网关，本进程是唯一写者，安全）。付费经 elicitation 真人确认后铸令牌放行。
// 取代旧 scripts/nomi-mcp.mjs + scripts/lib/nomiClient.mjs 的 MCP 路径：无 node 依赖、入口在包内永远存在（P1）。
import readline from 'node:readline'
import { app, safeStorage, session } from 'electron'
import { createMcpProtocol, MCP_REQUEST_SIGNAL, type McpInvokeOptions } from './mcpProtocol'
import { MAX_MCP_LINE_BYTES, parseMcpStdioLine } from './mcpStdioLine'
import { getDesktopLocale, setDesktopLocale } from '../i18n'
import { createDiskGateway, withPreApprovedSpend, type ProjectGateway } from './gateway'
import { readLiveInstance, type InstanceAdvertisement } from './lockfile'
import { runTask, fetchTaskResult } from '../runtime'
import { applySystemProxy } from '../systemProxy'
import { appFetch } from '../appFetch'
import { readProxyPrefs } from '../proxySettings'
import { getProductionRunService } from '../productionRun/productionRunRuntime'
import { startArtifactPreviewHttpServer, withAssetPreview } from '../productionRun/artifactPreviewHttpServer'
import { readWorkspaceProject, resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { getProjectLocationState, getWorkspaceRepositoryDeps } from '../runtimePaths'
import { dispatchAndEnrich } from './mcpResultEnrichLive'
import { makeShotVerifyDeps } from './shotVerifyDeps'
import { rpcErrorFromPayload } from './mcpRpcError'
import {
  MCP_CLIENT_PROOF_ENV,
  ensureCapabilitySigningKey,
} from './security'
import type { ApprovalReceiptAuthority } from './approvalReceipt'
import { createRuntimeMcpGenerationPolicy, type McpGenerationPolicy } from './mcpGenerationPolicy'
import type { DispatchContext } from './dispatcher'
import { createGenerationPlanningHandler } from './mcpGenerationTools'
import { planStoryboardFromScript } from './mcpStoryboardPlanner'
import { createProductionGenerationOperationStore } from '../productionRun/productionGenerationOperationStore'
import { createProductionGenerationSubmission } from '../productionRun/productionGenerationSubmission'
import { createMultiShotBatchScheduler } from '../productionRun/multiShotBatchScheduler'
import { prepareProductionGenerationAuthorization } from '../productionRun/prepareProductionGenerationAuthorization'
import { createCatalogModelPricingResolver, createCatalogShotPriceResolver } from '../productionRun/catalogPricingResolver'
import type { ModuleRegistry } from './moduleRegistry'
import { createLiveGenerationRuntime } from './liveGenerationRuntime'
import { createGenerationProviderBootstrap } from './generationProviderBootstrap'
import { markSingleShotAttention, markSingleShotCompleted, markSingleShotRunning } from '../productionRun/singleShotRunLifecycle'
import { createGenerationOutputMaterializer } from './generationOutputMaterializer'
import { readCatalog } from '../catalog/catalogStore'
import { buildVideoModelCandidates, recommendVideoGeneration, videoArchetypeIdFromMeta } from '../shared/videoCapabilities'
import type { McpConnectionContext } from './mcpConnectionContext'
import { createMcpStdioProjectSessionRouter } from './mcpStdioProjectSessionRouter'
import { createProductionMcpStdioProjectSessionBinding } from './mcpStdioProjectSessionBinding'
import { createMcpLoopbackRpcRequest } from './mcpLoopbackRpcRequest'
import { createHeadlessCanvasReadExecutionRuntime, type CanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import { createMcpCanvasReadTransportAdapter } from './canvasReadTransportAdapters'
import type { VerifiedProjectSessionBinding } from './projectSessionRuntime'
import { createRunOwnedGenerationGateAuthority } from './runOwnedGenerationGateAuthority'
import { readGenerationDefaultModelResolver } from './generationDefaultModelResolver'
import { startSemanticMultiShotBatch } from './mcpSemanticBatchStart'
import { hasGenerationOperationProviderReadiness } from './generationOperationProviderReadiness'

const productionRuns = getProductionRunService()

export type McpStdioServerOptions = {
  approvalReceiptAuthority?: ApprovalReceiptAuthority
  requestGenerationGate?: DispatchContext['requestGenerationGate']
  authorizeGeneration?: DispatchContext['authorizeGeneration']
  generationPolicy?: McpGenerationPolicy
  generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
  generationPlanning?: DispatchContext['generationPlanning']
  generationModuleRegistry?: Pick<ModuleRegistry, 'resolve'>
  projectRevisionResolver?: (projectId: string) => number | undefined
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

// 传输兜底超时：须 ≥ 服务端最长合法耗时（core.ts 视频轮询 300s）才不误杀真生成；默认 360s，可经 env 调。
function transportTimeoutMs(): number {
  const raw = Number(process.env.NOMI_RPC_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 360_000
}

/**
 * 付费已确认（elicitation 真人点了）→ 直铸令牌放行本次生成。仅在 elicit confirmed 后用，不碰全局 env。
 * 「预批付费」这层只此一份定义（gateway.withPreApprovedSpend），App 开着走 RPC 的那条路复用同一份
 * ——两条路的钱路语义不会各写各的、漂移开（rpcServer.ts 读 body.spendConfirmed 处）。
 */
function makeConfirmedGateway(projectId: string): ProjectGateway {
  return withPreApprovedSpend(createDiskGateway(projectId))
}

async function callViaRpc(
  instance: InstanceAdvertisement,
  method: string,
  params: Record<string, unknown>,
  connection: McpConnectionContext,
  options?: McpInvokeOptions,
): Promise<unknown> {
  const timeoutMs = transportTimeoutMs()
  const controller = new AbortController()
  const relayAbort = () => controller.abort(options?.signal?.reason)
  if (options?.signal?.aborted) relayAbort()
  else options?.signal?.addEventListener('abort', relayAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await appFetch(`http://127.0.0.1:${instance.port}/rpc`, {
      ...createMcpLoopbackRpcRequest({
        token: instance.token,
        clientProof: String(process.env[MCP_CLIENT_PROOF_ENV] || ''),
        connection,
        method,
        params,
        planConfirmed: options?.planConfirmed,
        spendConfirmed: options?.spendConfirmed,
        signal: controller.signal,
      }),
    })
  } catch (error) {
    if (options?.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('MCP request cancelled')
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Nomi 无响应（${Math.round(timeoutMs / 1000)}s 超时）——生成可能仍在后台跑，可稍后用 nomi_read（target=canvas）查结果。`,
        { cause: error },
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
    options?.signal?.removeEventListener('abort', relayAbort)
  }
  const body = (await res.json()) as { ok?: boolean; error?: unknown; result?: unknown }
  if (!body.ok) throw rpcErrorFromPayload(body, res.status)
  return body.result
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
    invokeDirect: async (routedMethod, routedParams, routedProjectSession, routedOptions) => {
      const canvasRead = await createMcpCanvasReadTransportAdapter({
        projectSession: routedProjectSession,
        executor: canvasReadExecutionRuntime.executor,
      }).tryExecute(routedMethod, routedParams, { signal: routedOptions?.signal })
      if (canvasRead.handled) return canvasRead.result
      const makeGateway = routedOptions?.spendConfirmed ? makeConfirmedGateway : createDiskGateway
      // 交付②④：GUI 没开的进程内路——本进程就是 Electron（NOMI_MCP_STDIO 模式），有 nativeImage → dispatchAndEnrich
      // 里就地富化生成结果（缩略图/签名链）。收口在包装器（0a），此路与 GUI-开着的 RPC 路一样忘不了富化。
      return dispatchAndEnrich(routedMethod, routedParams, {
        runTask,
        fetchTaskResult,
        makeGateway,
        productionRuns,
        origin: { host: routedProjectSession.connection.authenticatedClient },
        ...authorities,
        projectSession: routedProjectSession,
        ...(routedOptions?.planConfirmed ? { planConfirmed: true } : {}),
        // 审片环（W1）：headless 路的真实 deps——judge 走 runTask 文本路（不花生成额度）、抽帧走主进程 ffmpeg、
        // 重试复用首发 grantId+同 nodeId 直发。judge 模型无可用 text 模型时 visionAvailable=false → 整体跳过。
        makeVerifyDeps: (verifyCtx) => makeShotVerifyDeps(verifyCtx),
      })
    },
  })(method, params, effectiveOptions)
}

/** 启动 stdio JSON-RPC server。main.ts 在 NOMI_MCP_STDIO 模式的 app.whenReady 后调；不开窗、不抢单实例锁。 */
export async function startMcpStdioServer(authorities: McpStdioServerOptions = {}): Promise<void> {
  if (process.env.NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE === '1' && process.platform === 'linux') {
    safeStorage.setUsePlainTextEncryption(true)
  }
  const generationPolicy = authorities.generationPolicy ?? createRuntimeMcpGenerationPolicy()
  const projectSession = createProductionMcpStdioProjectSessionBinding(generationPolicy)
  const canvasReadExecutionRuntime = createHeadlessCanvasReadExecutionRuntime()
  const { connection } = projectSession
  // 无窗口进程：mac 别在 dock 弹图标。
  app.dock?.hide?.()
  const previewServer = await startArtifactPreviewHttpServer(
    withAssetPreview(productionRuns, (projectId) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps())),
  )
  // 关键：stdout 是 JSON-RPC 通道，任何杂质都会毁帧。把我们自己的非错误 console.* 改写到 stderr
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
  // P4 S2: derive real per-shot prices from the live catalog pricing (readCatalog reflects user edits;
  // resolve lazily so a mid-session pricing change is picked up). Preview/gate use the model-pricing
  // resolver; the submission seam uses the contract→ShotPrice resolver for its ledger amounts.
  const resolveModelPricing = (providerId: string, modelId: string) => createCatalogModelPricingResolver(readCatalog().models)(providerId, modelId)
  const resolveShotPrice = (contract: Parameters<ReturnType<typeof createCatalogShotPriceResolver>>[0]) => createCatalogShotPriceResolver(readCatalog().models)(contract)
  const operationStore = createProductionGenerationOperationStore(productionRuns)
  const generationPlanning = authorities.generationPlanning
    ?? createGenerationPlanningHandler({
      registry: generationRegistry,
      operations: operationStore,
      videoModelCandidates,
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
        const authorizationRun = productionRuns.repository.read(lease.projectId, operation.operationId)
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
          projectRoot,
          immutableProjectUuid: lease.immutableProjectUuid,
          projectGeneration: lease.projectGeneration,
          projectRevision: projectRecord.revision,
          intentMacKey: ensureCapabilitySigningKey('generation-intent'),
          providers: providerBootstrap.providers,
          materializeOutput: ({ projectId, providerTaskId, output }) => outputMaterializer.materialize({ projectId, providerTaskId, output }),
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
              commandId: `generation.submit:${operation.operationId}:${run.generationPlan?.planHash ?? run.generationPlan?.contract?.contractHash ?? 'plan'}`,
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
                perShotPrice: (shot) => (shot.contract ? resolveShotPrice(shot.contract) : { known: false }),
                onBatchComplete: () => productionRuns.advanceSemanticProduction(lease.projectId, operation.operationId),
              })
            },
            driveScheduler: (scheduler) => {
              void scheduler.runToQuiescence().catch((error) => {
                console.warn('[nomi:production] stdio semantic batch scheduler failed:', error instanceof Error ? error.message : String(error))
              })
            },
          })
        }
        const started = await submission.start({ projectId: lease.projectId, operationId: operation.operationId })
        // Keep the stdio transport on the same durable lifecycle as the GUI:
        // accepting a provider task is an active Run, not a still-ready draft.
        if (!operation.shots || operation.shots.length === 0) {
          markSingleShotRunning(productionRuns.repository, lease.projectId, operation.operationId)
        }
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
          repository: productionRuns.repository,
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
  const runOwnedGenerationAuthority = authorities.approvalReceiptAuthority
    ? createRunOwnedGenerationGateAuthority({
        owner: productionRuns,
        operations: operationStore,
        planning: generationPlanning,
        receipts: authorities.approvalReceiptAuthority,
      })
    : undefined
  const generationAuthorities = {
    ...authorities,
    generationPlanning,
    generationPolicy,
    ...(authorities.requestGenerationGate ?? runOwnedGenerationAuthority?.requestGenerationGate
      ? { requestGenerationGate: authorities.requestGenerationGate ?? runOwnedGenerationAuthority!.requestGenerationGate }
      : {}),
    ...(authorities.authorizeGeneration ?? runOwnedGenerationAuthority?.authorizeGeneration
      ? { authorizeGeneration: authorities.authorizeGeneration ?? runOwnedGenerationAuthority!.authorizeGeneration }
      : {}),
  }
  const protocol = createMcpProtocol({
    send: (message) => process.stdout.write(JSON.stringify(message) + '\n'),
    invoke: (method, params, options) => invoke(
      method,
      params,
      options,
      generationAuthorities,
      projectSession,
      canvasReadExecutionRuntime,
    ),
    isAppOpen: () => Boolean(readLiveInstance(currentLibrary())),
    getAuthenticatedClient: () => connection.authenticatedClient,
    confirmGenerationInNomi: async (challenge) => {
      const challengeToken = challenge.handoff && typeof challenge.handoff.challengeToken === 'string'
        ? challenge.handoff.challengeToken
        : ''
      const instance = readLiveInstance(currentLibrary())
      if (!challengeToken || !instance) return { confirmed: false }
      const result = await callViaRpc(instance, 'nomi_confirm_generation_gate', { challengeToken }, connection)
      const typed = result as { confirmed?: boolean; receiptId?: string; receiptToken?: string }
      return { confirmed: typed.confirmed === true, ...(typed.receiptId ? { receiptId: typed.receiptId } : {}), ...(typed.receiptToken ? { receiptToken: typed.receiptToken } : {}) }
    },
    getLocale: () => getDesktopLocale(),
  })

  // 行长上限：stdin 是**不可信输入**（本地客户端行为异常或被劫持时，一条无换行的超长流能把主进程
  // 内存吃满）。4 MiB 够装带 base64 参考图的 tools/call，又把最坏内存钉死。readline 的 maxLength 会
  // 在超限时抛 'error' 而不是静默截断，故我们自己按字节判——截断的半条 JSON 解析出来可能是**另一条
  // 合法请求**，那比丢弃危险得多。
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    const parsed = parseMcpStdioLine(line)
    if (parsed.kind === 'blank') return
    if (parsed.kind === 'oversized') {
      // 超长行整条丢弃。无从可靠取 id（正是因为它可能根本不是一条完整 JSON）→ 按规范只记日志。
      console.warn(`[nomi-mcp] dropped an oversized stdin line (> ${MAX_MCP_LINE_BYTES} bytes)`)
      return
    }
    if (parsed.kind === 'parse-error') {
      // 非 JSON 行：旧行为是静默丢弃 → 客户端永远等不到响应也不知道为什么。按 JSON-RPC 标准回
      // -32700 Parse error。此时无从得知 id（正是解析失败），按规范用 null id。
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n')
      return
    }
    protocol.handleIncoming(parsed.value as Parameters<typeof protocol.handleIncoming>[0])
  })
  // 客户端关闭 stdin（断连/退出）→ 我们也退出，不留孤儿进程。
  // **退出前先中止在飞工作**：否则客户端断连后，已经发出去的付费生成仍在后台跑到底（真金风险，
  // 审计 2026-08-25）。中止只切断我们这侧的等待；已提交给供应商的任务走既有 reconcile 语义收敛，
  // 这里不新增重试、也不重复提交。
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    const cancelled = protocol.cancelAllInFlight('stdio disconnected')
    if (cancelled > 0) console.warn(`[nomi-mcp] cancelled ${cancelled} in-flight request(s) on disconnect`)
    protocol.dispose()
    void previewServer.close().finally(() => app.exit(0))
  }
  rl.on('close', close)
  process.stdin.on('end', close)
}
