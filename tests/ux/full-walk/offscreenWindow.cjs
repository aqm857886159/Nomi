// 走查窗口放到屏幕外、不抢焦点：经启动器的 mainRequire（`-r`）在 App 入口之前装进主进程。
//
// 为什么：走查在用户自己的桌面上跑，弹出来的窗口会盖住他手上的活、抢走键盘焦点
// （他正在打字时被抢走，按键就落进了走查窗口）。Playwright 驱动 Electron 走的是调试协议，
// 点击 / 截图都不要求窗口在屏幕上或拿着焦点，所以放到屏幕外不影响证据。
// 只动这一个 App 进程自己建的窗口；不碰用户开着的任何 Nomi。
'use strict'

const { app } = require('electron')

app.on('browser-window-created', (_event, window) => {
  const hide = () => {
    if (window.isDestroyed()) return
    window.setPosition(-32000, -32000)
    window.setFocusable(false)
  }
  hide()
  // App 自己会在 ready-to-show 之后定位 / 居中窗口：在那之后再挪一次，免得被它拉回屏幕中间。
  window.once('ready-to-show', hide)
  window.once('show', hide)
})
