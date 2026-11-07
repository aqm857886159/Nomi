// 导入类 IPC（界面导入、拷贝文件、懒自愈）被停下时给渲染层的回执约定。
// 在途请求登记（electron/ipcRequestRegistry.ts）里停下回 null；这一层把 null 翻译成各通道原有的约定：
// 界面导入回「已取消」的失败回执（不是 ok、不发布资产），拷贝文件 / 懒自愈让 invoke 被拒；
// 懒自愈自己合法地回 null（本就可播 / 无法处理）不是取消。
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

type Handler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  importFile: vi.fn(),
  ensurePlayable: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
  clipboard: {},
  dialog: {},
  ipcMain: { handle: (name: string, handler: Handler) => mocks.handlers.set(name, handler) },
}))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: () => undefined, assertTrustedUiSender: () => undefined }))
vi.mock('./projectAssetStore', () => ({ copyProjectAsset: vi.fn(), importRemoteAsset: vi.fn() }))
vi.mock('./downloadPrefs', () => ({ getAutoSavePrefs: vi.fn(), setAutoSavePrefs: vi.fn() }))
vi.mock('./localFileImport', async importOriginal => ({
  ...await importOriginal<typeof import('./localFileImport')>(),
  importLocalFile: mocks.importFile,
  ensurePlayableAsset: mocks.ensurePlayable,
}))
import { registerAssetsIpc } from './assetsIpc'
import { AssetImportCancelledError } from './localFileImport'

/** 一个会被关掉的发起窗口：销毁时发 destroyed（和 WebContents 一样）。 */
class FakeWindow extends EventEmitter {
  destroyed = false
  constructor(readonly id: number) { super() }
  isDestroyed(): boolean { return this.destroyed }
  close(): void { this.destroyed = true; this.emit('destroyed') }
}
const eventOf = (window: FakeWindow) => ({ sender: window, senderFrame: {} }) as unknown as IpcMainInvokeEvent

/** 一件一直跑到被中止的活：第一次被调用时兑现 started（事件握手，不拿墙钟等），被中止就照叶子的样子抛错。 */
function blockUntilAborted() {
  let begin: () => void = () => undefined
  const started = new Promise<void>((resolve) => { begin = resolve })
  const work = (_payload: unknown, options: { signal: AbortSignal }) => new Promise<never>((_resolve, reject) => {
    begin()
    options.signal.addEventListener('abort', () => reject(new Error('ffmpeg killed')), { once: true })
  })
  return { started, work }
}

beforeEach(() => {
  mocks.importFile.mockReset()
  mocks.ensurePlayable.mockReset()
  mocks.handlers.clear()
  registerAssetsIpc(() => undefined)
})

describe('导入类 IPC 被停下时的回执', () => {
  it.each(['nomi:assets:import-file', 'nomi:assets:import-native-file'])('界面导入：发起窗口关掉 → 「已取消」的失败回执，不是 ok：%s', async channel => {
    const window = new FakeWindow(1)
    const { started, work } = blockUntilAborted()
    mocks.importFile.mockImplementation(work)
    const pending = mocks.handlers.get(channel)!(eventOf(window), { projectId: 'a', bytes: new Uint8Array([1]), sourcePath: '/native' })
    await started
    window.close()
    await expect(pending).resolves.toEqual({ ok: false, failure: { code: 'capability_execution_failed', reason: 'import-failed' } })
    expect(mocks.importFile).toHaveBeenCalledOnce()
    expect((mocks.importFile.mock.calls[0]![1] as { signal: AbortSignal }).signal.aborted).toBe(true)
  })

  it('拷贝文件：发起窗口关掉 → invoke 被拒（取消），不是一份成功的结果', async () => {
    const window = new FakeWindow(2)
    const { started, work } = blockUntilAborted()
    mocks.importFile.mockImplementation(work)
    const pending = mocks.handlers.get('nomi:assets:copy-files')!(eventOf(window), { projectId: 'a', paths: ['/tmp/clip.mov'] })
    await started
    window.close()
    await expect(pending).rejects.toBeInstanceOf(AssetImportCancelledError)
  })

  it('懒自愈：发起窗口关掉 → invoke 被拒（取消）', async () => {
    const window = new FakeWindow(3)
    const { started, work } = blockUntilAborted()
    mocks.ensurePlayable.mockImplementation(work)
    const pending = mocks.handlers.get('nomi:assets:ensure-playable')!(eventOf(window), { url: 'nomi-local://asset/p/clip.mov' })
    await started
    window.close()
    await expect(pending).rejects.toBeInstanceOf(AssetImportCancelledError)
  })

  it('懒自愈：「本就可播 / 无法处理」是它合法回的 null，照原样交回，不当成取消；修好的资产也原样交回', async () => {
    const handler = mocks.handlers.get('nomi:assets:ensure-playable')!
    mocks.ensurePlayable.mockResolvedValueOnce(null)
    await expect(handler(eventOf(new FakeWindow(4)), { url: 'nomi-local://asset/p/ok.mp4' })).resolves.toBeNull()
    mocks.ensurePlayable.mockResolvedValueOnce({ data: { url: 'nomi-local://asset/p/healed.mp4' } })
    await expect(handler(eventOf(new FakeWindow(5)), { url: 'nomi-local://asset/p/clip.mov' })).resolves.toEqual({ data: { url: 'nomi-local://asset/p/healed.mp4' } })
  })

  it('同一个窗口同时来两件导入：互不相撤，关窗口才一起停', async () => {
    const window = new FakeWindow(6)
    const first = blockUntilAborted()
    const second = blockUntilAborted()
    mocks.importFile.mockImplementationOnce(first.work).mockImplementationOnce(second.work)
    const handler = mocks.handlers.get('nomi:assets:import-native-file')!
    const one = handler(eventOf(window), { projectId: 'a', sourcePath: '/native/one' })
    await first.started
    // 第二件在第一件还在转的时候到（vitest 里两个同时发起的动态 import 会拿到真模块，所以不同时发起）。
    const two = handler(eventOf(window), { projectId: 'a', sourcePath: '/native/two' })
    await second.started
    const signals = mocks.importFile.mock.calls.map((call) => (call[1] as { signal: AbortSignal }).signal)
    expect(signals.map((signal) => signal.aborted)).toEqual([false, false])
    window.close()
    await expect(Promise.all([one, two])).resolves.toEqual([
      { ok: false, failure: { code: 'capability_execution_failed', reason: 'import-failed' } },
      { ok: false, failure: { code: 'capability_execution_failed', reason: 'import-failed' } },
    ])
  })
})
