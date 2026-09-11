import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { MobileBridgeServer } from './mobileBridgeServer'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex')

describe('mobile preview and recording feedback', () => {
  let bridge: MobileBridgeServer
  let phone: WebSocket
  afterEach(async () => { phone?.terminate(); await bridge?.stop(); vi.restoreAllMocks() })

  async function connect() {
    bridge = new MobileBridgeServer(() => {}, { secure: false, host: '127.0.0.1' })
    bridge.grantConsent()
    const state = await bridge.start()
    const url = new URL(state.urls[0])
    phone = new WebSocket(`ws://127.0.0.1:${state.port}/ws?k=${url.searchParams.get('k')}`)
    await new Promise<void>((resolve, reject) => { phone.once('open', resolve); phone.once('error', reject) })
  }

  it('sends desktop recording truth and a bounded binary PNG over the authenticated connection', async () => {
    await connect()
    // 连上先收到配对回执（会话令牌 + 指纹），录制状态是它之后那条
    const state = new Promise<string>((resolve) => phone.on('message', (value, binary) => {
      if (binary) return
      const text = String(value)
      if ((JSON.parse(text) as { type?: string }).type === 'state') resolve(text)
    }))
    expect(bridge.feedback({ recording: true })).toBe(true)
    expect(JSON.parse(await state)).toEqual({ type: 'state', recording: true })
    const frame = new Promise<Buffer>((resolve) => phone.on('message', (value, binary) => { if (binary) resolve(value as Buffer) }))
    expect(bridge.feedback({ recording: false, frame: PNG })).toBe(true)
    expect(await frame).toEqual(PNG)
  })

  it('rejects non-PNG, excessive bytes, and feedback after stop', async () => {
    await connect()
    expect(bridge.feedback({ recording: false, frame: new Uint8Array(10) })).toBe(false)
    expect(bridge.feedback({ recording: false, frame: new Uint8Array(1024 * 1024 + 1) })).toBe(false)
    await bridge.stop()
    expect(bridge.feedback({ recording: true, frame: PNG })).toBe(false)
  })

  it('does not append frames to a slow socket queue', async () => {
    await connect()
    const original = WebSocket.prototype.send
    const sends = vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (this: WebSocket, ...args: Parameters<WebSocket['send']>) {
      return original.apply(this, args)
    })
    bridge.feedback({ recording: false })
    const serverSocket = sends.mock.contexts[0]
    expect(serverSocket).toBeDefined()
    Object.defineProperty(serverSocket!, 'bufferedAmount', { configurable: true, value: 1 })
    sends.mockClear()
    bridge.feedback({ recording: true, frame: PNG })
    bridge.feedback({ recording: false, frame: PNG })
    expect(sends).not.toHaveBeenCalled()
  })
})
