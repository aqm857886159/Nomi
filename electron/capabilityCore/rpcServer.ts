// 能力核 · 本地 RPC 传输（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S4）。
//
// 一个最小 JSON-over-HTTP server，只监听 127.0.0.1（绝不开公网，S6 安全门之一），token 鉴权
// （Authorization: Bearer <token>，常数时间校验）。所有传输（CLI / MCP）都打它，路由到能力核。
// 用 node:http，**不引新依赖**（P1 极简）。
//
// A/B 模式路由（所见即所得 + 不静默损坏）：app 开着且改的正是**正在打开的项目** → 走渲染层网关
// （A 模式：实时应用进 store，画布即时刷新、需要确认时弹卡）；否则 → 磁盘网关（B 模式：直写盘）。
// 注入 isProjectOpen()（main-owned Surface committed identity 的只读投影）。headless host 里
// isProjectOpen 恒 false → 全走磁盘网关；B4 会删除这里尚未 verified 的 legacy 选路。
import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'

import type { FetchTaskResultFn, RunTaskFn } from './core'
import { RpcError } from './dispatcher'
import { createDiskGateway, createHybridGateway, createRendererGateway, withPreApprovedSpend, type ProjectGateway } from './gateway'
import { isRendererAvailable, requestRenderer } from './rendererBridge'
import { resolveMcpOrigin, verifyToken } from './security'
import { getProductionRunService } from '../productionRun/productionRunRuntime'
import { handleArtifactPreviewHttpRequest, withAssetPreview } from '../productionRun/artifactPreviewHttpServer'
import { setArtifactPreviewHttpOrigin } from '../productionRun/artifactProjection'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { dispatchAndEnrich } from './mcpResultEnrichLive'
import { makeShotVerifyDeps } from './shotVerifyDeps'
import { rpcErrorWirePayload } from './mcpRpcError'
import type { ApprovalReceiptAuthority } from './approvalReceipt'
import type { McpGenerationPolicy } from './mcpGenerationPolicy'
import { bindMcpConnectionContext, McpConnectionAuthenticationError } from './mcpConnectionContext'
import type { ProjectSessionAuthority } from './projectSessionAuthority'
import { assertLocalBearerProjectSessionRoute } from './localProjectSessionTransportPolicy'
import type { CanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import { resolveProductionCanvasReadProjectIdentity } from './canvasReadExecutionRuntime'
import {
  createInternalCanvasReadTransportAdapter,
  isCanvasReadTransportMethod,
  createMcpCanvasReadTransportAdapter,
} from './canvasReadTransportAdapters'
import { createInternalCanvasReadVerifiedInvocationFactory } from './verifiedCapabilityInvocation'
import { createVerifiedProjectSessionBindingFromAuthority } from './projectSessionRuntime'
import { canvasReadLeaseRequiredRpcError, canvasReadRpcError } from './canvasReadPublicError'
import { isMcpEditingMethod } from './mcpCapabilityProjection'
import type { ProjectBinding } from '../shared/projectBinding'
import type { ProjectAgentProposalReceiptService } from '../projectAgentHost/projectAgentProposalReceiptStore'
import { executeMcpDocumentWriteWithReceipt, executeMcpWriteWithReceipt } from './mcpDocumentWriteReceipt'

export type RpcServerOptions = {
  /** 真实生成入口（runtime.runTask）。注入式：headless host 与 app 各自传同一份。 */
  runTask: RunTaskFn
  /** 异步任务轮询入口（runtime.fetchTaskResult）。图/视频异步生成等终态用。 */
  fetchTaskResult?: FetchTaskResultFn
  /** 该 projectId 是否正在某个 app 窗口里打开（命中则拒绝直写图变更）。headless: ()=>false。 */
  isProjectOpen?: (projectId: string) => boolean
  productionRuns?: ReturnType<typeof getProductionRunService>
  /** One project-session authority; each request adds its freshly verified transport connection. */
  projectSessionAuthority?: ProjectSessionAuthority
  approvalReceiptAuthority?: ApprovalReceiptAuthority
  requestGenerationGate?: import('./dispatcher').DispatchContext['requestGenerationGate']
  authorizeGeneration?: import('./dispatcher').DispatchContext['authorizeGeneration']
  /** Internal client→GUI fallback. The callback must verify the challenge before prompting. */
  confirmGenerationInNomi?: (input: { challengeToken: string }) => Promise<unknown>
  /**
   * Verify that a registered MCP client confirmed the gate identified by
   * challengeToken via the elicitation protocol, then mint and return a real
   * main-process receipt. Called by the launcher/stdio-server loopback RPC
   * `nomi_verify_client_generation_gate`.
   */
  verifyClientGenerationGateInMain?: (input: { challengeToken: string; authenticatedClient: string }) => Promise<unknown>
  generationPolicy?: McpGenerationPolicy
  generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
  generationPlanning?: import('./dispatcher').DispatchContext['generationPlanning']
  projectRevisionResolver?: (projectId: string) => number | undefined
  /** B4 main-only executor. When absent canvas.read is denied, never routed to legacy dispatch. */
  canvasReadExecutionRuntime?: CanvasReadExecutionRuntime
  /** Main-owned durable proposal receipt service resolved only after a verified project lease. */
  proposalReceiptFor?: (binding: ProjectBinding) => ProjectAgentProposalReceiptService | undefined | Promise<ProjectAgentProposalReceiptService | undefined>
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    const LIMIT = 8 * 1024 * 1024 // 8MB 上限，防内存炸
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > LIMIT) {
        reject(new RpcError('请求体过大', 413))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function stableRequestFingerprint(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableRequestFingerprint).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableRequestFingerprint(child)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function bearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)
  return match ? match[1].trim() : ''
}

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export type RpcServerHandle = {
  port: number
  close: () => Promise<void>
}

/** 启动 RPC server，监听 127.0.0.1 随机端口。返回端口与关闭句柄。 */
export function startRpcServer(options: RpcServerOptions): Promise<RpcServerHandle> {
  const productionRuns = options.productionRuns ?? getProductionRunService()
  const isProjectOpen = options.isProjectOpen || (() => false)
  // 三态路由（治「外部 MCP 生成到非当前项目 → 静默黑洞」，用户拍板 A）：
  // - 项目正在前台打开 + 渲染层可达 → 渲染层网关（A：读写实时刷画布 + 弹卡）。
  // - 窗口活着但项目没在前台 → 混合网关（读写走盘不动非活动 store + 付费确认弹全局卡，不打断）。
  // - 无窗口（headless host）→ 磁盘网关（认 env 逃生口）。
  const makeGateway = (projectId: string): ProjectGateway => {
    if (!projectId || !isRendererAvailable()) return createDiskGateway(projectId)
    return isProjectOpen(projectId) ? createRendererGateway(projectId) : createHybridGateway(projectId)
  }
  // 交付④：同一预览 server 兼解 canvas-asset token（生成结果缩略图给非 Electron 宿主）。
  const previewService = withAssetPreview(productionRuns, (projectId) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps()))
  const internalCanvasRead = options.canvasReadExecutionRuntime
    ? createInternalCanvasReadTransportAdapter({
        factory: createInternalCanvasReadVerifiedInvocationFactory({
          verifyBearer: (bearer) => verifyToken(bearer),
          resolveProjectIdentity: resolveProductionCanvasReadProjectIdentity,
        }),
        executor: options.canvasReadExecutionRuntime.executor,
      })
    : null

  const server = http.createServer((req, res) => {
    void (async () => {
      const requestController = new AbortController()
      const abortRequest = () => requestController.abort()
      const abortOnClosedReply = () => { if (!res.writableEnded) abortRequest() }
      req.once('aborted', abortRequest)
      res.once('close', abortOnClosedReply)
      const send = (status: number, payload: unknown) => {
        if (res.destroyed || res.writableEnded) return
        const body = JSON.stringify(payload)
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
        res.end(body)
      }
      try {
        if (await handleArtifactPreviewHttpRequest(req, res, previewService)) return
        if (req.method !== 'POST' || req.url !== '/rpc') throw new RpcError('仅支持 POST /rpc', 404)
        if (!verifyToken(bearerToken(req))) throw new RpcError('鉴权失败：token 无效', 401)
        const raw = await readBody(req)
        let parsed: { method?: unknown; params?: unknown; planConfirmed?: unknown; spendConfirmed?: unknown; documentConfirmed?: unknown; requestId?: unknown }
        try {
          parsed = JSON.parse(raw || '{}')
        } catch {
          throw new RpcError('请求体非合法 JSON', 400)
        }
        const method = String(parsed.method || '')
        const requestId = typeof parsed.requestId === 'string' && parsed.requestId.trim() ? parsed.requestId.trim() : undefined
        const isCanvasRead = isCanvasReadTransportMethod(method)
        const params = (parsed.params && typeof parsed.params === 'object' ? parsed.params : {}) as Record<string, unknown>
        // The storyboard plan adapter resolves to canvas.write, but patch_shots
        // is renderer-owned: it must use the same live store/admission/receipt
        // path as the open Electron project rather than generic planning.
        const isCanonicalCanvasPlanPatch = method === 'canvas.write' && params.operation === 'patch_shots'
        const isCanvasWrite = method === 'canvas.write' && !isCanonicalCanvasPlanPatch
        const isEditing = isMcpEditingMethod(method)
        const client = firstHeader(req.headers['x-nomi-mcp-client'])
        const clientProof = firstHeader(req.headers['x-nomi-mcp-client-proof'])
        const connectionAttestation = firstHeader(req.headers['x-nomi-mcp-connection-attestation'])
        const origin = resolveMcpOrigin(client, clientProof)
        const hasMcpTransportClaims = Boolean(client || clientProof || connectionAttestation)
        let projectSessionConnection
        if (connectionAttestation) {
          try {
            projectSessionConnection = bindMcpConnectionContext({
              client,
              proof: clientProof,
              connectionAttestation,
            })
          } catch (error) {
            if (error instanceof McpConnectionAuthenticationError) throw new RpcError(error.message, 403)
            throw error
          }
        }
        if (!projectSessionConnection && !isCanvasRead && !isEditing && !isCanonicalCanvasPlanPatch && !isCanvasWrite) assertLocalBearerProjectSessionRoute(method)
        if (method === 'nomi_confirm_generation_gate') {
          if (origin === 'external' || origin === 'nomi') throw new RpcError('Registered MCP client proof is required', 403)
          const challengeToken = typeof params.challengeToken === 'string' ? params.challengeToken.trim() : ''
          if (!challengeToken) throw new RpcError('Generation challenge is required', 400)
          if (typeof options.confirmGenerationInNomi !== 'function') throw new RpcError('Nomi confirmation is unavailable', 501)
          const result = await options.confirmGenerationInNomi({ challengeToken })
          send(200, { ok: true, result })
          return
        }
        if (method === 'nomi_verify_client_generation_gate') {
          // Only registered MCP clients may call this — the same guard as nomi_confirm_generation_gate.
          if (origin === 'external' || origin === 'nomi') throw new RpcError('Registered MCP client proof is required', 403)
          const challengeToken = typeof params.challengeToken === 'string' ? params.challengeToken.trim() : ''
          if (!challengeToken) throw new RpcError('Generation challenge is required', 400)
          const authenticatedClient = typeof params.authenticatedClient === 'string' ? params.authenticatedClient.trim() : ''
          if (!authenticatedClient) throw new RpcError('Authenticated client identity is required', 400)
          if (typeof options.verifyClientGenerationGateInMain !== 'function') throw new RpcError('Client generation verification is unavailable', 501)
          const result = await options.verifyClientGenerationGateInMain({ challengeToken, authenticatedClient })
          send(200, { ok: true, result })
          return
        }
        if (isCanvasRead) {
          try {
            let result: unknown
            if (hasMcpTransportClaims) {
              if (!projectSessionConnection || !options.projectSessionAuthority) {
                throw canvasReadLeaseRequiredRpcError()
              }
              if (!options.canvasReadExecutionRuntime) throw new Error('canvas read executor unavailable')
              const projectSession = createVerifiedProjectSessionBindingFromAuthority(
                options.projectSessionAuthority,
                projectSessionConnection,
              )
              const routed = await createMcpCanvasReadTransportAdapter({
                projectSession,
                executor: options.canvasReadExecutionRuntime.executor,
              }).tryExecute(method, params, { signal: requestController.signal })
              if (!routed.handled) throw new Error('canvas read route unavailable')
              result = routed.result
            } else {
              if (!internalCanvasRead) throw new Error('canvas read executor unavailable')
              const routed = await internalCanvasRead.tryExecute(method, {
                bearer: bearerToken(req),
                requestBody: params,
              }, { signal: requestController.signal })
              if (!routed.handled) throw new Error('canvas read route unavailable')
              result = routed.result
            }
            send(200, { ok: true, result })
            return
          } catch (error) {
            throw error instanceof RpcError ? error : canvasReadRpcError(error)
          }
        }
        // 付费确认标志在所有编辑/生成分支共用，必须在编辑分支进入前解析。
        const preApprovedSpend = parsed.spendConfirmed === true
        if (isEditing || isCanonicalCanvasPlanPatch || isCanvasWrite) {
          if (!hasMcpTransportClaims || !projectSessionConnection || !options.projectSessionAuthority) {
            throw new RpcError('A verified project-session transport is required for editing tools', 403)
          }
          const leaseHandle = typeof params.leaseHandle === 'string' ? params.leaseHandle.trim() : ''
          if (!leaseHandle) throw new RpcError('A project-session lease is required', 403)
          const projectHint = typeof params.projectId === 'string' ? params.projectId.trim() || undefined : undefined
          const operation = typeof params.operation === 'string' ? params.operation : ''
          const scope = isCanonicalCanvasPlanPatch
            ? 'canvas:write'
              : isCanvasWrite ? 'canvas:write'
              : method === 'timeline.write' && (operation === 'apply' || operation === 'undo')
                ? 'timeline:write'
                : method === 'timeline.write' ? 'timeline:read'
                  : method === 'document.write' ? 'document:write'
                : method === 'asset.read' ? 'asset:read' : 'export:read'
          const lease = await options.projectSessionAuthority.verifyLease(leaseHandle, {
            connection: projectSessionConnection,
            ...(projectHint ? { projectHint } : {}),
            scope,
          })
          if (method === 'document.write' && parsed.documentConfirmed !== true) {
            throw new RpcError('Human confirmation is required before applying a document change', 403, {
              code: 'human_approval_required',
              nextAction: 'Confirm the document change in the MCP client and retry',
              capability: 'document.write' as never,
            })
          }
          if (method === 'timeline.write' && (operation === 'apply' || operation === 'undo') && parsed.planConfirmed !== true) {
            throw new RpcError('Host approval is required before applying a timeline edit', 403)
          }
          const rendererOp = isCanonicalCanvasPlanPatch
            ? 'canvas.write'
            : method === 'timeline.read'
              ? 'timeline.read'
              : method === 'timeline.write'
                ? 'timeline.write'
                : method === 'document.write'
                  ? 'document.write'
                  : method === 'asset.read' ? 'asset.read' : 'export.read'
          const rendererPayload = isCanonicalCanvasPlanPatch
            ? (() => {
                const { leaseHandle: _leaseHandle, projectId: _projectHint, ...input } = params
                return {
                  projectId: lease.projectId,
                  input,
                  receiptProposalId: `mcp-canvas-plan:${crypto.randomUUID()}`,
                  approvalId: `mcp-canvas-plan-approval:${crypto.randomUUID()}`,
                  // This direct MCP request is approved by the MCP elicitation
                  // seam, not by a Project Agent Host turn. Do not forge Host
                  // correlation without a claimed Host approval; the renderer
                  // receipt remains durable but intentionally uncorrelated.
                }
              })()
            : {
                ...params,
                projectId: lease.projectId,
                ...(requestId ? { requestId } : {}),
                // These values are minted only after the verified lease and (for writes) Host approval.
                ...(method === 'timeline.write' && (operation === 'apply' || operation === 'undo')
                  ? { receiptProposalId: `mcp-edit:${crypto.randomUUID()}`, approvalId: `mcp-host:${crypto.randomUUID()}`, actionHash: crypto.randomUUID() }
                  : {}),
              }
          const result = method === 'document.write'
            ? await (async () => {
                const service = await options.proposalReceiptFor?.({
                  projectId: lease.projectId,
                  immutableProjectUuid: lease.immutableProjectUuid,
                  projectGeneration: lease.projectGeneration,
                })
                if (!service) throw new RpcError('Durable document proposal receipt is unavailable', 501)
                if (
                  service.binding.projectId !== lease.projectId ||
                  service.binding.immutableProjectUuid !== lease.immutableProjectUuid ||
                  service.binding.projectGeneration !== lease.projectGeneration
                ) {
                  throw new RpcError('Durable document proposal receipt binding mismatch', 409)
                }
                return executeMcpDocumentWriteWithReceipt({
                  service,
                  operation,
                  execute: () => requestRenderer(rendererOp, rendererPayload, 30_000),
                })
              })()
            : isCanvasWrite
              ? await (async () => {
                  const service = await options.proposalReceiptFor?.({
                    projectId: lease.projectId,
                    immutableProjectUuid: lease.immutableProjectUuid,
                    projectGeneration: lease.projectGeneration,
                  })
                  if (!service) throw new RpcError('Durable canvas proposal receipt is unavailable', 501)
                  if (
                    service.binding.projectId !== lease.projectId ||
                    service.binding.immutableProjectUuid !== lease.immutableProjectUuid ||
                    service.binding.projectGeneration !== lease.projectGeneration
                  ) {
                    throw new RpcError('Durable canvas proposal receipt binding mismatch', 409)
                  }
                  return executeMcpWriteWithReceipt({
                    service,
                    kind: 'canvas',
                    operation,
                    requestId,
                    requestFingerprint: stableRequestFingerprint(params),
                    signal: requestController.signal,
                    execute: () => dispatchAndEnrich(method, params, {
                      runTask: options.runTask,
                      fetchTaskResult: options.fetchTaskResult,
                      makeGateway: preApprovedSpend ? (projectId: string) => withPreApprovedSpend(makeGateway(projectId)) : makeGateway,
                      productionRuns,
                      origin: { host: origin },
                      generationPolicy: options.generationPolicy,
                      generationContext: options.generationContext,
                      generationPlanning: options.generationPlanning,
                      projectRevisionResolver: options.projectRevisionResolver,
                      ...(options.projectSessionAuthority && projectSessionConnection
                        ? { projectSession: { authority: options.projectSessionAuthority, connection: projectSessionConnection } }
                        : {}),
                      approvalReceiptAuthority: options.approvalReceiptAuthority,
                      requestGenerationGate: options.requestGenerationGate,
                      authorizeGeneration: options.authorizeGeneration,
                      makeVerifyDeps: (verifyCtx) => makeShotVerifyDeps(verifyCtx),
                      ...(parsed.planConfirmed === true ? { planConfirmed: true } : {}),
                      signal: requestController.signal,
                    }),
                  })
                })()
            : await requestRenderer(rendererOp, rendererPayload, 30_000)
          send(200, { ok: true, result })
          return
        }
        // 付费已在**调用方客户端**经 elicitation 被真人确认（协议层 mcpProtocol.ts 只在收到
        // `action:'accept' + confirm:true` 后才置位）→ 预批准付费门，App 不再弹第二张确认卡。
        //
        // 这条曾**刻意不过线**，注释写着「永远不预批 confirmSpend」。2026-08-18 用户拍板放开，理由与代价：
        // · 为什么放开——旧判据是「Nomi 窗口开着没」，它跟「用户注意力在不在 Nomi」没有因果关系（桌面上常年
        //   挂着 Nomi）。结果：人在 Claude 里驱动生成，却被赶回 Nomi 点一下。若信号不过线，协议层弹完
        //   elicitation 这边照样弹卡 → 变成点两次，比原来更糟。
        // · 为什么仍守得住 spendGrant.ts 写死的威胁模型（「Nomi 的 AI 触发不了未确认的付费生成」）——模型只能
        //   吐 tool-call/文本，伪造不了客户端写进 server stdin 的 elicitation 响应帧；且 App 关着时这条一模一样的
        //   信任链早已在用（makeConfirmedGateway）。
        // · 代价（已知并接受）——能读 `~/.nomi/capability-core/token` 的本地进程可借此静默烧额度；此前它触发生成
        //   会弹卡、用户看得见能拒。这是把「防本地攻击者」这层纵深换成「少跑一趟」，不是「防 AI」那道红线松了。
        // ⚠️ 边界仅放宽到付费确认这一处：令牌仍只在主进程铸、assertAndConsumeSpendGrant 仍逐次硬校验、
        // 导出等其余硬边界一律不得复制本模式（那些是抗伪造红线，客户端一个 flag 不足以过）。
        // 交付②④：dispatch + 生成结果富化收口在 dispatchAndEnrich（0a）——传输里没有 bare dispatch 可调，
        // 缩略图 base64 / 签名预览链的富化在结构上不可能被忘（此进程有 nativeImage，launcher bare node 做不了）。
        const result = await dispatchAndEnrich(method, params, {
          runTask: options.runTask,
          fetchTaskResult: options.fetchTaskResult,
          makeGateway: preApprovedSpend ? (projectId: string) => withPreApprovedSpend(makeGateway(projectId)) : makeGateway,
          productionRuns,
          origin: { host: origin },
          generationPolicy: options.generationPolicy,
          generationContext: options.generationContext,
          generationPlanning: options.generationPlanning,
          projectRevisionResolver: options.projectRevisionResolver,
          ...(options.projectSessionAuthority && projectSessionConnection
            ? { projectSession: { authority: options.projectSessionAuthority, connection: projectSessionConnection } }
            : {}),
          approvalReceiptAuthority: options.approvalReceiptAuthority,
          requestGenerationGate: options.requestGenerationGate,
          authorizeGeneration: options.authorizeGeneration,
          // 审片环（W1）：GUI-开着的 RPC 路复用同一份主进程 deps（judge/抽帧/重试都在主进程跑，与 headless 同实现，
          // 无并行版 P1）。生成在主进程 core、判分也在主进程，路径①两条传输吃同一 makeShotVerifyDeps。
          makeVerifyDeps: (verifyCtx) => makeShotVerifyDeps(verifyCtx),
          // 画布方案已在聊天里确认（协议层 elicitation-first）→ addNodes 预批准方案门、渲染层不再弹卡（免双问）。
          //
          // 为什么这里敢信客户端传的 planConfirmed（对比 origin「never trust」的硬边界）：方案门守的是
          // 「模型的决定要过真人」这道软闸，不是抗伪造令牌的红线——加节点免费、可撤销，且持有本 RPC token
          // 的进程在 headless 下 confirmPlan 本就恒 true，客户端「预批」拿不到它本来拿不到的权限。协议层也只
          // 在真人 accept 之后才置这个位。
          ...(parsed.planConfirmed === true ? { planConfirmed: true } : {}),
        })
        send(200, { ok: true, result })
      } catch (error) {
        const status = error instanceof RpcError ? error.httpStatus : 500
        // Keep ordinary errors as legacy strings; policy errors preserve their
        // typed recovery contract for local RPC clients.
        send(status, { ok: false, error: rpcErrorWirePayload(error) })
      } finally {
        req.removeListener('aborted', abortRequest)
        res.removeListener('close', abortOnClosedReply)
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    // 0.0.0.0 绝不用——只 127.0.0.1，外网/局域网够不着。
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      const previewOrigin = `http://127.0.0.1:${address.port}`
      setArtifactPreviewHttpOrigin(previewOrigin)
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => {
              setArtifactPreviewHttpOrigin(null)
              resolveClose()
            })
          }),
      })
    })
  })
}
