// 导演台手机虚拟相机 IPC：start/stop/status + 事件推送。
// 证书缓存在 userData/director-mobile；页面文案由渲染层随 start 载荷注入（i18n 不住主进程）。
// 事件通道照 nomi:tasks:text:event：绑启动它的 webContents，窗口销毁即停服务。
// 同意闸（2026-09-11）：start 的载荷带 `consent: true` 才算一次用户显式同意；同意只活在**本次 App 运行**
// 的主进程内存里（不落盘、不跨冷启动），照 productionRunApprovalReceipt 的既有纪律——人证在主进程内部装配，
// 渲染层只能发起一次同意，能不能监听由服务自己判（MobileBridgeServer.start 没同意必抛）。
import path from 'node:path'
import { app, ipcMain, webContents as electronWebContents } from 'electron'
import type { WebContents } from 'electron'
import { toString as qrToSvg } from 'qrcode'
import { assertTrustedSender } from '../ipcSenderGuard'
import { MobileBridgeConsentError, MobileBridgeServer, type MobileBridgeEvent, type MobileBridgeStatus } from './mobileBridgeServer'
import type { MobileBridgeFeedback } from '../shared/contracts/directorMobileBridge'

const START = 'nomi:director:mobile:start'
const STOP = 'nomi:director:mobile:stop'
const STATUS = 'nomi:director:mobile:status'
const EVENT = 'nomi:director:mobile:event'
const FEEDBACK = 'nomi:director:mobile:feedback'

/** 本次 App 运行里用户同意过开局域网监听。冷启动重新问一遍。 */
let consentGrantedThisRun = false

function idleStatus(): MobileBridgeStatus {
  return { running: false, secure: true, port: null, urls: [], devices: [], qrByUrl: {}, consentRequired: !consentGrantedThisRun, certFingerprint: null, pairingExpiresAt: null }
}

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
    if (subscriberId !== expectedOwner) return server ? withQr(server.status()) : idleStatus()
    if (server) await server.stop()
    server = null
    subscriberId = null
    return idleStatus()
  })
}

export function registerDirectorMobileIpc(): void {
  ipcMain.handle(START, async (event, payload: { text?: Record<string, string>; consent?: boolean } | undefined) => {
    assertTrustedSender(event)
    return enqueueLifetime(async () => {
      if (event.sender.isDestroyed()) return idleStatus()
      bindSender(event.sender)
      if (payload?.consent === true) consentGrantedThisRun = true
      // 没同意就连服务对象都不造：没有任何路径能从这里走到 listen
      if (!consentGrantedThisRun) return idleStatus()
      if (!server) {
        server = new MobileBridgeServer(sendEvent, {
          certDir: path.join(app.getPath('userData'), 'director-mobile'),
          text: payload?.text ?? {},
        })
      }
      server.grantConsent()
      try {
        return await withQr(await server.start())
      } catch (error) {
        if (!(error instanceof MobileBridgeConsentError)) throw error
        return idleStatus()
      }
    })
  })

  ipcMain.handle(STOP, async (event) => {
    assertTrustedSender(event)
    return shutdown(event.sender.id)
  })

  ipcMain.handle(STATUS, async (event) => {
    assertTrustedSender(event)
    return server ? withQr(server.status()) : idleStatus()
  })
  ipcMain.handle(FEEDBACK, (event, payload: MobileBridgeFeedback) => {
    assertTrustedSender(event)
    if (!server) return false
    if (event.sender.id !== subscriberId) throw new Error('Mobile feedback sender does not own this service')
    return server.feedback(payload)
  })
}
