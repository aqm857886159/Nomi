// 钉住启动器的核心不变量（替掉原 helpers/electronFixture.test.mjs，2026-08-11 收敛）。
// 这条不变量就是本次修复的根因：漏掉这两个 env，窗口起不来且**毫无提示**，只会干等到超时。
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { spawn } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import {
  buildNomiLaunchEnv,
  cleanupTempRoot,
  configureSyntheticCredentialStorage,
  currentCatalogVersion,
  diagnoseLaunchFailure,
  prepareIsolatedCatalog,
  prepareLocalStorageSeed,
  launchNomiApp,
  mainRequireArgs,
  repoRoot,
  registerTempRoot,
  requireBeforePackagedMain,
  withLinuxNoSandbox,
  withLinuxSyntheticCredentialStorage,
  withPackagedPlaywrightOrigin,
} from './_launchApp.mjs'

describe('shared Electron temp-root lifecycle', () => {
  test('cleanup is idempotent for explicit and generated roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-launch-cleanup-'))
    registerTempRoot(root)
    expect(fs.existsSync(root)).toBe(true)
    cleanupTempRoot(root)
    cleanupTempRoot(root)
    expect(fs.existsSync(root)).toBe(false)
  })
})

const dirs = { userDataDir: '/tmp/case/user-data', settingsDir: '/tmp/case/settings', projectsDir: '/tmp/case/projects' }

describe('initial local storage fixture', () => {
  test('seeds missing preferences while preserving explicit values and excluding subframes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storage-seed-'))
    try {
      const args = prepareLocalStorageSeed(root, { 'nomi:splash:v1': 'seen', 'nomi-color-scheme': 'light' })
      let listener
      let registration
      vm.runInNewContext(fs.readFileSync(args[1], 'utf8'), {
        require: () => ({ app: { once: (event, callback) => {
          expect(event).toBe('session-created')
          listener = callback
        } } }),
      })
      listener({ registerPreloadScript: (value) => { registration = value } })
      expect(args[0]).toBe('-r')
      expect(registration.type).toBe('frame')
      const values = new Map([['nomi-color-scheme', 'dark']])
      const context = {
        process: { isMainFrame: false },
        window: { localStorage: {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => values.set(key, value),
        } },
      }
      const script = fs.readFileSync(registration.filePath, 'utf8')
      vm.runInNewContext(script, context)
      expect(values.has('nomi:splash:v1')).toBe(false)
      context.process.isMainFrame = true
      vm.runInNewContext(script, context)
      expect(Object.fromEntries(values)).toEqual({ 'nomi-color-scheme': 'dark', 'nomi:splash:v1': 'seen' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses to seed a real profile before launching Electron', async () => {
    await expect(launchNomiApp({ executablePath: 'unused-by-isolation-guard', isolate: false, initialLocalStorage: { 'nomi:splash:v1': 'seen' } }))
      .rejects.toThrow('requires an isolated Nomi profile')
  })
})

describe('mainRequire（主进程入口前的 -r 模块）', () => {
  test('每个绝对路径拼成一对 -r，顺序保持', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-main-require-'))
    try {
      const first = path.join(root, 'guard.cjs')
      const second = path.join(root, 'probe.cjs')
      fs.writeFileSync(first, '')
      fs.writeFileSync(second, '')
      expect(mainRequireArgs([first, second])).toEqual(['-r', first, '-r', second])
      expect(mainRequireArgs(undefined)).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('相对路径与不存在的文件当场拒（相对路径会被 Node 当包名去找，闸就静默没装上）', () => {
    expect(() => mainRequireArgs(['scripts/walkthrough-network-guard.cjs'])).toThrow('absolute module paths')
    expect(() => mainRequireArgs([path.join(os.tmpdir(), 'nomi-no-such-guard.cjs')])).toThrow('does not exist')
  })

  test('不许装进真实 profile', async () => {
    await expect(launchNomiApp({ executablePath: 'unused-by-isolation-guard', isolate: false, mainRequire: [path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')] }))
      .rejects.toThrow('mainRequire requires an isolated Nomi profile')
  })

  // 打包好的 App 静默忽略 `-r`：闸没装上、请求直奔真网。打包形态必须在主入口第一行之前真的装上。
  test('打包形态：模块在 app.asar/dist-electron/main.js 第一行之前就已加载', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-packaged-premain-'))
    const entryDir = path.join(root, 'resources', 'app.asar', 'dist-electron')
    fs.mkdirSync(entryDir, { recursive: true })
    const guard = path.join(root, 'guard.cjs')
    const seen = path.join(root, 'seen.txt')
    fs.writeFileSync(guard, 'globalThis.__nomiGuard = "installed-before-main"\n')
    fs.writeFileSync(path.join(entryDir, 'main.js'), `require('node:fs').writeFileSync(${JSON.stringify(seen)}, String(globalThis.__nomiGuard))\n`)
    const port = await new Promise((resolve) => {
      const server = net.createServer().listen(0, '127.0.0.1', () => { const { port: free } = server.address(); server.close(() => resolve(free)) })
    })
    const child = spawn(process.execPath, [`--inspect-brk=127.0.0.1:${port}`, path.join(entryDir, 'main.js')], { stdio: 'ignore' })
    const exited = new Promise((resolve) => child.once('exit', resolve))
    try {
      await requireBeforePackagedMain({ port, modules: [guard], timeout: 20_000 })
      await exited
      expect(fs.readFileSync(seen, 'utf8')).toBe('installed-before-main')
    } finally {
      child.kill()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('prepareIsolatedCatalog', () => {
  test('quarantines a seed newer than the tested app instead of letting it enter Electron', () => {
    const root = fs.mkdtempSync('/tmp/nomi-catalog-seed-red-')
    const catalog = path.join(root, 'model-catalog.json')
    const future = { version: 12, futureOnlyField: 'preserve-me', vendors: [], models: [], mappings: [], apiKeysByVendor: {} }
    fs.writeFileSync(catalog, JSON.stringify(future))

    const result = prepareIsolatedCatalog(root, { testedCatalogVersion: 11 })

    expect(result.status).toBe('quarantined')
    expect(fs.existsSync(catalog)).toBe(false)
    expect(JSON.parse(fs.readFileSync(result.quarantinePath, 'utf8'))).toEqual(future)
  })

  test('keeps current and older seeds for the app migration chain', () => {
    for (const diskVersion of [currentCatalogVersion(), currentCatalogVersion() - 1]) {
      const root = fs.mkdtempSync('/tmp/nomi-catalog-seed-compatible-')
      const catalog = path.join(root, 'model-catalog.json')
      fs.writeFileSync(catalog, JSON.stringify({ version: diskVersion, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }))

      expect(prepareIsolatedCatalog(root)).toMatchObject({ status: 'compatible', diskVersion })
      expect(JSON.parse(fs.readFileSync(catalog, 'utf8')).version).toBe(diskVersion)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('buildNomiLaunchEnv', () => {
  test('钉死必需 env 并隔离每个可写路径', () => {
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {} })).toEqual({
      NOMI_E2E: '1',
      NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
      // 走查环境里主进程日志必须看得见（否则 CI 的 job 日志里一条 WARN 都没有）。
      NOMI_LOG_STDERR: '1',
      NOMI_ELECTRON_USER_DATA_DIR: dirs.userDataDir,
      NOMI_SETTINGS_DIR: dirs.settingsDir,
      NOMI_PROJECTS_DIR: dirs.projectsDir,
    })
  })

  test('调用方覆盖不掉这两条——本次修复的根因就在这里', () => {
    // 走查作者可能出于任何理由传进来（复制粘贴、想「测生产行为」……）。
    // 覆盖成功 = 窗口起不来 + 零提示，所以启动器必须无视它。
    const env = buildNomiLaunchEnv({
      ...dirs,
      baseEnv: {},
      extraEnv: { NOMI_E2E: '0', NOMI_E2E_ALLOW_MULTI_INSTANCE: undefined },
    })
    expect(env.NOMI_E2E).toBe('1')
    expect(env.NOMI_E2E_ALLOW_MULTI_INSTANCE).toBe('1')
  })

  test('额外 env 照常透传（走查各自的开关不受影响）', () => {
    const env = buildNomiLaunchEnv({ ...dirs, baseEnv: { PATH: '/usr/bin' }, extraEnv: { NOMI_TEST_SYSTEM_LOCALE: '1' } })
    expect(env.NOMI_TEST_SYSTEM_LOCALE).toBe('1')
    expect(env.PATH).toBe('/usr/bin')
  })

  test('隔离能力核目录也随 env 传入且不与 settings 混用', () => {
    const env = buildNomiLaunchEnv({ ...dirs, capabilityDir: '/tmp/case/capability', baseEnv: {} })
    expect(env.NOMI_CAPABILITY_DIR).toBe('/tmp/case/capability')
    expect(env.NOMI_SETTINGS_DIR).toBe(dirs.settingsDir)
  })
})

describe('withLinuxNoSandbox', () => {
  test('Linux direct spawns disable the unavailable setuid sandbox once', () => {
    expect(withLinuxNoSandbox(['.', '--disable-gpu'], 'linux')).toEqual(['.', '--disable-gpu', '--no-sandbox', '--enable-unsafe-swiftshader'])
    expect(withLinuxNoSandbox(['.', '--no-sandbox'], 'linux')).toEqual(['.', '--no-sandbox', '--enable-unsafe-swiftshader'])
  })

  test('Linux spawns opt in to SwiftShader WebGL exactly once (Chromium >=139 removed the fallback)', () => {
    expect(withLinuxNoSandbox(['.', '--enable-unsafe-swiftshader'], 'linux'))
      .toEqual(['.', '--enable-unsafe-swiftshader', '--no-sandbox'])
  })

  test('non-Linux spawns keep their original arguments', () => {
    expect(withLinuxNoSandbox(['.', '--disable-gpu'], 'darwin')).toEqual(['.', '--disable-gpu'])
    expect(withLinuxNoSandbox(['.', '--disable-gpu'], 'win32')).toEqual(['.', '--disable-gpu'])
  })
})

describe('withLinuxSyntheticCredentialStorage', () => {
  test('isolated synthetic fixtures get a deterministic Linux backend exactly once', () => {
    expect(withLinuxSyntheticCredentialStorage(['.'], true, 'linux'))
      .toEqual(['.', '--password-store=basic'])
    expect(withLinuxSyntheticCredentialStorage(['.', '--password-store=basic'], true, 'linux'))
      .toEqual(['.', '--password-store=basic'])
  })

  test('real credential journeys and non-Linux hosts keep their storage backend', () => {
    expect(withLinuxSyntheticCredentialStorage(['.'], false, 'linux')).toEqual(['.'])
    expect(withLinuxSyntheticCredentialStorage(['.'], true, 'darwin')).toEqual(['.'])
    expect(() => withLinuxSyntheticCredentialStorage(['.', '--password-store=gnome-libsecret'], true, 'linux'))
      .toThrow('synthetic credential storage conflicts')
  })

  test('activates and verifies Electron safeStorage only for opted-in Linux fixtures', async () => {
    const calls = []
    const app = {
      evaluate: async (callback) => callback({
        safeStorage: {
          setUsePlainTextEncryption: (enabled) => calls.push(enabled),
          isEncryptionAvailable: () => true,
        },
      }),
    }

    await expect(configureSyntheticCredentialStorage(app, true, 'linux')).resolves.toBe(true)
    await expect(configureSyntheticCredentialStorage(app, false, 'linux')).resolves.toBe(false)
    await expect(configureSyntheticCredentialStorage(app, true, 'darwin')).resolves.toBe(false)
    expect(calls).toEqual([true])
  })

  test('fails at the launcher boundary when the Linux fallback is still unavailable', async () => {
    const app = {
      evaluate: async (callback) => callback({
        safeStorage: {
          setUsePlainTextEncryption: () => undefined,
          isEncryptionAvailable: () => false,
        },
      }),
    }

    await expect(configureSyntheticCredentialStorage(app, true, 'linux'))
      .rejects.toThrow('could not initialize an in-memory safeStorage key')
  })

  test('every literal fixture credential explicitly opts into isolated synthetic storage', () => {
    const sources = ['tests/ux', 'scripts'].flatMap((directory) =>
      fs.readdirSync(path.join(repoRoot, directory), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
        .map((entry) => path.join(entry.parentPath, entry.name)),
    )
    const offenders = sources
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return source.includes('upsertVendorApiKey') && /apiKey:\s*['"]/.test(source) &&
          !/syntheticCredentialStorage:\s*true/.test(source)
      })
      .map((file) => path.relative(repoRoot, file))

    expect(offenders).toEqual([])
  })
})

describe('withPackagedPlaywrightOrigin', () => {
  test('packaged E2E admits the Playwright DevTools websocket exactly once', () => {
    expect(withPackagedPlaywrightOrigin(['--user-data-dir=/tmp/case'], true))
      .toEqual(['--user-data-dir=/tmp/case', '--remote-allow-origins=*'])
    expect(withPackagedPlaywrightOrigin(['--remote-allow-origins=*'], true))
      .toEqual(['--remote-allow-origins=*'])
  })

  test('development launches do not broaden the DevTools origin policy', () => {
    expect(withPackagedPlaywrightOrigin(['.', '--disable-gpu'], false)).toEqual(['.', '--disable-gpu'])
  })
})

describe('diagnoseLaunchFailure', () => {
  test('extracts the real main-process stderr from Playwright Call log and filters debugger noise', () => {
    const error = new Error([
      'electron.launch: Timeout 30000ms exceeded.',
      'Call log:',
      '  - <launching> /Applications/Nomi.app/Contents/MacOS/Nomi',
      '  - <launched> pid=4242',
      '  - [pid=4242][err] Debugger listening on ws://127.0.0.1:9229/abc',
      '  - [pid=4242][err] Debugger attached.',
      '  - [pid=4242][err] DevTools listening on ws://127.0.0.1:31337/devtools/browser/abc',
      '  - [pid=4242][err] fatal: catalog migration failed',
    ].join('\n'))

    const report = diagnoseLaunchFailure('Electron launch timed out', 'synthetic-launch', error, [])

    expect(report).toContain('fatal: catalog migration failed')
    expect(report).not.toContain('Debugger listening')
    expect(report).not.toContain('Debugger attached')
    expect(report).not.toContain('DevTools listening')
  })

  test('an empty capture reports only that the launcher did not capture output', () => {
    const report = diagnoseLaunchFailure(
      'Electron launch timed out',
      'no-output-launch',
      new Error('electron.launch: Timeout 30000ms exceeded.'),
      [],
    )

    expect(report).toContain('启动器未捕获到主进程输出')
    expect(report).not.toContain('压根没起来')
  })
})
