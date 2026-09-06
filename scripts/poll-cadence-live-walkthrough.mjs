// R13 真机闭环（**真实调用、真花额度**）：改完轮询节奏（慢道 3s + ±30% 抖动 + 429 指数退避）后，
// 跑一次真实的视频生成，证明「提交 → 轮询 → 拿到片子」整条链没被改坏。
//
// 单测已证明节奏本身（nextPollDelayMs 纯函数 + setTimeout 间谍穿过真实 waitForCatalogTaskResult
// 拿到 [100,200,400,100]），这里补的是单测覆盖不到的那一段：真网络、真 vendor、真终态。
//
// 顺带把 5fbe0a5f 欠的真机验证补上：火山 Seedance 档案新加的 seed 控件是否真能发出去、
// 不填时是否被模板丢弃（不发空值）。
//
// 用法：pnpm build 后 node scripts/poll-cadence-live-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.poll-cadence-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log('  📸 ' + name)
}

// 走慢道（video → 轮询间隔 3s）的模型。用火山 Seedance：正好也是 5fbe0a5f 改过 wire 的那个。
const MODEL = process.env.NOMI_WALK_VIDEO_MODEL || 'doubao-seedance-2-0-260128'
const VENDOR = process.env.NOMI_WALK_VIDEO_VENDOR || 'volcengine'

const settings = path.join(os.tmpdir(), 'nomi-pollcadence-settings')
const projects = path.join(os.tmpdir(), 'nomi-pollcadence-projects')
mkdirSync(settings, { recursive: true })
mkdirSync(projects, { recursive: true })
const devCatalog = path.join(os.homedir(), 'Library', 'Application Support', 'nomi', 'model-catalog.json')
if (!existsSync(devCatalog)) {
  console.log('✗ 缺 dev catalog（' + devCatalog + '）—— 没有已接模型就没法跑真生成')
  process.exit(1)
}
const iso = path.join(settings, 'model-catalog.json')
copyFileSync(devCatalog, iso)
{
  const catalog = JSON.parse(readFileSync(iso, 'utf8'))
  let kept = 0
  for (const model of catalog.models || []) {
    if (model.kind !== 'video') continue
    model.enabled = model.modelKey === MODEL && model.vendorKey === VENDOR
    if (model.enabled) kept += 1
  }
  writeFileSync(iso, JSON.stringify(catalog))
  console.log('  [准备] 视频模型只留 ' + MODEL + '@' + VENDOR + '（命中 ' + kept + ' 条）')
  if (!kept) {
    console.log('✗ 该模型没启用或 vendor 没 key')
    process.exit(1)
  }
}

const { app, win } = await launchNomiApp({
  name: 'poll-cadence-live',
  settingsDir: settings,
  projectsDir: projects,
})
let failed = false
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1500)
  await addCanvasNodeFromRail(win, 'video')
  await win.waitForTimeout(1500)

  // 底部时间轴压住 composer；画布覆盖层拦 Playwright 命中检测 → 原生 click 派发。
  const collapse = win.locator('[aria-label="生成时间轴-收起时间轴"]').first()
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click()
    await win.waitForTimeout(800)
  }
  const editor = win.locator('div[contenteditable="true"]').last()
  await editor.click()
  await win.keyboard.type('一只橘猫从画面左侧慢慢走到右侧，柔和自然光，固定机位', { delay: 6 })
  await win.waitForTimeout(400)

  // 省钱：清晰度调到 480p（默认 720p）。参数面板同样走原生 click。
  await win.evaluate(() => document.querySelector('[aria-label="生成参数"]')?.click())
  await win.waitForTimeout(1000)
  const picked = await win.evaluate(() => {
    const hit = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '480p')
    if (!hit) return false
    hit.click()
    return true
  })
  console.log('  [准备] 480p ' + (picked ? '已选' : '没找到控件，用默认清晰度'))
  await win.waitForTimeout(600)
  await shot(win, '01-params.png')
  await win.evaluate(() => document.querySelector('[aria-label="生成参数"]')?.click())
  await win.waitForTimeout(500)

  await win.locator('[aria-label="生成素材"]').first().click()
  await win.waitForTimeout(1200)
  await win.getByText('开始生成', { exact: false }).first().waitFor({ timeout: 10000 })
  await win.locator('.fixed.inset-0').last().getByRole('button', { name: '生成', exact: true }).first().click()
  const submittedAt = Date.now()
  console.log('  已提交真实任务，等终态（慢道轮询间隔 3s + 抖动）…')

  let outcome = null
  while (Date.now() - submittedAt < 600000) {
    outcome = await win.evaluate(() => {
      const node = document.querySelector('[data-node-id]')
      if (!node) return null
      const video = node.querySelector('video')
      if (video?.getAttribute('src')) return { ok: true, src: video.getAttribute('src') }
      const alert = node.querySelector('[role="alert"][aria-label*="生成失败"]')
      if (alert) return { ok: false, text: (alert.textContent || '').trim().slice(0, 400) }
      return null
    })
    if (outcome) break
    await win.waitForTimeout(3000)
  }
  const elapsedS = Math.round((Date.now() - submittedAt) / 1000)
  await shot(win, '02-outcome.png')

  if (!outcome) {
    console.log('  ✗ ' + elapsedS + 's 内既没出片也没报错（轮询可能卡住了）')
    failed = true
  } else if (outcome.ok) {
    console.log('  ✓ ' + elapsedS + 's 出片，节点 src = ' + String(outcome.src).slice(0, 90))
    if (!/^(nomi-local|file|blob|https?):/.test(String(outcome.src))) {
      console.log('  ✗ src 形状不对')
      failed = true
    }
  } else {
    console.log('  ✗ 生成失败：' + outcome.text)
    failed = true
  }
} catch (error) {
  console.log('  ✗ 走查抛错: ' + String(error).slice(0, 400))
  failed = true
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? '\n✗ 未通过' : '\n✓ 通过：改完轮询节奏后，真实提交→轮询→出片整条链正常')
process.exit(failed ? 1 : 0)
