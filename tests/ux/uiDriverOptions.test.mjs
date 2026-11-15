// 常驻驱动的启动默认值合同：默认隔离 + 安静、证据落仓库外、起始数据只认点名清单、一个工作树一个实例、
// 外面的 NOMI_CAPABILITY_DIR 进不了隔离实例。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  acquireInstanceLock, buildLaunchOptions, DATA_FIXTURES, defaultEvidenceDir, parseDriverArgs, profileBanner,
  seedDataFixture, shotFileName, SIZE_PRESETS,
} from './uiDriverOptions.mjs'
import { assertForegroundAllowed } from './_launchApp.mjs'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const inside = (dir) => {
  const rel = path.relative(repoRoot, dir)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

describe('ui-driver defaults', () => {
  it('bare `up` is isolated, quiet, zh-CN light 1280x800 empty data', () => {
    const options = parseDriverArgs([], {})
    expect(options).toMatchObject({ isolated: true, realProfile: false, locale: 'zh-CN', theme: 'light', sizeName: '1280x800', data: 'empty' })
    const launch = buildLaunchOptions(options, { tempRoot: '/tmp/nomi-ui-driver-x' })
    expect(launch.isolate).not.toBe(false)
    expect(launch.foreground).toBeUndefined()
    expect(launch.tempRoot).toBe('/tmp/nomi-ui-driver-x')
    expect(profileBanner(options)).toMatch(/^PROFILE 隔离/)
  })

  it('isolated launch pins its own capability dir, so an outer NOMI_CAPABILITY_DIR never reaches it', () => {
    const launch = buildLaunchOptions(parseDriverArgs([], { NOMI_CAPABILITY_DIR: '/Users/someone/.nomi/capability' }), { tempRoot: '/tmp/nomi-ui-driver-y' })
    expect(launch.capabilityDir).toBe(path.join('/tmp/nomi-ui-driver-y', 'capability'))
    expect(JSON.stringify(launch)).not.toContain('.nomi/capability')
  })

  it('real profile needs the explicit flag, goes through isolate:false + foreground, and still needs NOMI_WALK_FOREGROUND_OK', () => {
    const options = parseDriverArgs(['--real-profile'], {})
    expect(options.isolated).toBe(false)
    const launch = buildLaunchOptions(options, {})
    expect(launch).toMatchObject({ isolate: false })
    expect(launch.foreground).toMatch(/真实资料/)
    expect(profileBanner(options)).toMatch(/^PROFILE 真实资料/)
    expect(() => assertForegroundAllowed(launch.foreground, {})).toThrow(/NOMI_WALK_FOREGROUND_OK/)
    expect(() => assertForegroundAllowed(launch.foreground, { NOMI_WALK_FOREGROUND_OK: '1' })).not.toThrow()
  })

  it('legacy NOMI_UI_USER_DATA still means isolated', () => {
    const options = parseDriverArgs([], { NOMI_UI_USER_DATA: '/tmp/legacy-ud' })
    expect(options.isolated).toBe(true)
    expect(buildLaunchOptions(options, { tempRoot: '/tmp/nomi-ui-driver-z' }).userDataDir).toBe('/tmp/legacy-ud')
  })

  it('locale, theme and the three named sizes go into the first window', () => {
    const options = parseDriverArgs(['--locale', 'en', '--theme', 'dark', '--size', '700x720'], {})
    const launch = buildLaunchOptions(options, { tempRoot: '/tmp/nomi-ui-driver-w' })
    expect(launch.viewportSize).toEqual({ width: 700, height: 720 })
    expect(launch.initialLocalStorage).toMatchObject({ 'nomi:locale:v1': 'en', 'nomi-color-scheme': 'dark' })
    expect(Object.keys(SIZE_PRESETS)).toEqual(expect.arrayContaining(['1280x800', '1100x720', '700x720']))
    expect(() => parseDriverArgs(['--size', '999x999'], {})).toThrow(/不认识的尺寸/)
  })

  it('evidence defaults outside the repo and refuses a path inside it', () => {
    const options = parseDriverArgs([], {})
    expect(inside(options.out)).toBe(false)
    expect(options.out.startsWith(os.tmpdir())).toBe(true)
    expect(inside(defaultEvidenceDir())).toBe(false)
    expect(() => parseDriverArgs(['--out', path.join(repoRoot, 'tests/ux/shots')], {})).toThrow(/在仓库里/)
  })

  it('shot names carry locale and theme', () => {
    expect(shotFileName('after', { locale: 'en', theme: 'dark' })).toBe('after.en.dark.png')
    expect(shotFileName(undefined, { locale: 'zh-CN', theme: 'light' })).toBe('live.zh-CN.light.png')
  })

  it('start data only from the named list, never an arbitrary path', () => {
    expect(() => parseDriverArgs(['--data', '/Users/someone/Documents/Nomi Projects'], {})).toThrow(/只许点名清单/)
    for (const [name, rel] of Object.entries(DATA_FIXTURES)) {
      if (rel) expect(fs.existsSync(path.join(repoRoot, rel)), name).toBe(true)
    }
    const tempRoot = makeTempDir('nomi-ui-driver-seed-')
    try {
      const settingsDir = seedDataFixture('v0.24.0-library', tempRoot)
      const registry = fs.readFileSync(path.join(settingsDir, 'recent-workspaces.json'), 'utf8')
      expect(registry).not.toContain('__OLD_USER_ROOT__')
      expect(registry).toContain(path.join(tempRoot, 'old-user'))
    } finally {
      cleanupTestTemp(tempRoot)
    }
  })

  it('one instance per worktree: a live holder makes the second start fail loudly', () => {
    const dir = makeTempDir('nomi-ui-driver-lock-')
    try {
      acquireInstanceLock(dir, process.pid)
      expect(() => acquireInstanceLock(dir, process.pid + 100000)).toThrow(/已经起了一个驱动实例/)
      fs.writeFileSync(path.join(dir, 'instance.lock'), '999999999')
      expect(acquireInstanceLock(dir, process.pid)).toBe(path.join(dir, 'instance.lock'))
    } finally {
      cleanupTestTemp(dir)
    }
  })
})
