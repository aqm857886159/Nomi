import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { dismissSplashIfPresent, isolatedAppEnv, prepareIsolation, splashSkipCoveredBy } from './isoApp.mjs'

const roots = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('eval isolation catalog boundary', () => {
  test('allocates a capability directory and propagates it with the other isolated roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-iso-app-'))
    roots.push(root)

    const iso = prepareIsolation(root, { requireCatalog: false })
    const env = isolatedAppEnv(iso, {})

    expect(fs.existsSync(iso.capabilityDir)).toBe(true)
    expect(env.NOMI_CAPABILITY_DIR).toBe(iso.capabilityDir)
    expect(env.NOMI_SETTINGS_DIR).toBe(iso.settingsDir)
  })

  test('isolates the host configs too: every host location variable points at an existing dir under the isolation root', () => {
    // 2026-10-24：只隔离 Nomi 自己的目录时，评测起的 App 读的是本机真实的 ~/.claude.json。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-iso-app-'))
    roots.push(root)
    const iso = prepareIsolation(root, { requireCatalog: false })
    const env = isolatedAppEnv(iso, { CLAUDE_CONFIG_DIR: '/developer/real/claude', CODEX_HOME: '/developer/real/codex' })
    expect(iso.hostConfigDir).toBe(path.join(root, 'host-config'))
    for (const name of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME']) {
      expect(env[name], name).toBe(path.join(iso.hostConfigDir, name))
      expect(fs.statSync(env[name]).isDirectory(), name).toBe(true)
    }
  })

  test('requireCatalog: false never copies the real profile, even when this machine has one', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-iso-real-profile-'))
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-iso-app-'))
    roots.push(real, root)
    fs.writeFileSync(path.join(real, 'model-catalog.json'), JSON.stringify({ version: 1, vendors: [], models: [], apiKeysByVendor: { fixture: { enc: 'safeStorage', value: 'x' } } }))
    // Fake DPAPI profile is complete on Windows; no real credential files are read.
    fs.writeFileSync(path.join(real, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: 'fixture-only' } }))
    const previous = process.env.NOMI_REAL_PROFILE_USER_DATA
    process.env.NOMI_REAL_PROFILE_USER_DATA = real
    try {
      const hermetic = prepareIsolation(path.join(root, 'hermetic'), { requireCatalog: false })
      expect(fs.readdirSync(hermetic.settingsDir)).toEqual([])
      const seeded = prepareIsolation(path.join(root, 'seeded'), { requireCatalog: true })
      expect(fs.existsSync(path.join(seeded.settingsDir, 'model-catalog.json'))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.NOMI_REAL_PROFILE_USER_DATA
      else process.env.NOMI_REAL_PROFILE_USER_DATA = previous
    }
  })
})

// 2026-10-27：顶栏（z 100）压着开屏（z 60），「跳过」被盖住点不到；这个 helper 在 Playwright 真点超时后悄悄改用 DOM click 兜底，
// 十来条走查靠它一直绿。现在：真点没成且「跳过」中心被别的元素盖住 → 抛错；没被盖住（动画首帧 / 开屏不在）→ 行为和以前一样。
class StubElement {
  constructor(props = {}) {
    this.tagName = props.tagName ?? 'DIV'
    this.attrs = props.attrs ?? {}
    this.clicked = 0
  }
  getAttribute(name) { return this.attrs[name] ?? null }
  getBoundingClientRect() { return { left: 1200, top: 28, width: 32, height: 18 } }
  contains(other) { return other === this }
  click() { this.clicked += 1 }
}

function stubPage({ skip, hit, clickFails }) {
  vi.stubGlobal('HTMLElement', StubElement)
  vi.stubGlobal('document', {
    querySelector: (selector) => (selector.includes('data-splash-skip') ? skip : null),
    elementFromPoint: () => hit,
  })
  const calls = { click: 0 }
  const evaluate = vi.fn(async (fn) => fn())
  const win = {
    locator: () => ({
      click: async () => {
        calls.click += 1
        if (clickFails) throw new Error('locator.click: Timeout 4000ms exceeded')
      },
      waitFor: async () => undefined,
    }),
    evaluate,
  }
  return { win, calls, evaluate }
}

describe('dismissSplashIfPresent：「跳过」被盖住必须红，不能再用 DOM click 悄悄放过', () => {
  test('真点成功：一次真点，不碰 DOM 兜底', async () => {
    const skip = new StubElement({ tagName: 'BUTTON' })
    const { win, calls, evaluate } = stubPage({ skip, hit: skip, clickFails: false })
    await dismissSplashIfPresent(win)
    expect(calls.click).toBe(1)
    expect(evaluate).not.toHaveBeenCalled()
  })

  test('真点超时且中心被顶栏里的别的元素盖住：抛错点名盖住它的元素，DOM click 不放行', async () => {
    const skip = new StubElement({ tagName: 'BUTTON' })
    const toolbar = new StubElement({ attrs: { 'aria-label': 'probe-toolbar' } })
    const { win } = stubPage({ skip, hit: toolbar, clickFails: true })
    await expect(dismissSplashIfPresent(win)).rejects.toThrow(/被别的元素盖住.*div\[probe-toolbar\]/)
    expect(skip.clicked).toBe(0)
  })

  test('真点超时但中心就是「跳过」自己（动画首帧偶发）：照旧 DOM click 收尾', async () => {
    const skip = new StubElement({ tagName: 'BUTTON' })
    const { win } = stubPage({ skip, hit: skip, clickFails: true })
    await dismissSplashIfPresent(win)
    expect(skip.clicked).toBe(1)
  })

  test('开屏不在（首启已看过）：静默返回，不抛', async () => {
    const { win } = stubPage({ skip: null, hit: null, clickFails: true })
    await expect(dismissSplashIfPresent(win)).resolves.toBeUndefined()
  })

  test('splashSkipCoveredBy：点在窗口外（elementFromPoint 给 null）判不了，不当成被盖住', async () => {
    const skip = new StubElement({ tagName: 'BUTTON' })
    const { win } = stubPage({ skip, hit: null, clickFails: true })
    await expect(splashSkipCoveredBy(win)).resolves.toBeNull()
  })
})
