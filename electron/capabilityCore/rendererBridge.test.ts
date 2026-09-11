import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcOn } = vi.hoisted(() => ({ ipcOn: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { on: ipcOn } }))

import { CAPABILITY_APPLY_REPLY_CHANNEL, requestRenderer, requestRendererDecision, setRendererTarget } from './rendererBridge'

/**
 * 桥只在模块加载后**第一次**发请求时绑 ipcMain 监听器，之后 `ipcOn.mock.calls` 被 reset 就再也
 * 找不回来了。这里记住第一次看到的那一个，让后面的 describe 也能拿到同一条回复通道。
 */
let capturedReplyListener: ((event: unknown, payload: unknown) => void) | null = null
function replyListener(): (event: unknown, payload: unknown) => void {
  const found = ipcOn.mock.calls.find(([channel]) => channel === CAPABILITY_APPLY_REPLY_CHANNEL)?.[1]
  if (found) capturedReplyListener = found as (event: unknown, payload: unknown) => void
  if (!capturedReplyListener) throw new Error('apply-reply listener has not been bound yet')
  return capturedReplyListener
}

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
    const listener = replyListener()
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

// 审批卡永不因空闲超时（2026-09-11 用户拍板）。卡片那边的倒计时删掉之后，主进程这边的 60/65s
// 兜底就成了同一件事的暗面：卡还在屏幕上，请求却已经被替用户答成「否」，他再按就毫无反应。
// 这三条把「等的是人」和「等的是渲染层」这两种等法钉开。
describe('waiting on a human decision', () => {
  function fakeTarget(id: number) {
    const listeners = new Map<string, Array<() => void>>()
    return {
      id,
      isDestroyed: () => false,
      mainFrame: { routingId: 1 },
      getURL: () => 'http://127.0.0.1:5273/index.html',
      send: vi.fn(),
      once: (event: string, fn: () => void) => { listeners.set(event, [...(listeners.get(event) ?? []), fn]) },
      removeListener: (event: string, fn: () => void) => {
        listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== fn))
      },
      emit: (event: string) => { for (const fn of [...(listeners.get(event) ?? [])]) fn() },
      listenerCount: (event: string) => (listeners.get(event) ?? []).length,
    }
  }

  // 这里不 reset ipcOn：单独跑本 describe 时，回复监听器正是在第一条请求里绑上的，
  // reset 会把它从 mock.calls 里抹掉，helper 就再也找不到那条通道。
  beforeEach(() => {
    setRendererTarget(null)
  })

  it('never answers on its own, however long the card sits there', async () => {
    const target = fakeTarget(21)
    setRendererTarget(target as never)
    const pending = requestRendererDecision('spend.confirm', {})
    let settled: unknown = 'still-waiting'
    void pending.then((value) => { settled = value }, (error) => { settled = error })

    // 把墙钟推远到任何一版倒计时都早就到点了的地方。
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(settled).toBe('still-waiting')

    // 人终于按了 —— 回复照样被认领（此前 pending 已被超时删掉，这一条会被静默丢弃）。
    const listener = replyListener()
    const id = (target.send.mock.calls[0]?.[1] as { id: number }).id
    listener({ sender: { id: 21 }, senderFrame: { routingId: 1, url: 'http://127.0.0.1:5273/index.html' } }, { id, ok: true, result: { confirmed: true } })
    await expect(pending).resolves.toEqual({ confirmed: true })
    // 收尾要干净：监听器不许留在 WebContents 上（一轮一条就是泄漏）。
    expect(target.listenerCount('destroyed')).toBe(0)
    expect(target.listenerCount('render-process-gone')).toBe(0)
  })

  it('fails closed when the window carrying the card goes away', async () => {
    const target = fakeTarget(22)
    setRendererTarget(target as never)
    const pending = requestRendererDecision('plan.confirm', {})
    const expectation = expect(pending).rejects.toMatchObject({ name: 'RendererUnavailableError' })
    target.emit('destroyed')
    await expectation
  })

  it('fails closed when the main window is replaced by another one', async () => {
    const target = fakeTarget(23)
    setRendererTarget(target as never)
    const pending = requestRendererDecision('generation.gate.confirm', {})
    const expectation = expect(pending).rejects.toMatchObject({ name: 'RendererUnavailableError' })
    setRendererTarget(fakeTarget(24) as never)
    await expectation
  })
})
