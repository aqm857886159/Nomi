// R13/R16 真页面走查：设置里的「素材上传通道」卡是否**如实**说出素材现在往哪传，
// 以及「去配置 KIE」是否真把人送到 Key 输入框（而不是丢在模型列表页让人自己找）。零额度。
//
// 走查跑在全新临时 userDataDir 上 → 一个 key 都没有 → 图片和视频必然都落到匿名公共托管。
// 这正是最该被如实说出来的一态，断言就按它锁死：卡片敢粉饰成「私有链接」就报红。
import { clickOrFail, expectText, expectVisible, screenshotSettled } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/asset-transport-settings')
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-asset-transport-settings-'))
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
  check('设置页出现 KIE 上传说明', /KIE/.test(text), text)
  check('明确说明上传免费', /免费|free/i.test(text), text)
  check('明确提示公共临时托管风险', /公共|public|隐私|privacy/i.test(text), text)
  check('公共托管提醒开关默认打开', await upload.locator('input[type="checkbox"]').count() === 1 && await upload.locator('input[type="checkbox"]').isChecked(), text)

  // 卡片必须逐类型说出现在走哪条——这是它存在的全部意义（用户此前看完仍不知道自己配没配）。
  const imageRow = upload.locator('[data-upload-channel="image"]')
  const videoRow = upload.locator('[data-upload-channel="video"]')
  await expectVisible(imageRow, '「图片」那条上传通道没显示：状态卡不说现状就退化回一句广告')
  await expectVisible(videoRow, '「视频」那条上传通道没显示')
  // 没有任何 key 的现场，两条都只能是匿名公共图床。写成「私有链接」= 卡片在骗人，必须报红。
  for (const [label, row] of [['图片', imageRow], ['视频', videoRow]]) {
    await expectText(
      row,
      /任何人可访问|Anyone can open it/,
      `未配任何 key 时「${label}」通道没如实标成公开可访问——用户会据此误判参考素材的隐私风险`,
    )
    await expectText(row, /litterbox|tmpfiles/, `「${label}」通道没说出真正收文件的主机名`)
  }
  await screenshotSettled(dialog(), { path: path.join(shotsDir, '01-ai-upload-guidance-light.png') })

  await getWin().evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'))
  await getWin().waitForTimeout(300)
  await screenshotSettled(dialog(), { path: path.join(shotsDir, '02-ai-upload-guidance-dark.png') })

  await clickOrFail(upload.getByRole('button', { name: /配置 KIE|Configure KIE/i }), '去配置 KIE')
  const modelWorkspace = dialog().locator('[data-settings-model-workspace]')
  await expectVisible(modelWorkspace, '「去配置 KIE」没进到模型工作区')

  // 这一条是本次改动的核心：以前点完只是切到模型 tab，KIE 那行静静躺在列表里、副标题还不提上传，
  // 用户点过去等于断线（他因此以为「我们没配置上传」）。现在必须直接落到 KIE 的 Key 输入页。
  const kieKeyInput = dialog().locator('#key-only-kie')
  await expectVisible(kieKeyInput, '没直达 KIE 的 Key 输入框：又把用户丢回模型列表页自己找')
  const focusedId = await getWin().evaluate(() => document.activeElement?.id ?? '')
  check('光标已经落在 KIE 的 Key 输入框里', focusedId === 'key-only-kie', `activeElement=#${focusedId || '(none)'}`)
  await screenshotSettled(dialog(), { path: path.join(shotsDir, '03-kie-model-settings.png') })
  console.log(`\n截图目录：${shotsDir}`)
} catch (error) {
  console.error('资产上传设置走查失败:', error)
  await getWin().screenshot({ path: path.join(shotsDir, '99-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
