import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { _electron as electron } from 'playwright'
import { afterEach, expect, test, vi } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, QUIET_WALK_MODULE } from './_launchApp.mjs'

vi.mock('../../scripts/package-build-stamp.mjs', () => ({ assertFreshBuild: vi.fn() }))
vi.mock('../../scripts/electron-build-artifacts.mjs', () => ({ assertElectronBuildArtifacts: vi.fn() }))
vi.mock('../../scripts/ensure-electron-signature.mjs', () => ({ ensureElectronSignature: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

const require = createRequire(import.meta.url)
const coreRequire = createRequire(require.resolve('playwright'))
const corePackage = coreRequire.resolve('playwright-core/package.json')

test.each([undefined, require('electron')])('开发构建保留官方 ready loader 的自动注入入口（%s）', async (executablePath) => {
  const launch = vi.spyOn(electron, 'launch').mockRejectedValue(new Error('captured launch options'))
  await expect(launchNomiApp({
    executablePath,
    tempRoot: makeTempDir('nomi-ready-options-'),
    mainRequire: [QUIET_WALK_MODULE],
  })).rejects.toThrow('captured launch options')
  const options = launch.mock.calls[0][0]
  expect(options).not.toHaveProperty('executablePath')
  expect(options.args.slice(0, 5)).toEqual(['-r', path.join(path.dirname(QUIET_WALK_MODULE), '_playwrightReady.cjs'), '-r', QUIET_WALK_MODULE, '.'])
  expect(options.timeout).toBe(60_000)
  expect(createRequire(corePackage)('electron/index.js')).toBe(require('electron'))
})

test('打包构建仍显式选择自定义二进制，不把开发 loader 的 -r 当成应用参数', async () => {
  const launch = vi.spyOn(electron, 'launch').mockRejectedValue(new Error('captured launch options'))
  await expect(launchNomiApp({
    executablePath: '/fixture/Nomi',
    tempRoot: makeTempDir('nomi-ready-packaged-'),
    allowUntrackedProcessForTest: true,
  })).rejects.toThrow('captured launch options')
  const options = launch.mock.calls[0][0]
  expect(options.executablePath).toBe('/fixture/Nomi')
  expect(options.args).not.toContain('.')
  expect(options.args).not.toContain('-r')
})

test('已安装的官方 loader 在握手前拦住 ready / whenReady，保留 mainRequire 参数', async () => {
  const app = new EventEmitter()
  app.commandLine = { appendSwitch: vi.fn() }
  let nativeReady
  app.whenReady = () => new Promise((resolve) => { nativeReady = resolve })
  const adapter = path.join(path.dirname(QUIET_WALK_MODULE), '_playwrightReady.cjs')
  const args = ['electron', '-r', 'loader.js', '--inspect=0', '--remote-debugging-port=0', '-r', adapter, '-r', QUIET_WALK_MODULE, '.']
  const context = vm.createContext({ require: () => ({ app }), process: { argv: args, env: {} } })
  vm.runInContext(fs.readFileSync(path.join(path.dirname(corePackage), 'lib/server/electron/loader.js'), 'utf8'), context)
  const events = []
  app.once('ready', () => events.push('ready'))
  app.whenReady().then(() => events.push('whenReady'))
  nativeReady()
  app.emit('ready', {})
  await Promise.resolve()
  expect(app.isReady()).toBe(false)
  expect(events).toEqual([])
  expect(args).toEqual(['electron', '-r', adapter, '-r', QUIET_WALK_MODULE, '.'])
  expect(typeof context.__playwright_run).toBe('function')
  await context.__playwright_run()
  expect(app.isReady()).toBe(true)
  expect(events).toEqual(['ready', 'whenReady'])
})


test.each([
  [[], {}],
  [['--password-store=basic'], { 'password-store': 'basic' }],
  [['--use-mock-keychain'], { 'use-mock-keychain': '' }],
  [['--use-mock-keychain', '--password-store=basic'], { 'use-mock-keychain': '', 'password-store': 'basic' }],
  [['--password-store=gnome-libsecret'], { 'password-store': 'gnome-libsecret' }],
  [['--password-store=basic', '--password-store=kwallet6'], { 'password-store': 'kwallet6' }],
])('ready 适配器保留调用方的凭据后端选择（%j）', (args, expected) => {
  const switches = new Map([['use-mock-keychain', ''], ['password-store', 'basic']])
  vm.runInNewContext(fs.readFileSync(path.join(path.dirname(QUIET_WALK_MODULE), '_playwrightReady.cjs'), 'utf8'), {
    require: () => ({ app: { commandLine: {
      removeSwitch: (name) => switches.delete(name),
      appendSwitch: (name, value) => switches.set(name, value),
    } } }),
    process: { argv: ['electron', '.', ...args] },
    __playwright_run: () => {},
  })
  expect(Object.fromEntries(switches)).toEqual(expected)
})

test('ready 适配器在官方屏障缺失时拒绝应用入口，不伪造放行函数', () => {
  const context = { require: () => ({ app: {} }) }
  expect(() => vm.runInNewContext(fs.readFileSync(path.join(path.dirname(QUIET_WALK_MODULE), '_playwrightReady.cjs'), 'utf8'), context))
    .toThrow('Playwright ready loader was not installed')
  expect(context.__playwright_run).toBeUndefined()
})
