import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const quietWalk = path.join(repoRoot, 'tests/ux/_quietWalk.cjs')

function runInstrumentProbe(extraEnv = {}) {
  const script = `
    const Module = require('node:module')
    const { EventEmitter } = require('node:events')
    // 仪表只在 macOS 上切 accessory：探针一律按 Mac 跑，Linux CI 上也验得到这一条。
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const nativeCalls = []
    class FakeWindow extends EventEmitter {
      static getAllWindows() { return [] }
      constructor(options) { super(); this.options = options; this.position = [options.x ?? 0, options.y ?? 0]; this.destroyed = false }
      showInactive(...args) { nativeCalls.push(['showInactive', args]); this.emit('show') }
      show(...args) { nativeCalls.push(['show', args]) }
      focus(...args) { nativeCalls.push(['focus', args]) }
      moveTop(...args) { nativeCalls.push(['moveTop', args]) }
      setOpacity(...args) { nativeCalls.push(['setOpacity', args]) }
      setIgnoreMouseEvents(...args) { nativeCalls.push(['setIgnoreMouseEvents', args]) }
      setFocusable(value) { nativeCalls.push(['setFocusable', [value]]) }
      getPosition() { return this.position }
      setPosition(x, y) { this.position = [x, y]; nativeCalls.push(['setPosition', [x, y]]); this.emit('moved') }
      isDestroyed() { return this.destroyed }
    }
    const app = new EventEmitter()
    app.setActivationPolicy = (...args) => nativeCalls.push(['setActivationPolicy', args])
    app.focus = (...args) => nativeCalls.push(['app.focus', args])
    app.dock = { bounce: (...args) => nativeCalls.push(['dock.bounce', args]), show: (...args) => nativeCalls.push(['dock.show', args]) }
    const shell = {
      openExternal: (...args) => nativeCalls.push(['openExternal', args]),
      openPath: (...args) => nativeCalls.push(['openPath', args]),
      showItemInFolder: (...args) => nativeCalls.push(['showItemInFolder', args]),
    }
    const dialog = {
      showOpenDialog: (...args) => nativeCalls.push(['showOpenDialog', args]),
      showErrorBox: (...args) => nativeCalls.push(['showErrorBox', args]),
    }
    class FakeNotification { constructor(options) { this.options = options } show(...args) { nativeCalls.push(['notification.show', args]) } }
    const fakeElectron = { BrowserWindow: FakeWindow, app, shell, dialog, Notification: FakeNotification }
    const electronName = ['elec', 'tron'].join('')
    const originalLoad = Module._load
    Module._load = function(request, parent, isMain) { return request === electronName ? fakeElectron : originalLoad.call(this, request, parent, isMain) }
    require(${JSON.stringify(quietWalk)})
    const injected = require(electronName)
    // 激活策略在 App 生命周期每一步之后是什么样：模块刚装上 / will-finish-launching / ready / App 自己再改一次。
    const policies = () => nativeCalls.filter(([name]) => name === 'setActivationPolicy').map(([, args]) => args[0])
    const policyAt = { loaded: policies() }
    app.emit('will-finish-launching')
    policyAt.willFinishLaunching = policies()
    app.emit('ready')
    policyAt.ready = policies()
    const win = new injected.BrowserWindow({ show: true, width: 10 })
    win.show(); win.focus(); win.moveTop(); win.setOpacity(1); win.setIgnoreMouseEvents(false)
    injected.app.focus({ steal: true }); injected.app.dock.bounce(); injected.app.dock.show()
    injected.app.setActivationPolicy('regular')
    policyAt.afterAppRequest = policies()
    injected.shell.openExternal('https://example.test'); injected.shell.openPath('/tmp/example'); injected.shell.showItemInFolder('/tmp/example')
    const notification = new injected.Notification({ title: 'walk' }); notification.show()
    let dialogError = null
    try { injected.dialog.showOpenDialog({}) } catch (error) { dialogError = error.message }
    console.log(JSON.stringify({ options: win.options, nativeCalls, events: globalThis.__nomiQuietWalk.events, dialogError, policyAt }))
  `
  const result = spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...process.env, ...extraEnv }, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim())
}

describe('quiet-walk main-process instrument', () => {
  test('constructs hidden offscreen windows and rewrites show/focus/moveTop', () => {
    const probe = runInstrumentProbe()
    expect(probe.options).toMatchObject({ show: false, x: -32000, y: -32000, focusable: false })
    expect(probe.nativeCalls.filter(([name]) => name === 'show')).toHaveLength(0)
    expect(probe.nativeCalls.filter(([name]) => name === 'focus' || name === 'moveTop')).toHaveLength(0)
    expect(probe.nativeCalls.filter(([name]) => name === 'showInactive')).toHaveLength(2)
    expect(probe.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'window.show', 'window.focus', 'window.moveTop', 'app.focus', 'dock.bounce', 'shell.openExternal',
      'shell.openPath', 'shell.showItemInFolder', 'notification.show',
    ]))
    expect(probe.dialogError).toBe('走查要先替身这个对话框')
    expect(probe.nativeCalls.some(([name]) => ['app.focus', 'dock.bounce', 'dock.show', 'openExternal', 'openPath', 'showItemInFolder', 'notification.show', 'showOpenDialog'].includes(name))).toBe(false)
  })

  test('macOS clamps "offscreen" back onto the screen, so the window is fully transparent and click-through, and stays that way', () => {
    const probe = runInstrumentProbe()
    expect(probe.options).toMatchObject({ opacity: 0 })
    // 只有仪表自己那一次：透明、穿透；App 后来想改回不透明 / 接鼠标，只进记录。
    expect(probe.nativeCalls.filter(([name]) => name === 'setOpacity')).toEqual([['setOpacity', [0]]])
    expect(probe.nativeCalls.filter(([name]) => name === 'setIgnoreMouseEvents')).toEqual([['setIgnoreMouseEvents', [true]]])
    expect(probe.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'window.setOpacity', args: [1] }),
      expect.objectContaining({ type: 'window.setIgnoreMouseEvents', args: [false] }),
    ]))
  })

  // 用户正在用起走查的那个 App（Claude）时，macOS 放行 AppKit 原生的启动激活，JS 拦不到；能管的只有「许不许被激活」。
  test('Mac: prohibited (cannot be activated) from will-finish-launching, back to accessory at ready; the app cannot change it', () => {
    const probe = runInstrumentProbe()
    expect(probe.policyAt).toEqual({
      loaded: [],
      willFinishLaunching: ['prohibited'],
      ready: ['prohibited', 'accessory'],
      afterAppRequest: ['prohibited', 'accessory'],
    })
    expect(probe.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'app.setActivationPolicy', args: ['prohibited'] }),
      expect.objectContaining({ type: 'app.setActivationPolicy', args: ['accessory'] }),
      expect.objectContaining({ type: 'app.setActivationPolicy.requested', args: ['regular'] }),
    ]))
  })

  test('foreground opt-in leaves window and app focus behavior real', () => {
    const probe = runInstrumentProbe({ NOMI_WALK_FOREGROUND_OK: '1' })
    expect(probe.options).toEqual({ show: true, width: 10 })
    expect(probe.nativeCalls.map(([name]) => name)).toEqual(expect.arrayContaining(['show', 'focus', 'moveTop', 'app.focus', 'dock.bounce', 'dock.show']))
    expect(probe.nativeCalls).toEqual(expect.arrayContaining([['setOpacity', [1]], ['setIgnoreMouseEvents', [false]]]))
    // 放行了：仪表不碰激活策略，App 自己改的照真的走。
    expect(probe.policyAt).toEqual({ loaded: [], willFinishLaunching: [], ready: [], afterAppRequest: ['regular'] })
    expect(probe.events.map((event) => event.type)).not.toContain('window.focus')
  })
})

test('quiet-walk module is a single main-process file', () => {
  expect(fs.readFileSync(quietWalk, 'utf8')).toContain('globalThis.__nomiQuietWalk')
})
