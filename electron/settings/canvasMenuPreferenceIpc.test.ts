import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ handle: vi.fn(), guard: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: mocks.guard }))
vi.mock('./canvasMenuPreferenceSettings', () => ({ readCanvasMenuPreferenceSettings: vi.fn(), writeCanvasMenuPreferenceSettings: vi.fn() }))
import { registerCanvasMenuPreferenceIpc } from './canvasMenuPreferenceIpc'
import { DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS } from '../shared/contracts/canvasMenuPreference'
beforeEach(() => vi.clearAllMocks())
it('guards reads and writes before touching storage for every IPC caller', async () => {
  const store = { read: vi.fn(() => DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS), write: vi.fn(() => DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS) }
  registerCanvasMenuPreferenceIpc(store)
  expect(mocks.handle).toHaveBeenCalledTimes(2)
  mocks.guard.mockImplementation(() => { throw new Error('untrusted') })
  for (const [, handler] of mocks.handle.mock.calls) await expect(handler({}, {})).rejects.toThrow('untrusted')
  expect(store.read).not.toHaveBeenCalled()
  expect(store.write).not.toHaveBeenCalled()
  mocks.guard.mockImplementation(() => {})
  for (const [, handler] of mocks.handle.mock.calls) await expect(handler({}, {})).resolves.toEqual(DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS)
  expect(store.read).toHaveBeenCalledOnce()
  expect(store.write).toHaveBeenCalledOnce()
})
