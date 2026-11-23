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

function runResizeOffscreenProbe(extraEnv = {}) {
  const script = `
    const Module = require('node:module')
    const { EventEmitter } = require('node:events')
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const nativeCalls = []
    class FakeWindow extends EventEmitter {
      static getAllWindows() { return [] }
      constructor(options) {
        super()
        this.options = options
        this.width = options.width ?? 1440
        this.height = options.height ?? 800
        this.position = [options.x ?? 0, options.y ?? 0]
        this.destroyed = false
        if (options.x !== undefined || options.y !== undefined) this._clamp(options.x ?? 0, options.y ?? 0)
      }
      _clamp(x, y) {
        // 模拟 macOS 钳位：屏外 x 被夹在 -(width - 40)（主屏左缘留 40px 隐身边缘条），y 最小停在 33。
        const minX = -(this.width - 40)
        this.position = [Math.max(minX, x), Math.max(33, y)]
      }
      showInactive(...args) { nativeCalls.push(['showInactive', args]); this.emit('show') }
      show(...args) { nativeCalls.push(['show', args]) }
      focus(...args) { nativeCalls.push(['focus', args]) }
      moveTop(...args) { nativeCalls.push(['moveTop', args]) }
      setOpacity(...args) { nativeCalls.push(['setOpacity', args]) }
      setIgnoreMouseEvents(...args) { nativeCalls.push(['setIgnoreMouseEvents', args]) }
      setFocusable(value) { nativeCalls.push(['setFocusable', [value]]) }
      getPosition() { return [...this.position] }
      setPosition(x, y) {
        nativeCalls.push(['setPosition', [x, y]])
        const prev = [...this.position]
        this._clamp(x, y)
        if (this.position[0] !== prev[0] || this.position[1] !== prev[1]) this.emit('moved')
      }
      setContentSize(width, height) {
        nativeCalls.push(['setContentSize', [width, height]])
        this.width = width; this.height = height
        // macOS 缩窄时把左缘夹到 -(700-40)=-660；扩回 1440 时左缘停在 -660（右侧 780px 裸露进屏幕），且不发 moved。
        this._clamp(this.position[0], this.position[1])
      }
      setSize(width, height) {
        nativeCalls.push(['setSize', [width, height]])
        this.width = width; this.height = height
        this._clamp(this.position[0], this.position[1])
      }
      setBounds(bounds) {
        nativeCalls.push(['setBounds', [bounds]])
        if (bounds && typeof bounds === 'object') {
          if (bounds.width !== undefined) this.width = bounds.width
          if (bounds.height !== undefined) this.height = bounds.height
          this._clamp(bounds.x ?? this.position[0], bounds.y ?? this.position[1])
        }
      }
      center() {
        nativeCalls.push(['center', []])
        this.position = [200, 100]
      }
      isDestroyed() { return this.destroyed }
    }
    const app = new EventEmitter()
    app.setActivationPolicy = () => undefined
    app.focus = () => undefined
    app.dock = { bounce: () => undefined, show: () => undefined }
    const shell = { openExternal: () => undefined, openPath: () => undefined, showItemInFolder: () => undefined }
    const dialog = { showOpenDialog: () => undefined, showErrorBox: () => undefined }
    class FakeNotification { show() {} }
    const fakeElectron = { BrowserWindow: FakeWindow, app, shell, dialog, Notification: FakeNotification }
    const electronName = ['elec', 'tron'].join('')
    const originalLoad = Module._load
    Module._load = function(request, parent, isMain) { return request === electronName ? fakeElectron : originalLoad.call(this, request, parent, isMain) }
    require(${JSON.stringify(quietWalk)})
    const injected = require(electronName)
    const win = new injected.BrowserWindow({ show: true, width: 1440, height: 800 })
    const snap = () => ({ pos: win.getPosition(), width: win.width, rightEdge: win.getPosition()[0] + win.width })
    const atInit = snap()
    win.setContentSize(700, 800)
    win.setContentSize(1440, 800)
    const afterSetContentSize = snap()
    win.setSize(700, 800)
    win.setSize(1440, 800)
    const afterSetSize = snap()
    win.setBounds({ x: 0, y: 0, width: 1440, height: 800 })
    const afterSetBounds = snap()
    win.center()
    const afterCenter = snap()
    // 模拟 OS / 原生侧直接改尺寸并只发 resized 事件
    win.position = [-660, 33]
    win.emit('resized')
    const afterResizedEvent = snap()
    console.log(JSON.stringify({ atInit, afterSetContentSize, afterSetSize, afterSetBounds, afterCenter, afterResizedEvent, nativeCalls, events: globalThis.__nomiQuietWalk.events }))
  `
  const result = spawnSync(process.execPath, ['-e', script], { cwd: repoRoot, env: { ...process.env, ...extraEnv }, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim())
}

test('quiet-walk module is a single main-process file', () => {
  expect(fs.readFileSync(quietWalk, 'utf8')).toContain('globalThis.__nomiQuietWalk')
})

describe('quiet-walk keeps offscreen windows parked after resize / setContentSize / setSize / setBounds / center', () => {
  test('缩窄再扩宽（setContentSize / setSize）、setBounds、center 与 resized 事件后，隐身窗口必须重新停回屏外（右缘 ≤ 40px）', () => {
    const probe = runResizeOffscreenProbe()
    expect(probe.atInit).toEqual({ pos: [-1400, 33], width: 1440, rightEdge: 40 })
    expect(probe.afterSetContentSize, 'setContentSize(700→1440) 后必须重停泊回屏外').toEqual({ pos: [-1400, 33], width: 1440, rightEdge: 40 })
    expect(probe.afterSetSize, 'setSize(700→1440) 后必须重停泊回屏外').toEqual({ pos: [-1400, 33], width: 1440, rightEdge: 40 })
    expect(probe.afterSetBounds, 'setBounds({ x: 0, y: 0 }) 不得把静默窗口挪进屏幕').toEqual({ pos: [-1400, 33], width: 1440, rightEdge: 40 })
    expect(probe.afterCenter, 'center() 不得把静默窗口居中到屏幕上').toEqual({ pos: [-1400, 33], width: 1440, rightEdge: 40 })
    expect(probe.afterResizedEvent, '原生 resized 事件后必须重停泊回屏外').toEqual({ pos: [-1400, 33], width: 1440, rightEdge: 40 })
  })

  test('foreground opt-in（NOMI_WALK_FOREGROUND_OK=1）保留 setBounds / center 真实行为', () => {
    const probe = runResizeOffscreenProbe({ NOMI_WALK_FOREGROUND_OK: '1' })
    expect(probe.afterSetBounds.pos).toEqual([0, 33])
    expect(probe.afterCenter.pos).toEqual([200, 100])
  })
})
