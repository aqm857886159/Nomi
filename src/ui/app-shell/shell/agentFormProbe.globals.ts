// 常驻探针的最小浏览器环境（单测是 node 环境、没有 jsdom）：必须在外壳和形态 store 被导入**之前**装上——
// store 在模块加载时读 matchMedia 定初始窄窗、persist 在创建时找 localStorage，外壳在模块加载时读 navigator。
// 只装探针要用的几个口：localStorage（真落盘，量得到「存档逐字相等」）、可拨的窗宽查询、window 上的按键监听、ResizeObserver。

type Listener = (event: unknown) => void

export const probeStorage = new Map<string, string>()
export const probeKeyListeners = new Set<Listener>()
const mediaListeners = new Set<Listener>()
let narrow = false

const storage = {
  getItem: (key: string) => (probeStorage.has(key) ? probeStorage.get(key)! : null),
  setItem: (key: string, value: string) => void probeStorage.set(key, String(value)),
  removeItem: (key: string) => void probeStorage.delete(key),
  clear: () => void probeStorage.clear(),
}

const narrowQuery = {
  get matches() { return narrow },
  addEventListener: (_type: string, listener: Listener) => void mediaListeners.add(listener),
  removeEventListener: (_type: string, listener: Listener) => void mediaListeners.delete(listener),
}
const otherQuery = { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }

/** 拨窗宽：跨过阈值时像 matchMedia 一样回调一次。 */
export function setProbeNarrow(next: boolean, options: { silent?: boolean } = {}): void {
  if (narrow === next) return
  narrow = next
  if (!options.silent) for (const listener of [...mediaListeners]) listener({ matches: next })
}

const body = { nodeType: 1, contains: () => false }
const fakeDocument = {
  body,
  documentElement: { lang: '', dataset: {}, classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined, contains: () => false }, style: {}, setAttribute: () => undefined },
  activeElement: null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}

const fakeWindow = {
  document: fakeDocument,
  localStorage: storage,
  matchMedia: (query: string) => (/width/.test(query) && !/prefers/.test(query) ? narrowQuery : otherQuery),
  addEventListener: (type: string, listener: Listener) => { if (type === 'keydown') probeKeyListeners.add(listener) },
  removeEventListener: (type: string, listener: Listener) => { if (type === 'keydown') probeKeyListeners.delete(listener) },
  requestAnimationFrame: (callback: (time: number) => void) => { callback(0); return 0 },
  cancelAnimationFrame: () => undefined,
  setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  event: undefined,
}

class ProbeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.assign(globalThis, {
  window: fakeWindow,
  document: fakeDocument,
  localStorage: storage,
  ResizeObserver: ProbeResizeObserver,
  IS_REACT_ACT_ENVIRONMENT: false,
})
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'node' }, configurable: true })
