// 导演台手机虚拟相机桥（Electron 版）：局域网 HTTPS（自签名，证书缓存到 userData）+ WebSocket，
// 手机扫码打开页面 → 发 32 字节 Float32 包 / JSON 控制消息（hello / record / pong），桌面端解包成事件回调给渲染层写机位。
//
// 安全面（2026-09-11，docs/plan/2026-09-11-director-lan-pairing-hardening.md）——四条不变量都归这一层管：
//  ① **同意闸**：没调过 grantConsent() 就 start()，直接抛 MobileBridgeConsentError，一个 socket 都不 bind。
//     防线放在服务自己而不是对话框（R28：能让最早那层拦住的别留给 UI）；同意只活在本进程内存，不落盘。
//  ② **配对码一次性 + 有时效**：URL/二维码里的 k 是配对码，第一个成功的 upgrade 消费掉它并当场轮换；
//     配对成功换出会话令牌（s），此后重连走 s，所以断线不用重新扫码。比较走 timingSafeEqual。
//  ③ **证书指纹**：status().certFingerprint 给桌面端显示；URL 的 fragment 带同一串（fragment 不上线，
//     是一条从桌面走二维码到手机的带外声明），手机页显示它供人眼与浏览器证书详情比对。
//  ④ **入站上限 + schema**：ws 的 maxPayload 拧到 MOBILE_CONTROL_MAX_BYTES；帧内容由
//     mobileBridgeMessages.ts 单独判，畸形一律断开（1008）而不是静默吞掉。
//
// 单测用 secure=false 的纯 HTTP 模式；真机用 HTTPS（iOS / Android 的陀螺仪都要求安全上下文）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { generate } from 'selfsigned'
import { WebSocketServer, type WebSocket } from 'ws'
import { decodePacketValues, parseControlMessage } from './mobileBridgeMessages'
import { renderMobilePage, type MobilePageText } from './mobilePage'
import type { MobileBridgeDevice, MobileBridgeEvent, MobileBridgeStatus } from '../shared/contracts/directorMobileBridge'
import { MOBILE_CONTROL_MAX_BYTES, MOBILE_PAIRING_TTL_MS, MOBILE_PREVIEW_MAX_BYTES, type MobileBridgeFeedback } from '../shared/contracts/directorMobileBridge'

export type { MobileBridgeDevice, MobileBridgeEvent, MobileBridgeStatus } from '../shared/contracts/directorMobileBridge'

export type MobileBridgeOptions = {
  secure?: boolean
  certDir?: string
  host?: string
  port?: number
  pingIntervalMs?: number
  pairingTtlMs?: number
  /** 注入时钟：配对码过期的用例因此不靠墙钟（R18）。 */
  now?: () => number
  text?: MobilePageText
}

/** 没拿到用户同意就想开局域网监听 —— 服务自己抛，调用方（IPC）翻译成 consentRequired 状态。 */
export class MobileBridgeConsentError extends Error {
  readonly code = 'consent-required'
  constructor() {
    super('Phone camera LAN service needs an explicit user consent before it can listen')
    this.name = 'MobileBridgeConsentError'
  }
}

type CertPair = { key: string; cert: string }

const CERT_FILE = 'director-mobile-cert.json'
/** 关闭畸形帧用的码：1008 = policy violation（RFC 6455 §7.4.1）。超限由 ws 自己按 1009 关。 */
const CLOSE_POLICY_VIOLATION = 1008

export function lanAddresses(): string[] {
  const out: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address)
    }
  }
  return out
}

// 证书：首次生成（10 年、RSA 2048、SAN 含 localhost / 127.0.0.1 / 当前局域网 IP）存 certDir；局域网 IP 变了就重生成
export async function loadOrCreateCert(certDir: string, ips: string[]): Promise<CertPair> {
  const file = path.join(certDir, CERT_FILE)
  const wanted = ['127.0.0.1', ...ips].sort().join(',')
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as CertPair & { ips?: string }
    if (cached.key && cached.cert && cached.ips === wanted) return { key: cached.key, cert: cached.cert }
  } catch {
    // 没有缓存 / 坏了 → 重新生成
  }
  const pems = await generate([{ name: 'commonName', value: 'nomi-director-mobile' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...['127.0.0.1', ...ips].map((ip) => ({ type: 7 as const, ip }))] },
    ],
  })
  const pair = { key: pems.private, cert: pems.cert }
  try {
    fs.mkdirSync(certDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...pair, ips: wanted }), 'utf8')
  } catch {
    // 写不进缓存也能用，只是下次再生成
  }
  return pair
}

/** 自签证书的 SHA-256 指纹，冒号分组大写（与浏览器证书详情面同一种写法，人眼能逐段比）。 */
export function certFingerprint(certPem: string): string {
  return new crypto.X509Certificate(certPem).fingerprint256
}

/** 定时安全比较：长度不同直接 false，长度相同走 timingSafeEqual。 */
function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length || left.length === 0) return false
  return crypto.timingSafeEqual(left, right)
}

type Client = { ws: WebSocket; device: MobileBridgeDevice }
type Pairing = { code: string; expiresAt: number }

export class MobileBridgeServer {
  private server: http.Server | https.Server | null = null
  private wss: WebSocketServer | null = null
  private clients = new Map<string, Client>()
  private pairing: Pairing | null = null
  private sessions = new Set<string>()
  private consented = false
  private fingerprint: string | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private lifetime: Promise<void> = Promise.resolve()
  private recording = false
  private readonly secure: boolean
  private readonly options: MobileBridgeOptions
  private readonly now: () => number
  private readonly pairingTtlMs: number

  constructor(private readonly onEvent: (event: MobileBridgeEvent) => void, options: MobileBridgeOptions = {}) {
    this.options = options
    this.secure = options.secure ?? true
    this.now = options.now ?? Date.now
    this.pairingTtlMs = options.pairingTtlMs ?? MOBILE_PAIRING_TTL_MS
  }

  /** 用户在 Nomi 自己的窗口里点了「允许并开启」。只活在本进程内存：冷启动重新问一遍。 */
  grantConsent(): void {
    this.consented = true
  }

  status(): MobileBridgeStatus {
    const address = this.server?.address() as AddressInfo | null | undefined
    const port = address && typeof address === 'object' ? address.port : null
    const scheme = this.secure ? 'https' : 'http'
    const hosts = this.options.host && this.options.host !== '0.0.0.0' ? [this.options.host] : lanAddresses()
    const pairing = this.server?.listening ? this.ensurePairing() : null
    // 指纹走 fragment：浏览器不把 # 后面的内容发给服务端，所以它是一条纯带外声明，中间人改不到
    const fragment = this.fingerprint ? `#fp=${this.fingerprint.replaceAll(':', '').toLowerCase()}` : ''
    return {
      running: Boolean(this.server?.listening),
      secure: this.secure,
      consentRequired: !this.consented,
      certFingerprint: this.fingerprint,
      pairingExpiresAt: pairing?.expiresAt ?? null,
      port,
      urls: port && pairing ? (hosts.length ? hosts : ['127.0.0.1']).map((host) => `${scheme}://${host}:${port}/?k=${pairing.code}${fragment}`) : [],
      devices: [...this.clients.values()].map((client) => ({ ...client.device })),
    }
  }

  feedback(payload: MobileBridgeFeedback): boolean {
    if (!this.server?.listening || !payload || typeof payload.recording !== 'boolean') return false
    const frame = payload.frame
    if (frame !== undefined && (!(frame instanceof Uint8Array) || frame.byteLength > MOBILE_PREVIEW_MAX_BYTES || frame.byteLength < 8 || !Buffer.from(frame.buffer, frame.byteOffset, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))) return false
    this.recording = payload.recording
    const state = JSON.stringify({ type: 'state', recording: this.recording })
    for (const { ws } of this.clients.values()) {
      // Keep the current frame only: never append images behind a slow socket's queued bytes.
      if (ws.readyState !== ws.OPEN || ws.bufferedAmount > 0) continue
      ws.send(state)
      if (frame) ws.send(frame, { binary: true, compress: false })
    }
    return true
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifetime.then(operation)
    this.lifetime = result.then(() => {}, () => {})
    return result
  }

  start(): Promise<MobileBridgeStatus> {
    return this.enqueue(async () => {
      // 同意闸在最前面：连 open() 都不进，证书也不生成
      if (!this.consented) throw new MobileBridgeConsentError()
      try {
        return await this.open()
      } catch (error) {
        await this.close()
        throw error
      }
    })
  }

  private async open(): Promise<MobileBridgeStatus> {
    if (this.server?.listening) return this.status()
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => this.handleHttp(req, res)
    if (this.secure) {
      const certDir = this.options.certDir ?? path.join(os.tmpdir(), 'nomi-director-mobile')
      const pair = await loadOrCreateCert(certDir, lanAddresses())
      this.fingerprint = certFingerprint(pair.cert)
      this.server = https.createServer({ key: pair.key, cert: pair.cert }, handler)
    } else {
      this.fingerprint = null
      this.server = http.createServer(handler)
    }
    this.rotatePairing(false)
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MOBILE_CONTROL_MAX_BYTES })
    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const admitted = url.pathname === '/ws' ? this.admit(url) : null
      if (!admitted || !this.wss) {
        socket.destroy()
        return
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws, admitted))
    })
    await new Promise<void>((resolve, reject) => {
      const server = this.server
      if (!server) return reject(new Error('server missing'))
      server.once('error', reject)
      server.listen(this.options.port ?? 0, this.options.host ?? '0.0.0.0', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const interval = this.options.pingIntervalMs ?? 2000
    this.pingTimer = setInterval(() => this.tick(), interval)
    return this.status()
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.close())
  }

  private async close(): Promise<void> {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    for (const client of this.clients.values()) client.ws.terminate()
    this.clients.clear()
    this.sessions.clear()
    this.pairing = null
    this.fingerprint = null
    this.recording = false
    const wss = this.wss
    const server = this.server
    this.wss = null
    this.server = null
    await new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve()))
    await new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  /** 现在这一刻有效的配对码；过期的当场换掉（换了就发事件，桌面端重画二维码）。 */
  private ensurePairing(): Pairing {
    if (!this.pairing || this.pairing.expiresAt <= this.now()) this.rotatePairing(Boolean(this.pairing))
    return this.pairing as Pairing
  }

  private rotatePairing(announce: boolean): void {
    this.pairing = { code: crypto.randomBytes(12).toString('hex'), expiresAt: this.now() + this.pairingTtlMs }
    if (announce) this.onEvent({ type: 'pairing', at: this.now(), expiresAt: this.pairing.expiresAt })
  }

  /**
   * upgrade 的准入：会话令牌（老设备重连）或配对码（新设备首次）。配对码**用一次就换**，
   * 所以截图/投屏泄露的那张二维码在第一台手机连上之后立刻作废。
   */
  private admit(url: URL): { sessionToken: string } | null {
    const session = url.searchParams.get('s')
    if (session) return this.sessions.has(session) ? { sessionToken: session } : null
    const code = url.searchParams.get('k')
    if (!code) return null
    const pairing = this.ensurePairing()
    if (!secretEquals(code, pairing.code)) return null
    this.rotatePairing(true)
    const sessionToken = crypto.randomBytes(16).toString('hex')
    this.sessions.add(sessionToken)
    return { sessionToken }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET') {
      res.writeHead(405).end()
      return
    }
    // 页面本身不含任何密钥（配对码在 URL 里、指纹在 fragment 里，都由扫码人自己带着），
    // 所以它不设门：设了反而会让「配对码用掉后刷新页面」变成 403，而那正是重连路径。
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(renderMobilePage(this.options.text ?? {}))
      return
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, devices: this.clients.size }))
      return
    }
    res.writeHead(404).end()
  }

  private attach(ws: WebSocket, admitted: { sessionToken: string }): void {
    const device: MobileBridgeDevice = { id: crypto.randomBytes(6).toString('hex'), name: 'phone', latencyMs: null, connectedAt: this.now() }
    this.clients.set(device.id, { ws, device })
    // 配对回执：会话令牌让手机断线后不用重新扫码；指纹供页面与二维码 fragment 比一次（误配检查，不是中间人防护）
    ws.send(JSON.stringify({ type: 'paired', s: admitted.sessionToken, fp: this.fingerprint }))
    const reject = (reason: string): void => {
      ws.close(CLOSE_POLICY_VIOLATION, reason.slice(0, 100))
    }
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
        const values = decodePacketValues(buffer)
        if (!values) return reject('malformed pose packet')
        this.onEvent({ type: 'packet', deviceId: device.id, values, at: this.now() })
        return
      }
      const verdict = parseControlMessage(String(data))
      if (!verdict.ok) return reject(verdict.reason)
      const message = verdict.value
      if (message.type === 'hello') {
        device.name = message.name ?? device.name
        this.onEvent({ type: 'device', deviceId: device.id, name: device.name, state: 'connected', latencyMs: device.latencyMs })
        ws.send(JSON.stringify({ type: 'state', recording: this.recording }))
      } else if (message.type === 'record') {
        this.onEvent({ type: 'record', deviceId: device.id, action: message.action })
      } else {
        device.latencyMs = Math.max(0, this.now() - message.t)
        this.onEvent({ type: 'device', deviceId: device.id, name: device.name, state: 'connected', latencyMs: device.latencyMs })
      }
    })
    ws.on('close', () => {
      this.clients.delete(device.id)
      this.onEvent({ type: 'device', deviceId: device.id, name: device.name, state: 'disconnected', latencyMs: device.latencyMs })
    })
    ws.on('error', () => ws.close())
  }

  /** 每个 ping 周期顺手把过期的配对码换掉，桌面端的二维码因此不会一直摆着一个已经连不上的码。 */
  private tick(): void {
    this.ensurePairing()
    const payload = JSON.stringify({ type: 'ping', t: this.now() })
    for (const client of this.clients.values()) {
      if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload)
    }
  }
}
