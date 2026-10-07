// 能力核 · 只会 stdio 的宿主（Claude Desktop）→ 本机 HTTP 的转发桥（设计卡第 2 段）。
//
// 帧原样两头搬：宿主那一侧（stdio）收到什么就发给 Nomi 的 HTTP 端点，Nomi 回什么（响应、进度、
// 确认弹框请求、list_changed）就原样还给宿主。这里**没有任何领域逻辑**：不认工具、不碰审批、不改参数。
// 只做两件 HTTP 传输本身要的事：
//   ① initialize 的响应回来时把协商出的协议版本告诉 HTTP 传输（规范要求后续请求带 MCP-Protocol-Version 头；
//      平常由 SDK 的 Client 做，转发桥没有 Client，只好在这里看一眼那一帧）；
//   ② Nomi 连不上（没开）时，给宿主那个请求回一帧错误，而不是让它干等到超时。
// 必须 electron-free：转发口跑在裸 Node 上。
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/server'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

export const NOMI_UNREACHABLE_MESSAGE =
  '连不上 Nomi：请先打开 Nomi 再试。 / Cannot reach Nomi: open the Nomi app first, then try again.'

function requestIdOf(message: JSONRPCMessage): string | number | undefined {
  return 'method' in message && 'id' in message && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : undefined
}

/**
 * 把宿主侧传输（downstream）与 Nomi 的 HTTP 传输（upstream）接起来。任一侧关掉，两侧都收；
 * 返回的 Promise 在两侧都关完后结束（转发口进程据此退出）。
 */
export async function bridgeStdioToHttp(
  downstream: Transport,
  upstream: StreamableHTTPClientTransport,
  hooks: Readonly<{ onError?: (error: Error) => void }> = {},
): Promise<void> {
  const initializeIds = new Set<string | number>()
  let closing = false
  let finished!: () => void
  const done = new Promise<void>((resolve) => { finished = resolve })
  const report = (error: unknown) => hooks.onError?.(error instanceof Error ? error : new Error(String(error)))

  const closeBoth = async () => {
    if (closing) return
    closing = true
    // 宿主走了：先让 Nomi 那边收掉这条会话（中止在途调用），再关本地两头。
    await upstream.terminateSession().catch(() => {})
    await Promise.allSettled([upstream.close(), downstream.close()])
    finished()
  }

  downstream.onmessage = (message) => {
    const id = requestIdOf(message)
    if (id !== undefined && 'method' in message && message.method === 'initialize') initializeIds.add(id)
    upstream.send(message).catch((error: unknown) => {
      report(error)
      if (id !== undefined) {
        void downstream.send({ jsonrpc: '2.0', id, error: { code: -32000, message: NOMI_UNREACHABLE_MESSAGE } }).catch(report)
      }
    })
  }
  upstream.onmessage = (message) => {
    if ('id' in message && 'result' in message && message.id !== undefined && initializeIds.delete(message.id as string | number)) {
      const version = (message.result as { protocolVersion?: unknown }).protocolVersion
      if (typeof version === 'string') upstream.setProtocolVersion(version)
    }
    downstream.send(message).catch(report)
  }
  downstream.onclose = () => { void closeBoth() }
  upstream.onclose = () => { void closeBoth() }
  downstream.onerror = report
  upstream.onerror = report

  await upstream.start()
  await downstream.start()
  return done
}
