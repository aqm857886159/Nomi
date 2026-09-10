import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const deps = vi.hoisted(() => ({
  closeRequest: null as null | ((payload: { requestId: string }) => void),
  confirm: vi.fn(), save: vi.fn(), closed: vi.fn(), cancelled: vi.fn(), reload: vi.fn(), toast: vi.fn(),
  t: (key: string) => key,
  cleanups: [] as Array<() => void>,
}))
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback, useRef: (current: unknown) => ({ current }), useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) deps.cleanups.push(cleanup) } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: deps.t }) }))
vi.mock('../../design', () => ({ confirmDialog: deps.confirm }))
vi.mock('../../ui/toast', () => ({ toast: deps.toast }))
vi.mock('./workbenchProjectSession', () => ({ persistActiveWorkbenchProjectNow: deps.save }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({
  window: { onCloseRequest: (callback: typeof deps.closeRequest) => { deps.closeRequest = callback; return () => { deps.closeRequest = null } }, confirmClose: deps.closed, cancelClose: deps.cancelled },
  app: { hardReloadWindow: deps.reload },
}) }))
import { useProjectLeaveAction, useProjectWindowLifecycle } from './useProjectWindowLifecycle'
beforeEach(() => { vi.clearAllMocks(); deps.confirm.mockResolvedValue(true); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.stubGlobal('window', new EventTarget()) })
afterEach(() => { for (const cleanup of deps.cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const reloadKey = () => window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'F5' }))
describe('project window save receipts', () => {
  it('shares a pending library exit across repeated calls and allows retry after a failed save', async () => {
    let reject!: (error: Error) => void
    const released = vi.fn()
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_yes, no) => { reject = no })).mockResolvedValueOnce(undefined)
    const leave = useProjectLeaveAction(async () => { await save(); released() })
    const first = leave(), second = leave()
    expect(second).toBe(first)
    await Promise.resolve()
    expect(save).toHaveBeenCalledOnce()
    expect(released).not.toHaveBeenCalled()
    const failure = new Error('save failed')
    reject(failure)
    await expect(first).rejects.toBe(failure)
    await expect(second).rejects.toBe(failure)
    expect(released).not.toHaveBeenCalled()
    await leave()
    expect(save).toHaveBeenCalledTimes(2)
    expect(released).toHaveBeenCalledOnce()
  })
  it('acknowledges close only after the project save completes', async () => {
    let finish!: () => void
    deps.save.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    useProjectWindowLifecycle()
    deps.closeRequest?.({ requestId: 'close-1' })
    await vi.waitFor(() => expect(deps.save).toHaveBeenCalledOnce())
    expect(deps.closed).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(deps.closed).toHaveBeenCalledWith('close-1'))
  })
  it('keeps the window and current project open when saving fails', async () => {
    deps.save.mockRejectedValueOnce(new Error('disk denied'))
    useProjectWindowLifecycle()
    deps.closeRequest?.({ requestId: 'close-failed' })
    await vi.waitFor(() => expect(deps.cancelled).toHaveBeenCalledWith('close-failed'))
    expect(deps.closed).not.toHaveBeenCalled()
    expect(deps.toast).toHaveBeenCalledWith('studio.projectSaveFailed', 'error')
  })
  it('keeps a failed reload in place and permits a later successful retry', async () => {
    deps.save.mockRejectedValueOnce(new Error('disk denied')).mockResolvedValueOnce(null)
    useProjectWindowLifecycle()
    reloadKey()
    await vi.waitFor(() => expect(deps.toast).toHaveBeenCalledOnce())
    expect(deps.reload).not.toHaveBeenCalled()
    reloadKey()
    await vi.waitFor(() => expect(deps.reload).toHaveBeenCalledOnce())
  })
})
