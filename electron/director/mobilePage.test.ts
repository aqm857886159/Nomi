import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { renderMobilePage } from './mobilePage'

class Element {
  hidden = false; src = ''; currentSrc = ''; complete = false; naturalWidth = 0
  disabled = false; textContent = ''; className = ''; style = {}; value = '0'
  onload: (() => void) | null = null; onerror: (() => void) | null = null
  addEventListener = vi.fn()
  removeAttribute(name: string) { if (name === 'src') { this.src = ''; this.currentSrc = ''; this.naturalWidth = 0 } }
}
class Socket {
  onopen: (() => void) | null = null; onclose: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  readyState = 1; binaryType = ''; send = vi.fn(); close = vi.fn()
}
function setup() {
  const html = renderMobilePage({})
  const elements = new Map<string, Element>()
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element())
  const preview = elements.get('preview')!
  preview.hidden = /<img\b[^>]*\bid="preview"[^>]*\bhidden\b/.test(html)
  const sockets: Socket[] = []; const timers: (() => void)[] = []; const events = new Map<string, () => void>()
  const create = vi.fn(() => `blob:frame-${create.mock.calls.length}`); const revoke = vi.fn()
  const context = vm.createContext({
    document: { getElementById: (id: string) => elements.get(id) }, navigator: { userAgent: 'Chrome' },
    window: { addEventListener: (name: string, callback: () => void) => events.set(name, callback), removeEventListener: vi.fn() },
    location: { search: '?k=token', protocol: 'https:', host: 'phone' }, URLSearchParams, Blob,
    URL: { createObjectURL: create, revokeObjectURL: revoke },
    WebSocket: class extends Socket { constructor() { super(); sockets.push(this) } },
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length }, clearTimeout: vi.fn(), setInterval: vi.fn(), clearInterval: vi.fn(),
  })
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  vm.runInContext(scripts.at(-1)![1], context)
  const frame = (socket = sockets.at(-1)!) => socket.onmessage?.({ data: new Blob(['png']) })
  const loaded = () => { preview.currentSrc = preview.src; preview.complete = true; preview.naturalWidth = 64; preview.onload?.() }
  return { preview, sockets, timers, events, create, revoke, frame, loaded }
}

describe('phone preview visible-frame lifetime', () => {
  it('starts hidden and shows only a successfully decoded current frame', () => {
    const view = setup(); expect(view.preview.hidden).toBe(true)
    view.sockets[0].onopen?.(); view.frame(); expect(view.preview.hidden).toBe(true)
    view.loaded(); expect(view.preview.hidden).toBe(false)
  })
  it('hides a previously visible frame on disconnect and rejects late decode/messages', () => {
    const view = setup(); const socket = view.sockets[0]; socket.onopen?.(); view.frame(); view.loaded()
    expect(view.preview.hidden).toBe(false); const lateLoad = view.preview.onload
    socket.onclose?.(); expect(view.preview.hidden).toBe(true); expect(view.preview.src).toBe('')
    view.frame(socket); lateLoad?.()
    expect(view.preview.hidden).toBe(true); expect(view.create).toHaveBeenCalledTimes(1)
    expect(view.revoke).toHaveBeenCalledExactlyOnceWith('blob:frame-1')
  })
  it('clears a failed decode through the same resource-release boundary', () => {
    const view = setup(); view.sockets[0].onopen?.(); view.frame(); view.loaded(); view.frame()
    view.preview.onerror?.()
    expect(view.preview.hidden).toBe(true); expect(view.preview.src).toBe('')
    expect(view.revoke.mock.calls.flat()).toEqual(['blob:frame-1', 'blob:frame-2'])
  })
  it('does not allow a previous socket to clear or replace a reconnected monitor', () => {
    const view = setup(); const old = view.sockets[0]; old.onopen?.(); view.frame(); view.loaded(); old.onclose?.()
    view.timers[0](); view.sockets[1].onopen?.(); view.frame(); view.loaded()
    old.onmessage?.({ data: new Blob(['late']) }); old.onclose?.()
    expect(view.preview.hidden).toBe(false); expect(view.preview.src).toBe('blob:frame-2')
    expect(view.create).toHaveBeenCalledTimes(2)
  })
  it('keeps the released page hidden when a queued frame or decode arrives after pagehide', () => {
    const view = setup(); view.sockets[0].onopen?.(); view.frame(); view.loaded(); const lateLoad = view.preview.onload
    view.events.get('pagehide')!(); view.frame(); lateLoad?.()
    expect(view.preview.hidden).toBe(true); expect(view.preview.src).toBe('')
    expect(view.create).toHaveBeenCalledTimes(1); expect(view.revoke).toHaveBeenCalledTimes(1)
  })
})
