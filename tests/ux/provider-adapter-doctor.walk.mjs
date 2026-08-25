// R13 走查 —— 自动 API 适配器在现有模型设置卡中的亮/暗模式状态。
// 用法: NOMI_ADAPTER_UI_USERDATA=/tmp/nomi-provider-adapter-live.xxxxxx node tests/ux/provider-adapter-doctor.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const userData = process.env.NOMI_ADAPTER_UI_USERDATA
if (!userData || !fs.existsSync(path.join(userData, 'provider-adapters.json'))) {
  throw new Error('Set NOMI_ADAPTER_UI_USERDATA to a completed live adapter harness directory')
}
const shotsDir = path.join(repoRoot, 'tests/ux/shots/provider-adapter-doctor')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const { app, win } = await launchNomiApp({
  name: 'provider-adapter-doctor',
  userDataDir: userData,
  args: ['--disable-gpu'],
  settleMs: 0,
})

try {
  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    window.localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(1_800)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成|先逛逛/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1_200 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(250)
  }
  const panelTrigger = win.locator('button', { hasText: /模型接入|接入模型/ }).first()
  check('找到现有「模型接入」入口', (await panelTrigger.count()) > 0)
  await panelTrigger.click({ timeout: 4_000 })
  const panel = win.getByRole('dialog', { name: '模型设置' })
  await panel.waitFor({ state: 'visible', timeout: 5_000 })
  await win.waitForTimeout(1_200)

  const providerCard = panel.locator('button', { hasText: 'AGNES Blind Auto' }).first()
  check('自动接入供应商复用现有模型卡', (await providerCard.count()) > 0)
  const panelText = await panel.innerText()
  check('卡片显示部分可用', panelText.includes('部分可用'), panelText.match(/部分可用/)?.[0] || '')
  check('卡片显示真实启用数 2 / 3', /2\s*\/\s*3\s*个模型已启用/.test(panelText))
  await screenshotSettled(panel, { path: path.join(shotsDir, '01-light-partial-card.png') })

  await providerCard.click({ timeout: 3_000 })
  await win.waitForTimeout(500)
  const expandedText = await panel.innerText()
  for (const label of ['AGNES 2.0 Flash', 'AGNES Image 2.1 Flash', 'AGNES Video V2.0']) {
    check(`展开卡可见 ${label}`, expandedText.includes(label))
  }
  const failedToggle = panel.getByRole('checkbox', { name: /启用 AGNES Video V2\.0|启用 agnes-video-v2\.0/i }).first()
  check('未验证视频模型开关被锁定', (await failedToggle.count()) > 0 && await failedToggle.isDisabled())
  await failedToggle.scrollIntoViewIfNeeded()
  await win.waitForTimeout(250)
  await screenshotSettled(panel, { path: path.join(shotsDir, '02-light-expanded-models.png') })

  await win.evaluate(() => window.localStorage.setItem('nomi-color-scheme', 'dark'))
  await win.reload()
  await win.waitForTimeout(1_600)
  const darkTrigger = win.locator('button', { hasText: /模型接入|接入模型/ }).first()
  await darkTrigger.click({ timeout: 4_000 })
  const darkPanel = win.getByRole('dialog', { name: '模型设置' })
  await darkPanel.waitFor({ state: 'visible', timeout: 5_000 })
  await win.waitForTimeout(900)
  const theme = await win.evaluate(() => document.documentElement.dataset.theme)
  check('暗色 token 已生效', theme === 'dark', String(theme))
  await screenshotSettled(darkPanel, { path: path.join(shotsDir, '03-dark-partial-card.png') })
} finally {
  await app.close().catch(() => undefined)
}

console.log(`\n═══ API 适配器模型卡 R13：${failures.length === 0 ? '通过' : `失败 ${failures.length} 项`} ═══`)
process.exit(failures.length === 0 ? 0 : 1)
