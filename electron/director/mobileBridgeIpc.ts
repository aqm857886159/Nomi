// 导演台手机虚拟相机 IPC：start/stop/status + 事件推送。
// 证书缓存在 userData/director-mobile；页面文案由渲染层随 start 注入（i18n 不住主进程）。
// 事件通道照 nomi:tasks:text:event：绑启动它的 webContents，窗口销毁即停服务。
import path from 'node:path'
import { app, ipcMain, webContents as electronWebContents } from 'electron'
import type { WebContents } from 'electron'
import { toString as qrToSvg } from 'qrcode'
import { assertTrustedSender } from '../ipcSenderGuard'
import { MobileBridgeServer, type MobileBridgeEvent, type MobileBridgeStatus } from './mobileBridgeServer'
import type { MobileBridgeFeedback } from '../shared/contracts/directorMobileBridge'

const START = 'nomi:director:mobile:start'
const STOP = 'nomi:director:mobile:stop'
const STATUS = 'nomi:director:mobile:status'
const EVENT = 'nomi:director:mobile:event'
const FEEDBACK = 'nomi:director:mobile:feedback'

const IDLE_STATUS: MobileBridgeStatus = { running: false, secure: true, port: null, urls: [], devices: [], qrByUrl: {} }

async function withQr(status: MobileBridgeStatus): Promise<MobileBridgeStatus> {
  const qrByUrl: Record<string, string> = {}
  for (const url of status.urls) {
    qrByUrl[url] = await qrToSvg(url, { type: 'svg', width: 192, margin: 1 })
  }
  return { ...status, qrByUrl }
}

let server: MobileBridgeServer | null = null
let subscriberId: number | null = null
let lifetime: Promise<void> = Promise.resolve()
const boundSenders = new WeakSet<WebContents>()

function enqueueLifetime<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifetime.then(operation)
  lifetime = result.then(() => {}, () => {})
  return result
}

function sendEvent(event: MobileBridgeEvent): void {
  if (subscriberId == null) return
  const target: WebContents | undefined = electronWebContents.fromId(subscriberId) || undefined
  if (!target || target.isDestroyed()) return
  target.send(EVENT, event)
}

function bindSender(sender: WebContents): void {
  subscriberId = sender.id
  if (boundSenders.has(sender)) return
  boundSenders.add(sender)
  sender.once('destroyed', () => {
    if (subscriberId !== sender.id) return
    void shutdown(sender.id)
  })
}

async function shutdown(expectedOwner: number): Promise<MobileBridgeStatus> {
  return enqueueLifetime(async () => {
    if (subscriberId !== expectedOwner) return server ? withQr(server.status()) : IDLE_STATUS
    if (server) await server.stop()
    server = null
    subscriberId = null
    return IDLE_STATUS
  })
}

export function registerDirectorMobileIpc(): void {
  ipcMain.handle(START, async (event, payload: { text?: Record<string, string> } | undefined) => {
    assertTrustedSender(event)
    return enqueueLifetime(async () => {
      if (event.sender.isDestroyed()) return IDLE_STATUS
      bindSender(event.sender)
      if (!server) {
        server = new MobileBridgeServer(sendEvent, {
          certDir: path.join(app.getPath('userData'), 'director-mobile'),
          text: payload?.text ?? {},
        })
      }
      return withQr(await server.start())
    })
  })

  ipcMain.handle(STOP, async (event) => {
    assertTrustedSender(event)
    return shutdown(event.sender.id)
  })

  ipcMain.handle(STATUS, async (event) => {
    assertTrustedSender(event)
    return server ? withQr(server.status()) : IDLE_STATUS
  })
  ipcMain.handle(FEEDBACK, (event, payload: MobileBridgeFeedback) => {
    assertTrustedSender(event)
    if (!server) return false
    if (event.sender.id !== subscriberId) throw new Error('Mobile feedback sender does not own this service')
    return server.feedback(payload)
  })
}
