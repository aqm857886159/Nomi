import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  trusted: vi.fn(),
  feedback: vi.fn(() => true),
  grantConsent: vi.fn(),
  stop: vi.fn(async () => {}),
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/temporary' },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => fixture.handlers.set(name, handler) },
  webContents: { fromId: () => undefined },
}))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: fixture.trusted }))
vi.mock('qrcode', () => ({ toString: vi.fn() }))
vi.mock('./mobileBridgeServer', () => ({
  MobileBridgeConsentError: class extends Error {},
  MobileBridgeServer: class {
    grantConsent = fixture.grantConsent
    start = async () => ({ running: true, secure: true, port: 1, urls: [], devices: [], consentRequired: false, certFingerprint: null, pairingExpiresAt: null })
    status = () => ({ running: true, secure: true, port: 1, urls: [], devices: [], consentRequired: false, certFingerprint: null, pairingExpiresAt: null })
    stop = fixture.stop
    feedback = fixture.feedback
  },
}))

import { registerDirectorMobileIpc } from './mobileBridgeIpc'
registerDirectorMobileIpc()
const call = (name: string, sender: unknown, payload?: unknown) => fixture.handlers.get(`nomi:director:mobile:${name}`)!({ sender }, payload)
// 同意闸：start 不带 consent 就不许起服务，所有既有用例照真实路径先递一次同意
const consented = { consent: true }
const sender = Object.assign(new EventEmitter(), { id: 11, isDestroyed: () => false, send: vi.fn() })
afterEach(async () => { await call('stop', sender); vi.clearAllMocks() })

describe('mobile feedback IPC owner', () => {
  it('没带同意的 start 不许起服务：状态回 consentRequired，服务对象根本没造出来', async () => {
    const shy = Object.assign(new EventEmitter(), { id: 31, isDestroyed: () => false, send: vi.fn() })
    const status = (await call('start', shy)) as { running: boolean; consentRequired: boolean }
    expect(status.running).toBe(false)
    expect(status.consentRequired).toBe(true)
    expect(fixture.grantConsent).not.toHaveBeenCalled()
    expect(call('feedback', shy, { recording: true })).toBe(false)
    // 同一条边界上递一次同意就起得来，而且同意是这次 App 运行级的
    const granted = (await call('start', shy, consented)) as { running: boolean; consentRequired: boolean }
    expect(granted.running).toBe(true)
    expect(granted.consentRequired).toBe(false)
    expect(fixture.grantConsent).toHaveBeenCalled()
    await call('stop', shy)
  })

  it('only the trusted service owner can send preview frames or recording state', async () => {
    await call('start', sender, consented)
    expect(() => call('feedback', { ...sender, id: 12 }, { recording: true })).toThrow('does not own')
    expect(fixture.feedback).not.toHaveBeenCalled()
    expect(call('feedback', sender, { recording: true })).toBe(true)
    expect(fixture.feedback).toHaveBeenCalledWith({ recording: true })
    expect(fixture.trusted).toHaveBeenCalled()
    await call('stop', sender)
    expect(call('feedback', sender, { recording: false })).toBe(false)
  })

  it('reopening the same dialog does not add repeated destroyed listeners', async () => {
    const before = sender.listenerCount('destroyed')
    await call('start', sender, consented)
    await call('start', sender, consented)
    expect(sender.listenerCount('destroyed')).toBeLessThanOrEqual(before + 1)
  })

  it('a queued old-window cleanup cannot close the service after a new owner takes over', async () => {
    await call('start', sender, consented)
    const nextSender = Object.assign(new EventEmitter(), { id: 12, isDestroyed: () => false, send: vi.fn() })
    const takeover = call('start', nextSender, consented)
    sender.emit('destroyed')
    await takeover
    // A second queued operation is a drain sentinel; no wall-clock delay or private queue inspection.
    await call('start', nextSender, consented)
    expect(fixture.stop).not.toHaveBeenCalled()
    expect(call('feedback', nextSender, { recording: false })).toBe(true)
    await call('stop', nextSender)
  })

  it('an old window explicit stop cannot close a later owner', async () => {
    await call('start', sender, consented)
    const nextSender = Object.assign(new EventEmitter(), { id: 12, isDestroyed: () => false, send: vi.fn() })
    await call('start', nextSender, consented)
    await call('stop', sender)
    expect(fixture.stop).not.toHaveBeenCalled()
    expect(call('feedback', nextSender, { recording: false })).toBe(true)
    await call('stop', nextSender)
  })

  it('stop and reopen on the same living window retain one destroyed listener', async () => {
    const freshSender = Object.assign(new EventEmitter(), { id: 21, isDestroyed: () => false, send: vi.fn() })
    await call('start', freshSender, consented)
    await call('stop', freshSender)
    await call('start', freshSender, consented)
    expect(freshSender.listenerCount('destroyed')).toBe(1)
    await call('stop', freshSender)
  })
})
