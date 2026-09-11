// 手机虚拟相机局域网桥的四项安全不变量（docs/plan/2026-09-11-director-lan-pairing-hardening.md）：
// ① 没拿到用户同意就不许 bind；② 配对码一次性 + 有时效；③ 自签证书指纹可见且与真实证书一致；
// ④ 入站帧有 schema 和上限，畸形/超限一律断开。时钟注入，不用墙钟（R18）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { MobileBridgeConsentError, MobileBridgeServer, type MobileBridgeEvent } from './mobileBridgeServer'
import { MOBILE_CONTROL_MAX_BYTES, MOBILE_PAIRING_TTL_MS } from '../shared/contracts/directorMobileBridge'

const live: MobileBridgeServer[] = []
const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(live.splice(0).map((server) => server.stop()))
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function create(options: ConstructorParameters<typeof MobileBridgeServer>[1] = {}, onEvent: (event: MobileBridgeEvent) => void = () => {}) {
  const server = new MobileBridgeServer(onEvent, { secure: false, host: '127.0.0.1', pingIntervalMs: 10_000, ...options })
  live.push(server)
  return server
}

function pairingCode(urls: string[]): string {
  return new URL(urls[0]).searchParams.get('k') ?? ''
}

type Attempt = { ws: WebSocket; opened: Promise<boolean>; closeCode: Promise<number>; message: (match: (value: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>> }

function dial(port: number, query: string): Attempt {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`)
  const seen: Record<string, unknown>[] = []
  const waiters: Array<{ match: (value: Record<string, unknown>) => boolean; resolve: (value: Record<string, unknown>) => void }> = []
  ws.on('message', (data, isBinary) => {
    if (isBinary) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(String(data)) as Record<string, unknown>
    } catch {
      return
    }
    seen.push(parsed)
    for (const waiter of [...waiters]) {
      if (!waiter.match(parsed)) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(parsed)
    }
  })
  const closeCode = new Promise<number>((resolve) => {
    ws.on('close', (code) => resolve(code))
    ws.on('error', () => resolve(-1))
  })
  const opened = new Promise<boolean>((resolve) => {
    ws.on('open', () => resolve(true))
    ws.on('error', () => resolve(false))
    ws.on('close', () => resolve(false))
  })
  const message = (match: (value: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const hit = seen.find(match)
      if (hit) return resolve(hit)
      waiters.push({ match, resolve })
    })
  return { ws, opened, closeCode, message }
}

function packet(values: number[]): Buffer {
  const buffer = Buffer.alloc(32)
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4))
  return buffer
}

describe('① 局域网监听必须先拿到用户显式同意', () => {
  it('没同意时 start 抛 MobileBridgeConsentError，一个端口都没 bind', async () => {
    const server = create()
    await expect(server.start()).rejects.toBeInstanceOf(MobileBridgeConsentError)
    expect(server.status().running).toBe(false)
    expect(server.status().port).toBeNull()
    expect(server.status().consentRequired).toBe(true)
    expect(server.status().urls).toEqual([])
  })

  it('同意之后才起得来，状态里的 consentRequired 落下去', async () => {
    const server = create()
    server.grantConsent()
    const status = await server.start()
    expect(status.running).toBe(true)
    expect(status.consentRequired).toBe(false)
    expect(status.port).toBeGreaterThan(0)
  })
})

describe('② 配对码一次性 + 有时效', () => {
  it('第一台手机消费掉配对码并换出会话令牌；同一个码第二次被拒', async () => {
    const events: MobileBridgeEvent[] = []
    const server = create({}, (event) => events.push(event))
    server.grantConsent()
    const status = await server.start()
    const code = pairingCode(status.urls)
    expect(code).not.toBe('')

    const first = dial(status.port!, `k=${code}`)
    expect(await first.opened).toBe(true)
    const paired = await first.message((value) => value.type === 'paired')
    expect(typeof paired.s).toBe('string')
    expect(String(paired.s).length).toBeGreaterThanOrEqual(16)

    // 用后即焚：服务当场轮换，桌面端的二维码跟着换
    expect(pairingCode(server.status().urls)).not.toBe(code)
    expect(events.some((event) => event.type === 'pairing')).toBe(true)

    const replay = dial(status.port!, `k=${code}`)
    expect(await replay.opened).toBe(false)

    // 会话令牌可以重连，断线不用重新扫码
    first.ws.close()
    const again = dial(status.port!, `s=${String(paired.s)}`)
    expect(await again.opened).toBe(true)
    again.ws.close()
  })

  it('过期的配对码被拒（注入时钟，不等墙钟）', async () => {
    let now = 1_000_000
    const server = create({ now: () => now })
    server.grantConsent()
    const status = await server.start()
    const code = pairingCode(status.urls)
    now += MOBILE_PAIRING_TTL_MS + 1
    const late = dial(status.port!, `k=${code}`)
    expect(await late.opened).toBe(false)
    // 过期后桌面端拿到的是一个新码，扫新码仍连得上
    const fresh = pairingCode(server.status().urls)
    expect(fresh).not.toBe(code)
    const retry = dial(status.port!, `k=${fresh}`)
    expect(await retry.opened).toBe(true)
    retry.ws.close()
  })
})

describe('③ 自签证书指纹可见可核', () => {
  it('status 的指纹与磁盘上的证书一致，并随二维码 URL 的 fragment 走带外通道', async () => {
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mobile-cert-'))
    temporaryDirs.push(certDir)
    const server = create({ secure: true, certDir })
    server.grantConsent()
    const status = await server.start()
    const cached = JSON.parse(fs.readFileSync(path.join(certDir, 'director-mobile-cert.json'), 'utf8')) as { cert: string }
    const expected = new crypto.X509Certificate(cached.cert).fingerprint256
    expect(status.certFingerprint).toBe(expected)
    expect(status.urls[0]).toContain(`#fp=${expected.replaceAll(':', '').toLowerCase()}`)
  })
})

describe('④ 入站帧 schema + 大小上限', () => {
  it('超过上限的帧被断开（1009）', async () => {
    const server = create()
    server.grantConsent()
    const status = await server.start()
    const phone = dial(status.port!, `k=${pairingCode(status.urls)}`)
    expect(await phone.opened).toBe(true)
    phone.ws.send(Buffer.alloc(MOBILE_CONTROL_MAX_BYTES + 1))
    expect(await phone.closeCode).toBe(1009)
  })

  it('畸形 JSON 控制帧被断开（1008），不再静默吞掉', async () => {
    const server = create()
    server.grantConsent()
    const status = await server.start()
    const phone = dial(status.port!, `k=${pairingCode(status.urls)}`)
    expect(await phone.opened).toBe(true)
    phone.ws.send('{ not json')
    expect(await phone.closeCode).toBe(1008)
  })

  it('未知类型 / 字段类型不对的控制帧被断开', async () => {
    const server = create()
    server.grantConsent()
    const status = await server.start()
    const phone = dial(status.port!, `k=${pairingCode(status.urls)}`)
    expect(await phone.opened).toBe(true)
    phone.ws.send(JSON.stringify({ type: 'record', action: 'explode' }))
    expect(await phone.closeCode).toBe(1008)
  })

  it('长度不是 32 字节、或量程越界的二进制包被断开', async () => {
    const server = create()
    server.grantConsent()
    const status = await server.start()
    const long = dial(status.port!, `k=${pairingCode(status.urls)}`)
    expect(await long.opened).toBe(true)
    long.ws.send(Buffer.alloc(33))
    expect(await long.closeCode).toBe(1008)

    const outOfRange = dial(status.port!, `k=${pairingCode(server.status().urls)}`)
    expect(await outOfRange.opened).toBe(true)
    outOfRange.ws.send(packet([99, 0, 0, 0, 0, 0, 35, 0]))
    expect(await outOfRange.closeCode).toBe(1008)
  })

  it('合法包照常成事件', async () => {
    // 事件驱动的等待：桥每回调一个事件就唤醒等待者，不用墙钟轮询（R18）
    const events: MobileBridgeEvent[] = []
    let wake: (() => void) | null = null
    const server = create({}, (event) => {
      events.push(event)
      if (event.type === 'packet') wake?.()
    })
    const firstPacket = new Promise<void>((resolve) => {
      wake = resolve
    })
    server.grantConsent()
    const status = await server.start()
    const phone = dial(status.port!, `k=${pairingCode(status.urls)}`)
    expect(await phone.opened).toBe(true)
    phone.ws.send(packet([0.5, -1, 0.25, 1.5, -2, 0.1, 50, 1]))
    await firstPacket
    const received = events.find((event) => event.type === 'packet')
    expect(received && received.type === 'packet' ? received.values.map((value) => Number(value.toFixed(2))) : null).toEqual([0.5, -1, 0.25, 1.5, -2, 0.1, 50, 1])
    phone.ws.close()
  })
})
