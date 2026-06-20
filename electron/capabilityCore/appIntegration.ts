// 能力核 · app 集成（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S4）。
//
// 把 RPC server + token + 实例广告接到运行中的 Nomi app：启动时拉起 RPC（127.0.0.1）、ensureToken、
// 写 instance.json 让外部 CLI/MCP 探测得到「app 开着」；退出时清广告 + 关 server。
// 还维护「当前哪个项目正在窗口里打开」（renderer 经 IPC 上报）供 A/B 守卫用——避免外部直写正在
// 编辑的工程被内存 store 覆盖（rpcServer 注释详述）。
//
// 这里只做接线，不碰 main.ts 的其它职责（保持 main.ts 精简、单一关注点）。
import { app } from 'electron'
import { startRpcServer, type RpcServerHandle } from './rpcServer'
import { ensureToken } from './security'
import { clearInstanceAdvertisement, writeInstanceAdvertisement } from './lockfile'
import type { FetchTaskResultFn, RunTaskFn } from './core'

let handle: RpcServerHandle | null = null
let openProjectId = ''

/** renderer 上报当前打开的项目（打开/切换=id，关闭=''）。A/B 守卫据此拒绝直写打开中的工程。 */
export function setOpenProjectId(projectId: string): void {
  openProjectId = String(projectId || '').trim()
}

/**
 * 启动能力核对外口。绝不拖垮 app 启动：任何失败只记日志、不抛（fail-open，与 applySystemProxy 同纪律）。
 */
export async function startCapabilityCore(runTask: RunTaskFn, fetchTaskResult: FetchTaskResultFn): Promise<void> {
  try {
    const token = ensureToken()
    handle = await startRpcServer({
      runTask,
      fetchTaskResult,
      isProjectOpen: (id) => Boolean(openProjectId) && id === openProjectId,
    })
    writeInstanceAdvertisement({
      pid: process.pid,
      port: handle.port,
      token,
      startedAt: Date.now(),
      version: app.getVersion(),
    })
    console.log(`[nomi:capability-core] RPC 监听 127.0.0.1:${handle.port}`)
  } catch (error) {
    console.error('[nomi:capability-core] 启动失败（不影响 app）:', error)
  }
}

/** 退出清理：清广告 + 关 server。同步触发、不抛，绝不卡退出。 */
export function stopCapabilityCore(): void {
  clearInstanceAdvertisement()
  if (handle) {
    void handle.close()
    handle = null
  }
}
