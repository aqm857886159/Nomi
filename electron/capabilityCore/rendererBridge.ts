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
import { logWarn } from '../logging/logger'

export const CAPABILITY_APPLY_CHANNEL = 'nomi:capability:apply'
export const CAPABILITY_APPLY_REPLY_CHANNEL = 'nomi:capability:apply-reply'

export class RendererUnavailableError extends Error {
  constructor(message = 'Nomi 窗口不可用') {
    super(message)
    this.name = 'RendererUnavailableError'
  }
}

export class RendererApplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RendererApplyError'
  }
}

let target: WebContents | null = null
let seq = 0
/**
 * pending 条目记下**发出时**的收件人身份（webContentsId/frameId/origin）。
 *
 * 为什么必须记：请求是定向发给 target 那个 webContents 的，但回复通道此前只按 id 配对——任何
 * renderer/frame（如被打开的第三方页面、devtools 里的 frame）都能抢先发一条同 id 的 apply-reply
 * 冒充答复。付费确认的 confirmed=true 正走这条桥（见文件头「不变量」第 3 条），所以这是信任缺口，
 * 不是洁癖：伪造一条 {ok:true,result:{confirmed:true}} 等于替真人点了确认。
 */
type PendingEntry = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  webContentsId: number
  frameRoutingId: number
  origin: string
}
const pending = new Map<number, PendingEntry>()
let replyListenerBound = false

function frameOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' ? 'file://' : parsed.origin
  } catch {
    return null
  }
}

/** 主进程在创建/销毁主窗口时调用，登记/清除当前可达的渲染层。 */
export function setRendererTarget(webContents: WebContents | null): void {
  target = webContents
}

export function isRendererAvailable(): boolean {
  return Boolean(target && !target.isDestroyed())
}

/** Main-process identity used when a renderer gesture is attested for a challenge. */
export function rendererTargetIdentity(): { webContentsId: number; frameId: number; origin: string } | null {
  if (!target || target.isDestroyed()) return null
  return { webContentsId: target.id, frameId: 0, origin: 'app://nomi' }
}

function ensureReplyListener(): void {
  if (replyListenerBound) return
  replyListenerBound = true
  ipcMain.on(CAPABILITY_APPLY_REPLY_CHANNEL, (event, payload: { id?: number; ok?: boolean; result?: unknown; error?: string }) => {
    const id = Number(payload?.id)
    const entry = pending.get(id)
    if (!entry) return
    // 来源绑定：回复必须来自当初收件的那个 webContents + 那个 frame。不匹配 → **丢弃**，
    // 既不 resolve 也不 reject——若 reject，伪造者就能把真请求打成失败（拒绝服务）；丢弃则让
    // 真答复或超时正常收尾。
    const senderId = event.sender?.id
    const frameRoutingId = event.senderFrame?.routingId
    const senderOrigin = frameOrigin(event.senderFrame?.url)
    if (senderId !== entry.webContentsId || frameRoutingId !== entry.frameRoutingId || senderOrigin !== entry.origin) {
      logWarn('capability', 'apply-reply-dropped-unexpected-sender', {
        id,
        sender: `${senderId}/${frameRoutingId}`,
        expected: `${entry.webContentsId}/${entry.frameRoutingId}`,
      })
      return
    }
    clearTimeout(entry.timer)
    pending.delete(id)
    if (payload?.ok) entry.resolve(payload.result)
    else entry.reject(new RendererApplyError(String(payload?.error || '渲染层处理失败')))
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
  // 收件人身份在**发出这一刻**定格：之后即便 target 被换掉（窗口重建），这条 pending 仍只认原收件人，
  // 不会被新窗口或别的 frame 的同 id 回复顶掉。主 frame 的 routingId 走 mainFrame（渲染层的
  // capability.onApply 就跑在主 frame 里）。
  const recipient = target!
  const recipientFrameRoutingId = recipient.mainFrame?.routingId ?? 1
  const recipientOrigin = frameOrigin(recipient.getURL())
  if (!recipientOrigin) return Promise.reject(new RendererUnavailableError('Nomi 窗口来源不可验证'))
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new RendererApplyError(`渲染层无响应（${Math.round(timeoutMs / 1000)}s 超时）`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer, webContentsId: recipient.id, frameRoutingId: recipientFrameRoutingId, origin: recipientOrigin })
    try {
      target!.send(CAPABILITY_APPLY_CHANNEL, { id, op, payload })
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error instanceof Error ? error : new RendererApplyError(String(error)))
    }
  })
}
