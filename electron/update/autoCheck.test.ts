import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { AUTO_CHECK_FIRST_DELAY_MS, AUTO_CHECK_INTERVAL_MS, classifyUpdateError, createAutoCheckScheduler, createVersionNotifyGate, describeUpdateFailure } from './autoCheck'

describe('自动检查调度（假时钟）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('启动后 30 秒首查，之后每 6 小时一次', async () => {
    const run = vi.fn(async () => undefined)
    const s = createAutoCheckScheduler({ enabled: () => true, busy: () => false, run })
    s.start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_FIRST_DELAY_MS - 1)
    expect(run).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(run).toHaveBeenCalledTimes(2)
    s.stop()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS * 2)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('不可用（开发版 / 非正式版）时根本不启动', async () => {
    const run = vi.fn(async () => undefined)
    createAutoCheckScheduler({ enabled: () => false, busy: () => false, run }).start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS * 3)
    expect(run).not.toHaveBeenCalled()
  })

  it('忙（手动检查 / 下载中）时跳过本轮，下一轮照常；一次失败不断掉调度', async () => {
    let busy = true
    const run = vi.fn(async () => { throw new Error('offline') })
    createAutoCheckScheduler({ enabled: () => true, busy: () => busy, run }).start()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_FIRST_DELAY_MS)
    expect(run).not.toHaveBeenCalled()
    busy = false
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('失败原因只落枚举', () => {
  it('网络 / 解析 / 其他', () => {
    expect(classifyUpdateError(Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' }))).toBe('network')
    expect(classifyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('network')
    expect(classifyUpdateError(Object.assign(new Error('HttpError: 503'), { statusCode: 503 }))).toBe('network')
    expect(classifyUpdateError(Object.assign(new Error('bad yaml'), { name: 'YAMLException' }))).toBe('parse')
    expect(classifyUpdateError(Object.assign(new Error('x'), { code: 'ERR_UPDATER_INVALID_UPDATE_INFO' }))).toBe('parse')
    expect(classifyUpdateError(new Error('something odd'))).toBe('other')
    expect(classifyUpdateError(null)).toBe('other')
  })
})

describe('describeUpdateFailure · 给界面选话术', () => {
  it('没连上网 / 连接中途断了 / 其他三类', () => {
    expect(describeUpdateFailure(Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' }))).toBe('offline')
    expect(describeUpdateFailure(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('offline')
    expect(describeUpdateFailure(new Error('net::ERR_CONNECTION_RESET'))).toBe('interrupted')
    expect(describeUpdateFailure(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe('interrupted')
    expect(describeUpdateFailure(new Error('spawn EACCES'))).toBe('other')
    expect(describeUpdateFailure(null)).toBe('other')
  })
})

describe('同一版本只通知一次', () => {
  it('静默发现同一版本第二次不再通知；新版本再通知；手动永远通知', () => {
    const gate = createVersionNotifyGate()
    expect(gate.shouldNotify('0.23.0', true)).toBe(true)
    expect(gate.shouldNotify('0.23.0', true)).toBe(false)
    expect(gate.shouldNotify('0.23.1', true)).toBe(true)
    expect(gate.shouldNotify('0.23.1', false)).toBe(true)
  })
})

// 接线：用假的 electron / electron-updater 走真实的 autoUpdater.ts，看广播与上报。
describe('autoUpdater.ts 接线（真实模块，假 electron）', () => {
  const sent: Array<Record<string, unknown>> = []
  const telemetry: Array<Record<string, unknown>> = []
  let updater: EventEmitter & { checkForUpdates: ReturnType<typeof vi.fn> }

  async function load(opts: { packaged: boolean; name?: string; automated?: boolean }) {
    vi.resetModules()
    sent.length = 0
    telemetry.length = 0
    vi.stubEnv("NOMI_E2E", opts.automated ? '1' : '')
    updater = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn(async () => undefined), downloadUpdate: vi.fn(async () => undefined), quitAndInstall: vi.fn() })
    vi.doMock('electron', () => ({
      app: { isPackaged: opts.packaged, getName: () => opts.name ?? 'Nomi', getVersion: () => '0.22.5' },
      BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_c: string, p: Record<string, unknown>) => sent.push(p) } }] },
      ipcMain: { handle: vi.fn() },
      shell: { openExternal: vi.fn() },
    }))
    vi.doMock('electron-updater', () => ({ autoUpdater: updater }))
    vi.doMock('../i18n', () => ({ desktopT: (k: string) => k }))
    // 判忙只需要这一个函数；别把任务缓存 / 制作流程 / 导出整串模块图拖进这个定时器测试里（假时钟下导入慢会让首测超时）。
    vi.doMock('../backgroundLaunch', () => ({ hasInFlightProductionWork: () => false }))
    vi.doMock('../ipcSenderGuard', () => ({ assertTrustedSender: vi.fn() }))
    vi.doMock('../telemetry/telemetryOutbox', () => ({ recordTelemetryEvent: (e: Record<string, unknown>) => telemetry.push(e) }))
    return import('./autoUpdater')
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.stubEnv("NOMI_E2E", '') })

  it('打包正式版：30 秒后静默检查；发现新版只广播一次 available；不闪 checking', async () => {
    const mod = await load({ packaged: true })
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('checking-for-update')
      updater.emit('update-available', { version: '0.23.0', releaseNotes: '<h1>Nomi v0.23.0 — 标题</h1><h2>组</h2><ul><li><strong>短语</strong>：说明</li></ul>', files: [{ url: 'Nomi.exe', size: 2048 }] })
    })
    mod.startAutoUpdateCheck()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_FIRST_DELAY_MS)
    expect(sent).toEqual([{
      type: 'available',
      version: '0.23.0',
      notes: [expect.objectContaining({ version: '0.23.0', zh: expect.objectContaining({ title: '标题', groups: [{ heading: '组', items: ['短语'] }] }) })],
      sizeBytes: 2048,
      releaseUrl: 'https://github.com/aqm857886159/Nomi/releases/tag/v0.23.0',
    }])
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(sent).toHaveLength(1)
    expect(telemetry).toHaveLength(0)
  })

  it('静默检查失败：不广播 error、不上报', async () => {
    const mod = await load({ packaged: true })
    updater.checkForUpdates.mockImplementation(async () => {
      const err = new Error('net::ERR_INTERNET_DISCONNECTED')
      updater.emit('error', err)
      throw err
    })
    mod.startAutoUpdateCheck()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_FIRST_DELAY_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([])
    expect(telemetry).toEqual([])
  })

  it.each([
    ['开发版（未打包）', { packaged: false }],
    ['非正式版（RC / 预览）', { packaged: true, name: 'Nomi RC' }],
    ['自动化启动', { packaged: true, automated: true }],
  ])('%s 不自动检查', async (_n, opts) => {
    const mod = await load(opts)
    mod.startAutoUpdateCheck()
    await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS * 2)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})
