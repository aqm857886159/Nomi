import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13 真页面走查（零额度）：TikHub 数据 connector 的 UI 亲验，两处重点：
//   ① 归位：TikHub 卡的家在 **设置 → 模型 → 数据源** 区（2026-09-01 从「AI 策略」搬来——它是数据源接入，不是 AI 策略）。
//   ② 假成功已修：保存一个**乱填的 key** → 得到**诚实错误态**（不再显示「已连接」、不出现「线路」行）。
//      真实校验（打 TikHub 鉴权账户端点验 key）在无真 key/无网的沙箱里必然失败——
//      失败可能是 auth（网通、被 TikHub 拒）或 no-route（网不通），两者都是诚实错误、都不是假的「已连接」。
//   ③ 素材库工具行「贴链接导入」入口 + 无 key 时引导去设置。
// 截图给人眼看（P3/R13）。**不调任何付费接口**：校验端点是免费账户端点；乱 key 只会被拒，不计费。
// ⚠️ 正确 key 的「已连接 + 线路行」正路需要真 key + 真网，沙箱里给不了——本走查只验错误路径（任务允许），
//    真 key 路径见文件末尾说明与 tikhub-connector.e2e（TIKHUB_E2E=1）。
import { expectVisible, expectAbsent, proveProbe, clickOrFail, scopedText } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/tikhub-connector')
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = makeTempDir('nomi-tikhub-walk-')
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

  // ── ① 归位亲验：设置 → 模型 tab → 「数据源」区里的 TikHub 卡 ──
  win = getWin()
  await clickOrFail(win.locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first(), '打开设置')
  const dialog = win.locator('[role="dialog"][aria-modal="true"]').first()
  await expectVisible(dialog, '设置对话框没打开')
  await clickOrFail(dialog.locator('[data-settings-tab-id="models"]'), '切到「模型」tab')
  await win.waitForTimeout(1200) // OnboardingDrawer 懒加载 + 目录读取

  // 卡的新家在「数据源」分组里（data-model-home-data-sources）。先证这个分组在「模型」tab 出现。
  const dataSourceSection = dialog.locator('[data-model-home-data-sources]')
  await expectVisible(dataSourceSection, 'TikHub 卡的新家「数据源」分组没出现在「模型」tab')
  const tikhubCard = dialog.locator('[data-settings-section="tikhub-connector"]')
  await expectVisible(tikhubCard, 'TikHub 卡没出现在「模型」tab 的数据源区')
  await tikhubCard.scrollIntoViewIfNeeded()
  await win.waitForTimeout(400)
  const cardText = await scopedText(tikhubCard)
  check('卡片标题含 TikHub', /TikHub/.test(cardText), cardText.slice(0, 80))
  check('卡片给了 key 输入框', await tikhubCard.locator('input[type="password"]').count() === 1)
  check('卡片带第三方抓取诚实提示', /第三方|抓取|风控/.test(cardText), cardText)
  // 「数据源」分组标题与它同在，且与模型家清单分开（P4：数据源≠模型）。
  check('数据源分组有标题', /数据源|Data source/i.test(await scopedText(dataSourceSection)))
  await tikhubCard.screenshot({ path: path.join(shotsDir, '01-settings-models-tab-datasource-card.png') })

  // ── ② 假成功已修：乱填 key → 诚实错误态（不「已连接」、不出「线路」行）──
  // 先在「保存前」证明「线路」行探针是活的：此刻它必然不存在（没连接），作为 expectAbsent 的对照，
  // 我们证的是同屏必然存在的对照物（key 输入框），排除「卡没渲染 / 选择器写错」这种恒真情形。
  const keyInput = tikhubCard.locator('input[type="password"]')
  const inputProof = await proveProbe(keyInput, '未连接时 key 输入框在场（数据源卡已渲染）')

  await keyInput.fill('totally-bogus-key-0000')
  await win.waitForTimeout(150)
  await clickOrFail(tikhubCard.getByRole('button', { name: /保存|Save|验证中|Verifying/ }).first(), '点保存（触发真实校验）')

  // 校验会真打一发（免费账户端点）。等它落地：要么 auth（被拒）要么 no-route（网不通），都给诚实错误。
  const errorLine = tikhubCard.locator('.text-workbench-danger')
  await expectVisible(errorLine, '乱填 key 保存后没有给出任何错误提示（这就是修掉的「假成功」）')
  const errText = await scopedText(errorLine)
  check(
    '错误文案诚实（Key 无效 / 连不上验证 / 额度），不是「保存成功」',
    /无效|未通过|连不上|无法验证|额度|Invalid|verif|reach|quota/i.test(errText),
    errText,
  )
  // 关键不变量：**没有假的「已连接」**——「线路」行只在真连接后出现，此刻必须不存在。
  const routeRow = tikhubCard.locator('button[aria-expanded]').filter({ hasText: /线路|Route/ })
  await expectAbsent(routeRow, {
    provenBy: inputProof,
    message: '乱填 key 竟出现了「线路」行 = 又把未验证的 key 当成已连接了（假成功）',
  })
  // 且卡片仍停在「可改 key」的输入态（没收起成「已连接」视图）。
  check('乱填 key 后仍停在输入态（未收起为「已连接」）', await keyInput.count() === 1)
  await tikhubCard.screenshot({ path: path.join(shotsDir, '02-bogus-key-honest-error.png') })

  // 关设置：在「模型」tab 上 Esc 是「抽屉返回」不是「关对话框」（SettingsDialog 的 Esc 分支），
  // 所以点关闭按钮（× = data-settings-close）才是关整个对话框的规范动作。
  await clickOrFail(dialog.locator('[data-settings-close]').first(), '关闭设置对话框')
  await dialog.waitFor({ state: 'hidden', timeout: 8000 })

  // ── ③ 素材库「贴链接导入」入口 + 无 key 引导 ──
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

  // 点开：无 key 时走「引导去设置」分支（现在深链跳到「模型」tab 的数据源区）。截当前态给人眼看。
  await pasteBtn.click()
  await win.waitForTimeout(700)
  await getWin().screenshot({ path: path.join(shotsDir, '04-paste-no-key-guides-to-settings.png') })

  console.log(`\n📸 截图已存到 ${path.relative(repoRoot, shotsDir)}/`)
  console.log('  01-settings-models-tab-datasource-card / 02-bogus-key-honest-error / 03-asset-library-paste-entry / 04-paste-no-key-guides-to-settings')
  console.log('✅ TikHub 走查通过：卡在「模型→数据源」新家；乱填 key 得到诚实错误态（无假「已连接」）；截图待人眼亲验')
  console.log('ℹ️ 正确 key 的「已连接 + 线路行」正路需真 key + 真网，沙箱给不了；见 tikhub-connector.e2e（TIKHUB_E2E=1）')
} finally {
  if (app) await app.close().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
