// 走查仪表（mainRequire 注入，主进程入口之前加载）：Nomi 的每一扇窗都挪到屏幕外、不抢焦点。
// 用途：在用户正在用的电脑上跑真 Electron 端到端（例如 MCP 本机 HTTP 直连），不弹到用户面前、不抢键盘。
// 只改窗口位置与可聚焦，不碰任何产品逻辑。
const { app } = require('electron')

const OFFSCREEN = [-32000, -32000]

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

app.on('browser-window-created', (_event, win) => keepOffscreen(win))
