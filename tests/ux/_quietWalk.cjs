// 主进程走查仪表：隔离走查默认不把窗口、焦点或桌面出口交给用户的 Mac。
// 这个文件只由 tests/ux/_launchApp.mjs 在 App 主入口前注入；不进产品构建。
const Module = module.require('node:module')
const electron = module.require('electron')

const OFFSCREEN = [-32000, -32000]
const ALLOW_FOREGROUND = process.env.NOMI_WALK_FOREGROUND_OK === '1'
const state = globalThis.__nomiQuietWalk ?? { events: [], startedAt: new Date().toISOString() }
globalThis.__nomiQuietWalk = state

function record(type, args = []) {
  state.events.push({ type, args: args.map((value) => {
    if (value === undefined) return null
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    try { return JSON.parse(JSON.stringify(value)) } catch { return String(value) }
  }), at: new Date().toISOString() })
}

function patchMethod(target, key, value) {
  try {
    Object.defineProperty(target, key, { configurable: true, writable: true, value })
    return true
  } catch {
    try { target[key] = value; return target[key] === value } catch { return false }
  }
}

function keepOffscreen(win) {
  if (ALLOW_FOREGROUND || !win || win.isDestroyed?.()) return
  try { win.setFocusable(false) } catch { /* destroyed during startup */ }
  const park = () => {
    if (win.isDestroyed?.()) return
    try {
      const position = win.getPosition?.() ?? []
      if (position[0] !== OFFSCREEN[0] || position[1] !== OFFSCREEN[1]) win.setPosition(OFFSCREEN[0], OFFSCREEN[1])
    } catch { /* destroyed during teardown */ }
  }
  park()
  for (const event of ['show', 'moved', 'ready-to-show']) win.on?.(event, park)
}

function patchWindow(win) {
  if (ALLOW_FOREGROUND || !win || win.__nomiQuietWalkPatched) return win
  Object.defineProperty(win, '__nomiQuietWalkPatched', { configurable: true, value: true })
  const native = (key) => (typeof win[key] === 'function' ? win[key].bind(win) : () => undefined)
  const showInactive = native('showInactive')
  const setOpacity = native('setOpacity')
  const setIgnoreMouseEvents = native('setIgnoreMouseEvents')
  patchMethod(win, 'show', (...args) => { record('window.show', args); return showInactive(...args) })
  patchMethod(win, 'focus', (...args) => { record('window.focus', args); return undefined })
  patchMethod(win, 'moveTop', (...args) => { record('window.moveTop', args); return undefined })
  // 屏外坐标在 macOS 上不算数：系统把窗口夹回主屏左缘留一条（真机实测 40px 宽），showInactive 还把它排到别的窗口上面。
  // 所以窗口全透明、鼠标穿透——用户看不见也点不着；App 自己改这两样只记录（应用内浏览器的浮层会切鼠标穿透）。
  patchMethod(win, 'setOpacity', (...args) => { record('window.setOpacity', args); return undefined })
  patchMethod(win, 'setIgnoreMouseEvents', (...args) => { record('window.setIgnoreMouseEvents', args); return undefined })
  try { setOpacity(0); setIgnoreMouseEvents(true) } catch { /* destroyed during startup */ }
  keepOffscreen(win)
  return win
}

const NativeBrowserWindow = electron.BrowserWindow
function QuietBrowserWindow(options = {}) {
  const requestedShow = options.show !== false
  const win = new NativeBrowserWindow(ALLOW_FOREGROUND
    ? options
    : { ...options, show: false, x: OFFSCREEN[0], y: OFFSCREEN[1], focusable: false, opacity: 0 })
  patchWindow(win)
  if (!ALLOW_FOREGROUND && requestedShow) {
    const showInactive = typeof win.showInactive === 'function' ? win.showInactive.bind(win) : () => undefined
    showInactive()
  }
  return win
}
QuietBrowserWindow.prototype = NativeBrowserWindow.prototype
Object.setPrototypeOf(QuietBrowserWindow, NativeBrowserWindow)

function quietDock(dock) {
  if (!dock || ALLOW_FOREGROUND) return dock
  return new Proxy(dock, {
    get(target, key) {
      if (key === 'bounce' || key === 'show' || key === 'hide') return (...args) => { record(`dock.${String(key)}`, args); return undefined }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const app = electron.app
const quietApp = new Proxy(app, {
  get(target, key) {
    if (key === 'focus' && !ALLOW_FOREGROUND) return (...args) => { record('app.focus', args); return undefined }
    // 激活策略归仪表管（下面那两步）：App 自己改只记录，不然 prohibited 那一段会被它提前结束。
    if (key === 'setActivationPolicy' && !ALLOW_FOREGROUND && process.platform === 'darwin') return (...args) => { record('app.setActivationPolicy.requested', args); return undefined }
    if (key === 'dock') return quietDock(target.dock)
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
})

// macOS 的「启动即激活」：走查从 Agent 的进程链起（Claude 桌面版 → Claude Code → … → node → Electron），LaunchServices
// 把父 App 推断成 Claude，Claude 在最前时系统放行 AppKit 原生的启动激活——主进程这边一个聚焦调用都没有，JS 拦不到。
// 能管的只有「这个 App 许不许被激活」：will-finish-launching（AppKit 的 applicationWillFinishLaunching，早于启动激活）
// 切 prohibited（BackgroundOnly：不进 Dock，系统不许激活它），ready 切回 accessory（UIElement：窗口照常上屏，不进 Dock / Cmd-Tab）。
// 见 docs/engineering/direction-checks/2026-10-27-walk-quiet-r3.md。
function setActivationPolicy(policy) {
  try { app.setActivationPolicy(policy); record('app.setActivationPolicy', [policy]) } catch (error) { record('app.setActivationPolicy.error', [policy, String(error?.message ?? error)]) }
}
if (!ALLOW_FOREGROUND && process.platform === 'darwin') {
  app.once('will-finish-launching', () => setActivationPolicy('prohibited'))
  app.once('ready', () => setActivationPolicy('accessory'))
}

app.on?.('browser-window-created', (_event, win) => patchWindow(win))

const shell = electron.shell
const quietShell = new Proxy(shell, {
  get(target, key) {
    if (key === 'openExternal' || key === 'openPath' || key === 'showItemInFolder') return (...args) => {
      record(`shell.${String(key)}`, args)
      return key === 'openPath' || key === 'openExternal' ? Promise.resolve('') : undefined
    }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
})

const dialog = electron.dialog
for (const key of ['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showMessageBox', 'showMessageBoxSync', 'showCertificateTrustDialog']) {
  if (typeof dialog?.[key] !== 'function') continue
  patchMethod(dialog, key, (...args) => {
    record(`dialog.${key}`, args)
    throw new Error('走查要先替身这个对话框')
  })
}
if (typeof dialog?.showErrorBox === 'function') {
  patchMethod(dialog, 'showErrorBox', (...args) => {
    record('dialog.showErrorBox', args)
    console.error(`[quiet-walk] dialog.showErrorBox ${args.map(String).join(' | ')}`)
  })
}

const NativeNotification = electron.Notification
if (NativeNotification?.prototype && typeof NativeNotification.prototype.show === 'function') {
  patchMethod(NativeNotification.prototype, 'show', function (...args) {
    record('notification.show', args)
    return undefined
  })
}
const quietNotification = new Proxy(NativeNotification, {
  construct(target, args) {
    const instance = Reflect.construct(target, args)
    if (typeof instance?.show === 'function') patchMethod(instance, 'show', (...showArgs) => { record('notification.show', showArgs); return undefined })
    return instance
  },
})

const quietElectron = new Proxy(electron, {
  get(target, key) {
    if (key === 'BrowserWindow') return QuietBrowserWindow
    if (key === 'app') return quietApp
    if (key === 'shell') return quietShell
    if (key === 'Notification') return quietNotification
    return Reflect.get(target, key, target)
  },
})

const originalLoad = Module._load
Module._load = function loadQuietWalk(request, ...rest) {
  const loaded = originalLoad.call(this, request, ...rest)
  return request === 'electron' ? quietElectron : loaded
}

module.exports = { OFFSCREEN, state }
