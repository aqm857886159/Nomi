// 能力核 · 本地 RPC 传输（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S4）。
//
// 一个最小 JSON-over-HTTP server，只监听 127.0.0.1（绝不开公网，S6 安全门之一），token 鉴权
// （Authorization: Bearer <token>，常数时间校验）。所有传输（CLI / MCP）都打它，路由到能力核。
// 用 node:http，**不引新依赖**（P1 极简）。
//
// A/B 模式路由（所见即所得 + 不静默损坏）：app 开着且改的正是**正在打开的项目** → 走渲染层网关
// （A 模式：实时应用进 store，画布即时刷新、需要确认时弹卡）；否则 → 磁盘网关（B 模式：直写盘）。
// 注入 isProjectOpen()（renderer 经 IPC 上报）。headless host 里 isProjectOpen 恒 false → 全走磁盘网关。
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import type { FetchTaskResultFn, RunTaskFn } from './core'
import { dispatch, RpcError } from './dispatcher'
import { createDiskGateway, createHybridGateway, createRendererGateway, type ProjectGateway } from './gateway'
import { isRendererAvailable } from './rendererBridge'
import { verifyToken } from './security'

export type RpcServerOptions = {
  /** 真实生成入口（runtime.runTask）。注入式：headless host 与 app 各自传同一份。 */
  runTask: RunTaskFn
  /** 异步任务轮询入口（runtime.fetchTaskResult）。图/视频异步生成等终态用。 */
  fetchTaskResult?: FetchTaskResultFn
  /** 该 projectId 是否正在某个 app 窗口里打开（命中则拒绝直写图变更）。headless: ()=>false。 */
  isProjectOpen?: (projectId: string) => boolean
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

function bearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)
  return match ? match[1].trim() : ''
}

export type RpcServerHandle = {
  port: number
  close: () => Promise<void>
}

/** 启动 RPC server，监听 127.0.0.1 随机端口。返回端口与关闭句柄。 */
export function startRpcServer(options: RpcServerOptions): Promise<RpcServerHandle> {
  const isProjectOpen = options.isProjectOpen || (() => false)
  // 三态路由（治「外部 MCP 生成到非当前项目 → 静默黑洞」，用户拍板 A）：
  // - 项目正在前台打开 + 渲染层可达 → 渲染层网关（A：读写实时刷画布 + 弹卡）。
  // - 窗口活着但项目没在前台 → 混合网关（读写走盘不动非活动 store + 付费确认弹全局卡，不打断）。
  // - 无窗口（headless host）→ 磁盘网关（认 env 逃生口）。
  const makeGateway = (projectId: string): ProjectGateway => {
    if (!projectId || !isRendererAvailable()) return createDiskGateway(projectId)
    return isProjectOpen(projectId) ? createRendererGateway(projectId) : createHybridGateway(projectId)
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const send = (status: number, payload: unknown) => {
        const body = JSON.stringify(payload)
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
        res.end(body)
      }
      try {
        if (req.method !== 'POST' || req.url !== '/rpc') throw new RpcError('仅支持 POST /rpc', 404)
        if (!verifyToken(bearerToken(req))) throw new RpcError('鉴权失败：token 无效', 401)
        const raw = await readBody(req)
        let parsed: { method?: unknown; params?: unknown }
        try {
          parsed = JSON.parse(raw || '{}')
        } catch {
          throw new RpcError('请求体非合法 JSON', 400)
        }
        const method = String(parsed.method || '')
        const params = (parsed.params && typeof parsed.params === 'object' ? parsed.params : {}) as Record<string, unknown>
        const result = await dispatch(method, params, { runTask: options.runTask, fetchTaskResult: options.fetchTaskResult, makeGateway })
        send(200, { ok: true, result })
      } catch (error) {
        const status = error instanceof RpcError ? error.httpStatus : 500
        send(status, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    // 0.0.0.0 绝不用——只 127.0.0.1，外网/局域网够不着。
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose())
          }),
      })
    })
  })
}
