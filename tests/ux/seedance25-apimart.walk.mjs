// R13 走查：apimart Seedance 2.5 接入后，节点上到底长什么样（2026-08-12）。
// 用法: node tests/ux/seedance25-apimart.walk.mjs
// 产出: tests/ux/shots/seedance25-apimart/*.png
//
// 要人眼判的两条（都是这次接入的核心主张）：
//   ① 模型出现在视频节点的模型选择里，且有 4 个模式（文生/首帧/首尾帧/全能参考）
//   ② **首尾帧模式不显示「比例」控件** —— 官方要求 size 必须 adaptive，我们用 fixedParams 发常量，
//      不做成只有一个选项的假下拉（设计系统 C1：可点即有效）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/seedance25-apimart')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-s25-userdata')
const settingsDir = path.join(repoRoot, '.tmp', 'nomi-s25-settings')
for (const dir of [userData, settingsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}
// 给 apimart 一把明文假 key，让模型在选择器里可见（本走查只看 UI，不发真实请求）。
fs.writeFileSync(
  path.join(settingsDir, 'model-catalog.json'),
  JSON.stringify({
    version: 1,
    vendors: [],
    models: [],
    mappings: [],
    apiKeysByVendor: {
      apimart: { vendorKey: 'apimart', apiKey: 'sk-walkthrough-fake', enc: 'plain', enabled: true, createdAt: '', updatedAt: '' },
    },
  }, null, 2),
)

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

// 走统一启动器：手抄 launch 会漏 NOMI_E2E / NOMI_E2E_ALLOW_MULTI_INSTANCE，漏了就静默挂死。
const { app, win } = await launchNomiApp({
  name: 'seedance25-apimart',
  userDataDir: userData,
  settingsDir,
  env: { NODE_ENV: 'production' },
  settleMs: 0,
})
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) { w.setSize(1680, 1050); w.center() }
}).catch(() => {})
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2500)

await win.evaluate(() => {
  window.localStorage.setItem('__nomiE2E', '1')
  for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) {
    window.localStorage.setItem(key, 'seen')
  }
})
await win.reload()
await win.waitForTimeout(2000)
for (let i = 0; i < 5; i += 1) {
  const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛|Skip/i }).first()
  if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(250)
}

// 先确认种子把模型接进来了（主进程侧事实，与 UI 无关）。
const cat = JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
const seededModel = (cat.models || []).find((x) => x.modelKey === 'doubao-seedance-2.5')
const seededMaps = (cat.mappings || []).filter((x) => x.modelKey === 'doubao-seedance-2.5')
console.log('  · 种子结果: ' + (seededModel
  ? `找到 kind=${seededModel.kind} enabled=${seededModel.enabled} archetypeId=${seededModel.meta?.archetypeId} mappings=[${seededMaps.map((x) => x.taskKind).join(',')}]`
  : '❌ 没被种进目录'))

const newProject = win.getByText('新建空白项目', { exact: false }).first()
if (await newProject.count()) {
  await newProject.click({ timeout: 6000 }).catch(() => {})
  await win.waitForTimeout(2500)
}
// 关掉「上手 4 步」引导，否则它盖住半个界面。
for (const label of ['不再提示', '关闭']) {
  const btn = win.locator('button,[role="button"]').filter({ hasText: label }).first()
  if (await btn.count()) { await btn.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(500) }
}
await win.keyboard.press('Escape').catch(() => {})
await win.waitForTimeout(600)
// 新建项目默认落在「创作」文本页，画布在「生成」页。
const genTab = win.locator('button,[role="tab"],[role="button"]').filter({ hasText: /^\s*生成\s*$/ }).first()
if (await genTab.count()) { await genTab.click({ timeout: 5000 }).catch(() => {}); await win.waitForTimeout(2500) }
await snap(win, 'canvas')

// 左缘加节点收口在 _canvasRail：软守卫 + .catch(() => {}) 在按钮找不到时会静默什么都不做，
// 后面每一步都在空画布上「通过」。助手找不到当场抛。
await addCanvasNodeFromRail(win, 'video', { timeout: 6000 })
await win.waitForTimeout(1500)
await snap(win, 'video-node')

// 模型按钮在节点下方的 composer 里（不在节点内），默认显示当前模型名（如 Vidu Q3）。
const modelBtn = win.locator('button').filter({ hasText: /Vidu|Seedance|Veo|Sora|Kling|Wan|Hailuo|HappyHorse|Grok/ }).first()
if (await modelBtn.count()) {
  await modelBtn.click({ timeout: 5000 }).catch(() => {})
  await win.waitForTimeout(1200)
  await snap(win, 'model-picker')
  const pick = win.getByText('Seedance 2.5', { exact: false }).first()
  console.log('  · 选择器里有 Seedance 2.5: ' + ((await pick.count()) > 0 ? '✅' : '❌'))
  if (await pick.count()) {
    await pick.click({ timeout: 4000 }).catch(() => {})
    await win.waitForTimeout(1500)
  }
}
await snap(win, 'seedance25-selected')
console.log('  · 选完后底栏按钮: ' + (await win.locator('button').allTextContents().catch(() => [])).filter((t) => t.trim()).join(' | ').slice(0, 400))

// 比例控件在 composer 底栏。判据：底栏里有没有出现比例字样/值。
async function composerText() {
  const btns = await win.locator('button').allTextContents().catch(() => [])
  return btns.join(' | ')
}
async function ratioControlVisible() {
  return /比例|adaptive|16:9|9:16|21:9/.test(await composerText())
}

// 模式切换：逐个点，记录每个模式下「比例」控件在不在。
for (const term of ['文生视频', '首帧', '首尾帧', '全能参考']) {
  const modeBtn = win.locator('button,[role="tab"],[role="menuitem"],[role="option"]').filter({ hasText: term }).first()
  if (!(await modeBtn.count())) { console.log(`  · 模式「${term}」没找到入口`); continue }
  await modeBtn.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(1200)
  console.log(`  · 模式「${term}」比例控件: ${(await ratioControlVisible()) ? '显示' : '不显示'}`)
  await snap(win, `mode-${term}`)
  // 展开参数摘要，看里面到底给了哪些选项、选中的是什么（摘要文字会骗人）。
  const chip = win.locator('button').filter({ hasText: /720p|16:9|adaptive/ }).first()
  if (await chip.count()) {
    await chip.click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(900)
    await snap(win, `params-${term}`)
    const panel = (await win.locator('[role="dialog"],[role="menu"],[data-radix-popper-content-wrapper]').allTextContents().catch(() => [])).join(' ¦ ')
    console.log(`    参数面板: ${panel.slice(0, 300)}`)
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(500)
  }
}

await app.close().catch(() => {})
console.log(`\n截图在 ${shotsDir}`)
process.exit(0)
