import { beforeEach, describe, expect, it, vi } from 'vitest'
const bridge = vi.hoisted(() => ({ importRemoteUrl: vi.fn(), available: true }))
vi.mock('../../../../../desktop/activeProject', () => ({ getDesktopActiveProjectId: () => 'project' }))
vi.mock('../../../../../desktop/bridge', () => ({ getDesktopBridge: () => bridge.available ? { assets: { importRemoteUrl: bridge.importRemoteUrl } } : null }))
import { persistDirectorScreenshot } from './persistOutputs'

beforeEach(() => { bridge.available = true; bridge.importRemoteUrl.mockReset() })
describe('director screenshot durable asset boundary', () => {
  it.each([undefined, '', '   ', 'data:image/png;base64,abc', 'blob:temporary'])('rejects a desktop asset without a durable url: %s', async (url) => {
    bridge.importRemoteUrl.mockResolvedValue({ id: 'asset', data: { url } })
    await expect(persistDirectorScreenshot('data:image/png;base64,original', 'node', 'Shot')).rejects.toThrow()
  })
  it('returns a persisted desktop handle unchanged', async () => {
    bridge.importRemoteUrl.mockResolvedValue({ id: 'asset', data: { url: 'nomi-asset://project/frame.png' } })
    await expect(persistDirectorScreenshot('data:image/png;base64,original', 'node', 'Shot')).resolves.toMatchObject({ url: 'nomi-asset://project/frame.png', localOnly: false })
  })
  it('explicitly identifies browser-only captures for the temporary blob path', async () => {
    bridge.available = false
    await expect(persistDirectorScreenshot('data:image/png;base64,original', 'node', 'Shot')).resolves.toMatchObject({ localOnly: true })
    expect(bridge.importRemoteUrl).not.toHaveBeenCalled()
  })
})
