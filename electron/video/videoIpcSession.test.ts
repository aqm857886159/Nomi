import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { CanvasReadSurfaceIpcCapture } from '../capabilityCore/canvasReadSurfaceIpc'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>>(),
  extract: vi.fn(),
  deconstruct: vi.fn(),
  drains: new Map<string, () => void | Promise<void>>(),
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>) => mocks.handlers.set(name, handler) } }))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: vi.fn() }))
vi.mock('../quitTeardown', () => ({ registerQuitDrain: (name: string, drain: () => void | Promise<void>) => { mocks.drains.set(name, drain); return () => undefined } }))
vi.mock('./depthVideoIpc', () => ({ registerVideoDepthIpc: vi.fn() }))
vi.mock('./extractVideoFrame', () => ({ extractVideoFrameToAsset: mocks.extract }))
vi.mock('./deconstructVideo', () => ({ deconstructVideo: mocks.deconstruct }))
vi.mock('./deconstructSpend', () => ({ authorizeDeconstructSpend: vi.fn() }))
import { createProjectInteractionCapture } from '../assets/projectInteractionCapture'
import { IPC_REQUEST_CONTEXT_POLL_MS } from '../ipcRequestRegistry'
import { registerVideoIpc } from './videoIpc'

const binding = { projectId: 'a', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
const event = { sender: {}, senderFrame: {} } as IpcMainInvokeEvent
beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); mocks.drains.clear() })
afterEach(() => { vi.useRealTimers() })

it('opens the trusted project session before any await and hands its assertion to frame publication', async () => {
  const session = Object.freeze({})
  let current = true
  const capture = {
    openProjectSession: vi.fn(() => session),
    assertProjectSession: vi.fn(() => { if (!current) throw Object.assign(new Error('project_binding_stale'), { code: 'project_binding_stale' }) }),
  }
  registerVideoIpc(createProjectInteractionCapture(capture as unknown as CanvasReadSurfaceIpcCapture, () => undefined))
  mocks.extract.mockImplementation(async (_payload: unknown, options: { assertCurrent?: () => void }) => {
    current = false
    options.assertCurrent?.()
    return { url: 'nomi-local://frame' }
  })
  const pending = mocks.handlers.get('nomi:video:extract-frame')!(event, { videoUrl: '/v.mp4', which: 'first', projectId: 'a', projectBinding: binding })
  expect(capture.openProjectSession).toHaveBeenCalledWith(event, binding)
  await expect(pending).rejects.toMatchObject({ code: 'project_binding_stale' })
  expect(capture.assertProjectSession).toHaveBeenCalledWith(event, session)
})

it('treats a frame request without a binding as explicit project IO without interactive authority', async () => {
  const capture = { openProjectSession: vi.fn(), assertProjectSession: vi.fn() }
  registerVideoIpc(createProjectInteractionCapture(capture as unknown as CanvasReadSurfaceIpcCapture, () => undefined))
  mocks.extract.mockResolvedValue({ url: 'nomi-local://frame' })
  await expect(mocks.handlers.get('nomi:video:extract-frame')!(event, { videoUrl: '/v.mp4', which: 'last', projectId: 'a' })).resolves.toEqual({ url: 'nomi-local://frame' })
  expect(capture.openProjectSession).not.toHaveBeenCalled()
  expect(mocks.extract).toHaveBeenCalledWith(expect.anything(), { assertCurrent: undefined })
})

// 拆解取消 · IPC 侧（第一刀，2026-10-27；设计卡 docs/plan/2026-10-27-deconstruct-cancel.md）。
// 第 1 轮在这里钉过修前现状：只有开始口、没有取消口，handler 不给编排任何 signal。现在：每次拆解按
// 「发送方:requestId」进中立的请求登记（electron/ipcRequestRegistry.ts），渲染层撤回 / 发起窗口销毁 /
// 项目会话失效 / 退出收摊四个来源汇成交给编排的同一个 signal；停下回 null，不是失败。
describe('拆解的停止边界（IPC）', () => {
  class FakeSender extends EventEmitter {
    destroyed = false
    readonly sent: Array<{ channel: string; payload: unknown }> = []
    constructor(readonly id: number) { super() }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('destroyed') }
    send(channel: string, payload: unknown) { this.sent.push({ channel, payload }) }
  }
  type DeconstructOptions = { signal: AbortSignal; onPhase?: (phase: number) => void }
  const eventOf = (sender: FakeSender) => ({ sender, senderFrame: {} }) as unknown as IpcMainInvokeEvent
  const request = (extra: Record<string, unknown> = {}) => ({ requestId: 'request-1', projectBinding: binding, videoUrl: '/v.mp4', projectId: 'a', nodeId: 'table-1', ...extra })
  const deconstruct = (sender: FakeSender, payload: unknown) => mocks.handlers.get('nomi:video:deconstruct')!(eventOf(sender), payload)
  const cancel = (sender: FakeSender, payload: unknown) => mocks.handlers.get('nomi:video:deconstruct-cancel')!(eventOf(sender), payload)
  const stale = () => Object.assign(new Error('project_binding_stale'), { code: 'project_binding_stale' })

  function setup(session: { stale?: boolean; current?: () => boolean } = {}) {
    const capture = {
      openProjectSession: vi.fn(() => { if (session.stale) throw stale(); return Object.freeze({}) }),
      assertProjectSession: vi.fn(() => { if (session.current && !session.current()) throw stale() }),
    }
    registerVideoIpc(createProjectInteractionCapture(capture as unknown as CanvasReadSurfaceIpcCapture, () => undefined))
    return capture
  }

  /** 编排替身：拿到 signal 就挂着，直到它停（照真的编排：停下以 DeconstructCancelledError 收尾）。 */
  function holdUntilStopped(): Promise<DeconstructOptions> {
    return new Promise((started) => {
      mocks.deconstruct.mockImplementation((_payload: unknown, options: DeconstructOptions) => {
        started(options)
        return new Promise((_resolve, reject) => {
          const stop = () => reject(Object.assign(new Error('deconstruct cancelled'), { name: 'DeconstructCancelledError' }))
          if (options.signal.aborted) stop()
          else options.signal.addEventListener('abort', stop, { once: true })
        })
      })
    })
  }

  it('缺 requestId、缺 projectBinding、绑定与 projectId 对不上：直接拒，编排一步都不起', async () => {
    setup()
    const sender = new FakeSender(1)
    await expect(deconstruct(sender, request({ requestId: undefined }))).rejects.toThrow(/requires a requestId/)
    await expect(deconstruct(sender, request({ requestId: '   ' }))).rejects.toThrow(/requires a requestId/)
    await expect(deconstruct(sender, request({ projectBinding: undefined }))).rejects.toThrow(/requires the projectBinding/)
    await expect(deconstruct(sender, request({ projectBinding: { ...binding, projectId: 'b' } }))).rejects.toThrow(/requires the projectBinding/)
    await expect(deconstruct(sender, null)).rejects.toThrow(/requires a requestId/)
    expect(mocks.deconstruct).not.toHaveBeenCalled()
  })

  it('发起时项目会话已经不是这个窗口的了（绑定过期）：当成已停回 null，编排不起', async () => {
    const capture = setup({ stale: true })
    await expect(deconstruct(new FakeSender(1), request())).resolves.toBeNull()
    expect(capture.openProjectSession).toHaveBeenCalled()
    expect(mocks.deconstruct).not.toHaveBeenCalled()
  })

  it('同一窗口按 requestId 撤：编排拿到的 signal 停下，这次拆解回 null（不是失败）', async () => {
    setup()
    const sender = new FakeSender(1)
    const started = holdUntilStopped()
    const pending = deconstruct(sender, request())
    const options = await started
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.signal.aborted).toBe(false)
    options.onPhase?.(0)
    expect(sender.sent).toEqual([{ channel: 'nomi:video:deconstruction-progress', payload: { requestId: 'request-1', projectId: 'a', phase: 0 } }])

    await expect(cancel(sender, { requestId: 'request-1' })).resolves.toEqual({ ok: true })
    expect(options.signal.aborted).toBe(true)
    await expect(pending).resolves.toBeNull()
    // 收尾后登记已撤：同一个号再撤一次没有对象。
    await expect(cancel(sender, { requestId: 'request-1' })).resolves.toEqual({ ok: false })
  })

  it('别的窗口撤不动；不认识的号、空号也撤不动', async () => {
    setup()
    const owner = new FakeSender(1)
    const started = holdUntilStopped()
    const pending = deconstruct(owner, request())
    const options = await started
    await expect(cancel(new FakeSender(2), { requestId: 'request-1' })).resolves.toEqual({ ok: false })
    await expect(cancel(owner, { requestId: 'request-2' })).resolves.toEqual({ ok: false })
    await expect(cancel(owner, {})).resolves.toEqual({ ok: false })
    await expect(cancel(owner, null)).resolves.toEqual({ ok: false })
    expect(options.signal.aborted).toBe(false)

    await expect(cancel(owner, { requestId: 'request-1' })).resolves.toEqual({ ok: true })
    await expect(pending).resolves.toBeNull()
  })

  it('撤回在编排还没加载完时到达：照样停，编排一开始拿到的就是已停的 signal', async () => {
    setup()
    const owner = new FakeSender(1)
    let abortedAtStart: boolean | undefined
    mocks.deconstruct.mockImplementation(async (_payload: unknown, options: DeconstructOptions) => {
      abortedAtStart = options.signal.aborted
      options.signal.throwIfAborted()
      return { shots: [] }
    })
    const pending = deconstruct(owner, request())
    // 开始口在第一个 await 之前就登记好了：同一拍里到的撤回找得到它。
    await expect(cancel(owner, { requestId: 'request-1' })).resolves.toEqual({ ok: true })
    await expect(pending).resolves.toBeNull()
    expect(abortedAtStart).toBe(true)
  })

  it('发起窗口销毁：编排的 signal 停下，回 null', async () => {
    setup()
    const owner = new FakeSender(1)
    const started = holdUntilStopped()
    const pending = deconstruct(owner, request())
    const options = await started
    owner.destroy()
    expect(options.signal.aborted).toBe(true)
    await expect(pending).resolves.toBeNull()
  })

  it('跑到一半项目被换走：会话复核一失败编排的 signal 就停，回 null', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let current = true
    const capture = setup({ current: () => current })
    const started = holdUntilStopped()
    const pending = deconstruct(new FakeSender(1), request())
    const options = await started
    vi.advanceTimersByTime(IPC_REQUEST_CONTEXT_POLL_MS)
    expect(options.signal.aborted).toBe(false)

    current = false
    vi.advanceTimersByTime(IPC_REQUEST_CONTEXT_POLL_MS)
    expect(options.signal.aborted).toBe(true)
    expect(capture.assertProjectSession).toHaveBeenCalled()
    await expect(pending).resolves.toBeNull()
  })

  it('退出收摊：在跑的拆解全撤', async () => {
    setup()
    const started = holdUntilStopped()
    const pending = deconstruct(new FakeSender(1), request())
    const options = await started
    await mocks.drains.get('video-deconstruct-requests')!()
    expect(options.signal.aborted).toBe(true)
    await expect(pending).resolves.toBeNull()
  })

  it('没撤、编排自己失败：照常抛出，不被吞成 null（停下不是失败，失败也不是停下）', async () => {
    setup()
    mocks.deconstruct.mockRejectedValue(new Error('vision vendor down'))
    await expect(deconstruct(new FakeSender(1), request())).rejects.toThrow('vision vendor down')
  })
})
