// 能力核 · `asset.import` 的路由体（从 dispatcher.ts 外移，同 productionTrustGrantChallenge.ts 的做法；参数尺子仍取 dispatcherParams）。
// MCP 协议层把这次请求的取消信号挂在 params 上（MCP_REQUEST_SIGNAL，不可枚举、过不了 JSON）：
// 进程内直调的那条路（stdio 头less）拿得到它，客户端断开 = 中止这次导入的转码；回环 RPC 那条路拿不到，靠转码在途表在退出时停。
import { importProjectAsset } from './core'
import { assertOnlyFields, requiredIdentifier } from './dispatcherParams'
import { MCP_REQUEST_SIGNAL } from './mcpProtocol'

export function dispatchAssetImport(params: Record<string, unknown>) {
  assertOnlyFields(params, new Set(['projectId', 'path', 'title']))
  const signal = (params as Record<PropertyKey, unknown>)[MCP_REQUEST_SIGNAL]
  return importProjectAsset({
    projectId: requiredIdentifier(params.projectId, 'project'),
    path: String(params.path || ''),
    ...(typeof params.title === 'string' && params.title.trim() ? { title: params.title.trim() } : {}),
    ...(signal instanceof AbortSignal ? { signal } : {}),
  })
}
