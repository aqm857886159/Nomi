// 能力核 · MCP stdio server（app 自身二进制以 NOMI_MCP_STDIO 模式跑；见 docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。
//
// Claude Code / Codex / Cursor 用 `<Nomi 二进制> + env NOMI_MCP_STDIO=1` 把 Nomi 拉起当 MCP server。
// 本模块把纯协议层 mcpProtocol.ts 接到 stdin/stdout（newline JSON-RPC），并提供「进程内 invoke」：
//   · Nomi GUI 开着（readLiveInstance 活）→ 转发给它的 RPC（127.0.0.1:port + 广告 token）：
//     写经 GUI 网关（不撞正在编辑的工程，所见即所得）、付费生成弹应用内实时确认卡。
//   · 没开 → 进程内 dispatch（磁盘网关，本进程是唯一写者，安全）。付费经 elicitation 真人确认后铸令牌放行。
// 取代旧 scripts/nomi-mcp.mjs + scripts/lib/nomiClient.mjs 的 MCP 路径：无 node 依赖、入口在包内永远存在（P1）。
import readline from 'node:readline'
import { app, session } from 'electron'
import { createMcpProtocol, type McpInvokeOptions } from './mcpProtocol'
import { getDesktopLocale, setDesktopLocale } from '../i18n'
import { createDiskGateway, withPreApprovedSpend, type ProjectGateway } from './gateway'
import { readLiveInstance, type InstanceAdvertisement } from './lockfile'
import { runTask, fetchTaskResult } from '../runtime'
import { applySystemProxy } from '../systemProxy'
import { getProductionRunService } from '../productionRun/productionRunRuntime'
import { startArtifactPreviewHttpServer, withAssetPreview } from '../productionRun/artifactPreviewHttpServer'
import { resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { getProjectLocationState, getWorkspaceRepositoryDeps } from '../runtimePaths'
import { dispatchAndEnrich } from './mcpResultEnrichLive'
import { makeShotVerifyDeps } from './shotVerifyDeps'
import { rpcErrorFromPayload } from './mcpRpcError'
import {
  MCP_CLIENT_ENV,
  MCP_CLIENT_PROOF_ENV,
  resolveMcpOrigin,
  type CapabilityOriginHost,
} from './security'
import type { ProjectLeaseAuthority } from './projectLease'
import type { ApprovalReceiptAuthority } from './approvalReceipt'
import type { McpGenerationPolicy } from './mcpGenerationPolicy'
import type { DispatchContext } from './dispatcher'

const productionRuns = getProductionRunService()

export type McpStdioServerOptions = {
  projectLeaseAuthority?: ProjectLeaseAuthority
  resolveCurrentProject?: DispatchContext['resolveCurrentProject']
  approvalReceiptAuthority?: ApprovalReceiptAuthority
  requestGenerationGate?: DispatchContext['requestGenerationGate']
  authorizeGeneration?: DispatchContext['authorizeGeneration']
  generationPolicy?: McpGenerationPolicy
  generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
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
  origin: CapabilityOriginHost,
  options?: McpInvokeOptions,
): Promise<unknown> {
  const timeoutMs = transportTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${instance.port}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${instance.token}`,
        ...(origin !== 'external' && origin !== 'nomi'
          ? {
              'x-nomi-mcp-client': origin,
              'x-nomi-mcp-client-proof': String(process.env[MCP_CLIENT_PROOF_ENV] || ''),
            }
          : {}),
      },
      // planConfirmed / spendConfirmed 跨 RPC 到渲染层网关：已在调用方客户端经 elicitation 被真人确认过
      // → App 不再弹第二次卡（免双问）。**没有这一行，App 开着时用户会在 Claude 点一次、再被叫去 Nomi 点一次。**
      // 钱路为何敢过线、代价是什么：见 gateway.withPreApprovedSpend 与 rpcServer 读 body.spendConfirmed 处。
      body: JSON.stringify({
        method,
        params,
        ...(options?.planConfirmed ? { planConfirmed: true } : {}),
        ...(options?.spendConfirmed ? { spendConfirmed: true } : {}),
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Nomi 无响应（${Math.round(timeoutMs / 1000)}s 超时）——生成可能仍在后台跑，可稍后用 nomi_read_canvas 查结果。`,
        { cause: error },
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
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
): Promise<unknown> {
  const origin = resolveMcpOrigin(process.env[MCP_CLIENT_ENV], process.env[MCP_CLIENT_PROOF_ENV])
  const instance = readLiveInstance(currentLibrary())
  // GUI 开着 → RPC 转发，rpcServer 侧已做生成结果富化（缩略图/签名链），此处不再重复富化。
  if (instance) return callViaRpc(instance, method, params, origin, options)
  const makeGateway = options?.spendConfirmed ? makeConfirmedGateway : createDiskGateway
  // 交付②④：GUI 没开的进程内路——本进程就是 Electron（NOMI_MCP_STDIO 模式），有 nativeImage → dispatchAndEnrich
  // 里就地富化生成结果（缩略图/签名链）。收口在包装器（0a），此路与 GUI-开着的 RPC 路一样忘不了富化。
  return dispatchAndEnrich(method, params, {
    runTask,
    fetchTaskResult,
    makeGateway,
    productionRuns,
    origin: { host: origin },
    ...authorities,
    ...(options?.planConfirmed ? { planConfirmed: true } : {}),
    // 审片环（W1）：headless 路的真实 deps——judge 走 runTask 文本路（不花生成额度）、抽帧走主进程 ffmpeg、
    // 重试复用首发 grantId+同 nodeId 直发。judge 模型无可用 text 模型时 visionAvailable=false → 整体跳过。
    makeVerifyDeps: (verifyCtx) => makeShotVerifyDeps(verifyCtx),
  })
}

/** 启动 stdio JSON-RPC server。main.ts 在 NOMI_MCP_STDIO 模式的 app.whenReady 后调；不开窗、不抢单实例锁。 */
export async function startMcpStdioServer(authorities: McpStdioServerOptions = {}): Promise<void> {
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

  // 和主 app 一致设代理（vendor fetch 在代理环境才通）；失败直连兜底，不崩。
  try {
    await applySystemProxy(session.defaultSession)
  } catch {
    /* 代理设失败 → 直连兜底 */
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

  const protocol = createMcpProtocol({
    send: (message) => process.stdout.write(JSON.stringify(message) + '\n'),
    invoke: (method, params, options) => invoke(method, params, options, authorities),
    isAppOpen: () => Boolean(readLiveInstance(currentLibrary())),
    getAuthenticatedClient: () => {
      const origin = resolveMcpOrigin(process.env[MCP_CLIENT_ENV], process.env[MCP_CLIENT_PROOF_ENV])
      return origin === 'external' || origin === 'nomi' ? null : origin
    },
    confirmGenerationInNomi: async (challenge) => {
      const challengeToken = challenge.handoff && typeof challenge.handoff.challengeToken === 'string'
        ? challenge.handoff.challengeToken
        : ''
      const instance = readLiveInstance(currentLibrary())
      if (!challengeToken || !instance) return { confirmed: false }
      const origin = resolveMcpOrigin(process.env[MCP_CLIENT_ENV], process.env[MCP_CLIENT_PROOF_ENV])
      const result = await callViaRpc(instance, 'nomi_confirm_generation_gate', { challengeToken }, origin)
      const typed = result as { confirmed?: boolean; receiptId?: string; receiptToken?: string }
      return { confirmed: typed.confirmed === true, ...(typed.receiptId ? { receiptId: typed.receiptId } : {}), ...(typed.receiptToken ? { receiptToken: typed.receiptToken } : {}) }
    },
    getLocale: () => getDesktopLocale(),
  })

  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      return // 非 JSON 行忽略（不崩）
    }
    protocol.handleIncoming(message as Parameters<typeof protocol.handleIncoming>[0])
  })
  // 客户端关闭 stdin（断连/退出）→ 我们也退出，不留孤儿进程。
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    void previewServer.close().finally(() => app.exit(0))
  }
  rl.on('close', close)
  process.stdin.on('end', close)
}
