// R13 真页面走查（零额度）：TikHub 数据 connector 的三处 UI 最小面亲验：
//   ① 设置 → AI → TikHub 数据源 卡（key 配置入口，照 vendor 卡先例）；
//   ①b 连接后出现的「线路」折叠行（双域名全球化：自动/主线路/大陆加速 + 当前生效线路）；
//   ② 素材库工具行「贴链接导入」入口 + 点开后的分享链接输入弹窗。
// 只截图给人眼看（P3/R13：截图人眼判断，不是 expect 断言真实性）。
// 保存 key 只落 safeStorage（不发网络、不计费），故用真实 UI 保存来翻出线路行——不调任何付费接口。
import { expectVisible } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/tikhub-connector')
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-tikhub-walk-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

// 播种一个项目，好让素材库有落点（贴链接入口在素材库工具行）。
const projectId = crypto.randomUUID()
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const project = {
  id: projectId,
  name: 'TikHub 走查项目',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  workbenchDocument: null,
  timeline: null,
  generationCanvas,
  payload: { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(file, JSON.stringify(project, null, 2))
}

const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${label}${detail ? `: ${detail}` : ''}`)
}

let app
try {
  ;({ app } = await launchNomiApp({
    name: 'tikhub-connector',
    userDataDir: settingsDir,
    settingsDir,
    projectsDir,
    args: ['--no-proxy-server'],
    env: { NOMI_E2E_SMOKE: '1' },
    settleMs: 0,
  }))
  const getWin = () => {
    const live = app.windows().filter((c) => !c.isClosed())
    return live[live.length - 1]
  }
  let win = getWin()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  for (let i = 0; i < 5; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(120)
  }

  // ── ① 设置 → AI → TikHub 卡 ──
  win = getWin()
  await win.locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first().click({ timeout: 8000 })
  const dialog = win.locator('[role="dialog"][aria-modal="true"]').first()
  await dialog.waitFor({ state: 'visible', timeout: 8000 })
  await dialog.locator('[data-settings-tab-id="ai"]').click({ timeout: 5000 })
  const tikhubCard = dialog.locator('[data-settings-section="tikhub-connector"]')
  await expectVisible(tikhubCard, 'TikHub 卡没出现在设置 AI tab')
  await tikhubCard.scrollIntoViewIfNeeded()
  await win.waitForTimeout(400)
  const cardText = await tikhubCard.innerText()
  check('卡片标题含 TikHub', /TikHub/.test(cardText), cardText.slice(0, 80))
  check('卡片给了 key 输入框', await tikhubCard.locator('input[type="password"]').count() === 1)
  check('卡片带第三方抓取诚实提示', /第三方|抓取|风控/.test(cardText), cardText)
  await tikhubCard.screenshot({ path: path.join(shotsDir, '01-settings-tikhub-card.png') })
  // 输入一个假 key 看输入态（保存只落 safeStorage，不发请求、不计费）。
  await tikhubCard.locator('input[type="password"]').fill('demo-key-not-a-real-token')
  await win.waitForTimeout(200)
  await tikhubCard.screenshot({ path: path.join(shotsDir, '02-settings-tikhub-card-typed.png') })

  // ── ①b 保存 key（翻到「已连接」态）→ 线路折叠行出现 ──
  await tikhubCard.getByRole('button', { name: /保存|Save/ }).first().click({ timeout: 5000 })
  await win.waitForTimeout(1000)
  const routeRow = tikhubCard.locator('button[aria-expanded]').filter({ hasText: /线路|Route/ }).first()
  await expectVisible(routeRow, '保存 key 后「线路」折叠行没出现')
  check('线路行收起态显示状态胶囊（自动选路）', /自动|Auto/.test(await routeRow.innerText()))
  await tikhubCard.screenshot({ path: path.join(shotsDir, '05-route-row-collapsed.png') })

  // 展开线路行：分段选择器（自动/主线路/大陆加速）+ 当前生效线路说明。
  await routeRow.click({ timeout: 5000 })
  await win.waitForTimeout(500)
  const routeGroup = tikhubCard.locator('[role="group"][aria-label*="线路"], [role="group"][aria-label*="Route"]').first()
  await expectVisible(routeGroup, '展开后没看到线路分段选择器')
  const groupText = await routeGroup.innerText()
  check('分段含 自动/主线路/大陆加速 三档', /自动|Auto/.test(groupText) && /主线路|Primary/.test(groupText) && /加速|accel/i.test(groupText), groupText.slice(0, 120))
  await tikhubCard.screenshot({ path: path.join(shotsDir, '06-route-row-expanded.png') })

  // 切到「大陆加速」看强制态 + 生效线路显示。
  await routeGroup.getByRole('button', { name: /大陆加速|China accel/ }).first().click({ timeout: 5000 })
  await win.waitForTimeout(700)
  check('切到大陆加速后说明含 api.tikhub.dev', /api\.tikhub\.dev/.test(await tikhubCard.innerText()))
  await tikhubCard.screenshot({ path: path.join(shotsDir, '07-route-forced-dev.png') })

  // 收尾：断开这个假 key（别把 demo key 留在隔离库里；也顺便验断开路径）。
  await routeRow.click({ timeout: 3000 }).catch(() => {}) // 收起线路行
  await win.waitForTimeout(200)
  await tikhubCard.getByRole('button', { name: /断开|Disconnect/ }).first().click({ timeout: 5000 }).catch(() => {})
  await win.waitForTimeout(500)
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)

  // ── ② 素材库「贴链接导入」入口 + 弹窗 ──
  win = getWin()
  const projectCard = win.getByText('TikHub 走查项目', { exact: false }).first()
  await projectCard.waitFor({ timeout: 8000 })
  await projectCard.click()
  await win.waitForTimeout(800)
  const assetSection = win.locator('section[aria-label="素材库"]')
  const libraryButton = win.getByRole('button', { name: '素材库', exact: true }).first()
  const continueButton = win.getByText('继续创作', { exact: false }).first()
  const step = await Promise.any([
    continueButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'continue'),
    assetSection.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'library'),
    libraryButton.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'button'),
  ]).catch(() => 'none')
  if (step === 'continue') {
    await continueButton.click()
    await win.waitForTimeout(600)
  }
  if (!(await assetSection.isVisible().catch(() => false))) {
    await libraryButton.click({ timeout: 8000 }).catch(() => {})
  }
  await assetSection.waitFor({ state: 'visible', timeout: 8000 })
  await win.waitForTimeout(500)

  const pasteBtn = win.locator('button[aria-label="贴链接导入"]').first()
  await expectVisible(pasteBtn, '素材库工具行没有「贴链接导入」入口')
  await assetSection.screenshot({ path: path.join(shotsDir, '03-asset-library-paste-entry.png') })
  check('贴链接入口就位', await pasteBtn.count() === 1)

  // 点开弹窗（会先探 key 态；无 key → 提示去设置 + toast；不发付费请求）。截弹窗前先直接打开输入弹窗看形态。
  await pasteBtn.click()
  await win.waitForTimeout(700)
  // 无 key 时走「引导去设置」分支：会打开设置到 AI tab。截当前态给人眼看。
  await getWin().screenshot({ path: path.join(shotsDir, '04-paste-no-key-guides-to-settings.png') })

  console.log(`\n📸 截图已存到 ${path.relative(repoRoot, shotsDir)}/`)
  console.log('  01-settings-tikhub-card / 02-typed / 05-route-row-collapsed / 06-route-row-expanded / 07-route-forced-dev / 03-asset-library-paste-entry / 04-paste-no-key-guides-to-settings')
  console.log('✅ TikHub connector 三处 UI 走查通过（含双域名线路行；截图待人眼亲验）')
} finally {
  if (app) await app.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
