// 走查仪表（mainRequire 注入，主进程入口之前加载）：Nomi 的每一扇窗都挪到屏幕外、不抢焦点。
// 用途：在用户正在用的电脑上跑真 Electron 端到端（例如 MCP 本机 HTTP 直连），不弹到用户面前、不抢键盘。
// 只改窗口位置与可聚焦，不碰任何产品逻辑。
//
// 2026-10-06（L-claim 连跑走查时用户看到窗口弹出来）：以前只在 `browser-window-created` 里挪窗，可主窗口是
// `show: true` 建的——构造函数里就已经在屏幕中央显示、并拿到了焦点，事件到的时候已经晚了，每次启动都闪一下、抢一下焦点。
// 现在在**构造那一刻**就把位置和可聚焦写进选项：主进程 `require('electron')` 拿到的 BrowserWindow 是一个只改这两项选项的构造包装
// （`electron` 模块上的 BrowserWindow 是不可改写的 getter，所以经 Module._load 给主进程一个代理出口）。
// 事件里的挪窗留着兜底（产品代码之后 center()/setBounds()/恢复上次位置）。
const Module = require('node:module')
const electron = require('electron')

const OFFSCREEN = [-32000, -32000]

// 不能用 `class extends`：Electron 的 BrowserWindow.getAllWindows() 只认构造器正好是 BrowserWindow 的实例，子类实例会从
// 「全部窗口」里消失（实测 0 扇），产品里按它找主窗口的逻辑就全错了。这里构造出来的仍是原生 BrowserWindow 实例，只改两项选项。
const NativeBrowserWindow = electron.BrowserWindow
function OffscreenBrowserWindow(options = {}) {
  return new NativeBrowserWindow({ ...options, x: OFFSCREEN[0], y: OFFSCREEN[1], focusable: false })
}
OffscreenBrowserWindow.prototype = NativeBrowserWindow.prototype
Object.setPrototypeOf(OffscreenBrowserWindow, NativeBrowserWindow)

const offscreenElectron = new Proxy(electron, {
  get(target, key) {
    return key === 'BrowserWindow' ? OffscreenBrowserWindow : Reflect.get(target, key, target)
  },
})

const originalLoad = Module._load
Module._load = function loadWithOffscreenWindows(request, ...rest) {
  const loaded = originalLoad.call(this, request, ...rest)
  return request === 'electron' ? offscreenElectron : loaded
}

function keepOffscreen(win) {
  const park = () => {
    if (win.isDestroyed()) return
    const [x, y] = win.getPosition()
    if (x !== OFFSCREEN[0] || y !== OFFSCREEN[1]) win.setPosition(OFFSCREEN[0], OFFSCREEN[1])
  }
  win.setFocusable(false)
  park()
  // 产品代码之后可能 center()/show()/恢复上次位置：每次显示与移动后再挪回去。
  win.on('show', park)
  win.on('moved', park)
  win.on('ready-to-show', park)
}

electron.app.on('browser-window-created', (_event, win) => keepOffscreen(win))
