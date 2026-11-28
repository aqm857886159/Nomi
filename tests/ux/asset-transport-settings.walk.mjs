import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13/R16 真页面走查：设置里的「素材上传通道」卡是否**如实**说出素材现在往哪传，
// 以及未授权匿名托管时是否显示「先问我」。零额度。
//
// 走查跑在全新临时 userDataDir 上 → 一个 key 都没有 → 默认先走受限公共 Relay。
// 这正是最该被如实说出来的一态，断言就按它锁死：卡片敢粉饰成「私有链接」就报红。
import { applyColorSchemeForShot, expect, expectText, expectVisible, screenshotSettled } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const shotsDir = path.resolve(process.env.EVIDENCE_DIR || path.join(repoRoot, '.tmp/asset-transport-settings'))
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = makeTempDir('nomi-asset-transport-settings-')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const { app, win: initialWindow } = await launchNomiApp({
  name: 'asset-transport-settings',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let win = initialWindow
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live[live.length - 1] || win
  return win
}
const dialog = () => getWin().locator('[role="dialog"][aria-modal="true"]').first()
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${label}${detail ? `: ${detail}` : ''}`)
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1800)
  await getWin().evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  for (let i = 0; i < 5; i += 1) {
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(120)
  }

  await getWin().locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first().click({ timeout: 8000 })
  await dialog().waitFor({ state: 'visible', timeout: 8000 })
  await dialog().locator('[data-settings-tab-id="ai"]').click({ timeout: 5000 })
  const upload = dialog().locator('[data-settings-upload-guidance]')
  await upload.waitFor({ state: 'visible', timeout: 8000 })
  const text = await upload.innerText()
  check('明确提示公共临时托管风险', /公共|public/i.test(text), text)
  await expect(upload.getByRole('switch', { name: /用公共临时托管前先问我|Ask before using public temporary hosting/ })).toBeChecked()

  // The resolver can choose different routes by kind. Check the group containing each kind.
  for (const kind of ['image', 'video', 'audio']) {
    const group = upload.locator('[data-settings-upload-channels] > div').filter({ has: getWin().locator('[data-upload-channel="' + kind + '"]') })
    await expectVisible(group, kind + ' 上传通道')
    await expectText(group, /任何人可访问|Anyone can open it/, kind + ' 公开链接必须可辨认')
    await expectText(group, /nomi-relay/i, kind + ' 当前通道主机')
  }
  await upload.scrollIntoViewIfNeeded()
  await screenshotSettled(dialog(), { path: path.join(shotsDir, '01-ai-upload-guidance-light.png') })

  await applyColorSchemeForShot(getWin(), 'dark')
  await getWin().waitForTimeout(300)
  await screenshotSettled(dialog(), { path: path.join(shotsDir, '02-ai-upload-guidance-dark.png') })

  console.log(`\n截图目录：${shotsDir}`)
} catch (error) {
  console.error('资产上传设置走查失败:', error)
  await getWin().screenshot({ path: path.join(shotsDir, '99-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
