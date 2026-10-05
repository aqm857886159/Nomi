// 两份 MCP 启动器（裸 Node 的 mcpNodeLauncher / Electron 内的 mcpStdioServer）转发给活 Nomi 的**唯一**一跳：
// 请求体、超时、取消、错误解析全在这里。此前两边各抄一份，launcher 那份漏转 documentConfirmed，
// 用户点了同意文稿编辑仍被 403（rpcServer 的 document.write 要求它）。只有「用哪个 fetch」由调用方注入：
// stdio 用带代理策略的 appFetch，裸 Node launcher 没有 Electron，用原生 fetch（见设计卡对代理的评估）。
// 本模块必须保持 electron-free（mcpLauncherClosure.test.ts 钉死）。
import type { McpConnectionContext } from './mcpConnectionContext'
import type { McpInvokeOptions } from './mcpProtocol'
import { createMcpLoopbackRpcRequest } from './mcpLoopbackRpcRequest'
import { rpcErrorFromPayload } from './mcpRpcError'
import { outboundRequestWasNeverWritten } from '../outboundDispatchEvidence'

// 传输兜底超时：须 ≥ 服务端最长合法耗时（core.ts 视频轮询 300s）才不误杀真生成；默认 360s，可经 env 调。
export function mcpRpcTimeoutMs(): number {
  const raw = Number(process.env.NOMI_RPC_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 360_000
}

export function mcpRpcTimeoutMessage(timeoutMs: number): string {
  return `Nomi 无响应（${Math.round(timeoutMs / 1000)}s 超时）——生成可能仍在后台跑，可稍后用 nomi_read（target=canvas）查结果，先别重复提交。`
}

/**
 * 请求已经送到、对方（Nomi）中途断开：请求**可能已经被执行**，这时只报「fetch failed」会让人以为没发生、直接重试，
 * 重复执行（生成 / 写文稿都不是幂等的）。只有能证明「一个字节都没写出去」的失败（端口拒连、DNS、握手前）才保持原样报错——
 * 判据和付费提交共用 `outboundDispatchEvidence`，拿不出证据就算「可能已执行」。
 */
export function mcpRequestMayHaveRunMessage(detail: string): string {
  return `Nomi 在收到请求后连接中断了（${detail}）——请求可能已被 Nomi 执行，请先用 nomi_read 查看结果，再决定要不要重试。 / The connection to Nomi dropped after the request was delivered (${detail}) — the request may already have been executed by Nomi. Check the result with nomi_read before deciding whether to retry.`
}

export type McpLoopbackRpcCallInput = Readonly<{
  instance: { port: number; token: string }
  fetchImpl: typeof fetch
  clientProof: string
  connection: McpConnectionContext
  method: string
  params: Record<string, unknown>
  options?: McpInvokeOptions
}>

export async function callMcpLoopbackRpc(input: McpLoopbackRpcCallInput): Promise<unknown> {
  const { options } = input
  const timeoutMs = mcpRpcTimeoutMs()
  const controller = new AbortController()
  const relayAbort = () => controller.abort(options?.signal?.reason)
  if (options?.signal?.aborted) relayAbort()
  else options?.signal?.addEventListener('abort', relayAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await input.fetchImpl(`http://127.0.0.1:${input.instance.port}/rpc`, {
      ...createMcpLoopbackRpcRequest({
        token: input.instance.token,
        clientProof: input.clientProof,
        connection: input.connection,
        method: input.method,
        params: input.params,
        planConfirmed: options?.planConfirmed,
        documentConfirmed: options?.documentConfirmed,
        signal: controller.signal,
      }),
    })
  } catch (error) {
    if (options?.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('MCP request cancelled')
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(mcpRpcTimeoutMessage(timeoutMs), { cause: error })
    }
    if (error instanceof Error && !outboundRequestWasNeverWritten(error)) {
      throw new Error(mcpRequestMayHaveRunMessage(error.message), { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
    options?.signal?.removeEventListener('abort', relayAbort)
  }
  const body = (await response.json()) as { ok?: boolean; error?: unknown; result?: unknown }
  if (!body.ok) throw rpcErrorFromPayload(body, response.status)
  return body.result
}

type GateVerdict = { confirmed: boolean; receiptId?: string; receiptToken?: string }
type GateChallenge = { handoff?: Record<string, unknown> }

function gateVerdict(result: unknown): GateVerdict {
  const typed = (result ?? {}) as { confirmed?: unknown; receiptId?: unknown; receiptToken?: unknown }
  return {
    confirmed: typed.confirmed === true,
    ...(typeof typed.receiptId === 'string' && typed.receiptId ? { receiptId: typed.receiptId } : {}),
    ...(typeof typed.receiptToken === 'string' && typed.receiptToken ? { receiptToken: typed.receiptToken } : {}),
  }
}

/**
 * 付费门的两条回环确认（「落 Nomi 兜底卡」与「客户端已同意 → 主进程验证并铸收据」）只有一份实现，
 * 三个装配点（裸 Node 启动器 / Electron stdio / 本机 HTTP）都用它；收据只由主进程铸，这里只转话。
 * `rpcIfOpen` 在没有活 Nomi 时返回 undefined——确认绝不为了问一句而冷启动 Nomi。
 */
export function createLoopbackGenerationConfirmation(deps: {
  rpcIfOpen: (method: string, params: Record<string, unknown>) => Promise<unknown> | undefined
  authenticatedClient: () => string | null
}) {
  const challengeTokenOf = (challenge: GateChallenge) =>
    challenge.handoff && typeof challenge.handoff.challengeToken === 'string' ? challenge.handoff.challengeToken : ''
  return {
    confirmGenerationInNomi: async (challenge: GateChallenge): Promise<GateVerdict> => {
      const challengeToken = challengeTokenOf(challenge)
      const pending = challengeToken ? deps.rpcIfOpen('nomi_confirm_generation_gate', { challengeToken }) : undefined
      return pending ? gateVerdict(await pending) : { confirmed: false }
    },
    verifyClientGenerationConfirmation: async (challenge: GateChallenge): Promise<GateVerdict> => {
      const challengeToken = challengeTokenOf(challenge)
      const authenticatedClient = deps.authenticatedClient()
      const pending = challengeToken && authenticatedClient
        ? deps.rpcIfOpen('nomi_verify_client_generation_gate', { challengeToken, authenticatedClient })
        : undefined
      return pending ? gateVerdict(await pending) : { confirmed: false }
    },
  }
}
