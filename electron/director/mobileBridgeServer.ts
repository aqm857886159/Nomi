// 导演台手机虚拟相机桥（Electron 版）：局域网 HTTPS（自签名，证书缓存到 userData）+ WebSocket，
// 手机扫码打开页面 → 发 32 字节 Float32 包 / JSON 控制消息（hello / record / pong），桌面端解包成事件回调给渲染层写机位。
// 令牌：页面 URL 与 WS 都带随机 k，局域网里别的设备猜不到，不接受无令牌连接（R20：碰信任的边界按标准做校验）。
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
import { renderMobilePage, type MobilePageText } from './mobilePage'
import type { MobileBridgeDevice, MobileBridgeEvent, MobileBridgeStatus } from '../shared/contracts/directorMobileBridge'
import { MOBILE_PREVIEW_MAX_BYTES, type MobileBridgeFeedback } from '../shared/contracts/directorMobileBridge'

export type { MobileBridgeDevice, MobileBridgeEvent, MobileBridgeStatus } from '../shared/contracts/directorMobileBridge'

export const MOBILE_PACKET_FLOATS = 8
export const MOBILE_PACKET_BYTES = MOBILE_PACKET_FLOATS * 4

export type MobileBridgeOptions = {
  secure?: boolean
  certDir?: string
  host?: string
  port?: number
  pingIntervalMs?: number
  text?: MobilePageText
}

type CertPair = { key: string; cert: string }

const CERT_FILE = 'director-mobile-cert.json'

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

export function decodePacketValues(data: Buffer): number[] | null {
  if (data.byteLength < MOBILE_PACKET_BYTES) return null
  const values: number[] = []
  for (let index = 0; index < MOBILE_PACKET_FLOATS; index += 1) {
    const value = data.readFloatLE(index * 4)
    values.push(Number.isFinite(value) ? value : 0)
  }
  return values
}

type Client = { ws: WebSocket; device: MobileBridgeDevice }

export class MobileBridgeServer {
  private server: http.Server | https.Server | null = null
  private wss: WebSocketServer | null = null
  private clients = new Map<string, Client>()
  private token = ''
  private pingTimer: NodeJS.Timeout | null = null
  private lifetime: Promise<void> = Promise.resolve()
  private recording = false
  private readonly secure: boolean
  private readonly options: MobileBridgeOptions

  constructor(private readonly onEvent: (event: MobileBridgeEvent) => void, options: MobileBridgeOptions = {}) {
    this.options = options
    this.secure = options.secure ?? true
  }

  status(): MobileBridgeStatus {
    const address = this.server?.address() as AddressInfo | null | undefined
    const port = address && typeof address === 'object' ? address.port : null
    const scheme = this.secure ? 'https' : 'http'
    const hosts = this.options.host && this.options.host !== '0.0.0.0' ? [this.options.host] : lanAddresses()
    return {
      running: Boolean(this.server?.listening),
      secure: this.secure,
      port,
      urls: port ? (hosts.length ? hosts : ['127.0.0.1']).map((host) => `${scheme}://${host}:${port}/?k=${this.token}`) : [],
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
    this.token = crypto.randomBytes(12).toString('hex')
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => this.handleHttp(req, res)
    if (this.secure) {
      const certDir = this.options.certDir ?? path.join(os.tmpdir(), 'nomi-director-mobile')
      const pair = await loadOrCreateCert(certDir, lanAddresses())
      this.server = https.createServer({ key: pair.key, cert: pair.cert }, handler)
    } else {
      this.server = http.createServer(handler)
    }
    this.wss = new WebSocketServer({ noServer: true })
    this.server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/ws' || url.searchParams.get('k') !== this.token || !this.wss) {
        socket.destroy()
        return
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws))
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
    this.pingTimer = setInterval(() => this.pingAll(), interval)
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

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET') {
      res.writeHead(405).end()
      return
    }
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

  private attach(ws: WebSocket): void {
    const device: MobileBridgeDevice = { id: crypto.randomBytes(6).toString('hex'), name: 'phone', latencyMs: null, connectedAt: Date.now() }
    this.clients.set(device.id, { ws, device })
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
        const values = decodePacketValues(buffer)
        if (values) this.onEvent({ type: 'packet', deviceId: device.id, values, at: Date.now() })
        return
      }
      let message: { type?: string; name?: string; action?: string; t?: number }
      try {
        message = JSON.parse(String(data)) as typeof message
      } catch {
        return
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return
      if (message.type === 'hello') {
        device.name = typeof message.name === 'string' && message.name.trim() ? message.name.trim().slice(0, 60) : device.name
        this.onEvent({ type: 'device', deviceId: device.id, name: device.name, state: 'connected', latencyMs: device.latencyMs })
        ws.send(JSON.stringify({ type: 'state', recording: this.recording }))
      } else if (message.type === 'record' && (message.action === 'start' || message.action === 'stop')) {
        this.onEvent({ type: 'record', deviceId: device.id, action: message.action })
      } else if (message.type === 'pong' && typeof message.t === 'number') {
        device.latencyMs = Math.max(0, Date.now() - message.t)
        this.onEvent({ type: 'device', deviceId: device.id, name: device.name, state: 'connected', latencyMs: device.latencyMs })
      }
    })
    ws.on('close', () => {
      this.clients.delete(device.id)
      this.onEvent({ type: 'device', deviceId: device.id, name: device.name, state: 'disconnected', latencyMs: device.latencyMs })
    })
    ws.on('error', () => ws.close())
  }

  private pingAll(): void {
    const payload = JSON.stringify({ type: 'ping', t: Date.now() })
    for (const client of this.clients.values()) {
      if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload)
    }
  }
}
