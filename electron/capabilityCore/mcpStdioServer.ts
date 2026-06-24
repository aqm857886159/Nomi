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
import { dispatch } from './dispatcher'
import { createDiskGateway, type ProjectGateway, type SpendConfirmInfo } from './gateway'
import { readLiveInstance, type InstanceAdvertisement } from './lockfile'
import { runTask, fetchTaskResult } from '../runtime'
import { mintSpendGrant } from '../spendGrant'
import { applySystemProxy } from '../systemProxy'

// 传输兜底超时：须 ≥ 服务端最长合法耗时（core.ts 视频轮询 300s）才不误杀真生成；默认 360s，可经 env 调。
function transportTimeoutMs(): number {
  const raw = Number(process.env.NOMI_RPC_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 360_000
}

/** 付费已确认（elicitation 真人点了）→ 直铸令牌放行本次生成。仅在 elicit confirmed 后用，不碰全局 env。 */
function makeConfirmedGateway(projectId: string): ProjectGateway {
  const disk = createDiskGateway(projectId)
  return {
    readDoc: disk.readDoc,
    apply: disk.apply,
    confirmSpend: async (info: SpendConfirmInfo) => mintSpendGrant({ nodeIds: [info.nodeId] }),
  }
}

async function callViaRpc(instance: InstanceAdvertisement, method: string, params: Record<string, unknown>): Promise<unknown> {
  const timeoutMs = transportTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${instance.port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${instance.token}` },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Nomi 无响应（${Math.round(timeoutMs / 1000)}s 超时）——生成可能仍在后台跑，可稍后用 nomi_read_canvas 查结果。`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
  const body = (await res.json()) as { ok?: boolean; error?: string; result?: unknown }
  if (!body.ok) throw new Error(body.error || `RPC ${res.status}`)
  return body.result
}

/** 进程内调能力核：GUI 开着→转发 RPC（实时 + 应用内确认卡）；关着→进程内 dispatch（磁盘网关）。 */
async function invoke(method: string, params: Record<string, unknown>, options?: McpInvokeOptions): Promise<unknown> {
  const instance = readLiveInstance()
  if (instance) return callViaRpc(instance, method, params)
  const makeGateway = options?.spendConfirmed ? makeConfirmedGateway : createDiskGateway
  return dispatch(method, params, { runTask, fetchTaskResult, makeGateway })
}

/** 启动 stdio JSON-RPC server。main.ts 在 NOMI_MCP_STDIO 模式的 app.whenReady 后调；不开窗、不抢单实例锁。 */
export async function startMcpStdioServer(): Promise<void> {
  // 无窗口进程：mac 别在 dock 弹图标。
  app.dock?.hide?.()
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

  const protocol = createMcpProtocol({
    send: (message) => process.stdout.write(JSON.stringify(message) + '\n'),
    invoke,
    isAppOpen: () => Boolean(readLiveInstance()),
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
  rl.on('close', () => app.exit(0))
  process.stdin.on('end', () => app.exit(0))
}
