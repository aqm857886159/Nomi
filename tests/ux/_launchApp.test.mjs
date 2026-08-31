// 钉住启动器的核心不变量（替掉原 helpers/electronFixture.test.mjs，2026-08-11 收敛）。
// 这条不变量就是本次修复的根因：漏掉这两个 env，窗口起不来且**毫无提示**，只会干等到超时。
import { describe, expect, test } from 'vitest'
import { buildNomiLaunchEnv, withLinuxNoSandbox } from './_launchApp.mjs'

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
