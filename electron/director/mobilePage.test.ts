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
  url = ''
}
function setup({ hash = '', session = null as string | null } = {}) {
  const html = renderMobilePage({})
  const elements = new Map<string, Element>()
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element())
  const preview = elements.get('preview')!
  preview.hidden = /<img\b[^>]*\bid="preview"[^>]*\bhidden\b/.test(html)
  const sockets: Socket[] = []; const timers: (() => void)[] = []; const events = new Map<string, () => void>()
  const create = vi.fn(() => `blob:frame-${create.mock.calls.length}`); const revoke = vi.fn()
  const bag = new Map<string, string>(); if (session) bag.set('nomi:director:mobile:session', session)
  const store = { getItem: (key: string) => bag.get(key) ?? null, setItem: (key: string, value: string) => { bag.set(key, value) }, removeItem: (key: string) => { bag.delete(key) } }
  const context = vm.createContext({
    document: { getElementById: (id: string) => elements.get(id) }, navigator: { userAgent: 'Chrome' },
    window: { addEventListener: (name: string, callback: () => void) => events.set(name, callback), removeEventListener: vi.fn() },
    location: { search: '?k=token', hash, protocol: 'https:', host: 'phone' }, URLSearchParams, Blob,
    sessionStorage: store,
    URL: { createObjectURL: create, revokeObjectURL: revoke },
    WebSocket: class extends Socket { constructor(url: string) { super(); this.url = url; sockets.push(this) } },
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length }, clearTimeout: vi.fn(), setInterval: vi.fn(), clearInterval: vi.fn(),
  })
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  vm.runInContext(scripts.at(-1)![1], context)
  const frame = (socket = sockets.at(-1)!) => socket.onmessage?.({ data: new Blob(['png']) })
  const loaded = () => { preview.currentSrc = preview.src; preview.complete = true; preview.naturalWidth = 64; preview.onload?.() }
  return { preview, sockets, timers, events, create, revoke, frame, loaded, elements, bag }
}

describe('phone pairing credential and certificate fingerprint', () => {
  it('首次用二维码里的一次性配对码，拿到会话令牌后重连改用它', () => {
    const view = setup()
    expect(view.sockets[0].url).toContain('k=token')
    view.sockets[0].onopen?.()
    view.sockets[0].onmessage?.({ data: JSON.stringify({ type: 'paired', s: 'session-abc', fp: 'AA:BB' }) })
    expect(view.bag.get('nomi:director:mobile:session')).toBe('session-abc')
    view.sockets[0].onclose?.()
    view.timers[0]()
    expect(view.sockets[1].url).toContain('s=session-abc')
    expect(view.sockets[1].url).not.toContain('k=token')
  })

  it('会话令牌是上一次服务留下的（连不上）就退回配对码', () => {
    const view = setup({ session: 'stale' })
    expect(view.sockets[0].url).toContain('s=stale')
    view.sockets[0].onclose?.()
    expect(view.bag.has('nomi:director:mobile:session')).toBe(false)
    view.timers[0]()
    expect(view.sockets[1].url).toContain('k=token')
  })

  it('证书指纹从 URL fragment（带外）显示，服务报的那串对不上就标红', () => {
    const view = setup({ hash: '#fp=aabbcc' })
    expect(view.elements.get('fpValue')!.textContent).toBe('AA:BB:CC')
    expect(view.elements.get('fp')!.className).toContain('on')
    view.sockets[0].onopen?.()
    view.sockets[0].onmessage?.({ data: JSON.stringify({ type: 'paired', s: 'x', fp: 'DD:EE:FF' }) })
    expect(view.elements.get('fp')!.className).toContain('bad')
  })

  it('没有 fragment 指纹时（HTTP 单测模式）指纹块不出现', () => {
    const view = setup()
    expect(view.elements.get('fp')!.className).not.toContain('on')
  })
})

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
