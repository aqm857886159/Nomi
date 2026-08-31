// 能力核 · 主进程 → 运行中渲染层的「请求/应答」桥（A 模式实时桥接的地基）。
//
// 此前能力核只有渲染层 → 主进程的单向上报（active-project），没有反向通道：主进程写完工程
// 既不通知界面、也没法弹「需要用户确认」的 UI。这条桥补上反向请求——主进程把一条 {id,op,payload}
// 发给当前窗口，渲染层处理后经 nomi:capability:apply-reply 带同一 id 回结果，按 id 配对 resolve。
//
// 不变量：
// - 只发给「当前主窗口」的 webContents（setRendererTarget 注入）；窗口不在/销毁 → 立即 reject（调用方降级）。
// - 每次请求带超时，超时即 reject 并清理 pending（绝不无限挂——这正是要根治的「卡死」）。
// - 付费确认走它时：confirmed=true 只可能来自渲染层那条 reply（真人点确认后由 preload 发），
//   外部 MCP 进程够不到这条 IPC，故「真人确认才铸令牌」的信任边界不破（见 spendGrant.ts）。
import { ipcMain, type WebContents } from 'electron'

export const CAPABILITY_APPLY_CHANNEL = 'nomi:capability:apply'
export const CAPABILITY_APPLY_REPLY_CHANNEL = 'nomi:capability:apply-reply'

export class RendererUnavailableError extends Error {
  constructor(message = 'Nomi 窗口不可用') {
    super(message)
    this.name = 'RendererUnavailableError'
  }
}

export class RendererApplyError extends Error {
  readonly code?: string
  readonly dispatchState?: 'not_dispatched' | 'submission_unknown' | 'provider_accepted'

  constructor(message: string, options: { code?: string; dispatchState?: 'not_dispatched' | 'submission_unknown' | 'provider_accepted' } = {}) {
    super(message)
    this.name = 'RendererApplyError'
    this.code = options.code
    this.dispatchState = options.dispatchState
  }
}

let target: WebContents | null = null
let seq = 0
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let replyListenerBound = false

/** 主进程在创建/销毁主窗口时调用，登记/清除当前可达的渲染层。 */
export function setRendererTarget(webContents: WebContents | null): void {
  target = webContents
}

export function isRendererAvailable(): boolean {
  return Boolean(target && !target.isDestroyed())
}

function ensureReplyListener(): void {
  if (replyListenerBound) return
  replyListenerBound = true
  ipcMain.on(CAPABILITY_APPLY_REPLY_CHANNEL, (_event, payload: { id?: number; ok?: boolean; result?: unknown; error?: string; errorCode?: string; dispatchState?: string }) => {
    const id = Number(payload?.id)
    const entry = pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(id)
    if (payload?.ok) entry.resolve(payload.result)
    else entry.reject(new RendererApplyError(String(payload?.error || '渲染层处理失败'), {
      ...(typeof payload?.errorCode === 'string' ? { code: payload.errorCode } : {}),
      ...(['not_dispatched', 'submission_unknown', 'provider_accepted'].includes(String(payload?.dispatchState))
        ? { dispatchState: payload.dispatchState as 'not_dispatched' | 'submission_unknown' | 'provider_accepted' }
        : {}),
    }))
  })
}

/**
 * 向渲染层发一条请求并等其应答。timeoutMs 内无应答即 reject（不挂死）。
 * 窗口不可用立即 reject（RendererUnavailableError），调用方据此降级到 B 模式（直写盘）。
 */
export function requestRenderer(op: string, payload: unknown, timeoutMs: number): Promise<unknown> {
  ensureReplyListener()
  if (!target || target.isDestroyed()) {
    return Promise.reject(new RendererUnavailableError())
  }
  const id = (seq += 1)
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new RendererApplyError(`渲染层无响应（${Math.round(timeoutMs / 1000)}s 超时）`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try {
      target!.send(CAPABILITY_APPLY_CHANNEL, { id, op, payload })
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error instanceof Error ? error : new RendererApplyError(String(error)))
    }
  })
}
