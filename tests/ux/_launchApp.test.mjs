// 钉住启动器的核心不变量（替掉原 helpers/electronFixture.test.mjs，2026-08-11 收敛）。
// 这条不变量就是本次修复的根因：漏掉这两个 env，窗口起不来且**毫无提示**，只会干等到超时。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assertCatalogWritable,
  buildNomiLaunchEnv,
  configureSyntheticCredentialStorage,
  diagnoseLaunchFailure,
  repoRoot,
  withLinuxNoSandbox,
  withLinuxSyntheticCredentialStorage,
  withPackagedPlaywrightOrigin,
} from './_launchApp.mjs'

const dirs = { userDataDir: '/tmp/case/user-data', settingsDir: '/tmp/case/settings', projectsDir: '/tmp/case/projects' }

describe('buildNomiLaunchEnv', () => {
  test('钉死必需 env 并隔离每个可写路径', () => {
    expect(buildNomiLaunchEnv({ ...dirs, baseEnv: {} })).toEqual({
      NOMI_E2E: '1',
      NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
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

// 假绿闸的类级回归：只读目录**必须**在起飞点炸，不许让走查带着只读目录继续拍截图。
// 这一类的危险不在「红」，而在「绿得跟真绿一样」——所以断言的是「会不会炸 + 说不说得清」。
describe('assertCatalogWritable（走查假绿闸）', () => {
  const winWithHealth = (health) => ({ evaluate: async () => health })

  test('盘上 schema 比被测构建新时抛错，并带出两个版本号与可执行的出路', async () => {
    const win = winWithHealth({
      ok: false,
      writable: false,
      issues: [{ code: 'catalog_read_only_version_skew', severity: 'error', diskVersion: 12, appVersion: 11 }],
    })

    await expect(assertCatalogWritable(win, 'canvas-walk')).rejects.toThrow(/只读/)
    const error = await assertCatalogWritable(win, 'canvas-walk').catch((e) => e)
    // 版本号 derive 自 health，不在走查侧 hardcode。
    expect(error.message).toContain('v12')
    expect(error.message).toContain('v11')
    // 报错要说清「为什么模型断言不可信」，否则下一个人还是会去改断言绕过它。
    expect(error.message).toContain('假绿')
    expect(error.message).toContain('requireCatalog: false')
    expect(error.message).toContain('allowReadOnlyCatalog: true')
  })

  test('目录可写时放行（返回 health，不制造假红）', async () => {
    const health = { ok: true, writable: true, issues: [] }
    await expect(assertCatalogWritable(winWithHealth(health))).resolves.toBe(health)
  })

  test('空目录等无关 issue 不误伤——只认版本偏移那一条', async () => {
    const health = { ok: false, writable: true, issues: [{ code: 'catalog_empty', severity: 'error' }] }
    await expect(assertCatalogWritable(winWithHealth(health))).resolves.toBe(health)
  })

  test('读不到 bridge 时放行（读不到 ≠ 只读，不制造假红）', async () => {
    await expect(assertCatalogWritable({ evaluate: async () => null })).resolves.toBe(null)
    await expect(
      assertCatalogWritable({ evaluate: async () => { throw new Error('no bridge') } }),
    ).resolves.toBe(null)
  })
})

// 无窗口脚本（waitForWindow: false）拿不到渲染层，assertCatalogWritable 无从查起 ——
// 它们是假绿闸唯一的盲区。原先「它们反正不做模型断言」只是看代码看出来的推断，
// 这条把推断变成断言：盲区里的脚本一旦开始播种目录或断言模型选择器，就必须红。
describe('假绿闸的盲区必须保持为空', () => {
  test('waitForWindow:false 的脚本不许播种模型目录或断言模型选择器', () => {
    const roots = ['tests/ux', 'evals', 'scripts']
    const files = roots.flatMap((dir) => {
      const abs = path.join(repoRoot, dir)
      if (!fs.existsSync(abs)) return []
      return fs.readdirSync(abs, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(mjs|ts)$/.test(entry.name))
        .map((entry) => path.join(entry.parentPath, entry.name))
    })

    const offenders = files
      .filter((file) => path.basename(file) !== '_launchApp.mjs') // 选项的定义方自己不算用它
      .filter((file) => !/\.(test|node-test)\.(mjs|ts)$/.test(file)) // 测试文件不是走查脚本（含本文件自指）
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        if (!/waitForWindow:\s*false/.test(source)) return false
        // 这两类正是只读目录会静默毁掉的东西。
        return /upsertVendorApiKey|upsertVendor\(|upsertModel\(|upsertMapping\(/.test(source) ||
          /onModelPick|模型选择器/.test(source)
      })
      .map((file) => path.relative(repoRoot, file))

    expect(offenders).toEqual([])
  })
})
