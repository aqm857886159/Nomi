import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  trusted: vi.fn(),
  feedback: vi.fn(() => true),
  stop: vi.fn(async () => {}),
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/temporary' },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => fixture.handlers.set(name, handler) },
  webContents: { fromId: () => undefined },
}))
vi.mock('../ipcSenderGuard', () => ({ assertTrustedSender: fixture.trusted }))
vi.mock('qrcode', () => ({ toString: vi.fn() }))
vi.mock('./mobileBridgeServer', () => ({ MobileBridgeServer: class {
  start = async () => ({ running: true, secure: true, port: 1, urls: [], devices: [] })
  status = () => ({ running: true, secure: true, port: 1, urls: [], devices: [] })
  stop = fixture.stop
  feedback = fixture.feedback
} }))

import { registerDirectorMobileIpc } from './mobileBridgeIpc'
registerDirectorMobileIpc()
const call = (name: string, sender: unknown, payload?: unknown) => fixture.handlers.get(`nomi:director:mobile:${name}`)!({ sender }, payload)
const sender = Object.assign(new EventEmitter(), { id: 11, isDestroyed: () => false, send: vi.fn() })
afterEach(async () => { await call('stop', sender); vi.clearAllMocks() })

describe('mobile feedback IPC owner', () => {
  it('only the trusted service owner can send preview frames or recording state', async () => {
    await call('start', sender)
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
    await call('start', sender)
    await call('start', sender)
    expect(sender.listenerCount('destroyed')).toBeLessThanOrEqual(before + 1)
  })

  it('a queued old-window cleanup cannot close the service after a new owner takes over', async () => {
    await call('start', sender)
    const nextSender = Object.assign(new EventEmitter(), { id: 12, isDestroyed: () => false, send: vi.fn() })
    const takeover = call('start', nextSender)
    sender.emit('destroyed')
    await takeover
    // A second queued operation is a drain sentinel; no wall-clock delay or private queue inspection.
    await call('start', nextSender)
    expect(fixture.stop).not.toHaveBeenCalled()
    expect(call('feedback', nextSender, { recording: false })).toBe(true)
    await call('stop', nextSender)
  })

  it('an old window explicit stop cannot close a later owner', async () => {
    await call('start', sender)
    const nextSender = Object.assign(new EventEmitter(), { id: 12, isDestroyed: () => false, send: vi.fn() })
    await call('start', nextSender)
    await call('stop', sender)
    expect(fixture.stop).not.toHaveBeenCalled()
    expect(call('feedback', nextSender, { recording: false })).toBe(true)
    await call('stop', nextSender)
  })

  it('stop and reopen on the same living window retain one destroyed listener', async () => {
    const freshSender = Object.assign(new EventEmitter(), { id: 21, isDestroyed: () => false, send: vi.fn() })
    await call('start', freshSender)
    await call('stop', freshSender)
    await call('start', freshSender)
    expect(freshSender.listenerCount('destroyed')).toBe(1)
    await call('stop', freshSender)
  })
})
