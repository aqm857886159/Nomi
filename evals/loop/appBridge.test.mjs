// 评测借真实资料的共享 app 桥：没放行（NOMI_WALK_FOREGROUND_OK=1）时，用户真实资料一个字节都不读。
// 探可用性的一律答「没配」（调用方回退规则版 / 跳过）；要发请求的在读 catalog 之前按 125 退出，也不起 app。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { readRealCatalog, launchNomiApp } = vi.hoisted(() => ({
  readRealCatalog: vi.fn(() => ({
    vendors: [{ key: 'fixture-vendor', baseUrlHint: 'https://provider.invalid/v1' }],
    apiKeysByVendor: { 'fixture-vendor': { apiKey: 'not-a-real-cipher', enc: 'safeStorage' } },
    models: [{ enabled: true, kind: 'text', vendorKey: 'fixture-vendor', modelKey: 'fixture-text' }],
  })),
  launchNomiApp: vi.fn(),
}))
vi.mock('../../tests/ux/_realProfile.mjs', () => ({ readRealCatalog }))
vi.mock('../../tests/ux/_launchApp.mjs', async (importOriginal) => ({ ...(await importOriginal()), launchNomiApp }))

const bridge = await import('./appBridge.mjs')

let inherited
beforeEach(() => {
  inherited = process.env.NOMI_WALK_FOREGROUND_OK
  readRealCatalog.mockClear()
  launchNomiApp.mockClear()
})
afterEach(() => {
  if (inherited === undefined) delete process.env.NOMI_WALK_FOREGROUND_OK
  else process.env.NOMI_WALK_FOREGROUND_OK = inherited
  vi.restoreAllMocks()
})

describe('appBridge without the foreground opt-in', () => {
  test('availability probes answer "not configured" and never read the real catalog', () => {
    delete process.env.NOMI_WALK_FOREGROUND_OK
    expect(bridge.resolveModels()).toEqual({ text: null, vision: null, image: null })
    expect(bridge.modelLabels()).toEqual({ text: null, vision: null, image: null })
    expect(bridge.textAvailable()).toBe(false)
    expect(readRealCatalog).not.toHaveBeenCalled()
  })

  test('requests skip with exit code 125 before reading the catalog or launching the app', async () => {
    delete process.env.NOMI_WALK_FOREGROUND_OK
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`) })
    await expect(bridge.chatText('system', 'user')).rejects.toThrow('exit 125')
    await expect(bridge.chatVision('data:image/png;base64,', 'question')).rejects.toThrow('exit 125')
    await expect(bridge.genImage('prompt')).rejects.toThrow('exit 125')
    expect(readRealCatalog).not.toHaveBeenCalled()
    expect(launchNomiApp).not.toHaveBeenCalled()
  })

  test('with the opt-in the catalog is read and models resolve as before', () => {
    process.env.NOMI_WALK_FOREGROUND_OK = '1'
    expect(bridge.resolveModels().text).toMatchObject({ modelKey: 'fixture-text', vendorKey: 'fixture-vendor', root: 'https://provider.invalid' })
    expect(readRealCatalog).toHaveBeenCalledTimes(1)
  })
})
