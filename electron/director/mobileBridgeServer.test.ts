import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { decodePacketValues } from './mobileBridgeMessages'
import { MobileBridgeServer, type MobileBridgeEvent } from './mobileBridgeServer'

function packet(values: number[]): Buffer {
  const buffer = Buffer.alloc(32)
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4))
  return buffer
}

// 事件驱动的等待：桥每回调一个事件就唤醒所有等待者，不用墙钟轮询（R18 测试等待门岗）。
// 真死锁由 vitest 的用例超时兜底。
function createEventInbox() {
  const events: MobileBridgeEvent[] = []
  const waiters: Array<{ match: (event: MobileBridgeEvent) => boolean; resolve: () => void }> = []
  const push = (event: MobileBridgeEvent) => {
    events.push(event)
    for (const waiter of [...waiters]) {
      if (!waiter.match(event)) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve()
    }
  }
  const until = (match: (event: MobileBridgeEvent) => boolean) =>
    new Promise<void>((resolve) => {
      if (events.some(match)) return resolve()
      waiters.push({ match, resolve })
    })
  return { events, push, until }
}

describe('MobileBridgeServer（模拟手机客户端）', () => {
  let server: MobileBridgeServer | null = null
  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('页面带令牌、无令牌的 WS 被拒、手机 hello / 32 字节包 / 录制 / pong 都成事件', async () => {
    const inbox = createEventInbox()
    server = new MobileBridgeServer(inbox.push, { secure: false, host: '127.0.0.1', pingIntervalMs: 50, text: { title: 'Nomi' } })
    server.grantConsent()
    const status = await server.start()
    expect(status.running).toBe(true)
    expect(status.port).toBeGreaterThan(0)
    const url = new URL(status.urls[0])
    expect(url.searchParams.get('k')).toHaveLength(24)
    const html = await fetch(`http://127.0.0.1:${status.port}/`).then((response) => response.text())
    expect(html).toContain('__NOMI_MOBILE_TEXT__')
    expect(html).toContain('"title":"Nomi"')

    const rejected = new WebSocket(`ws://127.0.0.1:${status.port}/ws?k=wrong`)
    await new Promise<void>((resolve) => {
      rejected.on('error', () => resolve())
      rejected.on('close', () => resolve())
    })

    const phone = new WebSocket(`ws://127.0.0.1:${status.port}/ws?k=${url.searchParams.get('k')}`)
    await new Promise<void>((resolve, reject) => {
      phone.on('open', () => resolve())
      phone.on('error', reject)
    })
    // 畸形帧的处置（断开）住 mobileBridgeSecurity.test.ts；这里只走正常手机页发得出的那些帧。
    phone.send(JSON.stringify({ type: 'hello', role: 'phone', name: 'Pixel' }))
    await inbox.until((event) => event.type === 'device' && event.state === 'connected' && event.name === 'Pixel')
    phone.send(packet([0.5, -1, 0.25, 1.5, -2, 0.1, 50, 1]))
    await inbox.until((event) => event.type === 'packet')
    const received = inbox.events.find((event) => event.type === 'packet')
    expect(received && received.type === 'packet' ? received.values.map((value) => Number(value.toFixed(2))) : null).toEqual([0.5, -1, 0.25, 1.5, -2, 0.1, 50, 1])
    phone.send(JSON.stringify({ type: 'record', action: 'start' }))
    await inbox.until((event) => event.type === 'record' && event.action === 'start')
    phone.on('message', (data) => {
      const message = JSON.parse(String(data)) as { type?: string; t?: number }
      if (message.type === 'ping') phone.send(JSON.stringify({ type: 'pong', t: message.t }))
    })
    // pong 回来 → 桥发一条带延迟数字的 device 事件
    await inbox.until((event) => event.type === 'device' && event.state === 'connected' && typeof event.latencyMs === 'number')
    expect(server.status().devices).toHaveLength(1)
    expect(typeof server.status().devices[0]?.latencyMs).toBe('number')
    phone.close()
    await inbox.until((event) => event.type === 'device' && event.state === 'disconnected')
    expect(server.status().devices).toHaveLength(0)
  })

  it('包解码：长度不是 32 字节、NaN、量程越界一律 null（畸形不再被归一化吞掉）', () => {
    expect(decodePacketValues(Buffer.alloc(8))).toBeNull()
    expect(decodePacketValues(Buffer.alloc(33))).toBeNull()
    const nan = packet([1, 1, 1, 4, 5, 6, 7, 1])
    nan.writeFloatLE(Number.NaN, 0)
    expect(decodePacketValues(nan)).toBeNull()
    expect(decodePacketValues(packet([9, 0, 0, 0, 0, 0, 35, 0]))).toBeNull()
    expect(decodePacketValues(packet([1, -1, 0.5, 30, -30, 2, 35, 1]))).toEqual([1, -1, 0.5, 30, -30, 2, 35, 1])
  })
})
