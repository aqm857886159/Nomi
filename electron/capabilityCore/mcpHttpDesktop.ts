// 能力核 · 在开着的 Nomi 里起本机 HTTP 直连（第 2 段）。main.ts 在回环 RPC 起好之后调一次，退出时停。
//
// 端口：正常实例用默认端口（写进宿主配置的地址要稳定）；走查 / 隔离实例要显式给 NOMI_MCP_HTTP_PORT（0 = 随机），
// 不许把用户真 Nomi 的地址抢走。端口被占就本次不开、记一条日志——旧 stdio 启动器照常能用，不影响启动。
// 每条会话的领域调用经回环 RPC 进本进程的 rpcServer（createLoopbackMcpHttpSession），与 stdio 同一扇门。
import { appFetch } from '../appFetch'
import { getDesktopLocale } from '../desktopLocale'
import { logInfo, logWarn } from '../logging/logger'
import { recordDetectedMcpClient } from './mcpDetectedClients'
import { clearMcpHttpEndpoint, resolveMcpHttpPort, writeMcpHttpEndpoint } from './mcpHttpEndpoint'
import type { McpHttpServerHandle } from './mcpHttpServer'
import { readToken } from './security'

let handle: McpHttpServerHandle | null = null

export async function startDesktopMcpHttp(deps: Readonly<{ rpcPort: () => number | null; onActivity?: () => void }>): Promise<void> {
  if (handle) return
  const port = resolveMcpHttpPort()
  if (port === null) return
  const rpc = () => {
    const rpcPort = deps.rpcPort()
    const token = readToken()
    return rpcPort && token ? { port: rpcPort, token } : null
  }
  try {
    // SDK（HTTP 服务端 + 协议层）按需加载：不进 Nomi 冷启动的关键路径。
    const { createLoopbackMcpHttpSession, startMcpHttpServer } = await import('./mcpHttpServer')
    handle = await startMcpHttpServer({
      port,
      onActivity: deps.onActivity,
      sessionFor: (identity) => createLoopbackMcpHttpSession({
        identity,
        rpc,
        fetchImpl: appFetch,
        getLocale: getDesktopLocale,
        onClientDetected: (name) => { recordDetectedMcpClient(name) },
      }),
    })
    writeMcpHttpEndpoint(handle.port)
    logInfo('capability', 'mcp-http-listening', { port: handle.port })
  } catch (error) {
    handle = null
    logWarn('capability', 'mcp-http-unavailable', { port }, error)
  }
}

export function stopDesktopMcpHttp(): void {
  if (!handle) return
  clearMcpHttpEndpoint()
  void handle.close()
  handle = null
}
