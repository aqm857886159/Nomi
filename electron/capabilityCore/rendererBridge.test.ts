import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcOn } = vi.hoisted(() => ({ ipcOn: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { on: ipcOn } }))

import { CAPABILITY_APPLY_REPLY_CHANNEL, requestRenderer, setRendererTarget } from './rendererBridge'

describe('renderer apply reply binding', () => {
  beforeEach(() => {
    ipcOn.mockReset()
    setRendererTarget(null)
  })

  it('rejects a reply from another frame/origin without settling the real request', async () => {
    const send = vi.fn()
    const target = {
      id: 17,
      isDestroyed: () => false,
      mainFrame: { routingId: 9 },
      getURL: () => 'http://127.0.0.1:5273/index.html',
      send,
    }
    setRendererTarget(target as never)
    const pending = requestRenderer('spend.confirm', {}, 5_000)
    const listener = ipcOn.mock.calls.find(([channel]) => channel === CAPABILITY_APPLY_REPLY_CHANNEL)?.[1] as (event: unknown, payload: unknown) => void
    const id = (send.mock.calls[0]?.[1] as { id: number }).id
    let settled = false
    void pending.then(() => { settled = true })
    listener({ sender: { id: 99 }, senderFrame: { routingId: 9, url: 'http://127.0.0.1:5273/index.html' } }, { id, ok: true, result: { confirmed: true } })
    listener({ sender: { id: 17 }, senderFrame: { routingId: 10, url: 'http://evil.test/' } }, { id, ok: true, result: { confirmed: true } })
    await Promise.resolve()
    expect(settled).toBe(false)
    listener({ sender: { id: 17 }, senderFrame: { routingId: 9, url: 'http://127.0.0.1:5273/other-route' } }, { id, ok: true, result: { confirmed: true } })
    await expect(pending).resolves.toEqual({ confirmed: true })
  })

  it('fails closed when the renderer is unavailable or does not answer before the timeout', async () => {
    await expect(requestRenderer('canvas.write', {}, 5)).rejects.toMatchObject({ name: 'RendererUnavailableError' })

    const target = {
      id: 18,
      isDestroyed: () => false,
      mainFrame: { routingId: 10 },
      getURL: () => 'http://127.0.0.1:5273/index.html',
      send: vi.fn(),
    }
    setRendererTarget(target as never)
    const pending = requestRenderer('canvas.write', {}, 5)
    const timeoutExpectation = expect(pending).rejects.toMatchObject({ name: 'RendererApplyError' })
    await new Promise((resolve) => setTimeout(resolve, 15))
    await timeoutExpectation
  })
})
