import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawnMcpStdioClient } from './_mcpJourney.mjs'
import * as launcher from './_launchApp.mjs'
import { _electron as electron } from 'playwright'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, QUIET_WALK_MODULE, decideSyntheticCredentialStorage, encryptFixtureKey, syntheticCredentialBackendArgs } from './_launchApp.mjs'

vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawn: vi.fn() }))

vi.mock('../../scripts/package-build-stamp.mjs', () => ({ assertFreshBuild: vi.fn() }))
vi.mock('../../scripts/electron-build-artifacts.mjs', () => ({ assertElectronBuildArtifacts: vi.fn() }))
vi.mock('../../scripts/ensure-electron-signature.mjs', () => ({ ensureElectronSignature: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

const require = createRequire(import.meta.url)
const CREDENTIAL_STORAGE_MODULE = launcher.CREDENTIAL_STORAGE_MODULE || new URL('_credentialStorage.cjs', import.meta.url).pathname
const { prepareCredentialSource } = launcher
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
  expect(options.args.slice(0, 7)).toEqual(['-r', path.join(path.dirname(QUIET_WALK_MODULE), '_playwrightReady.cjs'), '-r', CREDENTIAL_STORAGE_MODULE, '-r', QUIET_WALK_MODULE, '.'])
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
  ['real', [], {}],
  ['synthetic', ['--password-store=basic'], { 'password-store': 'basic' }],
  ['synthetic', ['--use-mock-keychain'], { 'use-mock-keychain': '' }],
  ['real', ['--password-store=gnome-libsecret'], { 'password-store': 'gnome-libsecret' }],
])('ready 适配器消费来源合同（%s %j）', (mode, args, expected) => {
  const switches = new Map([['use-mock-keychain', ''], ['password-store', 'basic']])
  const app = new EventEmitter()
  app.isReady = () => false
  app.commandLine = { removeSwitch: (name) => switches.delete(name), appendSwitch: (name, value) => switches.set(name, value) }
  const context = {
    module: { require: () => ({ app }) },
    require: () => vm.runInNewContext(fs.readFileSync(CREDENTIAL_STORAGE_MODULE, 'utf8'), {
      require: () => ({ app, safeStorage: {}, ipcMain: { handle: vi.fn() } }),
      process: { platform: 'linux', env: { NOMI_WALK_CREDENTIAL_SOURCE: mode, NOMI_WALK_CREDENTIAL_ARGS: JSON.stringify(args) } },
    }),
    process: { argv: ['electron', '.'] },
    __playwright_run: () => {},
  }
  vm.runInNewContext(fs.readFileSync(new URL('_playwrightReady.cjs', import.meta.url), 'utf8'), context)
  expect(Object.fromEntries(switches)).toEqual(expected)
})

test('ready 适配器在官方屏障缺失时拒绝应用入口，不伪造放行函数', () => {
  const context = { module: { require: () => ({ app: {} }) } }
  expect(() => vm.runInNewContext(fs.readFileSync(path.join(path.dirname(QUIET_WALK_MODULE), '_playwrightReady.cjs'), 'utf8'), context))
    .toThrow('Playwright ready loader was not installed')
  expect(context.__playwright_run).toBeUndefined()
})


// Source matrix: no credential bytes are read; all stored values are non-secret fixture shapes.
const platforms = ['linux', 'darwin', 'win32']
const shapes = ['empty', 'plain', 'safeStorage']
function sourceDirs(shape = 'empty', real = false) {
  const root = makeTempDir('nomi-source-matrix-')
  const userDataDir = path.join(root, 'user-data')
  const settingsDir = path.join(root, 'settings')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(settingsDir, { recursive: true })
  if (shape !== 'empty') fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({ apiKeysByVendor: { fixture: { apiKey: 'fixture-shape-only', enc: shape } } }))
  if (real) fs.writeFileSync(path.join(userDataDir, '.nomi-real-credential-copy'), 'fixture marker only')
  return { tempRoot: root, userDataDir, settingsDir }
}

describe('credential source matrix', () => {
  test.each(platforms.flatMap((platform) => shapes.map((shape) => [platform, shape])))('%s / %s synthetic source includes future first save', (platform, shape) => {
    const dirs = sourceDirs(shape)
    expect(decideSyntheticCredentialStorage({ ...dirs, isolate: true, platform })).toBe(true)
  })
  test.each(platforms)('%s real copy and nonisolated source never become synthetic', (platform) => {
    const dirs = sourceDirs('safeStorage', true)
    expect(decideSyntheticCredentialStorage({ ...dirs, isolate: true, platform })).toBe(false)
    expect(decideSyntheticCredentialStorage({ ...dirs, isolate: false, platform })).toBe(false)
    expect(() => decideSyntheticCredentialStorage({ ...dirs, isolate: true, platform, explicit: true })).toThrow(/conflict|冲突/)
  })
  test.each(platforms)('%s an unmarked profile-copy override fails without changing its catalog', (platform) => {
    const dirs = sourceDirs('safeStorage')
    const file = path.join(dirs.settingsDir, 'model-catalog.json')
    const before = fs.readFileSync(file)
    expect(() => decideSyntheticCredentialStorage({ ...dirs, isolate: true, platform, explicit: false })).toThrow(/marker|标记/)
    expect(fs.readFileSync(file)).toEqual(before)
  })
  test.each([null, 'true', 0, {}])('invalid explicit source declaration %j fails closed', (explicit) => {
    expect(() => decideSyntheticCredentialStorage({ ...sourceDirs(), isolate: true, explicit })).toThrow()
  })
  test('a claimed profile cannot silently change its credential origin', () => {
    const dirs = sourceDirs()
    expect(decideSyntheticCredentialStorage({ ...dirs, isolate: true })).toBe(true)
    fs.writeFileSync(path.join(dirs.userDataDir, '.nomi-real-credential-copy'), 'fixture')
    expect(() => decideSyntheticCredentialStorage({ ...dirs, isolate: true })).toThrow(/source|来源/)
  })
  test.each(platforms.flatMap((platform) => shapes.flatMap((shape) => [false, true].map((packaged) => [platform, shape, packaged]))))('%s / %s / packaged=%s GUI and pre-encryption share the source', async (platform, shape, packaged) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: platform })
    try {
      const dirs = sourceDirs(shape)
      const launch = vi.spyOn(electron, 'launch').mockRejectedValue(new Error('capture source'))
      await expect(launchNomiApp({ ...dirs, ...(packaged ? { executablePath: '/fixture/Nomi', allowUntrackedProcessForTest: true } : {}) })).rejects.toThrow('capture source')
      const options = launch.mock.calls[0][0]
      expect(options.env.NOMI_WALK_CREDENTIAL_SOURCE).toBe('synthetic')
      expect(options.env.NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE).toBe('1')
      const backend = (args) => args.filter((arg) => /^--(password-store|use-mock-keychain)\b/.test(arg))
      expect(backend(options.args)).toEqual(syntheticCredentialBackendArgs(platform))
      encryptFixtureKey({ userDataDir: dirs.userDataDir, appName: 'nomi', plaintext: 'non-secret-fixture', platform, spawn: (_command, args, settings) => {
        expect(settings.env.NOMI_WALK_CREDENTIAL_SOURCE).toBe(options.env.NOMI_WALK_CREDENTIAL_SOURCE)
        expect(backend(args)).toEqual(backend(options.args))
        return { status: 0, stdout: 'fixture-ciphertext' }
      } })
    } finally { Object.defineProperty(process, 'platform', descriptor) }
  })
  test('pre-encryption refuses real-marker profiles before spawning', () => {
    const dirs = sourceDirs('safeStorage', true)
    const spawn = vi.fn()
    expect(() => encryptFixtureKey({ userDataDir: dirs.userDataDir, appName: 'nomi', plaintext: 'fixture', spawn })).toThrow(/real|真实/)
    expect(spawn).not.toHaveBeenCalled()
  })
  test('all four effect points consume source; none infers it from catalog or opts in', () => {
    const source = fs.readFileSync(new URL('./_launchApp.mjs', import.meta.url), 'utf8')
    expect(source).not.toContain('isolatedCatalogHasSafeStorageCredentials')
    expect(source).not.toContain('await configureSyntheticCredentialStorage(app,')
    for (const file of ['_playwrightReady.cjs', '_encryptFixtureKey.cjs', '_mcpJourney.mjs']) {
      expect(fs.readFileSync(new URL(file, import.meta.url), 'utf8')).toMatch(/CredentialSource|credentialStorage/)
    }
    expect(fs.readFileSync(new URL('_mcpJourney.mjs', import.meta.url), 'utf8')).not.toContain('syntheticCredentialStorage = false')
  })
})

function runtimeStorage(platform, mode = 'synthetic', availableAfterInit = true) {
  const app = new EventEmitter()
  let initialized = platform !== 'linux' || mode === 'real'
  app.isReady = () => false
  app.commandLine = { removeSwitch: vi.fn(), appendSwitch: vi.fn() }
  const handlers = new Map()
  const safeStorage = {
    setUsePlainTextEncryption: (enabled) => { initialized = enabled && availableAfterInit },
    isEncryptionAvailable: () => initialized,
    encryptString: (value) => { if (!initialized) throw new Error('safeStorage unavailable'); return Buffer.from(value) },
  }
  const logs = []
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
  const context = { require: (id) => id === 'electron' ? { app, safeStorage, ipcMain } : require(id), module: { exports: {} }, process: { platform, env: { NOMI_WALK_CREDENTIAL_SOURCE: mode, NOMI_WALK_CREDENTIAL_ARGS: JSON.stringify(mode === 'synthetic' ? syntheticCredentialBackendArgs(platform) : []) }, stderr: { write: (line) => logs.push(line) } }, Buffer }
  vm.runInNewContext(fs.readFileSync(new URL('_credentialStorage.cjs', import.meta.url), 'utf8'), context)
  return { app, safeStorage, ipcMain, handlers, logs }
}

describe('credential first-save initialization', () => {
  test.each(platforms.flatMap((platform) => ['GUI-development', 'GUI-packaged', 'MCP', 'pre-encryption'].map((entry) => [platform, entry])))('%s / %s initializes before the first catalog save', (platform) => {
    const runtime = runtimeStorage(platform)
    let saved
    runtime.app.once('ready', () => { saved = runtime.safeStorage.encryptString('fixture-first-save').toString() })
    runtime.app.emit('ready')
    expect(saved).toBe('fixture-first-save')
  })
  test('unavailable backend fails with mode, availability and cause', () => {
    const runtime = runtimeStorage('linux', 'synthetic', false)
    expect(() => runtime.app.emit('ready')).toThrow(/safeStorage/)
    expect(runtime.logs.join('')).toMatch(/synthetic/)
    expect(runtime.logs.join('')).toMatch(/available=false/)
  })
  test('a failed save logs its cause and backend, without key or ciphertext', async () => {
    const runtime = runtimeStorage('linux')
    runtime.app.emit('ready')
    const secret = 'fake-only-key-for-redaction'
    const cipher = Buffer.from('fake ciphertext bytes').toString('base64')
    runtime.ipcMain.handle('nomi:model-catalog:vendor-api-key:upsert', async () => ({ ok: false, error: { message: `save failed ${secret} ${cipher}` } }))
    await runtime.handlers.get('nomi:model-catalog:vendor-api-key:upsert')({}, 'fixture', { apiKey: secret })
    const log = runtime.logs.join('')
    expect(log).toMatch(/save failed/)
    expect(log).toMatch(/synthetic/)
    expect(log).toMatch(/available=true/)
    expect(log).not.toContain(secret)
    expect(log).not.toContain(cipher)
  })
})


test('credential cross-process identity decrypts in both directions on the actual host', () => {
  const dirs = sourceDirs()
  const marker = 'non-secret-cross-process-fixture'
  const encrypted = encryptFixtureKey({ userDataDir: dirs.userDataDir, appName: 'nomi', plaintext: marker })
  const consumer = path.join(dirs.tempRoot, 'consume.cjs')
  const runtime = path.join(path.dirname(QUIET_WALK_MODULE), '_credentialStorage.cjs')
  fs.writeFileSync(consumer, `const { app, safeStorage } = require('electron')
app.setName('nomi')
app.setPath('userData', process.env.NOMI_ELECTRON_USER_DATA_DIR)
require(${JSON.stringify(path.join(path.dirname(QUIET_WALK_MODULE), '_quietWalk.cjs'))})
require(${JSON.stringify(runtime)})
app.whenReady().then(() => {
  if (safeStorage.decryptString(Buffer.from(process.env.FIXTURE_CIPHER, 'base64')) !== ${JSON.stringify(marker)}) throw new Error('identity mismatch')
  process.stdout.write(safeStorage.encryptString(${JSON.stringify(marker)}).toString('base64'))
  app.quit()
}).catch(() => { process.stderr.write('cross-process decryption failed'); app.exit(1) })
`)
  const env = { ...process.env, NOMI_E2E: '1', NOMI_ELECTRON_USER_DATA_DIR: dirs.userDataDir, NOMI_WALK_CREDENTIAL_SOURCE: 'synthetic', NOMI_WALK_CREDENTIAL_ARGS: JSON.stringify(syntheticCredentialBackendArgs()), FIXTURE_CIPHER: encrypted }
  delete env.ELECTRON_RUN_AS_NODE
  const first = spawnSync(require('electron'), [consumer, ...syntheticCredentialBackendArgs()], { env, encoding: 'utf8', timeout: 20_000 })
  expect(first.status, first.stderr).toBe(0)
  const second = spawnSync(require('electron'), [consumer, ...syntheticCredentialBackendArgs()], { env: { ...env, FIXTURE_CIPHER: first.stdout.trim() }, encoding: 'utf8', timeout: 20_000 })
  expect(second.status, second.stderr).toBe(0)
}, 45_000)


describe('credential MCP assembly matrix', () => {
  test.each(platforms.flatMap((platform) => [...shapes, 'real-marker'].flatMap((shape) => [false, true].map((packaged) => [platform, shape, packaged]))))('%s / %s / packaged=%s uses the claimed source', (platform, shape, packaged) => {
    const dirs = sourceDirs(shape === 'real-marker' ? 'safeStorage' : shape, shape === 'real-marker')
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: platform })
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stdin = new PassThrough()
    spawn.mockReturnValueOnce(child)
    try {
      spawnMcpStdioClient({ ...dirs, projectsDir: path.join(dirs.tempRoot, 'projects'), capabilityDir: path.join(dirs.tempRoot, 'capability'), runtime: {
        command: '/fixture/electron', args: [packaged ? '/fixture/mcpNodeLauncher.js' : '.'],
        env: packaged ? { ELECTRON_RUN_AS_NODE: '1', NOMI_MCP_APP_COMMAND: '/fixture/Nomi', NOMI_MCP_APP_ARGS: '["--disable-gpu"]' } : {},
      } })
      const [, args, options] = spawn.mock.calls.at(-1)
      const expected = shape === 'real-marker' ? 'real' : 'synthetic'
      expect(options.env.NOMI_WALK_CREDENTIAL_SOURCE).toBe(expected)
      expect(options.env.NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE).toBe(expected === 'synthetic' ? '1' : '')
      if (packaged) {
        const ownerArgs = JSON.parse(options.env.NOMI_MCP_APP_ARGS)
        expect(ownerArgs[0]).toMatch(/_packagedCredentialOwner.mjs$/)
        expect(ownerArgs.slice(1)).toEqual(['/fixture/Nomi', '--disable-gpu'])
        expect(options.env.NOMI_MCP_APP_COMMAND).toBe(process.execPath)
      } else {
        expect(args.slice(0, 2)).toEqual(['-r', CREDENTIAL_STORAGE_MODULE])
        expect(args.filter((arg) => /^--(password-store|use-mock-keychain)\b/.test(arg))).toEqual(expected === 'synthetic' ? syntheticCredentialBackendArgs(platform) : [])
      }
    } finally {
      child.stdout.destroy()
      child.stdin.destroy()
      Object.defineProperty(process, 'platform', descriptor)
    }
  })
  test.each([
    { NOMI_WALK_CREDENTIAL_SOURCE: 'real' },
    { NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE: '' },
    { NOMI_WALK_CREDENTIAL_ARGS: '[]' },
    { NOMI_ELECTRON_USER_DATA_DIR: '/fixture/another-profile' },
    { NOMI_SETTINGS_DIR: '/fixture/another-settings' },
  ])('source or profile override %j fails closed', (env) => {
    expect(() => prepareCredentialSource({ ...sourceDirs(), isolate: true, args: [], platform: 'linux', env })).toThrow(/conflict/)
  })
})


test.each([[0, null, 0], [1, null, 1], [null, 'SIGKILL', 1]])('packaged credential owner preserves child exit %j / %j', async (code, signal, expected) => {
  const child = new EventEmitter()
  const launch = vi.fn(async () => ({ close: vi.fn(), app: { process: () => child } }))
  const processDouble = {
    argv: ['node', 'bootstrap', '/fixture/Nomi', '--disable-gpu'],
    env: { NOMI_ELECTRON_USER_DATA_DIR: '/fixture/user-data', NOMI_SETTINGS_DIR: '/fixture/settings', NOMI_PROJECTS_DIR: '/fixture/projects', NOMI_CAPABILITY_DIR: '/fixture/capability', ELECTRON_RUN_AS_NODE: '1' },
    once: vi.fn(), exit: vi.fn(),
  }
  const codeUnderTest = fs.readFileSync(new URL('_packagedCredentialOwner.mjs', import.meta.url), 'utf8').replace(/^import .*$/gm, '')
  await vm.runInNewContext(`(async () => { ${codeUnderTest} })()`, { path, process: processDouble, launchNomiApp: launch })
  expect(launch.mock.calls[0][0]).toMatchObject({ executablePath: '/fixture/Nomi', args: ['--disable-gpu'], waitForWindow: false, userDataDir: '/fixture/user-data' })
  expect(launch.mock.calls[0][0].env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  child.emit('exit', code, signal)
  expect(processDouble.exitCode).toBe(expected)
})
